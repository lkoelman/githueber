We are building a persistent daemon that bridges GitHub (acting as the memory, state machine, and human-in-the-loop UI) with an Agentic Coding Harness (OpenCode) via the Agent Client Protocol (ACP).


The **TypeScript Daemon should act as a deterministic Control Plane**, applying strict scoping rules, rate-limited polling, and label-based filtering to condense context. It then passes this highly structured context over ACP to an **OpenCode Orchestrator Agent or Worker Agent**, which uses native LLM reasoning and `gh` CLI skills to perform the non-deterministic work (planning, coding, delegating).

Here is the proposed high-level system design.

### High-Level System Architecture

```mermaid
flowchart TB
    %% External Systems
    subgraph Cloud [GitHub Cloud - High Level Memory & UI]
        GH_Issues[Issues & Epics]
        GH_PRs[Pull Requests]
        GH_Comments[Issue Comments\n/approve, /revise]
    end

    %% Daemon Host
    subgraph Host [Ubuntu 24 Daemon Service]
        subgraph Daemon [TypeScript Daemon Service]
            direction TB
            Poller[GitHub State Poller\n(Octokit, Rate-Limit Aware)]
            Filter[State Filter & Router\n(Label & Keyword Logic)]
            SessionMgr[Session & Context Manager\n(Map Issues to ACP Sessions)]
            ACP_Client[ACP TypeScript Client]

            Poller -->|Raw State| Filter
            Filter -->|Filtered Context\n(Issue ID, Labels)| SessionMgr
            SessionMgr <-->|Create/Resume/Message| ACP_Client
        end
    end

    %% OpenCode Environment
    subgraph OpenCodeEnv [OpenCode Harness Environment]
        ACP_Server[ACP Server Endpoint]

        subgraph Agents [Agent Pool]
            Orchestrator[Orchestrator Agent\n(Refines Epics -> Sub-tasks)]
            Worker[Worker Agent\n(Bugfix, Feature, Docs)]
        end

        subgraph Skills [Custom Skills & Tools]
            GH_CLI[GitHub CLI Skill\n(gh issue comment, gh pr create)]
            Git_CLI[Git Operations]
            Code_Tools[Linter, Compiler, etc.]
        end

        Workspace[(Local Git Repository)]

        ACP_Server <--> Orchestrator
        ACP_Server <--> Worker
        Orchestrator -.->|Uses| Skills
        Worker -.->|Uses| Skills
        Worker -.->|Modifies| Workspace
    end

    %% Connections
    GH_Issues <-->|Polls State / Updates Labels| Poller
    GH_Comments -->|Reads user commands| Poller

    ACP_Client <==>|Agent Client Protocol| ACP_Server

    GH_CLI -.->|Autonomous Agent Actions| GH_Issues
    GH_CLI -.->|Autonomous PRs| GH_PRs
```

### Component Breakdown

#### 1. The GitHub Layer (Memory & UI)
GitHub acts as the single source of truth. The user interacts entirely through the GitHub web UI.
* **State Machine:** Managed via labels (`agent-queue`, `agent-processing`, `await-plan`, `agent-completed`).
* **Human-in-the-loop (HITL):** Managed via issue comments (e.g., user typing `/approve` or `/revise: please use a PostgreSQL database instead`).

#### 2. The TypeScript Daemon (Control Plane)
Run as a `systemd` service, this component contains **no AI logic**. It is purely deterministic.
* **Smart Poller:** Uses `@octokit/rest`. It checks `ETag` headers and the `since` parameter to only fetch changed issues/comments, strictly respecting GitHub's rate limits.
* **State Router:** Evaluates the fetched state against your configuration (similar to your `yaml` file).
    * *If an issue has `agent-queue` + `bug`*, it maps to the `bug-fixer-agent`.
    * *If an issue is an `epic`*, it maps to the `orchestrator-agent`.
* **ACP Session Manager:** Uses the ACP TypeScript SDK to start isolated OpenCode sessions. It passes a condensed JSON context (Issue ID, title, description, repository path) to the agent as its initialization prompt. If an agent is waiting for approval, the Daemon pauses the state. When `/approve` is detected, the Daemon sends an ACP message to resume the paused session.

#### 3. OpenCode Harness (Execution Plane)
This is where the agentic work happens, invoked via ACP.
* **Custom Agent Definitions (Markdown):** * **Orchestrator Agent:** Instructed to read a high-level feature request, write a breakdown plan, and use the `gh` CLI to generate sub-issues (adding the `agent-queue` label to them so the Daemon picks them up on the next polling cycle).
    * **Worker Agents:** Instructed to checkout a branch, read the issue context, write a plan, post the plan to GitHub via `gh issue comment`, and yield execution back to the user until approval is granted. Once approved, it writes code and submits a PR.
* **Custom Skills (`SKILL.md`):** Agents are restricted from using generic web requests to talk to GitHub. Instead, they are provided a highly specific `gh-cli` skill definition, teaching them exactly how to run `gh issue view <id>`, `gh pr create`, and `gh issue comment`.

### Example Lifecycle: Feature Implementation with Approval

1. **Trigger:** User creates Issue #42: "Add dark mode toggle" and adds the `agent-queue` label.
2. **Detection:** Daemon polls GitHub, sees #42. It updates the label to `agent-processing`.
3. **Dispatch:** Daemon uses ACP to initialize a new OpenCode Session, injecting Context: `{"task": "issue", "id": 42, "role": "feature-builder"}`.
4. **Planning (Agent):** OpenCode spins up the custom Feature Agent. The agent investigates the codebase, decides on a plan, and uses its `gh` CLI skill to post a comment on Issue #42: *"Plan: 1. Update CSS variables. 2. Add React context. 3. Create Toggle button. Awaiting approval."* The agent then pauses.
5. **State Update:** Daemon detects the plan comment, updates GitHub label to `await-plan`.
6. **User Approval:** User replies to Issue #42: `/approve`.
7. **Execution:** Daemon detects `/approve`, updates label back to `agent-processing`, and sends an ACP message to the paused OpenCode session: `"User approved. Proceed."`
8. **Completion:** Agent writes code, runs tests, uses `gh pr create` to make a PR linked to Issue #42, and terminates. Daemon detects session end, labels Issue #42 as `agent-completed`.

