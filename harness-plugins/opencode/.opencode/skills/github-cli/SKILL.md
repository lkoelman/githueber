---
name: github-cli
description: Use GitHub `gh` client for issue, pull request, and issue-thread workflows driven from GitHub.
compatibility: opencode
allowed-tools:
  - bash
  - question
---

## When to use me

Use this skill whenever the task involves GitHub issues, pull requests, review threads, or agent-driven updates posted back to GitHub.

This skill is the preferred GitHub interface for OpenCode agents. Do not replace it with ad hoc API calls or generic web requests when `gh` can perform the action.

## Rules

- Work from the repository checkout the daemon provided.
- Read the issue thread before acting.
- Post concise status updates back to the issue when the workflow requires it.
- Prefer explicit flags and structured output.
- Never run destructive GitHub operations such as `gh repo delete`.
- Do not close issues or edit workflow labels directly unless the task explicitly requires it.
- When posting a plan that requires approval, end the comment with `[AWAITING_APPROVAL]`.

## Common GitHub Actions


### Issues

```bash
# list issues with title and label
gh issue list [--label "bug"] [--label ...] [--milestone "Big Feature"]

# Search issues with GithHub query syntax
gh issue list --search "error no:assignee sort:created-asc"

# View an issue with comments
gh issue view {<number> | <url>} --comments

# View an issue as JSON for structured inspection
gh issue view {<number> | <url>} --json title,body,labels,comments,assignees

# Add issue comment
gh issue comment {<number> | <url>} [flags] [-b <text>] [-F - <reads stdin>]

# Create issue for delegated sub-task
gh issue create --title "Task title" --body "Relates to #123" --label agent-queue
```

### PR Review

```bash
# view PR thread as markdown, without inline review comments
gh pr view <pr-number>

# Get PR reviews as JSON - use for retrieving comment ids
gh pr-review review view --pr <pr-number> -R <owner/repo>

# retrieve inline review comments that are unresolved
# get owner/repo using `git remote get-url $(git remote)`
gh pr-review review view --pr <pr-number> -R <owner/repo> --unresolved | jq '.reviews[].comments[]? | select(.is_resolved == false)'

# Reply to review comment
gh pr-review comments reply -R owner/repo --pr 123 --thread-id PRRT_kwDOAAABbcdEFG12 --body "Follow-up addressed in commit abc123"
```

### Create resources

```bash
# create a branch locally first, then open a PR
gh pr create --title "Feature" --body "Description" --base main --head your-branch

# create a child issue from an epic
gh issue create --title "Task title" --body "Relates to #123" --label agent-queue

# optionally add a more specific issue label when the issue type is known
gh issue create --title "Task title" --body "Relates to #123" --label agent-queue --label bug-fix
```

## Workflow patterns

### Worker issue flow

1. Read the full issue with `gh issue view <id> --json title,body,labels,comments`.
2. Investigate the local codebase.
3. Post a plan with `gh issue comment <id> --body ...`.
4. End the plan comment with `[AWAITING_APPROVAL]` when approval is required.
5. After approval, implement, run the relevant tests, and open a PR with `gh pr create`.

### Epic decomposition flow

1. Read the epic and discussion thread with `gh issue view`.
2. Break it into self-contained tasks.
3. Create one issue per task with `gh issue create`.
4. Include `Relates to #<epic-id>` in each child issue body.
5. Apply `agent-queue` to each child so the daemon will pick it up.
6. Comment on the epic summarizing the child issues created.
