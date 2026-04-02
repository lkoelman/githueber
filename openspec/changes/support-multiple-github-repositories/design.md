## Context

`opencode-gh-buddy` currently models the world as one GitHub repository, one local checkout, one poller, and session records keyed only by issue number. That is sufficient for a single target repository, but it does not scale to a daemon instance that should monitor several repositories at once because issue numbers collide across repositories, prompt context lacks repository identity, and CLI output cannot distinguish where a session belongs.

This change crosses configuration, GitHub polling, routing, session bookkeeping, prompt generation, and IPC/CLI output. The implementation therefore needs an explicit repository scope that becomes part of the daemon's core data model instead of an incidental config detail.

## Goals / Non-Goals

**Goals:**

- Allow one daemon instance to load multiple repository definitions from config.
- Preserve single-repository usage by treating it as a degenerate case of the multi-repository config model.
- Ensure every polled issue, route decision, prompt, and active session is scoped to a repository identity.
- Show repository identity in CLI-visible session information.
- Keep repository-specific values together, including owner, repo name, local checkout, labels, and agent mapping overrides.

**Non-Goals:**

- Supporting multiple ACP endpoints within one daemon instance.
- Adding per-repository concurrency pools or priority scheduling in this change.
- Changing the OpenCode agent workflow beyond passing richer repository context.
- Replacing polling with GitHub webhooks.

## Decisions

### Introduce a `repositories` collection as the primary config model

The daemon should move from a top-level single `github` block to a `repositories` collection keyed by a stable repository alias such as `frontend` or `docs`. Each repository entry should contain GitHub coordinates, local repo path, and repository-scoped workflow settings. Global defaults can remain at the top level for shared values like ACP endpoint and polling interval.

Why this over a flat array only:

- A stable alias is useful in logs, CLI output, and session records.
- Named entries make it easier to override individual repositories without fragile positional indexing.
- The alias can act as the lookup key for session management and manual operations.

Alternative considered:

- Reusing the current top-level `github` block and adding `extra_repositories`.
This keeps backward compatibility superficially simple, but it leaves the core model inconsistent and forces the codebase to keep special cases indefinitely.

### Scope sessions by repository key plus issue number

Session bookkeeping must stop using `issueNumber` alone as the identifier. The new primary key should be `(repositoryKey, issueNumber)`, and session records should include repository key plus owner/repo identity for display and label updates.

Why:

- Issue `#42` can exist in many repositories.
- Pause/resume/completion callbacks need enough identity to update the correct repository.
- CLI output becomes unambiguous and useful.

Alternative considered:

- Using owner/repo strings everywhere without a repository alias.
This is workable, but it is noisier in config and CLI usage and makes local overrides less ergonomic.

### Run one poller per repository behind a shared daemon coordinator

Each configured repository should have its own GitHub poller instance with repository-scoped Octokit calls, while `DaemonCore` coordinates the shared ACP manager and IPC interface.

Why:

- Pollers already encapsulate repository-specific behavior.
- Independent pollers keep ETags and incremental state isolated per repository.
- The daemon can add or inspect repositories without rewriting all poller logic into a single multiplexed class.

Alternative considered:

- A single poller class that loops over all repositories internally.
That centralizes polling but couples unrelated repositories together and makes per-repository observability and testing harder.

### Include repository identity in initialization prompts and CLI responses

The ACP prompt should include repository alias, owner/repo, and local checkout path so OpenCode agents can switch to the correct workspace with no extra discovery. The CLI `sessions` response should expose the same repository identity.

Why:

- Multi-repository dispatch is not reliable if the agent only receives an issue number.
- Operators need to see where a session is running before stopping or inspecting it.

Alternative considered:

- Keeping prompts unchanged and assuming the agent infers repository from checkout.
That is brittle and breaks down immediately when a daemon manages more than one repository.


## Risks / Trade-offs

- [Config complexity increases] → Keep shared defaults at the top level and use a normalized internal representation.
- [Session management touches several modules] → Add repository-aware types first, then update router, prompt, poller, daemon, and CLI in that order.
- [Backward compatibility can hide ambiguous config] → Reject configs that define conflicting single-repo and multi-repo values for the same field.
- [Manual CLI operations need stronger targeting] → Keep `stop <session-id>` working, but surface repository identity clearly in `sessions` output.

## Migration Plan

1. Add repository-aware internal types and config normalization.
2. Update tests to cover both single-repo compatibility mode and multi-repo config.
3. Refactor poller, router, prompts, and daemon processing to carry repository context end to end.
4. Extend IPC/CLI session output to include repository identity.
5. Document the new config format and keep the old format accepted for one release window.

Rollback is straightforward because the change is internal to the daemon package: revert to the previous single-repository config shape and session model if multi-repo routing proves unstable.

## Open Questions

- Should labels and agent mappings be fully repository-local, or should the config support shared defaults plus per-repository overrides?
- Should future CLI commands accept a repository key explicitly for manual operations such as triggering a poll for only one repository?
