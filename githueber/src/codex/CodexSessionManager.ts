import type { AgentSessionRecord, GitHubIssue, HarnessClientLike } from "../models/types.ts";
import { HarnessSessionManager } from "../sessionManager/HarnessSessionManager.ts";
import { CodexSessionRegistry, type PersistedCodexSessionRecord } from "./CodexSessionRegistry.ts";

/** Adds persisted restore and operator resumability metadata for daemon-managed Codex threads. */
export class CodexSessionManager extends HarnessSessionManager {
  constructor(
    harnessClient: HarnessClientLike,
    private readonly registry: CodexSessionRegistry
  ) {
    super(harnessClient);

    this.onSessionPaused((sessionId) => {
      this.persistTrackedSession(sessionId, "PAUSED_AWAITING_APPROVAL");
    });
    this.onSessionCompleted((sessionId) => {
      this.registry.remove(sessionId);
    });
  }

  /**
   * Connects to Codex, then restores still-actionable daemon-managed app-server threads.
   *
   * Side effects: queries Codex thread history, mutates the in-memory session table, and rewrites
   * the registry to discard entries that Codex no longer reports.
   */
  override async initialize(): Promise<void> {
    await super.initialize();
    await this.restoreTrackedSessions();
  }

  /**
   * Starts a new Codex thread and persists the repository issue mapping for operator visibility.
   *
   * Side effects: creates a live Codex thread, mutates the inherited session table, and writes the
   * mapping to the registry.
   */
  override async startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void> {
    await super.startNewSession(issue, agentName, prompt);
    const session = this.getSessionForIssue(issue.repositoryKey, issue.number);
    if (!session) {
      return;
    }

    const codexSession = this.withCodexMetadata({
      ...session,
      title: this.buildTitle(issue.repositoryKey, issue.number, agentName),
      resumability: "open"
    });
    this.restoreSession(codexSession);
    this.registry.upsert(this.toPersistedRecord(codexSession));
  }

  /**
   * Removes the persisted mapping when the daemon intentionally stops a live Codex session.
   *
   * Side effects: interrupts/stops the Codex thread process and rewrites the registry.
   */
  override async stopSession(sessionId: string): Promise<void> {
    await super.stopSession(sessionId);
    this.registry.remove(sessionId);
  }

  /**
   * Sends feedback to Codex and persists the cleared release metadata after a successful resume.
   *
   * Side effects: may reopen a released Codex thread, starts or steers a turn, and rewrites the
   * registry with the current running session state.
   */
  override async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    await super.sendMessageToSession(sessionId, message);
    this.persistTrackedSession(sessionId, "RUNNING");
  }

  /**
   * Restores persisted Codex records that still exist in app-server history and remain actionable.
   *
   * Side effects: queries the Codex client, repopulates in-memory session records, and prunes stale
   * registry entries.
   */
  private async restoreTrackedSessions(): Promise<void> {
    if (!this.harnessClient.listSessions) {
      return;
    }

    const availableSessions = await this.harnessClient.listSessions();
    const availableById = new Map(availableSessions.map((session) => [session.id, session]));
    const restored: PersistedCodexSessionRecord[] = [];

    for (const record of this.registry.load()) {
      const available = availableById.get(record.sessionId);
      if (!available) {
        continue;
      }

      const restoredStatus = this.getRestoredStatus(record, available.status?.type);
      if (!restoredStatus) {
        continue;
      }

      const { updatedAt: _updatedAt, ...sessionRecord } = record;
      const restoredRecord = this.withCodexMetadata({
        ...sessionRecord,
        status: restoredStatus,
        title: record.title ?? available.title,
        resumability: available.status?.type === "active" ? "open" : "resumable"
      });
      this.restoreSession(restoredRecord);
      restored.push(this.toPersistedRecord(restoredRecord));
    }

    this.registry.replace(restored);
  }

  /** Returns the daemon status to restore from persisted and current Codex state. */
  private getRestoredStatus(
    record: AgentSessionRecord,
    codexStatus?: string
  ): AgentSessionRecord["status"] | null {
    if (codexStatus === "active") {
      return "RUNNING";
    }

    if (record.status === "PAUSED_AWAITING_APPROVAL") {
      return "PAUSED_AWAITING_APPROVAL";
    }

    return null;
  }

  /** Persists the current tracked Codex record after a lifecycle transition. */
  private persistTrackedSession(sessionId: string, status: AgentSessionRecord["status"]): void {
    const session = this.listSessions().find((record) => record.sessionId === sessionId);
    if (!session) {
      return;
    }

    const resumability = status === "PAUSED_AWAITING_APPROVAL" ? "resumable" : "open";
    const updatedSession = this.withCodexMetadata({ ...session, status, resumability });
    this.restoreSession(updatedSession);
    this.registry.upsert(this.toPersistedRecord(updatedSession));
  }

  /** Adds Codex-specific operator metadata to a session record. */
  private withCodexMetadata(record: AgentSessionRecord): AgentSessionRecord {
    return {
      ...record,
      harness: "codex",
      title: record.title,
      resumability: record.resumability ?? "unknown",
      resumeHint: `codex resume --include-non-interactive ${record.sessionId}`
    };
  }

  /** Builds the stable title used for Codex thread naming and session displays. */
  private buildTitle(repositoryKey: string, issueNumber: number, agentName: string): string {
    return `githueber ${repositoryKey}#${issueNumber} ${agentName}`;
  }

  /** Adds timestamp metadata needed by the persisted registry. */
  private toPersistedRecord(record: AgentSessionRecord): PersistedCodexSessionRecord {
    return {
      ...record,
      updatedAt: new Date().toISOString()
    };
  }
}
