import { describe, expect, test } from "bun:test";
import { createACPClient } from "../src/acp/ACPSessionManager.ts";

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
