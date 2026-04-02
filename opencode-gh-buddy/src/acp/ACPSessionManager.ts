import type { ACPManagerLike, AgentSessionRecord, SessionStatus } from "../models/types.ts";

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

type FetchLike = typeof fetch;

/**
 * Minimal ACP client adapter for the HTTP API exposed by `opencode acp`.
 *
 * This preserves the daemon's existing `ACPClientLike` contract even though the
 * installed ACP SDK no longer exports the older high-level `Client` wrapper the
 * codebase was originally written against.
 */
class OpenCodeHTTPClient implements ACPClientLike {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: FetchLike
  ) {}

  /** Resolves a relative API path against the configured OpenCode server URL. */
  private buildUrl(path: string): string {
    return new URL(path, this.endpoint.endsWith("/") ? this.endpoint : `${this.endpoint}/`).toString();
  }

  /** Sends an HTTP request to OpenCode and raises a typed error on non-2xx responses. */
  private async request(
    path: string,
    init?: RequestInit
  ): Promise<Response> {
    const response = await this.fetchImpl(this.buildUrl(path), init);

    if (!response.ok) {
      throw new Error(`OpenCode server request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /** Verifies that the target OpenCode server is reachable before the daemon starts polling. */
  async connect(): Promise<void> {
    const response = await this.request("./global/health");
    const health = await response.json() as { healthy?: boolean };

    if (!health.healthy) {
      throw new Error("OpenCode server health check failed");
    }
  }

  /** Creates a new OpenCode session and immediately sends the daemon's initialization prompt. */
  async createSession(request: ACPCreateSessionRequest): Promise<{ id: string }> {
    const sessionResponse = await this.request("./session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `gh-buddy:${request.agentDefinition}` })
    });

    const session = await sessionResponse.json() as { id: string };

    await this.sendPrompt(session.id, request.initialPrompt, request.agentDefinition);

    return session;
  }

  /** Dispatches a prompt turn to an existing OpenCode session, optionally pinning the agent mode. */
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

/**
 * Creates the ACP client used by the daemon.
 *
 * The preferred path is the SDK's legacy `Client` export when available. When
 * the installed SDK only exposes low-level protocol primitives, the daemon
 * falls back to the HTTP API served by `opencode acp`.
 */
export async function createACPClient(
  endpoint: string,
  fetchImpl: FetchLike = fetch
): Promise<ACPClientLike> {
  const mod = await import("@agentclientprotocol/sdk");
  const ClientCtor = (mod as { Client?: new (config: { url: string }) => ACPClientLike }).Client;

  if (ClientCtor) {
    return new ClientCtor({ url: endpoint });
  }

  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return new OpenCodeHTTPClient(endpoint, fetchImpl);
  }

  throw new Error("ACP SDK Client export not available and endpoint is not an OpenCode HTTP server URL");
}

export class ACPSessionManager implements ACPManagerLike {
  private readonly activeSessions = new Map<number, AgentSessionRecord>();
  private readonly pauseListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly completionListeners = new Set<(sessionId: string) => Promise<void> | void>();

  constructor(private readonly acpClient: ACPClientLike) {
    this.bindEvents();
  }

  private bindEvents(): void {
    this.acpClient.on?.("sessionPaused", ({ sessionId }) => {
      this.updateStatus(sessionId, "PAUSED_AWAITING_APPROVAL");
      for (const listener of this.pauseListeners) {
        void listener(sessionId);
      }
    });

    this.acpClient.on?.("sessionCompleted", ({ sessionId }) => {
      this.updateStatus(sessionId, "COMPLETED");
      for (const listener of this.completionListeners) {
        void listener(sessionId);
      }
    });
  }

  private updateStatus(sessionId: string, status: SessionStatus): void {
    for (const [issueNumber, record] of this.activeSessions.entries()) {
      if (record.sessionId === sessionId) {
        this.activeSessions.set(issueNumber, { ...record, status });
      }
    }
  }

  async initialize(): Promise<void> {
    await this.acpClient.connect();
  }

  getSessionForIssue(issueNumber: number): AgentSessionRecord | undefined {
    return this.activeSessions.get(issueNumber);
  }

  listSessions(): AgentSessionRecord[] {
    return Array.from(this.activeSessions.values());
  }

  async startNewSession(issueNumber: number, agentName: string, prompt: string): Promise<void> {
    this.activeSessions.set(issueNumber, {
      sessionId: `initializing-${issueNumber}`,
      issueNumber,
      status: "INITIALIZING",
      agentName
    });

    const session = await this.acpClient.createSession({
      agentDefinition: agentName,
      initialPrompt: prompt
    });

    this.activeSessions.set(issueNumber, {
      sessionId: session.id,
      issueNumber,
      status: "RUNNING",
      agentName
    });
  }

  async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    await this.acpClient.sendMessage(sessionId, { text: message });
  }

  async stopSession(sessionId: string): Promise<void> {
    if (this.acpClient.stopSession) {
      await this.acpClient.stopSession(sessionId);
    }

    for (const [issueNumber, record] of this.activeSessions.entries()) {
      if (record.sessionId === sessionId) {
        this.activeSessions.delete(issueNumber);
      }
    }
  }

  onSessionPaused(callback: (sessionId: string) => Promise<void> | void): void {
    this.pauseListeners.add(callback);
  }

  onSessionCompleted(callback: (sessionId: string) => Promise<void> | void): void {
    this.completionListeners.add(callback);
  }
}
