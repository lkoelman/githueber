import { describe, expect, test } from "bun:test";
import { DaemonCore } from "../src/daemon.ts";
import type {
  ACPManagerLike,
  DaemonConfig,
  GitHubIssue,
  GitHubPollerLike,
  RouteDecision,
  RouterLike
} from "../src/models/types.ts";

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
  agentMapping: {},
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

class PollerStub implements GitHubPollerLike {
  public latestComment = "";
  public updated: Array<{ issueNumber: number; add: string; remove?: string }> = [];

  start(): void {}
  stop(): void {}
  onIssuesUpdated(): void {}
  onApprovalRequested(): void {}
  onIssueCompleted(): void {}
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
  public started: Array<{ issueNumber: number; agentName: string; prompt: string }> = [];
  public sent: Array<{ sessionId: string; message: string }> = [];
  public sessions = new Map<number, { sessionId: string; issueNumber: number; status: "RUNNING" | "PAUSED_AWAITING_APPROVAL" | "COMPLETED"; agentName: string }>();

  async initialize(): Promise<void> {}
  getSessionForIssue(issueNumber: number) {
    return this.sessions.get(issueNumber);
  }
  listSessions() {
    return Array.from(this.sessions.values());
  }
  async startNewSession(issueNumber: number, agentName: string, prompt: string): Promise<void> {
    this.started.push({ issueNumber, agentName, prompt });
    this.sessions.set(issueNumber, {
      sessionId: "session-42",
      issueNumber,
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
  constructor(private decision: RouteDecision) {}
  evaluateIssueState(): RouteDecision {
    return this.decision;
  }
}

describe("DaemonCore", () => {
  test("starts a new session and updates queue label", async () => {
    const poller = new PollerStub();
    const acp = new ACPStub();
    const daemon = new DaemonCore(
      poller,
      new RouterStub({
        action: "START_SESSION",
        agentName: "github-worker-agent",
        promptContext: "start prompt"
      }),
      acp,
      config
    );

    await daemon.processIssue({
      id: 1,
      number: 42,
      title: "Test",
      body: "Body",
      labels: ["agent-queue"],
      state: "open",
      updatedAt: "2026-04-01T00:00:00Z",
      comments: []
    });

    expect(acp.started).toEqual([
      { issueNumber: 42, agentName: "github-worker-agent", prompt: "start prompt" }
    ]);
    expect(poller.updated).toEqual([
      { issueNumber: 42, add: "agent-processing", remove: "agent-queue" }
    ]);
  });

  test("resumes an approved session and restores processing label", async () => {
    const poller = new PollerStub();
    const acp = new ACPStub();
    const daemon = new DaemonCore(
      poller,
      new RouterStub({
        action: "RESUME_APPROVED",
        acpSessionId: "session-42",
        promptContext: "approved"
      }),
      acp,
      config
    );

    await daemon.processIssue({
      id: 1,
      number: 42,
      title: "Test",
      body: "Body",
      labels: ["await-plan"],
      state: "open",
      updatedAt: "2026-04-01T00:00:00Z",
      comments: []
    });

    expect(acp.sent).toEqual([{ sessionId: "session-42", message: "approved" }]);
    expect(poller.updated).toEqual([
      { issueNumber: 42, add: "agent-processing", remove: "await-plan" }
    ]);
  });
});
