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

export async function createACPClient(endpoint: string): Promise<ACPClientLike> {
  const mod = await import("@agentclientprotocol/sdk");
  const ClientCtor = (mod as { Client?: new (config: { url: string }) => ACPClientLike }).Client;
  if (!ClientCtor) {
    throw new Error("ACP SDK Client export not available");
  }
  return new ClientCtor({ url: endpoint });
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
