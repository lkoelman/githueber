import type {
  AgentSessionRecord,
  GitHubIssue,
  RepositoryConfig,
  SessionInteractionEvent,
  SessionManagerLike
} from "../models/types.ts";

type HarnessResolver = (repository: RepositoryConfig) => SessionManagerLike;

/** Routes repository-scoped session operations to the correct harness-specific manager. */
export class MultiHarnessSessionManager implements SessionManagerLike {
  private readonly pauseListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly completionListeners = new Set<(sessionId: string) => Promise<void> | void>();
  private readonly sessionEventListeners = new Set<(event: SessionInteractionEvent) => void>();

  constructor(
    private readonly managers: SessionManagerLike[],
    private readonly repositories: Record<string, RepositoryConfig>,
    private readonly resolveManager: HarnessResolver
  ) {
    this.bindManagers();
  }

  /** Fans child-manager lifecycle events back out through the shared session manager interface. */
  private bindManagers(): void {
    for (const manager of this.managers) {
      manager.onSessionPaused((sessionId) => {
        for (const listener of this.pauseListeners) {
          void listener(sessionId);
        }
      });
      manager.onSessionCompleted((sessionId) => {
        for (const listener of this.completionListeners) {
          void listener(sessionId);
        }
      });
      manager.onSessionEvent((event) => {
        for (const listener of this.sessionEventListeners) {
          listener(event);
        }
      });
    }
  }

  /** Initializes every active harness backend used by the daemon. */
  async initialize(): Promise<void> {
    await Promise.all(this.managers.map((manager) => manager.initialize()));
  }

  /** Shuts down every active harness backend used by the daemon. */
  async shutdown(): Promise<void> {
    await Promise.all(this.managers.map((manager) => manager.shutdown?.()));
  }

  /** Returns the session currently associated with a repository issue, regardless of harness backend. */
  getSessionForIssue(repositoryKey: string, issueNumber: number): AgentSessionRecord | undefined {
    return this.managers
      .map((manager) => manager.getSessionForIssue(repositoryKey, issueNumber))
      .find((session) => session !== undefined);
  }

  /** Lists all tracked sessions across every configured harness. */
  listSessions(): AgentSessionRecord[] {
    return this.managers.flatMap((manager) => manager.listSessions());
  }

  /** Starts a new session for an issue using the repository's resolved harness manager. */
  async startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void> {
    await this.getManagerForRepository(issue.repositoryKey).startNewSession(issue, agentName, prompt);
  }

  /** Sends a follow-up message by locating the child manager that owns the session id. */
  async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    await this.getManagerForSession(sessionId).sendMessageToSession(sessionId, message);
  }

  /** Releases a live runtime through the child manager that owns the session id. */
  async releaseSessionRuntime(sessionId: string): Promise<void> {
    await this.getManagerForSession(sessionId).releaseSessionRuntime(sessionId);
  }

  /** Stops a session through the child manager that owns the session id. */
  async stopSession(sessionId: string): Promise<void> {
    await this.getManagerForSession(sessionId).stopSession(sessionId);
  }

  /** Registers a callback for pause events emitted by any harness backend. */
  onSessionPaused(callback: (sessionId: string) => Promise<void> | void): void {
    this.pauseListeners.add(callback);
  }

  /** Registers a callback for completion events emitted by any harness backend. */
  onSessionCompleted(callback: (sessionId: string) => Promise<void> | void): void {
    this.completionListeners.add(callback);
  }

  /** Registers a structured interaction listener spanning all harness backends. */
  onSessionEvent(callback: (event: SessionInteractionEvent) => void): () => void {
    this.sessionEventListeners.add(callback);
    return () => {
      this.sessionEventListeners.delete(callback);
    };
  }

  /** Resolves the owning child manager from repository configuration. */
  private getManagerForRepository(repositoryKey: string): SessionManagerLike {
    const repository = this.repositories[repositoryKey];
    if (!repository) {
      throw new Error(`Unknown repository: ${repositoryKey}`);
    }
    return this.resolveManager(repository);
  }

  /** Finds the child manager that owns a specific runtime session id. */
  private getManagerForSession(sessionId: string): SessionManagerLike {
    const manager = this.managers.find((candidate) =>
      candidate.listSessions().some((session) => session.sessionId === sessionId)
    );

    if (!manager) {
      throw new Error(`Unknown session id: ${sessionId}`);
    }

    return manager;
  }
}
