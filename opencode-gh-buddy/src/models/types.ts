export type GitHubIssueState = "open" | "closed";

export type SessionStatus =
  | "INITIALIZING"
  | "RUNNING"
  | "PAUSED_AWAITING_APPROVAL"
  | "COMPLETED";

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

export interface LabelConfig {
  queue: string;
  processing: string;
  awaitPlan: string;
  completed: string;
  failed: string;
  revising: string;
}

export interface ExecutionConfig {
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

export interface ACPConfig {
  endpoint: string;
}

export interface IPCConfig {
  socketPath: string;
}

export interface LoggingConfig {
  level: string;
}

export interface DaemonConfig {
  repositories: Record<string, RepositoryConfig>;
  execution: ExecutionConfig;
  polling: PollingConfig;
  acp: ACPConfig;
  ipc: IPCConfig;
  logging: LoggingConfig;
}

export interface GitHubPollerLike {
  start(intervalMs: number): void;
  stop(): void;
  pollNow(): Promise<GitHubIssue[]>;
  getLatestComment(issueNumber: number): Promise<string | null>;
  updateIssueLabel(issueNumber: number, addLabel: string, removeLabel?: string): Promise<void>;
  onIssuesUpdated(callback: (issues: GitHubIssue[]) => Promise<void> | void): void;
}

export interface ACPManagerLike {
  initialize(): Promise<void>;
  getSessionForIssue(repositoryKey: string, issueNumber: number): AgentSessionRecord | undefined;
  listSessions(): AgentSessionRecord[];
  startNewSession(issue: GitHubIssue, agentName: string, prompt: string): Promise<void>;
  sendMessageToSession(sessionId: string, message: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  onSessionPaused(callback: (sessionId: string) => Promise<void> | void): void;
  onSessionCompleted(callback: (sessionId: string) => Promise<void> | void): void;
}

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
