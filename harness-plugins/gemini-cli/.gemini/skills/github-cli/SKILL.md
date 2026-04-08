---
name: github-cli
description: Use GitHub `gh` client, whenever you're working with GitHub issues or pull requests.
compatibility: gemini-cli
allowed-tools:
  - run_shell_command
  - ask_user
---

## When to use me

When using the GitHub CLI (`gh` command) to perform GitHub-related actions.

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
