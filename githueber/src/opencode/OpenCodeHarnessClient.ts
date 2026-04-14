import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { HarnessClientLike, HarnessMessagePayload, HarnessSessionStartRequest } from "../models/types.ts";

interface OpenCodeSessionStatusEvent {
  type?: string;
  properties?: {
    sessionID?: string;
    status?: {
      type?: string;
    };
  };
}

interface OpenCodeMessagePartUpdatedEvent {
  type?: string;
  properties?: {
    part?: {
      type?: string;
      text?: string;
      messageID?: string;
      sessionID?: string;
    };
  };
}

export interface CreateOpenCodeHarnessClientDeps {
  createClient?: (config: { baseUrl: string }) => OpencodeClient;
}

function sessionMessageKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

/** Implements the daemon-facing harness contract on top of the official OpenCode SDK. */
class OpenCodeSdkClient implements HarnessClientLike {
  private readonly listeners = new Map<string, Set<(payload: { sessionId: string; message?: string }) => void>>();
  private readonly assistantMessageText = new Map<string, string>();
  private readonly sessionTurnMessages = new Map<string, Set<string>>();
  private eventStreamStarted = false;

  constructor(private readonly client: OpencodeClient) {}

  /** Verifies server connectivity through the session API and subscribes to the event bus exactly once. */
  async connect(): Promise<void> {
    await this.client.session.status();

    if (!this.eventStreamStarted) {
      this.eventStreamStarted = true;
      void this.consumeEventStream();
    }
  }

  /** Streams server events in the background for the lifetime of the process. */
  private async consumeEventStream(): Promise<void> {
    const subscription = await this.client.event.subscribe();
    for await (const event of subscription.stream as AsyncGenerator<unknown>) {
      this.handleServerEvent(event as OpenCodeSessionStatusEvent | OpenCodeMessagePartUpdatedEvent);
    }
  }

  /** Updates tracked assistant turn state and emits pause/completion signals when turns finish. */
  private handleServerEvent(event: OpenCodeSessionStatusEvent | OpenCodeMessagePartUpdatedEvent): void {
    if (event.type === "session.status") {
      const sessionId = event.properties?.sessionID;
      const statusType = event.properties?.status?.type;

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

    if (event.type === "message.part.updated") {
      const sessionId = event.properties?.part?.sessionID;
      const messageId = event.properties?.part?.messageID;
      const partType = event.properties?.part?.type;
      const text = event.properties?.part?.text;

      if (!sessionId || !messageId || partType !== "text" || typeof text !== "string") {
        return;
      }

      this.trackTurnMessage(sessionId, messageId);
      this.assistantMessageText.set(sessionMessageKey(sessionId, messageId), text);
      this.emit("sessionMessageDelta", { sessionId, message: text });
    }
  }

  /** Adds one message id to the current in-flight assistant turn. */
  private trackTurnMessage(sessionId: string, messageId: string): void {
    const messages = this.sessionTurnMessages.get(sessionId) ?? new Set<string>();
    messages.add(messageId);
    this.sessionTurnMessages.set(sessionId, messages);
  }

  /** Emits pause or completion once OpenCode reports the prompt turn is idle. */
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
  private emit(eventName: string, payload: { sessionId: string; message?: string }): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(payload);
    }
  }

  /** Registers a listener for session lifecycle or delta events. */
  on(eventName: string, callback: (payload: { sessionId: string; message?: string }) => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(callback);
    this.listeners.set(eventName, listeners);
  }

  /** Creates a new OpenCode session and immediately dispatches the initial prompt asynchronously. */
  async createSession(request: HarnessSessionStartRequest): Promise<{ id: string }> {
    const session = await this.client.session.create({
      body: { title: request.title ?? `githueber:${request.agentDefinition}` },
      query: request.cwd ? { directory: request.cwd } : undefined
    });

    await this.sendPrompt(session.data.id, request.initialPrompt, request.agentDefinition);
    return { id: session.data.id };
  }

  /** Sends one asynchronous prompt turn into an existing OpenCode session. */
  private async sendPrompt(sessionId: string, text: string, agent?: string): Promise<void> {
    const body: Record<string, unknown> = {
      parts: [{ type: "text", text }]
    };

    if (agent) {
      body.agent = agent;
    }

    await this.client.session.promptAsync({
      path: { id: sessionId },
      body
    });
  }

  /** Resumes an existing session by sending another text prompt turn. */
  async sendMessage(sessionId: string, payload: HarnessMessagePayload): Promise<void> {
    await this.sendPrompt(sessionId, payload.text);
  }

  /** Requests that OpenCode abort the active turn for a tracked session. */
  async stopSession(sessionId: string): Promise<void> {
    await this.client.session.abort({
      path: { id: sessionId }
    });
  }

  /** Lists OpenCode-native sessions so daemon metadata can be reattached after restart. */
  async listSessions(): Promise<Array<{ id: string; title?: string }>> {
    const sessions = await this.client.session.list();
    return sessions.data.map((session) => ({ id: session.id, title: session.title ?? undefined }));
  }

  /** Returns the server-reported runtime status for all OpenCode sessions. */
  async getSessionStatuses(): Promise<Record<string, { type: string }>> {
    return await this.client.session.status().then((response) => response.data as Record<string, { type: string }>);
  }
}

/** Creates the OpenCode harness client used by the daemon. */
export async function createOpenCodeHarnessClient(
  endpoint: string,
  deps: CreateOpenCodeHarnessClientDeps = {}
): Promise<HarnessClientLike> {
  const createClient = deps.createClient ?? ((config: { baseUrl: string }) => createOpencodeClient(config));
  return new OpenCodeSdkClient(createClient({ baseUrl: endpoint }));
}

export const createACPClient = createOpenCodeHarnessClient;
