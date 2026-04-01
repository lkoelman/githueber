---
name: gh-issue-monitor
description: "Fetch GitHub issues, spawn sub-agents to implement fixes and open PRs, then monitor and address PR review comments. Usage: /gh-issues [owner/repo] [--label bug] [--limit 5] [--milestone v1.0] [--assignee @me] [--fork user/repo] [--watch] [--interval 5] [--reviews-only] [--cron] [--dry-run] [--model glm-5] [--notify-channel -1002381931352]"
user-invocable: true
metadata:
  { "openclaw": { "requires": { "bins": ["curl", "git", "gh"] }, "primaryEnv": "GH_TOKEN" } }
---

# gh-issues — Address GitHub Issues with Parallel Sub-agents

You are an orchestrator. Follow these 6 phases exactly. Do not skip phases.

IMPORTANT: you use `gh` CLI to manage issues and PRs. Call `gh` with a cloned git repository as the working directory.


## Common GitHub Actions

### Issues

```bash
# list issues with title and label
gh issue list [--label "bug"] [--label ...] [--milestone "Big Feature"]

# Search issues with GithHub query syntax
gh issue list --search "error no:assignee sort:created-asc"

# View an issue
gh issue view {<number> | <url>} [--jq <expr>] [--comments]

# Add issue comment
gh issue comment {<number> | <url>} [flags] [-b <text>] [-F - <reads stdin>]

# Close issue
gh issue close {<number> | <url>} [-c <closing-comment>] [-r <reason>]
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
gh pr create --title "Feature" --body "Description" --reviewer @user
gh issue create --title "Bug" --label bug,urgent --assignee @me
gh repo fork owner/repo --clone
```

---

## Phase 1 — Parse Arguments

Parse the arguments string provided after /gh-issues.

Positional:

- owner/repo — optional. This is the source repo to fetch issues from. If omitted, detect from the current git remote:
  `git remote get-url origin`
  Extract owner/repo from the URL (handles both HTTPS and SSH formats).
  - HTTPS: https://github.com/owner/repo.git → owner/repo
  - SSH: git@github.com:owner/repo.git → owner/repo
    If not in a git repo or no remote found, stop with an error asking the user to specify owner/repo.

Flags (all optional):
| Flag | Default | Description |
|------|---------|-------------|
| --label | _(none)_ | Filter by label (e.g. bug, `enhancement`) |
| --limit | 10 | Max issues to fetch per poll |
| --milestone | _(none)_ | Filter by milestone title |
| --assignee | _(none)_ | Filter by assignee (`@me` for self) |
| --state | open | Issue state: open, closed, all |
| --fork | _(none)_ | Your fork (`user/repo`) to push branches and open PRs from. Issues are fetched from the source repo; code is pushed to the fork; PRs are opened from the fork to the source repo. |
| --watch | false | Keep polling for new issues and PR reviews after each batch |
| --interval | 5 | Minutes between polls (only with `--watch`) |
| --dry-run | false | Fetch and display only — no sub-agents |
| --yes | false | Skip confirmation and auto-process all filtered issues |
| --reviews-only | false | Skip issue processing (Phases 2-5). Only run Phase 6 — check open PRs for review comments and address them. |
| --cron | false | Cron-safe mode: fetch issues and spawn sub-agents, exit without waiting for results. |
| --model | _(none)_ | Model to use for sub-agents (e.g. `glm-5`, `zai/glm-5`). If not specified, uses the agent's default model. |
| --notify-channel | _(none)_ | Telegram channel ID to send final PR summary to (e.g. -1002381931352). Only the final result with PR links is sent, not status updates. |

Store parsed values for use in subsequent phases.

Derived values:

- SOURCE_REPO = the positional owner/repo (where issues live)
- PUSH_REPO = --fork value if provided, otherwise same as SOURCE_REPO
- FORK_MODE = true if --fork was provided, false otherwise

**If `--reviews-only` is set:** Skip directly to Phase 6. Run token resolution (from Phase 2) first, then jump to Phase 6.

**If `--cron` is set:**

- Force `--yes` (skip confirmation)
- If `--reviews-only` is also set, run token resolution then jump to Phase 6 (cron review mode)
- Otherwise, proceed normally through Phases 2-5 with cron-mode behavior active

---

## Phase 2 — Fetch Issues
