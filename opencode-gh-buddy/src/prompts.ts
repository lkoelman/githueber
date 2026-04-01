import type { DaemonConfig, GitHubIssue } from "./models/types.ts";

export function buildInitializationPrompt(
  issue: GitHubIssue,
  config: DaemonConfig,
  agentName: string
): string {
  const labels = issue.labels.join(", ") || "(none)";

  return [
    "SYSTEM INSTRUCTION: You are being invoked by the GitHub Daemon Orchestrator.",
    "",
    `TARGET ISSUE: #${issue.number}`,
    `TITLE: ${issue.title}`,
    `AGENT: ${agentName}`,
    `REPOSITORY PATH: ${config.github.targetRepoPath}`,
    `REPOSITORY: ${config.github.repoOwner}/${config.github.repoName}`,
    `LABELS: ${labels}`,
    "",
    "ACTION REQUIRED:",
    `1. Change into ${config.github.targetRepoPath}.`,
    `2. Fetch the full issue thread for #${issue.number} using the github-cli skill.`,
    "3. Follow your agent definition exactly.",
    "4. If you are in planning mode, post the plan and stop at [AWAITING_APPROVAL]."
  ].join("\n");
}
