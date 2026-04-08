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
  | "SESSION_PAUSED"
  | "SESSION_COMPLETED";

export type TaskAction =
  | "START_SESSION"
  | "RESUME_APPROVED"
  | "RESUME_REVISED"
  | "IGNORE";

export interface RepositoryIdentity {
  repositoryKey: string;
  repoOwner: string;
  repoName: string;
}

export interface RepositoryConfig {
  key: string;
  owner: string;
  repo: string;
  localRepoPath: string;
  harness?: HarnessName;
  labels: LabelConfig;
  agentMapping: Record<string, string>;
}

export interface GitHubComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssue extends RepositoryIdentity {
  localRepoPath: string;
  id: number;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: GitHubIssueState;
  updatedAt: string;
  comments: GitHubComment[];
}

export interface RouteDecision {
  action: TaskAction;
  agentName?: string;
  promptContext?: string;
  acpSessionId?: string;
}

export interface AgentSessionRecord extends RepositoryIdentity {
  sessionId: string;
  issueNumber: number;
  status: SessionStatus;
  agentName: string;
}

export interface SessionInteractionEvent extends Partial<RepositoryIdentity> {
  timestamp: string;
  direction: SessionInteractionDirection;
  kind: SessionInteractionKind;
  sessionId?: string;
  issueNumber?: number;
  agentName?: string;
  message?: string;
}

export interface ManualPollIssueSummary {
  issueNumber: number;
  title: string;
}

export interface ManualPollDispatchSummary extends ManualPollIssueSummary {
  action: Exclude<TaskAction, "IGNORE">;
  agentName?: string;
}

export interface ManualPollRepositorySummary {
  repositoryKey: string;
  fetchedIssues: ManualPollIssueSummary[];
  dispatchedIssues: ManualPollDispatchSummary[];
}

export interface ManualPollSummary {
  repositories: ManualPollRepositorySummary[];
}

export interface LabelConfig {
  queue: string;
  processing: string;
  awaitPlan: string;
  completed: string;
  failed: string;
  revising: string;
}

export interface ExecutionConfig {
  harness: HarnessName;
  autoApprove: boolean;
  concurrency: number;
  approvalComment: string;
  reviseComment: string;
  opencodeModel: string | null;
  timeoutSeconds: number;
}

export interface PollingConfig {
  intervalMs: number;
}

export interface OpenCodeConfig {
  endpoint: string;
}

export interface CodexConfig {
  command: string;
  args: string;
  model: string | null;
}

export interface IPCConfig {
  socketPath: string;
}

export interface LoggingConfig {
  level: string;
}

export interface IsolationConfig {
  worktrees: string | null;
}

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

export interface GitHubPollerLike {
  start(intervalMs: number): void;
  stop(): void;
  pollNow(): Promise<GitHubIssue[]>;
  getLatestComment(issueNumber: number): Promise<string | null>;
  updateIssueLabel(issueNumber: number, addLabel: string, removeLabel?: string): Promise<void>;
  onIssuesUpdated(callback: (issues: GitHubIssue[]) => Promise<void> | void): void;
}

export interface HarnessSessionStartRequest {
  agentDefinition: string;
  initialPrompt: string;
  cwd?: string;
}

export interface HarnessMessagePayload {
  text: string;
}

export interface HarnessClientLike {
  connect(): Promise<void>;
  createSession(request: HarnessSessionStartRequest): Promise<{ id: string }>;
  sendMessage(sessionId: string, payload: HarnessMessagePayload): Promise<void>;
  stopSession?(sessionId: string): Promise<void>;
  on?(eventName: string, callback: (payload: { sessionId: string }) => void): void;
}

export interface SessionManagerLike {
  initialize(): Promise<void>;
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

export interface RouterLike {
  evaluateIssueState(
    issue: GitHubIssue,
    latestComment?: string | null,
    activeSession?: AgentSessionRecord
  ): RouteDecision;
}

export interface IPCRequest {
  command: "LIST_SESSIONS" | "STOP_SESSION" | "TRIGGER_POLL" | "SET_CONFIG";
  payload: Record<string, unknown>;
}

export interface IPCResponse {
  status: "ok";
  data?: unknown;
  message?: string;
}
