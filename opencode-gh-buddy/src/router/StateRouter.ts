import type { AgentSessionRecord, DaemonConfig, GitHubIssue, RouteDecision } from "../models/types.ts";
import { buildInitializationPrompt } from "../prompts.ts";

/** Encodes the daemon's side-effect-free rules for starting, resuming, or ignoring issue work. */
export class StateRouter {
  constructor(private readonly config: DaemonConfig) {}

  /** Evaluates a repository-scoped issue snapshot and returns the next control-plane action. */
  public evaluateIssueState(
    issue: GitHubIssue,
    latestComment?: string | null,
    activeSession?: AgentSessionRecord
  ): RouteDecision {
    const repository = this.config.repositories[issue.repositoryKey];
    if (!repository || issue.state !== "open") {
      return { action: "IGNORE" };
    }

    const { labels } = repository;
    const { execution } = this.config;

    if (issue.labels.includes(labels.awaitPlan) && activeSession) {
      if (latestComment?.startsWith(execution.approvalComment)) {
        return {
          action: "RESUME_APPROVED",
          acpSessionId: activeSession.sessionId,
          promptContext: "The user has approved your plan. Proceed with execution and PR creation."
        };
      }

      if (latestComment?.startsWith(execution.reviseComment)) {
        return {
          action: "RESUME_REVISED",
          acpSessionId: activeSession.sessionId,
          promptContext: `The user requested plan revisions: ${latestComment}`
        };
      }

      return { action: "IGNORE" };
    }

    if (!issue.labels.includes(labels.queue) || activeSession) {
      return { action: "IGNORE" };
    }

    const matchedAgent =
      Object.entries(repository.agentMapping).find(([label]) => issue.labels.includes(label))?.[1] ??
      "github-worker-agent";

    return {
      action: "START_SESSION",
      agentName: matchedAgent,
      promptContext: buildInitializationPrompt(issue, matchedAgent)
    };
  }
}
