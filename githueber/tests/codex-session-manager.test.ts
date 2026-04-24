import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexSessionManager } from "../src/codex/CodexSessionManager.ts";
import { CodexSessionRegistry } from "../src/codex/CodexSessionRegistry.ts";
import type { GitHubIssue, HarnessClientLike } from "../src/models/types.ts";

function makeIssue(): GitHubIssue {
  return {
    repositoryKey: "frontend",
    repoOwner: "acme",
    repoName: "frontend",
    localRepoPath: "/repos/frontend",
    id: 42,
    number: 42,
    title: "Fix bug",
    body: "Body",
    labels: ["queue"],
    state: "open",
    updatedAt: "2026-04-24T00:00:00Z",
    comments: []
  };
}

function createClientStub(overrides: Partial<HarnessClientLike> = {}): HarnessClientLike {
  const listeners = new Map<string, (payload: { sessionId: string }) => void>();

  return {
    async connect(): Promise<void> {},
    async createSession(): Promise<{ id: string }> {
      return { id: "thr_new" };
    },
    async sendMessage(): Promise<void> {},
    async stopSession(): Promise<void> {},
    async listSessions(): Promise<Array<{ id: string; title?: string; status?: { type: string } }>> {
      return [];
    },
    async getSessionStatuses(): Promise<Record<string, { type: string }>> {
      return {};
    },
    on(eventName, callback) {
      listeners.set(eventName, callback);
    },
    ...overrides
  };
}

describe("CodexSessionManager", () => {
  test("persists new Codex sessions with resumability metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-codex-registry-"));
    const registry = new CodexSessionRegistry(join(dir, "codex-sessions.json"));
    const manager = new CodexSessionManager(createClientStub(), registry);

    await manager.startNewSession(makeIssue(), "github-worker-agent", "prompt");

    expect(manager.listSessions()[0]).toMatchObject({
      sessionId: "thr_new",
      repositoryKey: "frontend",
      repoOwner: "acme",
      repoName: "frontend",
      issueNumber: 42,
      status: "RUNNING",
      agentName: "github-worker-agent",
      harness: "codex",
      title: "githueber frontend#42 github-worker-agent",
      resumability: "open",
      resumeHint: "codex resume --include-non-interactive thr_new"
    });
    expect(manager.listSessions()[0]?.startedAt).toBeString();
    expect(manager.listSessions()[0]?.lastActiveAt).toBeString();

    expect(registry.load()[0]).toMatchObject({
      sessionId: "thr_new",
      repositoryKey: "frontend",
      issueNumber: 42,
      status: "RUNNING",
      agentName: "github-worker-agent",
      harness: "codex",
      title: "githueber frontend#42 github-worker-agent",
      resumability: "open",
      resumeHint: "codex resume --include-non-interactive thr_new"
    });
  });

  test("restores stored Codex app-server threads and drops stale registry entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-codex-restore-"));
    const registry = new CodexSessionRegistry(join(dir, "codex-sessions.json"));
    registry.replace([
      {
        sessionId: "thr_restored",
        repositoryKey: "frontend",
        repoOwner: "acme",
        repoName: "frontend",
        issueNumber: 42,
        status: "PAUSED_AWAITING_APPROVAL",
        agentName: "github-worker-agent",
        harness: "codex",
        title: "githueber frontend#42 github-worker-agent",
        resumability: "resumable",
        resumeHint: "codex resume --include-non-interactive thr_restored",
        updatedAt: "2026-04-24T00:00:00.000Z"
      },
      {
        sessionId: "thr_stale",
        repositoryKey: "frontend",
        repoOwner: "acme",
        repoName: "frontend",
        issueNumber: 99,
        status: "RUNNING",
        agentName: "github-worker-agent",
        harness: "codex",
        title: "githueber frontend#99 github-worker-agent",
        resumability: "resumable",
        resumeHint: "codex resume --include-non-interactive thr_stale",
        updatedAt: "2026-04-24T00:00:00.000Z"
      }
    ]);

    const manager = new CodexSessionManager(
      createClientStub({
        async listSessions() {
          return [
            {
              id: "thr_restored",
              title: "githueber frontend#42 github-worker-agent",
              status: { type: "notLoaded" }
            }
          ];
        },
        async getSessionStatuses() {
          return { thr_restored: { type: "notLoaded" } };
        }
      }),
      registry
    );

    await manager.initialize();

    expect(manager.getSessionForIssue("frontend", 42)).toEqual({
      sessionId: "thr_restored",
      repositoryKey: "frontend",
      repoOwner: "acme",
      repoName: "frontend",
      issueNumber: 42,
      status: "PAUSED_AWAITING_APPROVAL",
      agentName: "github-worker-agent",
      harness: "codex",
      title: "githueber frontend#42 github-worker-agent",
      resumability: "resumable",
      resumeHint: "codex resume --include-non-interactive thr_restored"
    });
    expect(registry.load().map((record) => record.sessionId)).toEqual(["thr_restored"]);
  });

  test("persists paused Codex sessions as released and natively resumable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-codex-paused-"));
    const registry = new CodexSessionRegistry(join(dir, "codex-sessions.json"));
    let pauseListener: ((payload: { sessionId: string }) => void) | undefined;
    const calls: string[] = [];
    const manager = new CodexSessionManager(
      createClientStub({
        async releaseSessionRuntime(sessionId): Promise<void> {
          calls.push(`release:${sessionId}`);
        },
        async resumeSession(sessionId, payload): Promise<void> {
          calls.push(`resume:${sessionId}:${payload.text}`);
        },
        on(eventName, callback) {
          if (eventName === "sessionPaused") {
            pauseListener = callback;
          }
        }
      }),
      registry
    );

    await manager.startNewSession(makeIssue(), "github-worker-agent", "prompt");
    pauseListener?.({ sessionId: "thr_new" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual(["release:thr_new"]);
    expect(manager.getSessionForIssue("frontend", 42)).toMatchObject({
      status: "PAUSED_AWAITING_APPROVAL",
      resumability: "resumable",
      runtimeReleaseReason: "awaiting_user",
      resumeHint: "codex resume --include-non-interactive thr_new"
    });
    expect(registry.load()[0]).toMatchObject({
      status: "PAUSED_AWAITING_APPROVAL",
      resumability: "resumable",
      runtimeReleaseReason: "awaiting_user",
      resumeHint: "codex resume --include-non-interactive thr_new"
    });
    expect(registry.load()[0]?.runtimeReleasedAt).toBeString();

    await manager.sendMessageToSession("thr_new", "User approved. Proceed.");

    expect(calls).toEqual(["release:thr_new", "resume:thr_new:User approved. Proceed."]);
    const resumedRecord = registry.load()[0];
    expect(resumedRecord).toMatchObject({
      status: "RUNNING",
      resumability: "open"
    });
    expect(resumedRecord?.runtimeReleasedAt).toBeUndefined();
    expect(resumedRecord?.runtimeReleaseReason).toBeUndefined();
  });
});
