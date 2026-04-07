import type {
  ACPManagerLike,
  AgentSessionRecord,
  DaemonConfig,
  GitHubIssue,
  GitHubPollerLike,
  ManualPollDispatchSummary,
  ManualPollSummary,
  RouterLike
} from "./models/types.ts";
import { logger } from "./utils/logger.ts";

const AWAITING_APPROVAL_MARKER = "[AWAITING_APPROVAL]";

function isAwaitingApprovalComment(comment: string | null): boolean {
  return comment?.trimEnd().endsWith(AWAITING_APPROVAL_MARKER) ?? false;
}

/** Coordinates pollers, routing, ACP sessions, and GitHub label transitions for all repositories. */
export class DaemonCore {
  constructor(
    private readonly pollers: Record<string, GitHubPollerLike>,
    private readonly router: RouterLike,
    private readonly acpManager: ACPManagerLike,
    private readonly config: DaemonConfig
  ) {
    this.setupBindings();
  }

  /** Wires poller updates and ACP lifecycle callbacks into the daemon control loop. */
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

  /** Returns the poller responsible for a repository key or fails fast on config drift. */
  private getPoller(repositoryKey: string): GitHubPollerLike {
    const poller = this.pollers[repositoryKey];
    if (!poller) {
      throw new Error(`No poller configured for repository ${repositoryKey}`);
    }
    return poller;
  }

  /** Looks up a tracked session record by ACP session id. */
  private findSessionById(sessionId: string): AgentSessionRecord | undefined {
    return this.acpManager.listSessions().find((session) => session.sessionId === sessionId);
  }

  /** Evaluates and executes the next action for one issue, returning manual-poll summary data when relevant. */
  private async processIssueInternal(issue: GitHubIssue): Promise<ManualPollDispatchSummary | null> {
    const activeSession = this.acpManager.getSessionForIssue(issue.repositoryKey, issue.number);
    const labels = this.config.repositories[issue.repositoryKey]?.labels;
    if (!labels) {
      throw new Error(`Unknown repository: ${issue.repositoryKey}`);
    }

    const poller = this.getPoller(issue.repositoryKey);
    const needsComment = activeSession && (
      issue.labels.includes(labels.awaitPlan) ||
      issue.labels.includes(labels.processing) ||
      issue.labels.includes(labels.revising)
    );
    const latestComment = needsComment ? await poller.getLatestComment(issue.number) : null;

    if (
      activeSession &&
      !issue.labels.includes(labels.awaitPlan) &&
      isAwaitingApprovalComment(latestComment)
    ) {
      const labelToRemove = issue.labels.includes(labels.revising) ? labels.revising : labels.processing;
      await poller.updateIssueLabel(issue.number, labels.awaitPlan, labelToRemove);
      return null;
    }

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
        return {
          issueNumber: issue.number,
          title: issue.title,
          action: decision.action,
          agentName: decision.agentName
        };
      case "RESUME_APPROVED":
        await this.acpManager.sendMessageToSession(
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
        await this.acpManager.sendMessageToSession(
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

  /** Initializes ACP connectivity and starts each configured repository poll loop. */
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

  /** Stops repository polling and closes every tracked ACP session before shutdown completes. */
  public async stop(): Promise<void> {
    for (const poller of Object.values(this.pollers)) {
      poller.stop();
    }

    const sessions = this.acpManager.listSessions();
    const results = await Promise.allSettled(
      sessions.map((session) => this.acpManager.stopSession(session.sessionId))
    );
    const failedSessionIds = results.flatMap((result, index) =>
      result.status === "rejected" ? [sessions[index]!.sessionId] : []
    );

    if (failedSessionIds.length > 0) {
      throw new Error(`Failed to stop ACP sessions: ${failedSessionIds.join(", ")}`);
    }
  }

  /** Returns the in-memory view of all active agent sessions. */
  public getActiveSessions(): AgentSessionRecord[] {
    return this.acpManager.listSessions();
  }

  /** Stops one session through ACP using its runtime session id. */
  public async stopSession(sessionId: string): Promise<void> {
    await this.acpManager.stopSession(sessionId);
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