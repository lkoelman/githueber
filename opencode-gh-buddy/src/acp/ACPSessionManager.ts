import type {
  ACPManagerLike,
  AgentSessionRecord,
  GitHubIssue,
  SessionInteractionEvent,
  SessionStatus
} from "../models/types.ts";

interface ACPCreateSessionRequest {
  agentDefinition: string;
  initialPrompt: string;
}

interface ACPMessagePayload {
  text: string;
}

interface ACPClientLike {
  connect(): Promise<void>;
  createSession(request: ACPCreateSessionRequest): Promise<{ id: string }>;
  sendMessage(sessionId: string, payload: ACPMessagePayload): Promise<void>;
  stopSession?(sessionId: string): Promise<void>;
  on?(eventName: string, callback: (payload: { sessionId: string }) => void): void;
}

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

/** Implements the daemon-facing ACP client contract over OpenCode's session HTTP API plus SSE events. */
class OpenCodeBidirectionalACPClient implements ACPClientLike {
  private readonly listeners = new Map<string, Set<(payload: { sessionId: string }) => void>>();
  private readonly assistantMessageText = new Map<string, string>();
  private readonly sessionTurnMessages = new Map<string, Set<string>>();
  private eventStreamStarted = false;
  private eventStreamReady: Promise<void> | null = null;
  private resolveEventStreamReady: (() => void) | null = null;
  private eventStreamResponse: Response | null = null;
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

    this.eventStreamResponse = response;
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
      return;
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
  async createSession(request: ACPCreateSessionRequest): Promise<{ id: string }> {
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
  async sendMessage(sessionId: string, payload: ACPMessagePayload): Promise<void> {
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

/** Creates the ACP client used by the daemon. */
export async function createACPClient(
  endpoint: string,
  fetchImpl: FetchLike = fetch
): Promise<ACPClientLike> {
  return new OpenCodeBidirectionalACPClient(endpoint, fetchImpl);
}

/** Produces a repository-scoped issue key so identical issue numbers cannot collide. */
function issueKey(repositoryKey: string, issueNumber: number): string {
  return `${repositoryKey}#${issueNumber}`;
}

/** Tracks daemon-managed OpenCode sessions and translates ACP events into session state updates. */
export class ACPSessionManager implements ACPManagerLike {
  private readonly activeSessions = new Map<string, AgentSessionRecord>();
  private readonly pauseListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly completionListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly sessionEventListeners = new Set<(event: SessionInteractionEvent) => void>();

  constructor(private readonly acpClient: ACPClientLike) {
    this.bindEvents();
  }

  /** Subscribes to ACP lifecycle events and fans them out to daemon listeners. */
  private bindEvents(): void {
    this.acpClient.on?.("sessionPaused", ({ sessionId }) => {
      this.updateStatus(sessionId, "PAUSED_AWAITING_APPROVAL");
      this.emitSessionEvent({
        direction: "INBOUND",
        kind: "SESSION_PAUSED",
        ...this.getSessionEventContext(sessionId)
      });
      for (const listener of this.pauseListeners) {
        void listener(sessionId);
      }
    });

    this.acpClient.on?.("sessionCompleted", ({ sessionId }) => {
      this.updateStatus(sessionId, "COMPLETED");
      this.emitSessionEvent({
        direction: "INBOUND",
        kind: "SESSION_COMPLETED",
        ...this.getSessionEventContext(sessionId)
      });
      for (const listener of this.completionListeners) {
        void listener(sessionId);
      }
    });
  }

  /** Updates the cached status for the tracked session record with the given ACP session id. */
  private updateStatus(sessionId: string, status: SessionStatus): void {
    for (const [key, record] of this.activeSessions.entries()) {
      if (record.sessionId === sessionId) {
        this.activeSessions.set(key, { ...record, status });
      }
    }
  }

  /** Looks up a tracked session record by ACP session id. */
  private findSessionById(sessionId: string): AgentSessionRecord | undefined {
    return this.listSessions().find((session) => session.sessionId === sessionId);
  }

  /** Publishes one structured session interaction event to all subscribers. */
  private emitSessionEvent(event: Omit<SessionInteractionEvent, "timestamp">): void {
    const payload = {
      timestamp: new Date().toISOString(),
      ...event
    } satisfies SessionInteractionEvent;

    for (const listener of this.sessionEventListeners) {
      listener(payload);
    }
  }

  /** Builds event metadata from the tracked session record when available. */
  private getSessionEventContext(
    sessionId: string
  ): Omit<SessionInteractionEvent, "timestamp" | "kind" | "direction" | "message"> {
    const session = this.findSessionById(sessionId);

    return {
      sessionId,
      repositoryKey: session?.repositoryKey,
      repoOwner: session?.repoOwner,
      repoName: session?.repoName,
      issueNumber: session?.issueNumber,
      agentName: session?.agentName
    };
  }

  /** Verifies ACP connectivity before the daemon starts accepting work. */
  async initialize(): Promise<void> {
    await this.acpClient.connect();
  }

  /** Returns the active session currently associated with a repository issue, if any. */
  getSessionForIssue(repositoryKey: string, issueNumber: number): AgentSessionRecord | undefined {
    return this.activeSessions.get(issueKey(repositoryKey, issueNumber));
  }

  /** Lists every session record the daemon is currently tracking in memory. */
  listSessions(): AgentSessionRecord[] {
    return Array.from(this.activeSessions.values());
  }

  /** Creates a new ACP session for an issue and records the resulting runtime session id. */
  async startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void> {
    const key = issueKey(issue.repositoryKey, issue.number);

    this.emitSessionEvent({
      direction: "CONTROL",
      kind: "SESSION_STARTING",
      repositoryKey: issue.repositoryKey,
      repoOwner: issue.repoOwner,
      repoName: issue.repoName,
      issueNumber: issue.number,
      agentName,
      message: prompt
    });

    this.activeSessions.set(key, {
      sessionId: `initializing-${issue.repositoryKey}-${issue.number}`,
      repositoryKey: issue.repositoryKey,
      repoOwner: issue.repoOwner,
      repoName: issue.repoName,
      issueNumber: issue.number,
      status: "INITIALIZING",
      agentName
    });

    const session = await this.acpClient.createSession({
      agentDefinition: agentName,
      initialPrompt: prompt
    });

    this.activeSessions.set(key, {
      sessionId: session.id,
      repositoryKey: issue.repositoryKey,
      repoOwner: issue.repoOwner,
      repoName: issue.repoName,
      issueNumber: issue.number,
      status: "RUNNING",
      agentName
    });

    this.emitSessionEvent({
      direction: "CONTROL",
      kind: "SESSION_STARTED",
      ...this.getSessionEventContext(session.id)
    });
    this.emitSessionEvent({
      direction: "OUTBOUND",
      kind: "PROMPT_SENT",
      message: prompt,
      ...this.getSessionEventContext(session.id)
    });
  }

  /** Sends a follow-up prompt to an existing ACP session, typically after human feedback. */
  async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    await this.acpClient.sendMessage(sessionId, { text: message });
    this.emitSessionEvent({
      direction: "OUTBOUND",
      kind: "PROMPT_SENT",
      message,
      ...this.getSessionEventContext(sessionId)
    });
  }

  /** Stops a tracked session and removes its repository-scoped mapping from memory. */
  async stopSession(sessionId: string): Promise<void> {
    if (this.acpClient.stopSession) {
      await this.acpClient.stopSession(sessionId);
    }

    for (const [key, record] of this.activeSessions.entries()) {
      if (record.sessionId === sessionId) {
        this.activeSessions.delete(key);
      }
    }
  }

  /** Registers a callback for ACP pause events that require user approval in GitHub. */
  onSessionPaused(callback: (sessionId: string) => Promise<void> | void): void {
    this.pauseListeners.add(callback);
  }

  /** Registers a callback for ACP completion events so labels can be transitioned. */
  onSessionCompleted(callback: (sessionId: string) => Promise<void> | void): void {
    this.completionListeners.add(callback);
  }

  /** Registers a structured interaction listener and returns an unsubscribe callback. */
  onSessionEvent(callback: (event: SessionInteractionEvent) => void): () => void {
    this.sessionEventListeners.add(callback);
    return () => {
      this.sessionEventListeners.delete(callback);
    };
  }
}
