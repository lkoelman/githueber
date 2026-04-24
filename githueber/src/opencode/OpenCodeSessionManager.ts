import type { AgentSessionRecord, GitHubIssue, HarnessClientLike } from "../models/types.ts";
import { HarnessSessionManager } from "../sessionManager/HarnessSessionManager.ts";
import { OpenCodeSessionRegistry, type PersistedOpenCodeSessionRecord } from "./OpenCodeSessionRegistry.ts";

/**
 * Adds persisted restore support for daemon-managed OpenCode sessions.
 *
 * Fields:
 * - `harnessClient`: inherited OpenCode client used for live session operations and status lookup
 * - `registry`: persistent issue-to-session mapping store used across daemon restarts
 * - `endpoint`: OpenCode server URL used to reject stale registry entries from another server
 */
export class OpenCodeSessionManager extends HarnessSessionManager {
  constructor(
    harnessClient: HarnessClientLike,
    private readonly registry: OpenCodeSessionRegistry,
    private readonly endpoint: string
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
   * Connects to OpenCode, then restores any still-valid daemon-managed sessions from disk.
   *
   * Side effects: opens the OpenCode connection, queries live session state, mutates the in-memory
   * session table, and rewrites the registry with only validated restorable sessions.
   */
  override async initialize(): Promise<void> {
    await super.initialize();
    await this.restoreTrackedSessions();
  }

  /**
   * Starts a new session and persists the resulting issue-to-session mapping for restart safety.
   *
   * Side effects: creates a live OpenCode session through the parent manager, mutates the in-memory
   * session table, and writes the new mapping to the registry file.
   */
  override async startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void> {
    await super.startNewSession(issue, agentName, prompt);
    const session = this.getSessionForIssue(issue.repositoryKey, issue.number);
    if (session) {
      this.registry.upsert(this.toPersistedRecord(session));
    }
  }

  /**
   * Removes the persisted mapping when the daemon intentionally stops tracking the session.
   *
   * Side effects: stops the live session through the parent manager, mutates the in-memory session
   * table, and deletes the mapping from the registry file.
   */
  override async stopSession(sessionId: string): Promise<void> {
    await super.stopSession(sessionId);
    this.registry.remove(sessionId);
  }

  /**
   * Sends feedback to OpenCode and persists the cleared release metadata after a successful resume.
   *
   * Side effects: sends a prompt to the native OpenCode session and rewrites the registry with the
   * current running session state.
   */
  override async sendMessageToSession(sessionId: string, message: string): Promise<void> {
    await super.sendMessageToSession(sessionId, message);
    this.persistTrackedSession(sessionId, "RUNNING");
  }

  /**
   * Restores persisted records that still exist in the OpenCode server and are still actionable.
   *
   * Side effects: queries the OpenCode server for available sessions and statuses, repopulates the
   * inherited in-memory session table, and rewrites the registry to discard stale entries.
   */
  private async restoreTrackedSessions(): Promise<void> {
    const client = this.harnessClient;
    if (!client.listSessions || !client.getSessionStatuses) {
      return;
    }

    const [availableSessions, statuses] = await Promise.all([
      client.listSessions(),
      client.getSessionStatuses()
    ]);
    const availableIds = new Set(availableSessions.map((session) => session.id));
    const restored: PersistedOpenCodeSessionRecord[] = [];

    for (const record of this.registry.load()) {
      if (record.endpoint !== this.endpoint || !availableIds.has(record.sessionId)) {
        continue;
      }

      const sessionStatus = statuses[record.sessionId]?.type;
      const restoredStatus =
        record.status === "PAUSED_AWAITING_APPROVAL"
          ? "PAUSED_AWAITING_APPROVAL"
          : sessionStatus === "busy"
            ? "RUNNING"
            : null;

      if (!restoredStatus) {
        continue;
      }

      const restoredRecord: AgentSessionRecord = {
        sessionId: record.sessionId,
        repositoryKey: record.repositoryKey,
        repoOwner: record.repoOwner,
        repoName: record.repoName,
        issueNumber: record.issueNumber,
        status: restoredStatus,
        agentName: record.agentName,
        harness: record.harness,
        title: record.title,
        resumability: record.resumability,
        resumeHint: record.resumeHint,
        startedAt: record.startedAt,
        lastActiveAt: record.lastActiveAt,
        runtimeReleasedAt: record.runtimeReleasedAt,
        runtimeReleaseReason: record.runtimeReleaseReason
      };
      this.restoreSession(restoredRecord);
      restored.push(this.toPersistedRecord(restoredRecord));
    }

    this.registry.replace(restored);
  }

  /**
   * Persists the current tracked record when the daemon receives a lifecycle transition.
   *
   * Side effects: reads the current in-memory session table and rewrites the registry file when the
   * target session is still tracked.
   */
  private persistTrackedSession(sessionId: string, status: AgentSessionRecord["status"]): void {
    const session = this.listSessions().find((record) => record.sessionId === sessionId);
    if (!session) {
      return;
    }

    this.registry.upsert(this.toPersistedRecord({ ...session, status }));
  }

  /**
   * Adds endpoint and timestamp metadata needed by the persisted registry.
   *
   * Side effects: none beyond allocating a new object and capturing the current timestamp.
   */
  private toPersistedRecord(record: AgentSessionRecord): PersistedOpenCodeSessionRecord {
    return {
      ...record,
      endpoint: this.endpoint,
      updatedAt: new Date().toISOString()
    };
  }
}
