import { describe, expect, test } from "bun:test";
import { HarnessSessionManager } from "../src/sessionManager/HarnessSessionManager.ts";
import { createACPClient } from "../src/opencode/OpenCodeHarnessClient.ts";
import type { GitHubIssue } from "../src/models/types.ts";

describe("createACPClient", () => {
  test("releases by aborting the active turn and resumes with promptAsync on same session", async () => {
    const calls: Array<{ method: string; payload?: unknown }> = [];

    async function* eventStream(): AsyncGenerator<any> {}

    const client = await createACPClient(
      {},
      {
        createRuntime: async () => ({
          client: {
            event: {
              subscribe: async () => ({ stream: eventStream() })
            },
            session: {
              create: async () => ({ data: { id: "ses_123" } }),
              promptAsync: async (payload: unknown) => {
                calls.push({ method: "session.promptAsync", payload });
                return { data: { info: { id: "msg_x" }, parts: [] } };
              },
              abort: async (payload: unknown) => {
                calls.push({ method: "session.abort", payload });
                return { data: true };
              },
              list: async () => ({ data: [] }),
              status: async () => ({ data: {} })
            }
          } as any,
          server: {
            url: "http://127.0.0.1:4100",
            close() {}
          }
        })
      }
    );

    await client.releaseSessionRuntime?.("ses_123");
    await client.resumeSession?.("ses_123", { text: "User approved. Proceed." });

    expect(calls).toEqual([
      {
        method: "session.abort",
        payload: {
          path: { id: "ses_123" }
        }
      },
      {
        method: "session.promptAsync",
        payload: {
          path: { id: "ses_123" },
          body: {
            parts: [{ type: "text", text: "User approved. Proceed." }]
          }
        }
      }
    ]);
  });

  test("uses the OpenCode SDK and listens to lifecycle events from the event stream", async () => {
    const calls: Array<{ method: string; payload?: unknown }> = [];
    const events = [
      { type: "server.connected", properties: {} },
      { type: "session.status", properties: { sessionID: "ses_123", status: { type: "busy" } } },
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_123",
            messageID: "msg_1",
            type: "text",
            text: "Plan ready. [AWAITING_APPROVAL]"
          }
        }
      },
      { type: "session.status", properties: { sessionID: "ses_123", status: { type: "idle" } } },
      { type: "session.status", properties: { sessionID: "ses_123", status: { type: "busy" } } },
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_123",
            messageID: "msg_2",
            type: "text",
            text: "Implementation done."
          }
        }
      },
      { type: "session.status", properties: { sessionID: "ses_123", status: { type: "idle" } } }
    ];

    async function* eventStream(): AsyncGenerator<any> {
      for (const event of events) {
        yield event;
      }
    }

    const client = await createACPClient(
      {
        permission: {
          external_directory: "allow"
        }
      },
      {
        createRuntime: async (options) => {
          calls.push({ method: "createOpencode", payload: options });
          return {
            client: {
              event: {
                subscribe: async () => {
                  calls.push({ method: "event.subscribe" });
                  return { stream: eventStream() };
                }
              },
              session: {
                create: async (payload: unknown) => {
                  calls.push({ method: "session.create", payload });
                  return { data: { id: "ses_123" } };
                },
                promptAsync: async (payload: unknown) => {
                  calls.push({ method: "session.promptAsync", payload });
                  return { data: { info: { id: "msg_x" }, parts: [] } };
                },
                abort: async (payload: unknown) => {
                  calls.push({ method: "session.abort", payload });
                  return { data: true };
                },
                list: async () => ({ data: [] }),
                status: async () => {
                  calls.push({ method: "session.status" });
                  return { data: {} };
                }
              }
            } as any,
            server: {
              url: "http://127.0.0.1:4100",
              close() {}
            }
          };
        }
      }
    );
    const paused: string[] = [];
    const completed: string[] = [];
    const deltas: Array<{ sessionId: string; message: string }> = [];

    client.on?.("sessionPaused", ({ sessionId }) => paused.push(sessionId));
    client.on?.("sessionCompleted", ({ sessionId }) => completed.push(sessionId));
    client.on?.("sessionMessageDelta", ({ sessionId, message }) => {
      deltas.push({ sessionId, message });
    });

    await client.connect();

    const session = await client.createSession({
      agentDefinition: "build",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend",
      title: "githueber frontend#42 build"
    });

    await client.sendMessage(session.id, { text: "User approved. Proceed." });
    await client.stopSession?.(session.id);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toEqual([
      {
        method: "createOpencode",
        payload: {
          hostname: undefined,
          port: undefined,
          timeout: undefined,
          config: {
            permission: {
              external_directory: "allow"
            }
          }
        }
      },
      {
        method: "session.status"
      },
      {
        method: "event.subscribe"
      },
      {
        method: "session.create",
        payload: {
          body: { title: "githueber frontend#42 build" },
          query: { directory: "/repos/frontend" }
        }
      },
      {
        method: "session.promptAsync",
        payload: {
          path: { id: "ses_123" },
          body: {
            agent: "build",
            parts: [{ type: "text", text: "Start working on issue 42." }]
          }
        }
      },
      {
        method: "session.promptAsync",
        payload: {
          path: { id: "ses_123" },
          body: {
            parts: [{ type: "text", text: "User approved. Proceed." }]
          }
        }
      },
      {
        method: "session.abort",
        payload: {
          path: { id: "ses_123" }
        }
      }
    ]);
    expect(deltas).toEqual([
      { sessionId: "ses_123", message: "Plan ready. [AWAITING_APPROVAL]" },
      { sessionId: "ses_123", message: "Implementation done." }
    ]);
    expect(paused).toEqual(["ses_123"]);
    expect(completed).toEqual(["ses_123"]);
  });
});

describe("HarnessSessionManager session events", () => {
  test("releases runtime on pause and resumes released sessions on feedback", async () => {
    const listeners = new Map<string, (payload: { sessionId: string }) => void>();
    const calls: string[] = [];

    const manager = new HarnessSessionManager({
      async connect(): Promise<void> {},
      async createSession(): Promise<{ id: string }> {
        return { id: "ses_123" };
      },
      async sendMessage(): Promise<void> {
        calls.push("sendMessage");
      },
      async releaseSessionRuntime(sessionId): Promise<void> {
        calls.push(`release:${sessionId}`);
      },
      async resumeSession(sessionId, payload): Promise<void> {
        calls.push(`resume:${sessionId}:${payload.text}`);
      },
      on(eventName, callback) {
        listeners.set(eventName, callback);
      }
    });

    await manager.startNewSession(
      {
        repositoryKey: "frontend",
        repoOwner: "acme",
        repoName: "web",
        localRepoPath: "/repos/web",
        id: 42,
        number: 42,
        title: "Fix bug",
        body: "Details",
        labels: ["agent-queue"],
        state: "open",
        updatedAt: "2026-04-07T00:00:00Z",
        comments: []
      },
      "github-worker-agent",
      "Start working on issue 42."
    );

    listeners.get("sessionPaused")?.({ sessionId: "ses_123" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const paused = manager.getSessionForIssue("frontend", 42);
    expect(paused).toMatchObject({
      sessionId: "ses_123",
      status: "PAUSED_AWAITING_APPROVAL",
      runtimeReleaseReason: "awaiting_user",
      resumability: "resumable"
    });
    expect(paused?.runtimeReleasedAt).toBeString();
    expect(calls).toEqual(["release:ses_123"]);

    await manager.sendMessageToSession("ses_123", "User approved. Proceed.");

    expect(calls).toEqual(["release:ses_123", "resume:ses_123:User approved. Proceed."]);
    const resumed = manager.getSessionForIssue("frontend", 42);
    expect(resumed).toMatchObject({
      sessionId: "ses_123",
      status: "RUNNING"
    });
    expect(resumed?.runtimeReleasedAt).toBeUndefined();
    expect(resumed?.runtimeReleaseReason).toBeUndefined();
  });

  test("publishes structured events for session startup, prompts, streamed deltas, and lifecycle updates", async () => {
    const listeners = new Map<string, (payload: { sessionId: string }) => void>();
    const events: Array<Record<string, unknown>> = [];

    const manager = new HarnessSessionManager({
      async connect(): Promise<void> {},
      async createSession(): Promise<{ id: string }> {
        return { id: "ses_123" };
      },
      async sendMessage(): Promise<void> {},
      on(eventName, callback) {
        listeners.set(eventName, callback);
      }
    });

    manager.onSessionEvent((event) => {
      events.push({
        kind: event.kind,
        direction: event.direction,
        sessionId: event.sessionId,
        repositoryKey: event.repositoryKey,
        issueNumber: event.issueNumber,
        agentName: event.agentName,
        message: event.message
      });
    });

    const issue: GitHubIssue = {
      repositoryKey: "frontend",
      repoOwner: "acme",
      repoName: "web",
      localRepoPath: "/repos/web",
      id: 42,
      number: 42,
      title: "Fix bug",
      body: "Details",
      labels: ["agent-queue"],
      state: "open",
      updatedAt: "2026-04-07T00:00:00Z",
      comments: []
    };

    await manager.startNewSession(issue, "github-worker-agent", "Start working on issue 42.");
    await manager.sendMessageToSession("ses_123", "User approved. Proceed.");
    (listeners.get("sessionMessageDelta") as ((payload: { sessionId: string; message: string }) => void) | undefined)?.({
      sessionId: "ses_123",
      message: "Streaming response."
    });
    listeners.get("sessionPaused")?.({ sessionId: "ses_123" });
    listeners.get("sessionCompleted")?.({ sessionId: "ses_123" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual([
      {
        kind: "SESSION_STARTING",
        direction: "CONTROL",
        sessionId: undefined,
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: "Start working on issue 42."
      },
      {
        kind: "SESSION_STARTED",
        direction: "CONTROL",
        sessionId: "ses_123",
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: undefined
      },
      {
        kind: "PROMPT_SENT",
        direction: "OUTBOUND",
        sessionId: "ses_123",
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: "Start working on issue 42."
      },
      {
        kind: "PROMPT_SENT",
        direction: "OUTBOUND",
        sessionId: "ses_123",
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: "User approved. Proceed."
      },
      {
        kind: "MESSAGE_DELTA",
        direction: "INBOUND",
        sessionId: "ses_123",
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: "Streaming response."
      },
      {
        kind: "SESSION_PAUSED",
        direction: "INBOUND",
        sessionId: "ses_123",
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: undefined
      },
      {
        kind: "SESSION_COMPLETED",
        direction: "INBOUND",
        sessionId: "ses_123",
        repositoryKey: "frontend",
        issueNumber: 42,
        agentName: "github-worker-agent",
        message: undefined
      }
    ]);
  });
});
