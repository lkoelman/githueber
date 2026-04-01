Here is a detailed implementation plan focusing on the **OpenCode Execution Plane**, specifically how to design the Agent Definitions, Skills, and the ACP interface that bridges them to your TypeScript daemon.

Because we are keeping the non-deterministic logic strictly inside OpenCode, the "Coding Agent" is actually a combination of **Markdown-based Agent Definitions** and **Skill Definitions**, driven by structured context passed via ACP.

### Phase 1: Workspace & Skill Implementation

The agents need to interact with GitHub autonomously without relying on the daemon for every API call. We achieve this by providing a highly constrained OpenCode Skill wrapping the GitHub CLI (`gh`).

**1. Create the GitHub CLI Skill (`.opencode/skills/github-cli/SKILL.md`)**
This skill definition teaches the LLM exactly how to use the `gh` tool. It must contain strict instructions to prevent the agent from destructive actions.

* **Skill Name:** `github-cli`
* **Description:** "Allows the agent to view issues, post comments, and create pull requests using the GitHub CLI."
* **Instructions to include in `SKILL.md`:**
    * **Viewing Issues:** "Use `gh issue view <issue-number> --json title,body,comments` to understand the task."
    * **Commenting:** "Use `gh issue comment <issue-number> --body '<your-comment>'` to post plans or ask questions."
    * **Creating PRs:** "Use `gh pr create --title '<title>' --body '<description>' --base main --head <your-branch>` to submit your work."
    * **Creating Sub-issues (for Orchestrator):** "Use `gh issue create --title '<title>' --body '<description>' --label 'agent-queue'` to delegate sub-tasks."
    * **Constraints:** "NEVER use `gh repo delete` or modify issue labels directly unless instructed. Do not close issues; the user or daemon will handle state management."

### Phase 2: Agent Definitions (The "Brains")

We will define two distinct agent types using OpenCode's custom agent markdown format.

#### 1. The Worker Agent (`.opencode/agents/github-worker-agent.md`)
This agent handles `bug-fix` and `feature-request` labels. It strictly adheres to the Plan -> Await Approval -> Execute workflow.

**Prompt Structure for `github-worker-agent.md`:**
* **Role:** "You are an expert autonomous software engineer."
* **Context Ingestion:** "You will be provided with a GitHub Issue ID and basic context via your initialization prompt. Your first step is ALWAYS to use the `github-cli` skill to fetch the full issue details and conversation history."
* **Workflow Instructions (Crucial for HITL):**
    1.  **Investigate:** Analyze the codebase relative to the issue request.
    2.  **Plan:** Formulate a step-by-step implementation plan.
    3.  **Propose:** Use `gh issue comment <id>` to post your plan to the GitHub issue. **End your comment with the exact phrase: `[AWAITING_APPROVAL]`**.
    4.  **Yield:** Pause your execution and wait for the user to reply via the ACP interface. Do NOT write code yet.
    5.  **Execute:** Once the ACP interface provides the user's approval message, write the code, run local tests, and commit to a new branch (e.g., `fix/issue-<id>`).
    6.  **Deliver:** Use `gh pr create` to open a pull request linking to the issue.

#### 2. The Orchestrator Agent (`.opencode/agents/github-orchestrator-agent.md`)
This agent handles `epic` or `refactor` labels where tasks need subdivision.

**Prompt Structure for `github-orchestrator-agent.md`:**
* **Role:** "You are an expert Lead Engineer and Technical Project Manager."
* **Workflow Instructions:**
    1.  **Analyze Epic:** Fetch the full epic issue using `gh issue view <epic-id>`.
    2.  **Decompose:** Break the epic down into isolated, self-contained coding tasks.
    3.  **Delegate:** For each sub-task, use `gh issue create` to create a new issue.
    4.  **Link & Label (Critical):** You MUST add the label `agent-queue` to every new issue you create so the daemon picks it up. You MUST mention the parent Epic ID in the description (e.g., `Relates to #<epic-id>`) to maintain traceability.
    5.  **Report:** Comment on the parent Epic summarizing the sub-issues created, then terminate.

### Phase 3: The ACP Interface (The "Bridge")

Your TypeScript daemon will use the ACP TypeScript SDK to manage these agents. The daemon's primary job is translating GitHub webhook/polling data into the `initialization_prompt` for the ACP session.

**1. Session Initialization Payload**
When the TS Daemon detects a new `agent-queue` issue, it maps it to the appropriate agent and starts an ACP session.

```typescript
// TypeScript Daemon Side
const sessionConfig = {
  agent: issue.labels.includes('epic') ? 'github-orchestrator-agent' : 'github-worker-agent',
  initialization_prompt: `
    SYSTEM INSTRUCTION: You are being invoked by the GitHub Daemon Orchestrator.

    TARGET ISSUE: #${issue.number}
    TITLE: ${issue.title}
    REPOSITORY PATH: ${config.target_repo_path}

    ACTION REQUIRED:
    Checkout to the repository path.
    Begin your defined workflow for Issue #${issue.number}.
  `
};
// Start ACP Session with this config...
```

**2. Handling the Approval Loop via ACP**
To implement the approval constraint without the agent busy-looping:
1.  **Agent Posts Plan:** The agent posts a comment via `gh` CLI and stops generating (or enters a natural `waitForInput` state if supported by your specific OpenCode ACP implementation).
2.  **Daemon Detects Plan:** The TS Daemon polls GitHub, sees the agent's comment (ending in `[AWAITING_APPROVAL]`), and updates the issue label to `await-plan`. The daemon *leaves the ACP session open but idle*.
3.  **User Approves:** The user comments `/approve` or `/revise: change X`.
4.  **Daemon Resumes Session:** The TS Daemon detects the comment, updates the label to `agent-processing`, and sends a new message to the existing ACP session:

```typescript
// TypeScript Daemon Side
const userComment = fetchNewComment(issue.number);

if (userComment.startsWith('/approve')) {
    await acpClient.sendMessage(sessionId, "The user has approved your plan. Proceed with execution and PR creation.");
} else if (userComment.startsWith('/revise')) {
    await acpClient.sendMessage(sessionId, `The user requested revisions to your plan: ${userComment}. Please write a new plan and post it for approval.`);
}
```

### Next Steps for You

To build this, I recommend the following order of execution:
1.  **Initialize the TS Project:** Set up the standard Node/TypeScript project with `@octokit/rest` and the `@agentclientprotocol/sdk`.
2.  **Write the Markdown Files:** Create the `.opencode/agents/` and `.opencode/skills/` directories in a test repository and author the prompts detailed in Phase 1 and 2.
3.  **Test the Agent Manually:** Run OpenCode manually from the terminal, select your custom Worker Agent, and paste the `initialization_prompt` to ensure it successfully reads an issue, posts a plan, and stops.
4.  **Build the Daemon Control Loop:** Write the TypeScript polling logic to automate what you just did manually.

Shall we dive into the TypeScript class structure for the Daemon (e.g., `GitHubPoller`, `SessionManager`, `StateRouter`) next?