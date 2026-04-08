/**
 * The harness asset templating system is the bridge between one canonical set of
 * agent and skill definitions and the different on-disk formats required by
 * each supported coding harness.
 *
 * The core design goal is to avoid maintaining the same agent behavior in
 * several harness-specific files by hand. Instead, this module stores the
 * shared meaning of each asset once. Those canonical definitions are intentionally
 * harness-agnostic. They describe the stable behavior that should remain
 * consistent no matter whether the final consumer is OpenCode, Codex, Claude, or Gemini.
 *
 * The rendering layer then translates that shared behavior into the syntax each
 * harness expects:
 *
 * - OpenCode expects markdown agent files with OpenCode frontmatter and `SKILL.md`
 *   skill directories
 * - Codex expects TOML agent files and markdown skill files under Codex-specific
 *   config directories
 * - Claude and Gemini expect markdown agent files with YAML frontmatter plus
 *   markdown skill directories
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Names the harness targets that can receive generated agent and skill assets from the templating system. */
export type InstallHarnessName = "opencode" | "codex" | "claude" | "gemini";

/** Enumerates the canonical skill definitions that the templating system can render into harness-specific formats. */
export type CanonicalSkillName = "github-cli";

/** Enumerates the canonical agent definitions that the templating system can render into harness-specific formats. */
export type CanonicalAgentName = "github-worker-agent" | "github-orchestrator-agent";

/** Represents one harness-agnostic skill definition that acts as the source of truth for all rendered skill files. */
interface CanonicalSkillDefinition {
  name: CanonicalSkillName;
  description: string;
  instructions: string;
  opencodeCompatibility: string;
  opencodeAllowedTools: string[];
}

/** Represents one harness-agnostic agent definition that acts as the source of truth for all rendered agent files. */
interface CanonicalAgentDefinition {
  name: CanonicalAgentName;
  description: string;
  instructions: string;
  opencodeTools: {
    websearch: boolean;
    webfetch: boolean;
    write: boolean;
    edit: boolean;
    bash: boolean;
  };
  opencodePermission: {
    edit: "allow";
    bash: Record<string, "allow" | "deny">;
  };
}

/** Describes one generated output file emitted by the templating system for a specific harness. */
export interface RenderedHarnessFile {
  relativePath: string;
  content: string;
}

/** Groups the full rendered file set for one harness install target. */
export interface RenderedHarnessAssets {
  harness: InstallHarnessName;
  files: RenderedHarnessFile[];
}

/** Summarizes the result of installing one harness's rendered agent and skill assets into a home directory. */
export interface HarnessInstallSummary {
  harness: InstallHarnessName;
  filesWritten: number;
  targetRoot: string;
}

const githubCliSkill: CanonicalSkillDefinition = {
  name: "github-cli",
  description:
    "Use GitHub `gh` client for issue, pull request, and issue-thread workflows driven from GitHub.",
  opencodeCompatibility: "opencode",
  opencodeAllowedTools: ["bash", "question"],
  instructions: `## When to use me

Use this skill whenever the task involves GitHub issues, pull requests, review threads, or agent-driven updates posted back to GitHub.

This skill is the preferred GitHub interface for OpenCode agents. Do not replace it with ad hoc API calls or generic web requests when \`gh\` can perform the action.

## Rules

- Work from the repository checkout the daemon provided.
- Read the issue thread before acting.
- Post concise status updates back to the issue when the workflow requires it.
- Prefer explicit flags and structured output.
- Never run destructive GitHub operations such as \`gh repo delete\`.
- Do not close issues or edit workflow labels directly unless the task explicitly requires it.
- When posting a plan that requires approval, end the comment with \`[AWAITING_APPROVAL]\`.

## Common GitHub Actions


### Issues

\`\`\`bash
# list issues with title and label
gh issue list [--label "bug"] [--label ...] [--milestone "Big Feature"]

# Search issues with GithHub query syntax
gh issue list --search "error no:assignee sort:created-asc"

# View an issue with comments
gh issue view {<number> | <url>} --comments

# View an issue as JSON for structured inspection
gh issue view {<number> | <url>} --json title,body,labels,comments,assignees

# Add issue comment
gh issue comment {<number> | <url>} [flags] [-b <text>] [-F - <reads stdin>]

# Create issue for delegated sub-task
gh issue create --title "Task title" --body "Relates to #123" --label agent-queue
\`\`\`

### PR Review

\`\`\`bash
# view PR thread as markdown, without inline review comments
gh pr view <pr-number>

# Get PR reviews as JSON - use for retrieving comment ids
gh pr-review review view --pr <pr-number> -R <owner/repo>

# retrieve inline review comments that are unresolved
# get owner/repo using \`git remote get-url $(git remote)\`
gh pr-review review view --pr <pr-number> -R <owner/repo> --unresolved | jq '.reviews[].comments[]? | select(.is_resolved == false)'

# Reply to review comment
gh pr-review comments reply -R owner/repo --pr 123 --thread-id PRRT_kwDOAAABbcdEFG12 --body "Follow-up addressed in commit abc123"
\`\`\`

### Create resources

\`\`\`bash
# create a branch locally first, then open a PR
gh pr create --title "Feature" --body "Description" --base main --head your-branch

# create a child issue from an epic
gh issue create --title "Task title" --body "Relates to #123" --label agent-queue

# optionally add a more specific issue label when the issue type is known
gh issue create --title "Task title" --body "Relates to #123" --label agent-queue --label bug-fix
\`\`\`
`
};

const githubWorkerAgent: CanonicalAgentDefinition = {
  name: "github-worker-agent",
  description:
    "Executes GitHub issue work through a plan, approval, implementation, and PR workflow.",
  opencodeTools: {
    websearch: false,
    webfetch: false,
    write: true,
    edit: true,
    bash: true
  },
  opencodePermission: {
    edit: "allow",
    bash: {
      "*": "deny",
      pwd: "allow",
      "ls *": "allow",
      "find *": "allow",
      "grep *": "allow",
      "cat *": "allow",
      "git status": "allow",
      "git branch": "allow",
      "git checkout *": "allow",
      "git switch *": "allow",
      "git add *": "allow",
      "git commit *": "allow",
      "git diff *": "allow",
      "git log *": "allow",
      "gh *": "allow",
      "bun *": "allow"
    }
  },
  instructions: `You are an autonomous software engineer operating on GitHub issue work dispatched by a daemon.

You will receive a structured initialization prompt with the target issue number, repository path, repository name, and the agent role selected for the task.

## Core responsibilities

1. Read the full GitHub issue and comment history before acting.
2. Investigate the codebase and determine the smallest correct change.
3. Write a concrete implementation plan and post it back to the issue.
4. Stop after posting the plan when approval is required.
5. After approval, implement the change, run relevant validation, and open a pull request.

## Required workflow

1. Read the initialization context carefully. If it includes both \`PRIMARY REPOSITORY PATH\` and \`REPOSITORY PATH\`, worktree isolation is enabled.
2. If worktree isolation is enabled, first change into \`PRIMARY REPOSITORY PATH\`, sync the base checkout from the tracked remote, and create or reuse the issue worktree at \`REPOSITORY PATH\` before making any edits.
3. If worktree isolation is not enabled, change into \`REPOSITORY PATH\` and sync the local checkout from the tracked remote before planning or coding.
4. Use the \`github-cli\` skill to read the full issue thread for the target issue.
5. Inspect the local codebase and determine the right implementation approach.
6. Post a plan comment to the issue.
The final line of the plan comment must be exactly \`[AWAITING_APPROVAL]\`.
7. Stop execution after posting the plan. Do not write code before approval arrives through ACP.
8. When approval or revision feedback arrives, incorporate it exactly.
9. Implement only the requested change.
10. Run the most relevant local tests or checks.
11. Create a branch named after the issue, such as \`issue-42\` or \`fix/issue-42\`. In worktree mode, create or switch that branch inside the issue worktree.
12. Open a pull request with \`gh pr create\` and link the issue in the PR body. Add a feature/fix description and discuss implementation details.
13. Post a comment to the issue that refers to the PR and explains how it addresses the issue.

## Operating rules

- Use the \`github-cli\` skill for GitHub issue and PR operations.
- Do not manage workflow labels yourself unless the task explicitly instructs it.
- Do not close issues yourself.
- Keep comments short and operationally useful.
- If you are blocked, comment on the issue with the blocker and the concrete information you need.
- Prefer small, test-backed changes over broad refactors.
`
};

const githubOrchestratorAgent: CanonicalAgentDefinition = {
  name: "github-orchestrator-agent",
  description:
    "Decomposes GitHub epics or refactors into actionable child issues for the daemon worker pool.",
  opencodeTools: {
    websearch: false,
    webfetch: false,
    write: true,
    edit: true,
    bash: true
  },
  opencodePermission: {
    edit: "allow",
    bash: {
      "*": "deny",
      pwd: "allow",
      "ls *": "allow",
      "find *": "allow",
      "grep *": "allow",
      "cat *": "allow",
      "git status": "allow",
      "gh *": "allow"
    }
  },
  instructions: `You are a lead engineer coordinating work from GitHub epics and large refactors.

Your job is to convert a high-level issue into well-scoped coding tasks that can be dispatched independently by the daemon.

## Required workflow

1. Read the initialization context carefully. If it includes both \`PRIMARY REPOSITORY PATH\` and \`REPOSITORY PATH\`, worktree isolation is enabled.
2. If worktree isolation is enabled, first change into \`PRIMARY REPOSITORY PATH\`, sync the base checkout from the tracked remote, and create or reuse the issue worktree at \`REPOSITORY PATH\` before doing repository analysis.
3. If worktree isolation is not enabled, change into \`REPOSITORY PATH\` and sync the local checkout from the tracked remote before analysis.
4. Use the \`github-cli\` skill to read the epic issue and full discussion thread.
5. Decompose the work into isolated tasks that a worker agent can finish independently.
6. Create one GitHub issue per task with \`gh issue create\`.
7. Each child issue must include \`Relates to #<parent-issue>\` in its body.
8. Each child issue must carry the \`agent-queue\` label so the daemon can dispatch it.
9. Add one more issue label when the task type is clear, for example \`bug-fix\` or \`feature-request\`.
10. Comment on the parent issue with a concise summary of the created child issues.
11. Terminate after reporting completion.

## Operating rules

- Create tasks that are independently testable and reviewable.
- Avoid creating child issues that overlap in write scope without stating the dependency.
- Do not implement code yourself unless the task explicitly changes from orchestration to execution.
- Do not close the parent issue.
`
};

const skills: Record<CanonicalSkillName, CanonicalSkillDefinition> = {
  "github-cli": githubCliSkill
};

const agents: Record<CanonicalAgentName, CanonicalAgentDefinition> = {
  "github-worker-agent": githubWorkerAgent,
  "github-orchestrator-agent": githubOrchestratorAgent
};

/** Returns the canonical skill source definition that renderers use to generate harness-specific skill files. */
export function getCanonicalSkillDefinition(name: CanonicalSkillName): CanonicalSkillDefinition {
  return skills[name];
}

/** Returns the canonical agent source definition that renderers use to generate harness-specific agent files. */
export function getCanonicalAgentDefinition(name: CanonicalAgentName): CanonicalAgentDefinition {
  return agents[name];
}

/** Renders a canonical skill into a Markdown skill file, adding harness-specific frontmatter when required. */
function renderSkillMarkdown(
  skill: CanonicalSkillDefinition,
  options: { compatibility?: string; allowedTools?: string[] } = {}
): string {
  const lines = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`
  ];

  if (options.compatibility) {
    lines.push(`compatibility: ${options.compatibility}`);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    lines.push("allowed-tools:");
    for (const tool of options.allowedTools) {
      lines.push(`  - ${tool}`);
    }
  }

  lines.push("---", "", skill.instructions.trimEnd(), "");
  return lines.join("\n");
}

/** Renders a canonical agent into the OpenCode markdown agent format while preserving the current checked-in behavior. */
function renderOpenCodeAgent(agent: CanonicalAgentDefinition): string {
  const lines = [
    "---",
    `description: ${agent.description}`,
    "mode: primary",
    "tools:",
    `  websearch: ${String(agent.opencodeTools.websearch)}`,
    `  webfetch: ${String(agent.opencodeTools.webfetch)}`,
    `  write: ${String(agent.opencodeTools.write)}`,
    `  edit: ${String(agent.opencodeTools.edit)}`,
    `  bash: ${String(agent.opencodeTools.bash)}`,
    "permission:",
    `  edit: ${agent.opencodePermission.edit}`,
    "  bash:"
  ];

  for (const [command, permission] of Object.entries(agent.opencodePermission.bash)) {
    lines.push(`    "${command}": ${permission}`);
  }

  lines.push("---", "", agent.instructions.trimEnd(), "");
  return lines.join("\n");
}

/** Renders a canonical agent into the Codex TOML subagent format used in `.codex/agents`. */
function renderCodexAgent(agent: CanonicalAgentDefinition): string {
  return [
    `name = "${agent.name}"`,
    `description = "${agent.description}"`,
    'model = "gpt-5.4"',
    'model_reasoning_effort = "high"',
    'sandbox_mode = "workspace-write"',
    "developer_instructions = '''",
    agent.instructions.trimEnd(),
    "'''",
    ""
  ].join("\n");
}

/** Renders a canonical agent into the YAML-frontmatter markdown style used by Claude and Gemini subagents. */
function renderYamlFrontmatterAgent(
  agent: CanonicalAgentDefinition,
  tools: string[],
  model: string
): string {
  return [
    "---",
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    "tools:",
    ...tools.map((tool) => `  - ${tool}`),
    `model: ${model}`,
    "---",
    "",
    agent.instructions.trimEnd(),
    ""
  ].join("\n");
}

/** Generates the full harness-specific file set for one install target from the canonical agent and skill definitions. */
export function renderHarnessAssets(harness: InstallHarnessName): RenderedHarnessAssets {
  const skill = getCanonicalSkillDefinition("github-cli");
  const worker = getCanonicalAgentDefinition("github-worker-agent");
  const orchestrator = getCanonicalAgentDefinition("github-orchestrator-agent");

  switch (harness) {
    case "opencode":
      return {
        harness,
        files: [
          {
            relativePath: ".opencode/skills/github-cli/SKILL.md",
            content: renderSkillMarkdown(skill, {
              compatibility: skill.opencodeCompatibility,
              allowedTools: skill.opencodeAllowedTools
            })
          },
          {
            relativePath: ".opencode/agents/github-worker-agent.md",
            content: renderOpenCodeAgent(worker)
          },
          {
            relativePath: ".opencode/agents/github-orchestrator-agent.md",
            content: renderOpenCodeAgent(orchestrator)
          }
        ]
      };
    case "codex":
      return {
        harness,
        files: [
          {
            relativePath: ".codex/skills/github-cli/SKILL.md",
            content: renderSkillMarkdown(skill)
          },
          {
            relativePath: ".codex/agents/github-worker-agent.toml",
            content: renderCodexAgent(worker)
          },
          {
            relativePath: ".codex/agents/github-orchestrator-agent.toml",
            content: renderCodexAgent(orchestrator)
          }
        ]
      };
    case "claude":
      return {
        harness,
        files: [
          {
            relativePath: ".claude/skills/github-cli/SKILL.md",
            content: renderSkillMarkdown(skill)
          },
          {
            relativePath: ".claude/agents/github-worker-agent.md",
            content: renderYamlFrontmatterAgent(
              worker,
              ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
              "sonnet"
            )
          },
          {
            relativePath: ".claude/agents/github-orchestrator-agent.md",
            content: renderYamlFrontmatterAgent(
              orchestrator,
              ["Read", "Bash", "Glob", "Grep", "Write"],
              "sonnet"
            )
          }
        ]
      };
    case "gemini":
      return {
        harness,
        files: [
          {
            relativePath: ".gemini/skills/github-cli/SKILL.md",
            content: renderSkillMarkdown(skill)
          },
          {
            relativePath: ".gemini/agents/github-worker-agent.md",
            content: renderYamlFrontmatterAgent(
              worker,
              ["Read", "Write", "Edit", "Shell", "Glob", "Grep"],
              "gemini-2.5-pro"
            )
          },
          {
            relativePath: ".gemini/agents/github-orchestrator-agent.md",
            content: renderYamlFrontmatterAgent(
              orchestrator,
              ["Read", "Shell", "Glob", "Grep", "Write"],
              "gemini-2.5-pro"
            )
          }
        ]
      };
  }
}

/** Lists the concrete rendered files for a harness so callers can inspect or test the install output without writing it. */
export function listRenderedHarnessAssets(harness: InstallHarnessName): RenderedHarnessFile[] {
  return renderHarnessAssets(harness).files;
}

/** Installs the rendered agent and skill files for one harness into the selected home-directory config tree. */
export function installHarnessAssets(options: {
  harness: InstallHarnessName;
  homeDir: string;
}): HarnessInstallSummary {
  const rendered = renderHarnessAssets(options.harness);

  for (const file of rendered.files) {
    const targetPath = join(options.homeDir, file.relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }

  return {
    harness: options.harness,
    filesWritten: rendered.files.length,
    targetRoot: join(options.homeDir, harnessHomeDir(options.harness))
  };
}

/** Resolves the top-level home-directory folder that owns generated assets for a given harness. */
function harnessHomeDir(harness: InstallHarnessName): string {
  switch (harness) {
    case "opencode":
      return ".opencode";
    case "codex":
      return ".codex";
    case "claude":
      return ".claude";
    case "gemini":
      return ".gemini";
  }
}
