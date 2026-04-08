import { describe, expect, test } from "bun:test";
import { createSessionManagerForConfig, createShutdownHandler, resolveRepositoryHarness } from "../src/startDaemon.ts";
import type { DaemonConfig, GitHubIssue, HarnessClientLike, SessionManagerLike } from "../src/models/types.ts";

describe("createShutdownHandler", () => {
  test("logs ACP shutdown, stops the daemon, stops IPC, and exits cleanly", async () => {
    const events: string[] = [];
    const infos: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    let exitCode: number | undefined;

    const shutdown = createShutdownHandler({
      daemon: {
        async stop(): Promise<void> {
          events.push("daemon.stop");
        }
      },
      ipc: {
        stop(): void {
          events.push("ipc.stop");
        }
      },
      logger: {
        info(message, meta) {
          infos.push({ message, meta });
        },
        error() {}
      },
      processRef: {
        exit(code?: number): void {
          exitCode = code;
        }
      }
    });

    await shutdown("SIGINT");

    expect(infos).toEqual([
      {
        message: "Closing ACP sessions before shutdown.",
        meta: { signal: "SIGINT" }
      }
    ]);
    expect(events).toEqual(["daemon.stop", "ipc.stop"]);
    expect(exitCode).toBe(0);
  });
});

describe("resolveRepositoryHarness", () => {
  test("prefers repository harness over CLI override and config default", () => {
    expect(
      resolveRepositoryHarness(
        {
          key: "frontend",
          owner: "acme",
          repo: "frontend",
          localRepoPath: "/repos/frontend",
          harness: "codex",
          labels: {
            queue: "queue",
            processing: "processing",
            awaitPlan: "await-plan",
            completed: "completed",
            failed: "failed",
            revising: "revising"
          },
          agentMapping: {}
        },
        { execution: { harness: "opencode" } as any },
        { harnessOverride: "opencode" }
      )
    ).toBe("codex");
  });

  test("uses CLI override when repository harness is absent", () => {
    expect(
      resolveRepositoryHarness(
        {
          key: "frontend",
          owner: "acme",
          repo: "frontend",
          localRepoPath: "/repos/frontend",
          labels: {
            queue: "queue",
            processing: "processing",
            awaitPlan: "await-plan",
            completed: "completed",
            failed: "failed",
            revising: "revising"
          },
          agentMapping: {}
        },
        { execution: { harness: "opencode" } as any },
        { harnessOverride: "codex" }
      )
    ).toBe("codex");
  });
});

describe("createSessionManagerForConfig", () => {
  const config: DaemonConfig = {
    repositories: {
      frontend: {
        key: "frontend",
        owner: "acme",
        repo: "frontend",
        localRepoPath: "/repos/frontend",
        labels: {
          queue: "queue",
          processing: "processing",
          awaitPlan: "await-plan",
          completed: "completed",
          failed: "failed",
          revising: "revising"
        },
        agentMapping: {}
      },
      backend: {
        key: "backend",
        owner: "acme",
        repo: "backend",
        localRepoPath: "/repos/backend",
        harness: "codex",
        labels: {
          queue: "queue",
          processing: "processing",
          awaitPlan: "await-plan",
          completed: "completed",
          failed: "failed",
          revising: "revising"
        },
        agentMapping: {}
      }
    },
    execution: {
      harness: "opencode",
      autoApprove: false,
      concurrency: 1,
      approvalComment: "/approve",
      reviseComment: "/revise",
      opencodeModel: null,
      timeoutSeconds: 3600
    },
    polling: { intervalMs: 1000 },
    opencode: { endpoint: "http://127.0.0.1:9000" },
    codex: { command: "codex", args: "app-server", model: "gpt-5.4" },
    ipc: { socketPath: "/tmp/githueber.sock" },
    logging: { level: "info" },
    isolation: { worktrees: null }
  };

  function createHarnessStub(prefix: string): HarnessClientLike {
    const listeners = new Map<string, (payload: { sessionId: string }) => void>();

    return {
      async connect(): Promise<void> {},
      async createSession(): Promise<{ id: string }> {
        return { id: `${prefix}-session` };
      },
      async sendMessage(): Promise<void> {},
      async stopSession(): Promise<void> {},
      on(eventName, callback) {
        listeners.set(eventName, callback);
      }
    };
  }

  test("constructs only the harness managers required by resolved repository harnesses", async () => {
    const created: string[] = [];

    await createSessionManagerForConfig(
      config,
      {},
      {
        createOpenCodeClient: async () => {
          created.push("opencode");
          return createHarnessStub("opencode");
        },
        createCodexClient: () => {
          created.push("codex");
          return createHarnessStub("codex");
        }
      }
    );

    expect(created).toEqual(["opencode", "codex"]);
  });

  test("routes mixed repositories to different harness backends in one daemon manager", async () => {
    const manager = await createSessionManagerForConfig(
      config,
      {},
      {
        createOpenCodeClient: async () => createHarnessStub("opencode"),
        createCodexClient: () => createHarnessStub("codex")
      }
    );

    const makeIssue = (repositoryKey: "frontend" | "backend"): GitHubIssue => ({
      repositoryKey,
      repoOwner: "acme",
      repoName: repositoryKey,
      localRepoPath: `/repos/${repositoryKey}`,
      id: 1,
      number: 1,
      title: "Test",
      body: "Body",
      labels: ["queue"],
      state: "open",
      updatedAt: "2026-04-07T00:00:00Z",
      comments: []
    });

    await manager.startNewSession(makeIssue("frontend"), "worker", "prompt");
    await manager.startNewSession(makeIssue("backend"), "worker", "prompt");

    expect(manager.listSessions().map((session) => session.sessionId)).toEqual([
      "opencode-session",
      "codex-session"
    ]);
    expect(manager.getSessionForIssue("frontend", 1)?.sessionId).toBe("opencode-session");
    expect(manager.getSessionForIssue("backend", 1)?.sessionId).toBe("codex-session");
  });
});
