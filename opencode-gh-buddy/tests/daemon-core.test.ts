import { describe, expect, test } from "bun:test";
import { DaemonCore } from "../src/daemon.ts";
import type {
  ACPManagerLike,
  AgentSessionRecord,
  DaemonConfig,
  GitHubIssue,
  GitHubPollerLike,
  RouteDecision,
  RouterLike
} from "../src/models/types.ts";

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
      agentMapping: {}
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
      agentMapping: {}
    }
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
    intervalMs: 1000
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

function makeIssue(repositoryKey: "frontend" | "backend", issueNumber = 42): GitHubIssue {
  const repoName = repositoryKey;
  return {
    repositoryKey,
    repoOwner: "acme",
    repoName,
    localRepoPath: `/repos/${repoName}`,
    id: issueNumber,
    number: issueNumber,
    title: "Test",
    body: "Body",
    labels: ["agent-queue"],
    state: "open",
    updatedAt: "2026-04-02T00:00:00Z",
    comments: []
  };
}

class PollerStub implements GitHubPollerLike {
  public latestComment = "";
  public updated: Array<{ issueNumber: number; add: string; remove?: string }> = [];

  constructor(public readonly repositoryKey: string) {}

  start(): void {}
  stop(): void {}
  onIssuesUpdated(): void {}
  async pollNow(): Promise<GitHubIssue[]> {
    return [];
  }
  async getLatestComment(): Promise<string | null> {
    return this.latestComment;
  }
  async updateIssueLabel(issueNumber: number, add: string, remove?: string): Promise<void> {
    this.updated.push({ issueNumber, add, remove });
  }
}

class ACPStub implements ACPManagerLike {
  public started: Array<{ repositoryKey: string; issueNumber: number; agentName: string; prompt: string }> = [];
  public sent: Array<{ sessionId: string; message: string }> = [];
  public sessions = new Map<string, AgentSessionRecord>();

  async initialize(): Promise<void> {}
  getSessionForIssue(repositoryKey: string, issueNumber: number) {
    return this.sessions.get(`${repositoryKey}#${issueNumber}`);
  }
  listSessions() {
    return Array.from(this.sessions.values());
  }
  async startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void> {
    this.started.push({ repositoryKey: issue.repositoryKey, issueNumber: issue.number, agentName, prompt });
    this.sessions.set(`${issue.repositoryKey}#${issue.number}`, {
      sessionId: `${issue.repositoryKey}-session-${issue.number}`,
      repositoryKey: issue.repositoryKey,
      repoOwner: issue.repoOwner,
      repoName: issue.repoName,
      issueNumber: issue.number,
      status: "RUNNING",
      agentName
    });
  }
  async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    this.sent.push({ sessionId, message });
  }
  async stopSession(): Promise<void> {}
  onSessionPaused(): void {}
  onSessionCompleted(): void {}
}

class RouterStub implements RouterLike {
  constructor(private readonly decision: RouteDecision) {}
  evaluateIssueState(): RouteDecision {
    return this.decision;
  }
}

describe("DaemonCore", () => {
  test("starts a new session and updates labels in the matching repository", async () => {
    const frontendPoller = new PollerStub("frontend");
    const backendPoller = new PollerStub("backend");
    const acp = new ACPStub();
    const daemon = new DaemonCore(
      { frontend: frontendPoller, backend: backendPoller },
      new RouterStub({
        action: "START_SESSION",
        agentName: "github-worker-agent",
        promptContext: "start prompt"
      }),
      acp,
      config
    );

    await daemon.processIssue(makeIssue("frontend", 42));

    expect(acp.started).toEqual([
      {
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        prompt: "start prompt"
      }
    ]);
    expect(frontendPoller.updated).toEqual([
      { issueNumber: 42, add: "agent-processing", remove: "agent-queue" }
    ]);
    expect(backendPoller.updated).toEqual([]);
  });

  test("keeps same issue number in a different repository isolated", async () => {
    const frontendPoller = new PollerStub("frontend");
    const backendPoller = new PollerStub("backend");
    const acp = new ACPStub();
    const daemon = new DaemonCore(
      { frontend: frontendPoller, backend: backendPoller },
      new RouterStub({
        action: "START_SESSION",
        agentName: "github-worker-agent",
        promptContext: "start prompt"
      }),
      acp,
      config
    );

    await daemon.processIssue(makeIssue("backend", 42));

    expect(acp.started[0]).toMatchObject({ repositoryKey: "backend", issueNumber: 42 });
    expect(frontendPoller.updated).toEqual([]);
    expect(backendPoller.updated).toEqual([
      { issueNumber: 42, add: "agent-processing", remove: "agent-queue" }
    ]);
  });
});
