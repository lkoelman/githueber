import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import type { GitHubComment, GitHubIssue, GitHubPollerLike } from "../models/types.ts";

interface OctokitIssueComment {
  id: number;
  body: string | null;
  user?: { login?: string | null };
  created_at: string;
  updated_at: string;
}

interface OctokitIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  labels: Array<string | { name?: string | null }>;
  state: "open" | "closed";
  updated_at: string;
  pull_request?: unknown;
}

interface OctokitLike {
  issues: {
    listForRepo(request: Record<string, unknown>): Promise<{ data: OctokitIssue[]; headers: Record<string, string>; status: number }>;
    listComments(request: Record<string, unknown>): Promise<{ data: OctokitIssueComment[] }>;
    addLabels(request: Record<string, unknown>): Promise<void>;
    removeLabel(request: Record<string, unknown>): Promise<void>;
  };
}

type RepositoryAccessValidator = (token: string, owner: string, repo: string) => Promise<boolean>;
type FallbackTokenReader = () => string | null;

/** Creates the Octokit client used for GitHub issue polling and label mutations. */
export async function createOctokit(token: string): Promise<OctokitLike> {
  const mod = await import("@octokit/rest");
  const OctokitCtor = (mod as { Octokit?: new (config: { auth: string }) => OctokitLike }).Octokit;
  if (!OctokitCtor) {
    throw new Error("Octokit export not available");
  }
  return new OctokitCtor({ auth: token });
}

/**
 * Checks whether a specific token can read the configured repository.
 *
 * GitHub returns `404 Not Found` for private repositories that exist but are
 * inaccessible to the token, so that status is treated as an access failure
 * rather than a signal that the repository name is wrong.
 */
export async function canAccessRepository(
  token: string,
  owner: string,
  repo: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "githueber"
    }
  });

  if (response.ok) {
    return true;
  }

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return false;
  }

  throw new Error(`GitHub repository access check failed: ${response.status} ${response.statusText}`);
}

/**
 * Reads the active credential managed by `gh auth`.
 *
 * The child process explicitly removes `GITHUB_TOKEN` from its environment so
 * `gh auth token` returns the stored CLI credential rather than echoing back an
 * unusable process-level override.
 */
export function readGhAuthToken(): string | null {
  try {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;

    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env
    }).trim();

    return token || null;
  } catch {
    return null;
  }
}

/**
 * Selects a GitHub token that can access the target repository.
 *
 * The daemon prefers the explicit `GITHUB_TOKEN` when it works, but falls back
 * to the credential managed by GitHub CLI so local development still works when
 * the environment token has narrower permissions than the logged-in account.
 */
export async function resolveGitHubToken(
  owner: string,
  repo: string,
  envToken: string | undefined,
  validateAccess: RepositoryAccessValidator = canAccessRepository,
  readFallbackToken: FallbackTokenReader = readGhAuthToken
): Promise<string> {
  if (envToken && await validateAccess(envToken, owner, repo)) {
    return envToken;
  }

  const fallbackToken = readFallbackToken();
  if (fallbackToken && fallbackToken !== envToken && await validateAccess(fallbackToken, owner, repo)) {
    return fallbackToken;
  }

  throw new Error(`No GitHub token could access ${owner}/${repo}. Check GITHUB_TOKEN or run gh auth login.`);
}

/** Normalizes GitHub label payloads into a plain list of label names. */
function normalizeLabels(labels: OctokitIssue["labels"]): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : label.name ?? ""))
    .filter((value): value is string => Boolean(value));
}

/** Converts GitHub API comments into the daemon's shared comment shape. */
function normalizeComments(comments: OctokitIssueComment[]): GitHubComment[] {
  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body ?? "",
    author: comment.user?.login ?? "unknown",
    createdAt: comment.created_at,
    updatedAt: comment.updated_at
  }));
}

/** Polls one configured repository and emits normalized issue state to the daemon core. */
export class GitHubPoller extends EventEmitter implements GitHubPollerLike {
  private lastEtag: string | null = null;
  private timer: Timer | null = null;
  private issuesUpdatedCallback?: (issues: GitHubIssue[]) => Promise<void> | void;

  constructor(
    private readonly octokit: OctokitLike,
    private readonly repositoryKey: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly localRepoPath: string
  ) {
    super();
  }

  /** Starts the repository poll loop and forwards any fetched issues to the subscriber. */
  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.pollNow().then((issues) => {
        if (issues.length > 0) {
          void this.issuesUpdatedCallback?.(issues);
        }
      });
    }, intervalMs);
  }

  /** Stops the repository poll loop if one is active. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Registers the single callback that receives normalized issues after polling. */
  onIssuesUpdated(callback: (issues: GitHubIssue[]) => Promise<void> | void): void {
    this.issuesUpdatedCallback = callback;
  }

  /** Fetches open issues for the repository, excluding pull requests, using ETag caching when available. */
  async pollNow(): Promise<GitHubIssue[]> {
    try {
      const response = await this.octokit.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: "open",
        per_page: 100,
        headers: this.lastEtag ? { "if-none-match": this.lastEtag } : undefined
      });

      this.lastEtag = response.headers.etag ?? null;

      return response.data
        .filter((issue) => issue.pull_request === undefined)
        .map((issue) => ({
          repositoryKey: this.repositoryKey,
          repoOwner: this.owner,
          repoName: this.repo,
          localRepoPath: this.localRepoPath,
          id: issue.id,
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
          labels: normalizeLabels(issue.labels),
          state: issue.state,
          updatedAt: issue.updated_at,
          comments: []
        }));
    } catch (error: any) {
      if (error?.status === 304) {
        return [];
      }
      throw error;
    }
  }

  /** Returns the most recent issue comment body for approval and revision routing decisions. */
  async getLatestComment(issueNumber: number): Promise<string | null> {
    const response = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      per_page: 100
    });
    const comments = normalizeComments(response.data);
    return comments.at(-1)?.body ?? null;
  }

  /** Applies the daemon's label transition by adding the new label and optionally removing the old one. */
  async updateIssueLabel(issueNumber: number, addLabel: string, removeLabel?: string): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels: [addLabel]
    });

    if (removeLabel) {
      try {
        await this.octokit.issues.removeLabel({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          name: removeLabel
        });
      } catch (error: any) {
        if (error?.status !== 404) {
          throw error;
        }
      }
    }
  }
}
