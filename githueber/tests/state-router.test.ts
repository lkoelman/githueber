import { describe, expect, test } from "bun:test";
import { StateRouter } from "../src/router/StateRouter.ts";
import type { AgentSessionRecord, DaemonConfig, GitHubIssue } from "../src/models/types.ts";

const config: DaemonConfig = {
  repositories: {
    frontend: {
      key: "frontend",
      owner: "acme",
      repo: "frontend",
      localRepoPath: "/repos/frontend",
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
      }
    },
    backend: {
      key: "backend",
      owner: "acme",
      repo: "backend",
      localRepoPath: "/repos/backend",
      labels: {
        queue: "agent-queue",
        processing: "agent-processing",
        awaitPlan: "await-plan",
        completed: "agent-completed",
        failed: "agent-failed",
        revising: "agent-revising"
      },
      agentMapping: {
        "feature-request": "github-worker-agent"
      }
    }
  },
  isolation: {
    worktrees: null
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
    socketPath: "/tmp/githueber.sock"
  },
  logging: {
    level: "info"
  }
};

const issue: GitHubIssue = {
  repositoryKey: "frontend",
  repoOwner: "acme",
  repoName: "frontend",
  localRepoPath: "/repos/frontend",
  id: 1,
  number: 42,
  title: "Fix race condition",
  body: "Please fix it",
  labels: ["agent-queue", "bug-fix"],
  state: "open",
  updatedAt: "2026-04-02T00:00:00Z",
  comments: []
};

describe("StateRouter", () => {
  test("starts a worker session for queued repository-scoped issues", () => {
    const router = new StateRouter(config);
    const decision = router.evaluateIssueState(issue);

    expect(decision.action).toBe("START_SESSION");
    expect(decision.agentName).toBe("github-worker-agent");
    expect(decision.promptContext).toContain("REPOSITORY KEY: frontend");
    expect(decision.promptContext).toContain("REPOSITORY: acme/frontend");
    expect(decision.promptContext).toContain("REPOSITORY PATH: /repos/frontend");
  });

  test("uses a deterministic issue worktree path when worktrees are enabled", () => {
    const router = new StateRouter({
      ...config,
      isolation: {
        worktrees: "/tmp/githueber-worktrees"
      }
    });
    const decision = router.evaluateIssueState(issue);

    expect(decision.action).toBe("START_SESSION");
    expect(decision.promptContext).toContain("PRIMARY REPOSITORY PATH: /repos/frontend");
    expect(decision.promptContext).toContain(
      "REPOSITORY PATH: /tmp/githueber-worktrees/acme-frontend-issue-42"
    );
    expect(decision.promptContext).toContain("Create or reuse the git worktree");
  });

  test("routes epic issues to the orchestrator agent within the same repository", () => {
    const router = new StateRouter(config);
    const decision = router.evaluateIssueState({
      ...issue,
      labels: ["agent-queue", "epic"]
    });

    expect(decision.action).toBe("START_SESSION");
    expect(decision.agentName).toBe("github-orchestrator-agent");
  });

  test("resumes paused session on approve comment for the matching repository session", () => {
    const router = new StateRouter(config);
    const session: AgentSessionRecord = {
      sessionId: "session-1",
      repositoryKey: "frontend",
      repoOwner: "acme",
      repoName: "frontend",
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

  test("keeps same issue number in another repository isolated", () => {
    const router = new StateRouter(config);
    const decision = router.evaluateIssueState({
      ...issue,
      repositoryKey: "backend",
      repoOwner: "acme",
      repoName: "backend",
      localRepoPath: "/repos/backend",
      labels: ["agent-queue", "feature-request"]
    });

    expect(decision.action).toBe("START_SESSION");
    expect(decision.agentName).toBe("github-worker-agent");
    expect(decision.promptContext).toContain("REPOSITORY KEY: backend");
    expect(decision.promptContext).not.toContain("acme/frontend");
  });
});
