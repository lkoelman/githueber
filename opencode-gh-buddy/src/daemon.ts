import type {
  ACPManagerLike,
  AgentSessionRecord,
  DaemonConfig,
  GitHubIssue,
  GitHubPollerLike,
  RouterLike
} from "./models/types.ts";
import { logger } from "./utils/logger.ts";

export class DaemonCore {
  constructor(
    private readonly poller: GitHubPollerLike,
    private readonly router: RouterLike,
    private readonly acpManager: ACPManagerLike,
    private readonly config: DaemonConfig
  ) {
    this.setupBindings();
  }

  private setupBindings(): void {
    this.poller.onIssuesUpdated(async (issues) => {
      for (const issue of issues) {
        await this.processIssue(issue);
      }
    });

    this.acpManager.onSessionPaused(async (sessionId) => {
      const session = this.findSessionById(sessionId);
      if (!session) {
        return;
      }
      await this.poller.updateIssueLabel(
        session.issueNumber,
        this.config.labels.awaitPlan,
        this.config.labels.processing
      );
    });

    this.acpManager.onSessionCompleted(async (sessionId) => {
      const session = this.findSessionById(sessionId);
      if (!session) {
        return;
      }
      await this.poller.updateIssueLabel(
        session.issueNumber,
        this.config.labels.completed,
        this.config.labels.processing
      );
    });
  }

  private findSessionById(sessionId: string): AgentSessionRecord | undefined {
    return this.acpManager.listSessions().find((session) => session.sessionId === sessionId);
  }

  public async processIssue(issue: GitHubIssue): Promise<void> {
    const activeSession = this.acpManager.getSessionForIssue(issue.number);
    const needsComment = issue.labels.includes(this.config.labels.awaitPlan) && activeSession;
    const latestComment = needsComment ? await this.poller.getLatestComment(issue.number) : null;
    const decision = this.router.evaluateIssueState(issue, latestComment, activeSession);

    logger.debug("Processing issue", {
      issueNumber: issue.number,
      action: decision.action
    });

    switch (decision.action) {
      case "START_SESSION":
        await this.acpManager.startNewSession(
          issue.number,
          decision.agentName!,
          decision.promptContext!
        );
        await this.poller.updateIssueLabel(
          issue.number,
          this.config.labels.processing,
          this.config.labels.queue
        );
        return;
      case "RESUME_APPROVED":
        await this.acpManager.sendMessageToSession(
          decision.acpSessionId!,
          decision.promptContext ?? "User approved. Proceed."
        );
        await this.poller.updateIssueLabel(
          issue.number,
          this.config.labels.processing,
          this.config.labels.awaitPlan
        );
        return;
      case "RESUME_REVISED":
        await this.acpManager.sendMessageToSession(
          decision.acpSessionId!,
          decision.promptContext ?? "Please revise the plan."
        );
        await this.poller.updateIssueLabel(
          issue.number,
          this.config.labels.revising,
          this.config.labels.awaitPlan
        );
        return;
      case "IGNORE":
      default:
        return;
    }
  }

  public async start(): Promise<void> {
    await this.acpManager.initialize();
    this.poller.start(this.config.polling.intervalMs);
    logger.info("Daemon started", {
      repository: `${this.config.github.repoOwner}/${this.config.github.repoName}`,
      pollingIntervalMs: this.config.polling.intervalMs
    });
  }

  public stop(): void {
    this.poller.stop();
  }

  public getActiveSessions(): AgentSessionRecord[] {
    return this.acpManager.listSessions();
  }

  public async stopSession(sessionId: string): Promise<void> {
    await this.acpManager.stopSession(sessionId);
  }

  public async triggerManualPoll(): Promise<void> {
    const issues = await this.poller.pollNow();
    for (const issue of issues) {
      await this.processIssue(issue);
    }
  }

  public updateConfig(key: string, value: unknown): void {
    const [section, field] = key.split(".");
    if (!section || !field) {
      throw new Error(`Unsupported config key: ${key}`);
    }
    const target = this.config[section as keyof DaemonConfig] as Record<string, unknown>;
    if (!target || typeof target !== "object") {
      throw new Error(`Unsupported config section: ${section}`);
    }
    target[field] = value;
  }
}
