import type {
  AgentSessionRecord,
  DaemonConfig,
  GitHubIssue,
  GitHubPollerLike,
  ManualPollDispatchSummary,
  ManualPollSummary,
  RouterLike,
  SessionManagerLike
} from "./models/types.ts";
import { logger } from "./utils/logger.ts";

/** Coordinates pollers, routing, harness sessions, and GitHub label transitions for all repositories. */
export class DaemonCore {
  constructor(
    private readonly pollers: Record<string, GitHubPollerLike>,
    private readonly router: RouterLike,
    private readonly sessionManager: SessionManagerLike,
    private readonly config: DaemonConfig
  ) {
    this.setupBindings();
  }

  /** Wires poller updates and session lifecycle callbacks into the daemon control loop. */
  private setupBindings(): void {
    for (const poller of Object.values(this.pollers)) {
      poller.onIssuesUpdated(async (issues) => {
        for (const issue of issues) {
          await this.processIssue(issue);
        }
      });
    }

    this.sessionManager.onSessionPaused(async (sessionId) => {
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

    this.sessionManager.onSessionCompleted(async (sessionId) => {
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

  /** Returns the poller responsible for a repository key or fails fast on config drift. */
  private getPoller(repositoryKey: string): GitHubPollerLike {
    const poller = this.pollers[repositoryKey];
    if (!poller) {
      throw new Error(`No poller configured for repository ${repositoryKey}`);
    }
    return poller;
  }

  /** Looks up a tracked session record by runtime session id. */
  private findSessionById(sessionId: string): AgentSessionRecord | undefined {
    return this.sessionManager.listSessions().find((session) => session.sessionId === sessionId);
  }

  /** Evaluates and executes the next action for one issue, returning manual-poll summary data when relevant. */
  private async processIssueInternal(issue: GitHubIssue): Promise<ManualPollDispatchSummary | null> {
    const activeSession = this.sessionManager.getSessionForIssue(issue.repositoryKey, issue.number);
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
        await this.sessionManager.startNewSession(issue, decision.agentName!, decision.promptContext!);
        await poller.updateIssueLabel(issue.number, labels.processing, labels.queue);
        return {
          issueNumber: issue.number,
          title: issue.title,
          action: decision.action,
          agentName: decision.agentName
        };
      case "RESUME_APPROVED":
        await this.sessionManager.sendMessageToSession(
          decision.acpSessionId!,
          decision.promptContext ?? "User approved. Proceed."
        );
        await poller.updateIssueLabel(issue.number, labels.processing, labels.awaitPlan);
        return {
          issueNumber: issue.number,
          title: issue.title,
          action: decision.action
        };
      case "RESUME_REVISED":
        await this.sessionManager.sendMessageToSession(
          decision.acpSessionId!,
          decision.promptContext ?? "Please revise the plan."
        );
        await poller.updateIssueLabel(issue.number, labels.revising, labels.awaitPlan);
        return {
          issueNumber: issue.number,
          title: issue.title,
          action: decision.action
        };
      case "IGNORE":
      default:
        return null;
    }
  }

  /** Processes a single issue update received from a poller subscription. */
  public async processIssue(issue: GitHubIssue): Promise<void> {
    await this.processIssueInternal(issue);
  }

  /** Initializes harness connectivity and starts each configured repository poll loop. */
  public async start(): Promise<void> {
    await this.sessionManager.initialize();
    for (const poller of Object.values(this.pollers)) {
      poller.start(this.config.polling.intervalMs);
    }
    logger.info("Daemon started", {
      repositories: Object.keys(this.config.repositories),
      pollingIntervalMs: this.config.polling.intervalMs
    });
  }

  /** Stops repository polling and closes every tracked session before shutdown completes. */
  public async stop(): Promise<void> {
    for (const poller of Object.values(this.pollers)) {
      poller.stop();
    }

    const sessions = this.sessionManager.listSessions();
    const results = await Promise.allSettled(
      sessions.map((session) => this.sessionManager.stopSession(session.sessionId))
    );
    const failedSessionIds = results.flatMap((result, index) =>
      result.status === "rejected" ? [sessions[index]!.sessionId] : []
    );

    if (failedSessionIds.length > 0) {
      throw new Error(`Failed to stop sessions: ${failedSessionIds.join(", ")}`);
    }
  }

  /** Returns the in-memory view of all active agent sessions. */
  public getActiveSessions(): AgentSessionRecord[] {
    return this.sessionManager.listSessions();
  }

  /** Stops one session using its runtime session id. */
  public async stopSession(sessionId: string): Promise<void> {
    await this.sessionManager.stopSession(sessionId);
  }

  /** Runs an immediate poll across repositories and reports which issues were fetched and dispatched. */
  public async triggerManualPoll(): Promise<ManualPollSummary> {
    const repositories = [];

    for (const [repositoryKey, poller] of Object.entries(this.pollers)) {
      const issues = await poller.pollNow();
      logger.info("Manual poll fetched issues", {
        repositoryKey,
        issueNumbers: issues.map((issue) => issue.number)
      });

      const dispatchedIssues: ManualPollDispatchSummary[] = [];
      for (const issue of issues) {
        logger.info("Manual poll fetched issue", {
          repositoryKey: issue.repositoryKey,
          issueNumber: issue.number,
          title: issue.title
        });
        const dispatched = await this.processIssueInternal(issue);
        if (dispatched) {
          dispatchedIssues.push(dispatched);
          logger.info("Manual poll dispatched issue", {
            repositoryKey: issue.repositoryKey,
            issueNumber: issue.number,
            title: issue.title,
            action: dispatched.action,
            agentName: dispatched.agentName
          });
        }
      }

      repositories.push({
        repositoryKey,
        fetchedIssues: issues.map((issue) => ({
          issueNumber: issue.number,
          title: issue.title
        })),
        dispatchedIssues
      });
    }

    return { repositories };
  }

  /** Applies an IPC-driven in-memory config update to a top-level config section. */
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
