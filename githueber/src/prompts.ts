import { join } from "node:path";
import type { GitHubIssue } from "./models/types.ts";

function toSlug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function resolveIssueWorkspacePath(issue: GitHubIssue, worktreeRoot: string | null): string {
  if (!worktreeRoot) {
    return issue.localRepoPath;
  }
  return join(worktreeRoot, `${toSlug(issue.repoOwner)}-${toSlug(issue.repoName)}-issue-${issue.number}`);
}

/** Builds the repository-aware prompt that seeds a new OpenCode session from a GitHub issue. */
export function buildInitializationPrompt(issue: GitHubIssue, agentName: string, worktreeRoot: string | null = null): string {
  const labels = issue.labels.join(", ") || "(none)";
  const workspacePath = resolveIssueWorkspacePath(issue, worktreeRoot);
  const worktreesEnabled = workspacePath !== issue.localRepoPath;

  return [
    "SYSTEM INSTRUCTION: You are being invoked by the GitHub Daemon Orchestrator.",
    "",
    `REPOSITORY KEY: ${issue.repositoryKey}`,
    `REPOSITORY: ${issue.repoOwner}/${issue.repoName}`,
    ...(worktreesEnabled ? [`PRIMARY REPOSITORY PATH: ${issue.localRepoPath}`] : []),
    `REPOSITORY PATH: ${workspacePath}`,
    `TARGET ISSUE: #${issue.number}`,
    `TITLE: ${issue.title}`,
    `AGENT: ${agentName}`,
    `LABELS: ${labels}`,
    "",
    "ACTION REQUIRED:",
    ...(worktreesEnabled
      ? [
          `1. Change into ${issue.localRepoPath}.`,
          `2. Create or reuse the git worktree at ${workspacePath}, then do all issue work from ${workspacePath}.`,
          `3. Fetch the full issue thread for #${issue.number} in ${issue.repoOwner}/${issue.repoName} using the github-cli skill.`,
          "4. Follow your agent definition exactly.",
          "5. If you are in planning mode, post the plan and stop at [AWAITING_APPROVAL]."
        ]
      : [
          `1. Change into ${workspacePath}.`,
          `2. Fetch the full issue thread for #${issue.number} in ${issue.repoOwner}/${issue.repoName} using the github-cli skill.`,
          "3. Follow your agent definition exactly.",
          "4. If you are in planning mode, post the plan and stop at [AWAITING_APPROVAL]."
        ])
  ].join("\n");
}
