import type { HarnessClientLike } from "../models/types.ts";
import { HarnessSessionManager } from "../harness/HarnessSessionManager.ts";

interface OpenCodeMessageUpdatedEvent {
  payload?: {
    type?: string;
    properties?: {
      sessionID?: string;
    };
  };
}

interface OpenCodeMessageDeltaEvent {
  payload?: {
    type?: string;
    properties?: {
      sessionID?: string;
      messageID?: string;
      field?: string;
      delta?: string;
    };
  };
}

interface OpenCodeMessagePartUpdatedEvent {
  payload?: {
    type?: string;
    properties?: {
      sessionID?: string;
      part?: {
        type?: string;
        text?: string;
        messageID?: string;
      };
    };
  };
}

interface OpenCodeSessionStatusEvent {
  payload?: {
    type?: string;
    properties?: {
      sessionID?: string;
      status?: {
        type?: string;
      };
    };
  };
}

type FetchLike = typeof fetch;

function sessionMessageKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

/** Implements the daemon-facing harness contract over OpenCode's session HTTP API plus SSE events. */
class OpenCodeHttpSseClient implements HarnessClientLike {
  private readonly listeners = new Map<string, Set<(payload: { sessionId: string }) => void>>();
  private readonly assistantMessageText = new Map<string, string>();
  private readonly sessionTurnMessages = new Map<string, Set<string>>();
  private eventStreamStarted = false;
  private eventStreamReady: Promise<void> | null = null;
  private resolveEventStreamReady: (() => void) | null = null;
  private eventStreamTask: Promise<void> | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: FetchLike
  ) {}

  /** Resolves a relative API path against the configured OpenCode server URL. */
  private buildUrl(path: string): string {
    return new URL(path, this.endpoint.endsWith("/") ? this.endpoint : `${this.endpoint}/`).toString();
  }

  /** Sends an HTTP request to OpenCode and raises a typed error on non-2xx responses. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(this.buildUrl(path), init);
    if (!response.ok) {
      throw new Error(`OpenCode server request failed: ${response.status} ${response.statusText}`);
    }
    return response;
  }

  /** Starts the server health check and the background SSE listener used for session lifecycle events. */
  async connect(): Promise<void> {
    const response = await this.request("./global/health");
    const health = (await response.json()) as { healthy?: boolean };

    if (!health.healthy) {
      throw new Error("OpenCode server health check failed");
    }

    if (!this.eventStreamStarted) {
      this.eventStreamStarted = true;
      await this.startEventStream();
    }
  }

  /** Opens the global SSE stream and processes events asynchronously for the lifetime of the client. */
  private async startEventStream(): Promise<void> {
    const response = await this.request("./global/event", {
      headers: { accept: "text/event-stream" }
    });

    const body = response.body;
    if (!body) {
      throw new Error("OpenCode global event stream did not provide a response body");
    }

    this.eventStreamReady = new Promise<void>((resolve) => {
      this.resolveEventStreamReady = resolve;
    });
    this.eventStreamTask = this.consumeEventStream(body).catch((error) => {
      console.error("OpenCode event stream failed", error);
      throw error;
    });
    await this.eventStreamReady;
  }

  /** Parses the OpenCode SSE stream and forwards relevant events into the daemon lifecycle model. */
  private async consumeEventStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.trim().length > 0) {
          this.handleEventChunk(buffer);
        }
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      let separator = findEventSeparator(buffer);

      while (separator) {
        const chunk = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        this.handleEventChunk(chunk);
        separator = findEventSeparator(buffer);
      }
    }
  }

  /** Extracts the JSON payload from one SSE event block. */
  private handleEventChunk(chunk: string): void {
    const dataLine = chunk
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));

    if (!dataLine) {
      return;
    }

    const payload = JSON.parse(dataLine.slice(6)) as
      | OpenCodeMessageUpdatedEvent
      | OpenCodeMessageDeltaEvent
      | OpenCodeMessagePartUpdatedEvent
      | OpenCodeSessionStatusEvent;

    this.resolveEventStreamReady?.();
    this.resolveEventStreamReady = null;
    this.eventStreamReady = null;
    this.handleServerEvent(payload);
  }

  /** Updates tracked assistant turn state and emits pause/completion signals when turns finish. */
  private handleServerEvent(
    event:
      | OpenCodeMessageUpdatedEvent
      | OpenCodeMessageDeltaEvent
      | OpenCodeMessagePartUpdatedEvent
      | OpenCodeSessionStatusEvent
  ): void {
    const eventType = event.payload?.type;

    if (eventType === "session.status") {
      const sessionId = event.payload?.properties?.sessionID;
      const statusType = event.payload?.properties?.status?.type;

      if (!sessionId || !statusType) {
        return;
      }

      if (statusType === "busy") {
        if (!this.sessionTurnMessages.has(sessionId)) {
          this.sessionTurnMessages.set(sessionId, new Set());
        }
        return;
      }

      if (statusType === "idle") {
        this.finalizeTurn(sessionId);
      }

      return;
    }

    if (eventType === "message.part.delta") {
      const sessionId = event.payload?.properties?.sessionID;
      const messageId = event.payload?.properties?.messageID;
      const field = event.payload?.properties?.field;
      const delta = event.payload?.properties?.delta;

      if (!sessionId || !messageId || field !== "text" || typeof delta !== "string") {
        return;
      }

      this.trackTurnMessage(sessionId, messageId);
      const key = sessionMessageKey(sessionId, messageId);
      this.assistantMessageText.set(key, `${this.assistantMessageText.get(key) ?? ""}${delta}`);
      return;
    }

    if (eventType === "message.part.updated") {
      const sessionId = event.payload?.properties?.sessionID;
      const messageId = event.payload?.properties?.part?.messageID;
      const partType = event.payload?.properties?.part?.type;
      const text = event.payload?.properties?.part?.text;

      if (!sessionId || !messageId || partType !== "text" || typeof text !== "string") {
        return;
      }

      this.trackTurnMessage(sessionId, messageId);
      this.assistantMessageText.set(sessionMessageKey(sessionId, messageId), text);
    }
  }

  /** Adds one message id to the set of assistant messages seen in the current prompt turn. */
  private trackTurnMessage(sessionId: string, messageId: string): void {
    const messages = this.sessionTurnMessages.get(sessionId) ?? new Set<string>();
    messages.add(messageId);
    this.sessionTurnMessages.set(sessionId, messages);
  }

  /** Emits the daemon lifecycle event that corresponds to the completed prompt turn. */
  private finalizeTurn(sessionId: string): void {
    const messageIds = this.sessionTurnMessages.get(sessionId);
    if (!messageIds || messageIds.size === 0) {
      return;
    }

    const text = Array.from(messageIds)
      .map((messageId) => this.assistantMessageText.get(sessionMessageKey(sessionId, messageId)) ?? "")
      .join("\n");

    for (const messageId of messageIds) {
      this.assistantMessageText.delete(sessionMessageKey(sessionId, messageId));
    }
    this.sessionTurnMessages.delete(sessionId);

    if (text.includes("[AWAITING_APPROVAL]")) {
      this.emit("sessionPaused", { sessionId });
      return;
    }

    this.emit("sessionCompleted", { sessionId });
  }

  /** Notifies all listeners registered for one daemon lifecycle event. */
  private emit(eventName: string, payload: { sessionId: string }): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(payload);
    }
  }

  /** Registers a listener for sessionPaused or sessionCompleted events. */
  on(eventName: string, callback: (payload: { sessionId: string }) => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(callback);
    this.listeners.set(eventName, listeners);
  }

  /** Creates a new OpenCode session and immediately sends the daemon's initialization prompt. */
  async createSession(request: {
    agentDefinition: string;
    initialPrompt: string;
  }): Promise<{ id: string }> {
    const sessionResponse = await this.request("./session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `gh-buddy:${request.agentDefinition}` })
    });

    const session = (await sessionResponse.json()) as { id: string };

    await this.sendPrompt(session.id, request.initialPrompt, request.agentDefinition);
    return session;
  }

  /** Dispatches one prompt turn to an existing OpenCode session. */
  private async sendPrompt(sessionId: string, text: string, agent?: string): Promise<void> {
    const payload: Record<string, unknown> = {
      parts: [{ type: "text", text }]
    };

    if (agent) {
      payload.agent = agent;
    }

    await this.request(`./session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  /** Resumes an existing session by sending another text prompt turn. */
  async sendMessage(sessionId: string, payload: { text: string }): Promise<void> {
    await this.sendPrompt(sessionId, payload.text);
  }

  /** Requests that OpenCode abort the active turn for a tracked session. */
  async stopSession(sessionId: string): Promise<void> {
    await this.request(`./session/${sessionId}/abort`, {
      method: "POST"
    });
  }
}

function findEventSeparator(buffer: string): { index: number; length: number } | null {
  const newlineIndex = buffer.indexOf("\n\n");
  const carriageReturnIndex = buffer.indexOf("\r\n\r\n");

  if (newlineIndex === -1) {
    return carriageReturnIndex === -1 ? null : { index: carriageReturnIndex, length: 4 };
  }

  if (carriageReturnIndex === -1) {
    return { index: newlineIndex, length: 2 };
  }

  return newlineIndex < carriageReturnIndex
    ? { index: newlineIndex, length: 2 }
    : { index: carriageReturnIndex, length: 4 };
}

/** Creates the OpenCode harness client used by the daemon. */
export async function createOpenCodeHarnessClient(
  endpoint: string,
  fetchImpl: FetchLike = fetch
): Promise<HarnessClientLike> {
  return new OpenCodeHttpSseClient(endpoint, fetchImpl);
}

export const createACPClient = createOpenCodeHarnessClient;
export { HarnessSessionManager };
export { HarnessSessionManager as ACPSessionManager };
