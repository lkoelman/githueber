import type { GitHubIssue } from "./models/types.ts";

export function buildInitializationPrompt(issue: GitHubIssue, agentName: string): string {
  const labels = issue.labels.join(", ") || "(none)";

  return [
    "SYSTEM INSTRUCTION: You are being invoked by the GitHub Daemon Orchestrator.",
    "",
    `REPOSITORY KEY: ${issue.repositoryKey}`,
    `REPOSITORY: ${issue.repoOwner}/${issue.repoName}`,
    `REPOSITORY PATH: ${issue.localRepoPath}`,
    `TARGET ISSUE: #${issue.number}`,
    `TITLE: ${issue.title}`,
    `AGENT: ${agentName}`,
    `LABELS: ${labels}`,
    "",
    "ACTION REQUIRED:",
    `1. Change into ${issue.localRepoPath}.`,
    `2. Fetch the full issue thread for #${issue.number} in ${issue.repoOwner}/${issue.repoName} using the github-cli skill.`,
    "3. Follow your agent definition exactly.",
    "4. If you are in planning mode, post the plan and stop at [AWAITING_APPROVAL]."
  ].join("\n");
}
