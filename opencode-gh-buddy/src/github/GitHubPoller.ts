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

export async function createOctokit(token: string): Promise<OctokitLike> {
  const mod = await import("@octokit/rest");
  const OctokitCtor = (mod as { Octokit?: new (config: { auth: string }) => OctokitLike }).Octokit;
  if (!OctokitCtor) {
    throw new Error("Octokit export not available");
  }
  return new OctokitCtor({ auth: token });
}

function normalizeLabels(labels: OctokitIssue["labels"]): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : label.name ?? ""))
    .filter((value): value is string => Boolean(value));
}

function normalizeComments(comments: OctokitIssueComment[]): GitHubComment[] {
  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body ?? "",
    author: comment.user?.login ?? "unknown",
    createdAt: comment.created_at,
    updatedAt: comment.updated_at
  }));
}

export class GitHubPoller extends EventEmitter implements GitHubPollerLike {
  private lastEtag: string | null = null;
  private timer: Timer | null = null;
  private issuesUpdatedCallback?: (issues: GitHubIssue[]) => Promise<void> | void;

  constructor(
    private readonly octokit: OctokitLike,
    private readonly owner: string,
    private readonly repo: string
  ) {
    super();
  }

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

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onIssuesUpdated(callback: (issues: GitHubIssue[]) => Promise<void> | void): void {
    this.issuesUpdatedCallback = callback;
  }

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

      const issues = response.data
        .filter((issue) => issue.pull_request === undefined)
        .map((issue) => ({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
          labels: normalizeLabels(issue.labels),
          state: issue.state,
          updatedAt: issue.updated_at,
          comments: []
        }));

      return issues;
    } catch (error: any) {
      if (error?.status === 304) {
        return [];
      }
      throw error;
    }
  }

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
