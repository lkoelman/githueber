import { describe, expect, test } from "bun:test";
import { ACPSessionManager, createACPClient } from "../src/acp/ACPSessionManager.ts";
import type { GitHubIssue } from "../src/models/types.ts";

describe("createACPClient", () => {
  test("falls back to the OpenCode HTTP API when the ACP SDK Client export is unavailable", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];

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

    await client.connect();

    const session = await client.createSession({
      agentDefinition: "build",
      initialPrompt: "Start working on issue 42."
    });

    await client.sendMessage(session.id, { text: "User approved. Proceed." });
    await client.stopSession?.(session.id);

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:9000/global/health",
        method: "GET",
        body: undefined
      },
      {
        url: "http://127.0.0.1:9000/session",
        method: "POST",
        body: { title: "gh-buddy:build" }
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
  });
});

describe("ACPSessionManager session events", () => {
  test("publishes structured events for session startup, prompts, and lifecycle updates", async () => {
    const listeners = new Map<string, (payload: { sessionId: string }) => void>();
    const events: Array<Record<string, unknown>> = [];

    const manager = new ACPSessionManager({
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
    listeners.get("sessionPaused")?.({ sessionId: "ses_123" });
    listeners.get("sessionCompleted")?.({ sessionId: "ses_123" });

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
