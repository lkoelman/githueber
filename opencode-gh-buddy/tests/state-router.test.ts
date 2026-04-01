import { describe, expect, test } from "bun:test";
import { StateRouter } from "../src/router/StateRouter.ts";
import type { AgentSessionRecord, DaemonConfig, GitHubIssue } from "../src/models/types.ts";

const config: DaemonConfig = {
  github: {
    repoOwner: "acme",
    repoName: "widget",
    targetRepoPath: "/repos/widget"
  },
  labels: {
    queue: "agent-queue",
    processing: "agent-processing",
    awaitPlan: "await-plan",
    completed: "agent-completed",
    failed: "agent-failed",
    revising: "agent-revising"
  },
  agentMapping: {
    "bug-fix": "github-worker-agent",
    epic: "github-orchestrator-agent"
  },
  execution: {
    autoApprove: false,
    concurrency: 1,
    approvalComment: "/approve",
    reviseComment: "/revise",
    opencodeModel: null,
    timeoutSeconds: 3600
  },
  polling: {
    intervalMs: 60000
  },
  acp: {
    endpoint: "http://127.0.0.1:9000"
  },
  ipc: {
    socketPath: "/tmp/opencode-gh-buddy.sock"
  },
  logging: {
    level: "info"
  }
};

const issue: GitHubIssue = {
  id: 1,
  number: 42,
  title: "Fix race condition",
  body: "Please fix it",
  labels: ["agent-queue", "bug-fix"],
  state: "open",
  updatedAt: "2026-04-01T00:00:00Z",
  comments: []
};

describe("StateRouter", () => {
  test("starts a worker session for queued bug-fix issues", () => {
    const router = new StateRouter(config);
    const decision = router.evaluateIssueState(issue);

    expect(decision.action).toBe("START_SESSION");
    expect(decision.agentName).toBe("github-worker-agent");
    expect(decision.promptContext).toContain("TARGET ISSUE: #42");
    expect(decision.promptContext).toContain("REPOSITORY PATH: /repos/widget");
  });

  test("routes epic issues to the orchestrator agent", () => {
    const router = new StateRouter(config);
    const decision = router.evaluateIssueState({
      ...issue,
      labels: ["agent-queue", "epic"]
    });

    expect(decision.action).toBe("START_SESSION");
    expect(decision.agentName).toBe("github-orchestrator-agent");
  });

  test("resumes paused session on approve comment", () => {
    const router = new StateRouter(config);
    const session: AgentSessionRecord = {
      sessionId: "session-1",
      issueNumber: 42,
      status: "PAUSED_AWAITING_APPROVAL",
      agentName: "github-worker-agent"
    };
    const decision = router.evaluateIssueState(
      {
        ...issue,
        labels: ["await-plan"]
      },
      "/approve",
      session
    );

    expect(decision).toEqual({
      action: "RESUME_APPROVED",
      acpSessionId: "session-1",
      promptContext: "The user has approved your plan. Proceed with execution and PR creation."
    });
  });

  test("requests plan revision when revise comment is posted", () => {
    const router = new StateRouter(config);
    const session: AgentSessionRecord = {
      sessionId: "session-2",
      issueNumber: 42,
      status: "PAUSED_AWAITING_APPROVAL",
      agentName: "github-worker-agent"
    };
    const decision = router.evaluateIssueState(
      {
        ...issue,
        labels: ["await-plan"]
      },
      "/revise: use a lock file",
      session
    );

    expect(decision.action).toBe("RESUME_REVISED");
    expect(decision.acpSessionId).toBe("session-2");
    expect(decision.promptContext).toContain("use a lock file");
  });
});
