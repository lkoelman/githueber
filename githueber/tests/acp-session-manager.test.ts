import { describe, expect, test } from "bun:test";
import { HarnessSessionManager } from "../src/sessionManager/HarnessSessionManager.ts";
import { createACPClient } from "../src/opencode/OpenCodeHarnessClient.ts";
import type { GitHubIssue } from "../src/models/types.ts";

describe("createACPClient", () => {
  test("uses the OpenCode session API and listens to lifecycle events from the global SSE stream", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();

    const fetchStub: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

      requests.push({ url, method, body });

      if (url.endsWith("/global/health")) {
        return new Response(JSON.stringify({ healthy: true, version: "1.3.13" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.endsWith("/global/event")) {
        return new Response(
          new ReadableStream({
            start(streamController) {
              controller = streamController;
              streamController.enqueue(
                encoder.encode('data: {"payload":{"type":"server.connected","properties":{}}}\n\n')
              );
            }
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" }
          }
        );
      }

      if (url.endsWith("/session") && method === "POST") {
        return new Response(JSON.stringify({ id: "ses_123" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.endsWith("/session/ses_123/prompt_async")) {
        return new Response(null, { status: 204 });
      }

      if (url.endsWith("/session/ses_123/abort")) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    };

    const client = await createACPClient("http://127.0.0.1:9000", fetchStub);
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
      initialPrompt: "Start working on issue 42."
    });

    await client.sendMessage(session.id, { text: "User approved. Proceed." });
    await client.stopSession?.(session.id);

    controller?.enqueue(
      encoder.encode(
        [
          'data: {"payload":{"type":"session.status","properties":{"sessionID":"ses_123","status":{"type":"busy"}}}}',
          "",
          'data: {"payload":{"type":"message.part.delta","properties":{"sessionID":"ses_123","messageID":"msg_1","partID":"prt_1","field":"text","delta":"Plan ready. [AWAITING_APPROVAL]"}}}',
          "",
          'data: {"payload":{"type":"session.status","properties":{"sessionID":"ses_123","status":{"type":"idle"}}}}',
          "",
          'data: {"payload":{"type":"session.status","properties":{"sessionID":"ses_123","status":{"type":"busy"}}}}',
          "",
          'data: {"payload":{"type":"message.part.delta","properties":{"sessionID":"ses_123","messageID":"msg_2","partID":"prt_2","field":"text","delta":"Implementation done."}}}',
          "",
          'data: {"payload":{"type":"session.status","properties":{"sessionID":"ses_123","status":{"type":"idle"}}}}',
          "",
        ].join("\n")
      )
    );
    controller?.close();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:9000/global/health",
        method: "GET",
        body: undefined
      },
      {
        url: "http://127.0.0.1:9000/global/event",
        method: "GET",
        body: undefined
      },
      {
        url: "http://127.0.0.1:9000/session",
        method: "POST",
        body: { title: "githueber:build" }
      },
      {
        url: "http://127.0.0.1:9000/session/ses_123/prompt_async",
        method: "POST",
        body: {
          agent: "build",
          parts: [{ type: "text", text: "Start working on issue 42." }]
        }
      },
      {
        url: "http://127.0.0.1:9000/session/ses_123/prompt_async",
        method: "POST",
        body: {
          parts: [{ type: "text", text: "User approved. Proceed." }]
        }
      },
      {
        url: "http://127.0.0.1:9000/session/ses_123/abort",
        method: "POST",
        body: undefined
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
