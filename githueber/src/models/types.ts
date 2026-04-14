import type { AskForApproval } from "../codex/generated/v2/AskForApproval.ts";
import type { SandboxMode } from "../codex/generated/v2/SandboxMode.ts";

export type GitHubIssueState = "open" | "closed";
export type HarnessName = "opencode" | "codex";

export type SessionStatus =
  | "INITIALIZING"
  | "RUNNING"
  | "PAUSED_AWAITING_APPROVAL"
  | "COMPLETED";

export type SessionInteractionDirection = "CONTROL" | "OUTBOUND" | "INBOUND";

export type SessionInteractionKind =
  | "SESSION_STARTING"
  | "SESSION_STARTED"
  | "PROMPT_SENT"
  | "MESSAGE_DELTA"
  | "SESSION_PAUSED"
  | "SESSION_COMPLETED";

export type TaskAction =
  | "START_SESSION"
  | "RESUME_APPROVED"
  | "RESUME_REVISED"
  | "IGNORE";

/** Stable repository identity carried across poller, router, daemon, and session events. */
export interface RepositoryIdentity {
  /** Daemon-local key from config, used as the primary lookup key for a repository. */
  repositoryKey: string;
  /** GitHub organization or user that owns the repository. */
  repoOwner: string;
  /** GitHub repository name without the owner prefix. */
  repoName: string;
}

/** Validated repository-specific daemon settings loaded from config. */
export interface RepositoryConfig {
  /** Daemon-local repository key, matching the key under `repositories:` in config. */
  key: string;
  /** GitHub owner used for API calls and prompt context. */
  owner: string;
  /** GitHub repository name used for API calls and prompt context. */
  repo: string;
  /** Absolute path to the main local checkout for this repository. */
  localRepoPath: string;
  /** Optional per-repository harness override; otherwise the daemon default is used. */
  harness?: HarnessName;
  /** Repository-local labels that drive the daemon state machine. */
  labels: LabelConfig;
  /** Maps issue labels to the agent name that should be started for matching issues. */
  agentMapping: Record<string, string>;
}

/** One normalized GitHub issue comment. */
export interface GitHubComment {
  /** GitHub comment id. */
  id: number;
  /** Full markdown body exactly as returned by GitHub. */
  body: string;
  /** GitHub login of the comment author. */
  author: string;
  /** ISO timestamp when the comment was created. */
  createdAt: string;
  /** ISO timestamp when the comment was last updated. */
  updatedAt: string;
}

/** One normalized GitHub issue snapshot enriched with repository context. */
export interface GitHubIssue extends RepositoryIdentity {
  /** Absolute path to the repository checkout the daemon should use for this issue. */
  localRepoPath: string;
  /** GitHub issue node/database id from the REST payload. */
  id: number;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: GitHubIssueState;
  updatedAt: string; // ISO timestamp
  comments: GitHubComment[];
}

/** Router output telling the daemon what control-plane action to take next. */
export interface RouteDecision {
  /** Deterministic next step for the daemon. */
  action: TaskAction;
  /** Agent name to start when `action` is `START_SESSION`. */
  agentName?: string;
  /** Prompt text or steering message that should be sent to the harness. */
  promptContext?: string;
  /** Existing harness session id to resume for approval/revision actions. */
  sessionId?: string;
}

/** In-memory record linking one harness session to one repository-scoped GitHub issue. */
export interface AgentSessionRecord extends RepositoryIdentity {
  /** Harness-native session/thread id used for follow-up messages and stop requests. */
  sessionId: string;
  issueNumber: number;
  /** Daemon-side lifecycle state derived from harness events. */
  status: SessionStatus;
  /** Agent name originally selected for this issue. */
  agentName: string;
}

/** Structured event emitted for operator echoing and other session observers. */
export interface SessionInteractionEvent extends Partial<RepositoryIdentity> {
  /** ISO timestamp when the daemon emitted the event. */
  timestamp: string;
  /** Whether the event came from daemon control flow, daemon outbound input, or harness inbound output. */
  direction: SessionInteractionDirection;
  /** Normalized event kind for lifecycle and streamed-message updates. */
  kind: SessionInteractionKind;
  /** Harness-native session/thread id when known. */
  sessionId?: string;
  /** Repository-scoped issue number when known. */
  issueNumber?: number;
  /** Agent associated with the session when known. */
  agentName?: string;
  /** Human-readable text payload, such as the prompt sent or streamed output delta. */
  message?: string;
}

/** Minimal issue information returned to CLI callers for a manual poll summary. */
export interface ManualPollIssueSummary {
  issueNumber: number;
  title: string;
}

/** Summary for one issue that was dispatched during a manual poll. */
export interface ManualPollDispatchSummary extends ManualPollIssueSummary {
  /** Non-ignore router decision that was executed. */
  action: Exclude<TaskAction, "IGNORE">;
  /** Agent started for a new session when applicable. */
  agentName?: string;
}

/** CLI-facing summary of one repository during a manual poll run. */
export interface ManualPollRepositorySummary {
  repositoryKey: string;
  fetchedIssues: ManualPollIssueSummary[];
  dispatchedIssues: ManualPollDispatchSummary[];
}

/** Top-level manual poll response returned over IPC. */
export interface ManualPollSummary {
  repositories: ManualPollRepositorySummary[];
}

/** Repository-local labels used as the daemon's issue state machine markers. */
export interface LabelConfig {
  /** Issue is eligible for daemon pickup when no active session exists. */
  queue: string;
  /** Issue currently has an active agent session running. */
  processing: string;
  /** Agent has posted a plan and is paused pending human approval or revision feedback. */
  awaitPlan: string;
  /** Issue work is finished from the daemon's perspective. */
  completed: string;
  /** Agent work failed and needs operator attention. */
  failed: string;
  /** Human requested plan revisions and the issue is awaiting another planning pass. */
  revising: string;
}

/** Global execution settings shared across repositories unless a repo overrides the harness. */
export interface ExecutionConfig {
  /** Default harness for repositories that do not set `RepositoryConfig.harness`. */
  harness: HarnessName;
  /** Reserved flag for approval automation; currently not used by the router/session manager flow. */
  autoApprove: boolean;
  /** Reserved concurrency limit for daemon scheduling; currently parsed from config but not enforced here. */
  concurrency: number;
  /** Comment prefix that means "resume the paused session and continue execution". */
  approvalComment: string;
  /** Comment prefix that means "resume the paused session and revise the plan". */
  reviseComment: string;
  /** Legacy/default OpenCode model selector from config; carried in config but not consumed in the current clients. */
  opencodeModel: string | null;
  /** Reserved execution timeout from config, in seconds; not currently enforced by the session managers. */
  timeoutSeconds: number;
}

/** Settings for GitHub polling. */
export interface PollingConfig {
  intervalMs: number;
}

/** Connection settings for the OpenCode harness backend. */
export interface OpenCodeConfig {
  hostname?: string;
  port?: number;
  timeout?: number;
  permission?: {
    edit?: "ask" | "allow" | "deny";
    bash?: ("ask" | "allow" | "deny") | Record<string, "ask" | "allow" | "deny">;
    webfetch?: "ask" | "allow" | "deny";
    doom_loop?: "ask" | "allow" | "deny";
    external_directory?: "ask" | "allow" | "deny";
  };
}

/** Launch and runtime settings for the Codex app-server harness backend. */
export interface CodexConfig {
  /** Executable name or absolute path used to launch Codex. */
  command: string;
  /** Raw argument string split on whitespace before spawning the Codex process. */
  args: string;
  /** Optional model override sent in `thread/start`; `null` lets Codex choose its default. */
  model: string | null;
  approvalPolicy: Exclude<AskForApproval, { granular: unknown }>;
  sandbox: SandboxMode;
}

/** Local IPC server settings for the daemon control socket. */
export interface IPCConfig {
  socketPath: string;
}

export interface LoggingConfig {
  level: string;
}

/** Settings for repository workspace isolation. */
export interface IsolationConfig {
  /** Absolute parent directory for per-issue worktrees, or `null` to work directly in `localRepoPath`. */
  worktrees: string | null;
}

/** Root validated daemon configuration assembled by `ConfigManager`. */
export interface DaemonConfig {
  repositories: Record<string, RepositoryConfig>;
  execution: ExecutionConfig;
  polling: PollingConfig;
  opencode?: OpenCodeConfig;
  codex?: CodexConfig;
  ipc: IPCConfig;
  logging: LoggingConfig;
  isolation: IsolationConfig;
}

/** Contract implemented by repository-scoped GitHub pollers. */
export interface GitHubPollerLike {
  start(intervalMs: number): void;
  stop(): void;
  pollNow(): Promise<GitHubIssue[]>;
  getLatestComment(issueNumber: number): Promise<string | null>;
  updateIssueLabel(issueNumber: number, addLabel: string, removeLabel?: string): Promise<void>;
  onIssuesUpdated(callback: (issues: GitHubIssue[]) => Promise<void> | void): void;
}

/** Parameters for starting a brand-new harness session. */
export interface HarnessSessionStartRequest {
  /**
   * Harness-facing agent selector.
   *
   * In the current daemon flow this is the agent name chosen from `RepositoryConfig.agentMapping`
   * or the router default. Each harness interprets the string in its own way:
   * OpenCode sends it as the `agent` field on the initial prompt, while Codex currently
   * treats it as metadata only and does not pass it through the app-server protocol.
   */
  agentDefinition: string;
  /** Full initial prompt that seeds the first turn for the session. */
  initialPrompt: string;
  /** Optional working directory for harnesses that support repository-scoped startup. */
  cwd?: string;
  /** Optional user-visible title for harnesses that persist named sessions. */
  title?: string;
}

/** One follow-up message sent into an existing harness session. */
export interface HarnessMessagePayload {
  /** Plain-text steering or reply text. */
  text: string;
}

/** Minimal harness client contract the daemon relies on. */
export interface HarnessClientLike {
  connect(): Promise<void>;
  createSession(request: HarnessSessionStartRequest): Promise<{ id: string }>;
  sendMessage(sessionId: string, payload: HarnessMessagePayload): Promise<void>;
  stopSession?(sessionId: string): Promise<void>;
  close?(): Promise<void> | void;
  getServerUrl?(): string;
  listSessions?(): Promise<Array<{ id: string; title?: string }>>;
  getSessionStatuses?(): Promise<Record<string, { type: string }>>;
  on?(eventName: string, callback: (payload: { sessionId: string; message?: string }) => void): void;
}

/** Daemon-facing session manager contract used by `DaemonCore`. */
export interface SessionManagerLike {
  initialize(): Promise<void>;
  shutdown?(): Promise<void>;
  getSessionForIssue(repositoryKey: string, issueNumber: number): AgentSessionRecord | undefined;
  listSessions(): AgentSessionRecord[];
  startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void>;
  sendMessageToSession(sessionId: string, message: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  onSessionPaused(callback: (sessionId: string) => Promise<void> | void): void;
  onSessionCompleted(callback: (sessionId: string) => Promise<void> | void): void;
  onSessionEvent(callback: (event: SessionInteractionEvent) => void): () => void;
}

export type ACPManagerLike = SessionManagerLike;

/** Side-effect-free issue router contract. */
export interface RouterLike {
  evaluateIssueState(
    issue: GitHubIssue,
    latestComment?: string | null,
    activeSession?: AgentSessionRecord
  ): RouteDecision;
}

/** One JSON command sent from the CLI to the daemon IPC server. */
export interface IPCRequest {
  command: "LIST_SESSIONS" | "STOP_SESSION" | "TRIGGER_POLL" | "SET_CONFIG";
  payload: Record<string, unknown>;
}

/** Successful JSON reply returned by the daemon IPC server. */
export interface IPCResponse {
  status: "ok";
  data?: unknown;
  message?: string;
}
