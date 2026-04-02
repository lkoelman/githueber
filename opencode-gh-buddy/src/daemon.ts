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
    private readonly pollers: Record<string, GitHubPollerLike>,
    private readonly router: RouterLike,
    private readonly acpManager: ACPManagerLike,
    private readonly config: DaemonConfig
  ) {
    this.setupBindings();
  }

  private setupBindings(): void {
    for (const poller of Object.values(this.pollers)) {
      poller.onIssuesUpdated(async (issues) => {
        for (const issue of issues) {
          await this.processIssue(issue);
        }
      });
    }

    this.acpManager.onSessionPaused(async (sessionId) => {
      const session = this.findSessionById(sessionId);
      if (!session) {
        return;
      }
      await this.getPoller(session.repositoryKey).updateIssueLabel(
        session.issueNumber,
        this.config.repositories[session.repositoryKey]!.labels.awaitPlan,
        this.config.repositories[session.repositoryKey]!.labels.processing
      );
    });

    this.acpManager.onSessionCompleted(async (sessionId) => {
      const session = this.findSessionById(sessionId);
      if (!session) {
        return;
      }
      await this.getPoller(session.repositoryKey).updateIssueLabel(
        session.issueNumber,
        this.config.repositories[session.repositoryKey]!.labels.completed,
        this.config.repositories[session.repositoryKey]!.labels.processing
      );
    });
  }

  private getPoller(repositoryKey: string): GitHubPollerLike {
    const poller = this.pollers[repositoryKey];
    if (!poller) {
      throw new Error(`No poller configured for repository ${repositoryKey}`);
    }
    return poller;
  }

  private findSessionById(sessionId: string): AgentSessionRecord | undefined {
    return this.acpManager.listSessions().find((session) => session.sessionId === sessionId);
  }

  public async processIssue(issue: GitHubIssue): Promise<void> {
    const activeSession = this.acpManager.getSessionForIssue(issue.repositoryKey, issue.number);
    const labels = this.config.repositories[issue.repositoryKey]?.labels;
    if (!labels) {
      throw new Error(`Unknown repository: ${issue.repositoryKey}`);
    }

    const poller = this.getPoller(issue.repositoryKey);
    const needsComment = issue.labels.includes(labels.awaitPlan) && activeSession;
    const latestComment = needsComment ? await poller.getLatestComment(issue.number) : null;
    const decision = this.router.evaluateIssueState(issue, latestComment, activeSession);

    logger.debug("Processing issue", {
      repositoryKey: issue.repositoryKey,
      issueNumber: issue.number,
      action: decision.action
    });

    switch (decision.action) {
      case "START_SESSION":
        await this.acpManager.startNewSession(issue, decision.agentName!, decision.promptContext!);
        await poller.updateIssueLabel(issue.number, labels.processing, labels.queue);
        return;
      case "RESUME_APPROVED":
        await this.acpManager.sendMessageToSession(
          decision.acpSessionId!,
          decision.promptContext ?? "User approved. Proceed."
        );
        await poller.updateIssueLabel(issue.number, labels.processing, labels.awaitPlan);
        return;
      case "RESUME_REVISED":
        await this.acpManager.sendMessageToSession(
          decision.acpSessionId!,
          decision.promptContext ?? "Please revise the plan."
        );
        await poller.updateIssueLabel(issue.number, labels.revising, labels.awaitPlan);
        return;
      case "IGNORE":
      default:
        return;
    }
  }

  public async start(): Promise<void> {
    await this.acpManager.initialize();
    for (const poller of Object.values(this.pollers)) {
      poller.start(this.config.polling.intervalMs);
    }
    logger.info("Daemon started", {
      repositories: Object.keys(this.config.repositories),
      pollingIntervalMs: this.config.polling.intervalMs
    });
  }

  public stop(): void {
    for (const poller of Object.values(this.pollers)) {
      poller.stop();
    }
  }

  public getActiveSessions(): AgentSessionRecord[] {
    return this.acpManager.listSessions();
  }

  public async stopSession(sessionId: string): Promise<void> {
    await this.acpManager.stopSession(sessionId);
  }

  public async triggerManualPoll(): Promise<void> {
    for (const poller of Object.values(this.pollers)) {
      const issues = await poller.pollNow();
      for (const issue of issues) {
        await this.processIssue(issue);
      }
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
