import type {
  AgentSessionRecord,
  GitHubIssue,
  HarnessClientLike,
  SessionInteractionEvent,
  SessionManagerLike
} from "../models/types.ts";

/** Produces a repository-scoped issue key so identical issue numbers cannot collide. */
function issueKey(repositoryKey: string, issueNumber: number): string {
  return `${repositoryKey}#${issueNumber}`;
}

/** Tracks daemon-managed harness sessions and translates harness events into session state updates. */
export class HarnessSessionManager implements SessionManagerLike {
  private readonly activeSessions = new Map<string, AgentSessionRecord>();
  private readonly pauseListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly completionListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly sessionEventListeners = new Set<(event: SessionInteractionEvent) => void>();

  constructor(protected readonly harnessClient: HarnessClientLike) {
    this.bindEvents();
  }

  /** Subscribes to harness lifecycle events and fans them out to daemon listeners. */
  private bindEvents(): void {
    this.harnessClient.on?.("sessionMessageDelta", ({ sessionId, message }) => {
      if (!message) {
        return;
      }

      this.emitSessionEvent({
        direction: "INBOUND",
        kind: "MESSAGE_DELTA",
        message,
        ...this.getSessionEventContext(sessionId)
      });
    });

    this.harnessClient.on?.("sessionPaused", ({ sessionId }) => {
      const timestamp = new Date().toISOString();
      this.updateRecord(sessionId, (record) => ({
        ...record,
        status: "PAUSED_AWAITING_APPROVAL",
        lastActiveAt: timestamp,
        runtimeReleasedAt: timestamp,
        runtimeReleaseReason: "awaiting_user",
        resumability: "resumable"
      }));
      this.emitSessionEvent({
        direction: "INBOUND",
        kind: "SESSION_PAUSED",
        ...this.getSessionEventContext(sessionId)
      });
      for (const listener of this.pauseListeners) {
        void listener(sessionId);
      }
      void this.releaseSessionRuntime(sessionId);
    });

    this.harnessClient.on?.("sessionCompleted", ({ sessionId }) => {
      const timestamp = new Date().toISOString();
      this.updateRecord(sessionId, (record) => ({
        ...record,
        status: "COMPLETED",
        lastActiveAt: timestamp
      }));
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

  /** Updates the cached tracked session record with the given session id. */
  private updateRecord(
    sessionId: string,
    update: (record: AgentSessionRecord) => AgentSessionRecord
  ): void {
    for (const [key, record] of this.activeSessions.entries()) {
      if (record.sessionId === sessionId) {
        this.activeSessions.set(key, update(record));
      }
    }
  }

  /** Looks up a tracked session record by runtime session id. */
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

  /** Verifies harness connectivity before the daemon starts accepting work. */
  async initialize(): Promise<void> {
    await this.harnessClient.connect();
  }

  /** Releases harness-scoped resources once the daemon is done managing this backend. */
  async shutdown(): Promise<void> {
    await this.harnessClient.close?.();
  }

  /** Returns the active session currently associated with a repository issue, if any. */
  getSessionForIssue(repositoryKey: string, issueNumber: number): AgentSessionRecord | undefined {
    return this.activeSessions.get(issueKey(repositoryKey, issueNumber));
  }

  /** Lists every session record the daemon is currently tracking in memory. */
  listSessions(): AgentSessionRecord[] {
    return Array.from(this.activeSessions.values());
  }

  /** Restores a previously tracked session into the in-memory active-session table. */
  restoreSession(record: AgentSessionRecord): void {
    this.activeSessions.set(issueKey(record.repositoryKey, record.issueNumber), record);
  }

  /** Creates a new harness session for an issue and records the resulting runtime session id. */
  async startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void> {
    const key = issueKey(issue.repositoryKey, issue.number);
    const startedAt = new Date().toISOString();

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
      agentName,
      startedAt,
      lastActiveAt: startedAt
    });

    const session = await this.harnessClient.createSession({
      agentDefinition: agentName,
      initialPrompt: prompt,
      cwd: issue.localRepoPath,
      title: `githueber ${issue.repositoryKey}#${issue.number} ${agentName}`
    });

    const runningAt = new Date().toISOString();
    this.activeSessions.set(key, {
      sessionId: session.id,
      repositoryKey: issue.repositoryKey,
      repoOwner: issue.repoOwner,
      repoName: issue.repoName,
      issueNumber: issue.number,
      status: "RUNNING",
      agentName,
      startedAt,
      lastActiveAt: runningAt
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

  /** Sends a follow-up prompt to an existing harness session, typically after human feedback. */
  async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    const session = this.findSessionById(sessionId);
    const payload = { text: message };

    if (session?.runtimeReleasedAt) {
      if (!this.harnessClient.resumeSession) {
        throw new Error(`Harness cannot resume released session: ${sessionId}`);
      }
      await this.harnessClient.resumeSession(sessionId, payload);
    } else {
      await this.harnessClient.sendMessage(sessionId, payload);
    }

    const timestamp = new Date().toISOString();
    this.updateRecord(sessionId, (record) => {
      const {
        runtimeReleasedAt: _runtimeReleasedAt,
        runtimeReleaseReason: _runtimeReleaseReason,
        ...rest
      } = record;
      return {
        ...rest,
        status: "RUNNING",
        lastActiveAt: timestamp,
        resumability: record.resumability === "resumable" ? "open" : record.resumability
      };
    });

    this.emitSessionEvent({
      direction: "OUTBOUND",
      kind: "PROMPT_SENT",
      message,
      ...this.getSessionEventContext(sessionId)
    });
  }

  /** Releases the live runtime while preserving the daemon session mapping. */
  async releaseSessionRuntime(sessionId: string): Promise<void> {
    await this.harnessClient.releaseSessionRuntime?.(sessionId);
  }

  /** Stops a tracked session and removes its repository-scoped mapping from memory. */
  async stopSession(sessionId: string): Promise<void> {
    if (this.harnessClient.stopSession) {
      await this.harnessClient.stopSession(sessionId);
    }

    for (const [key, record] of this.activeSessions.entries()) {
      if (record.sessionId === sessionId) {
        this.activeSessions.delete(key);
      }
    }
  }

  /** Registers a callback for pause events that require user approval in GitHub. */
  onSessionPaused(callback: (sessionId: string) => Promise<void> | void): void {
    this.pauseListeners.add(callback);
  }

  /** Registers a callback for completion events so labels can be transitioned. */
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
