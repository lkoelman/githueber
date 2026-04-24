import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubIssue, HarnessClientLike } from "../src/models/types.ts";
import { OpenCodeSessionManager } from "../src/opencode/OpenCodeSessionManager.ts";
import { OpenCodeSessionRegistry } from "../src/opencode/OpenCodeSessionRegistry.ts";

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
  return {
    async connect(): Promise<void> {},
    async createSession(): Promise<{ id: string }> {
      return { id: "ses_new" };
    },
    async sendMessage(): Promise<void> {},
    async releaseSessionRuntime(): Promise<void> {},
    async resumeSession(): Promise<void> {},
    async stopSession(): Promise<void> {},
    async listSessions(): Promise<Array<{ id: string; title?: string; status?: { type: string } }>> {
      return [];
    },
    async getSessionStatuses(): Promise<Record<string, { type: string }>> {
      return {};
    },
    on(): void {},
    ...overrides
  };
}

describe("OpenCodeSessionManager", () => {
  test("persists paused sessions with runtime release metadata and restores it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-opencode-paused-"));
    const registry = new OpenCodeSessionRegistry(join(dir, "opencode-sessions.json"));
    let pauseListener: ((payload: { sessionId: string }) => void) | undefined;
    const calls: string[] = [];

    const manager = new OpenCodeSessionManager(
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
      registry,
      "http://127.0.0.1:4100"
    );

    await manager.startNewSession(makeIssue(), "github-worker-agent", "prompt");
    pauseListener?.({ sessionId: "ses_new" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual(["release:ses_new"]);
    expect(registry.load()[0]).toMatchObject({
      sessionId: "ses_new",
      status: "PAUSED_AWAITING_APPROVAL",
      resumability: "resumable",
      runtimeReleaseReason: "awaiting_user"
    });
    expect(registry.load()[0]?.runtimeReleasedAt).toBeString();

    const restored = new OpenCodeSessionManager(
      createClientStub({
        async listSessions() {
          return [{ id: "ses_new", title: "githueber frontend#42 github-worker-agent" }];
        },
        async getSessionStatuses() {
          return { ses_new: { type: "idle" } };
        }
      }),
      registry,
      "http://127.0.0.1:4100"
    );

    await restored.initialize();

    expect(restored.getSessionForIssue("frontend", 42)).toMatchObject({
      sessionId: "ses_new",
      status: "PAUSED_AWAITING_APPROVAL",
      resumability: "resumable",
      runtimeReleaseReason: "awaiting_user"
    });

    await manager.sendMessageToSession("ses_new", "User approved. Proceed.");

    expect(calls).toEqual(["release:ses_new", "resume:ses_new:User approved. Proceed."]);
    const resumedRecord = registry.load()[0];
    expect(resumedRecord).toMatchObject({
      status: "RUNNING",
      resumability: "open"
    });
    expect(resumedRecord?.runtimeReleasedAt).toBeUndefined();
    expect(resumedRecord?.runtimeReleaseReason).toBeUndefined();
  });
});
