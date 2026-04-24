# GitHub Issue 18 Summary

## Issue

Issue `#18` reported that Githueber could not reliably use OpenCode worker sessions when extra permissions were needed, because the daemon depended on a user-managed OpenCode server. The issue investigation concluded that the required permission overrides are server-side OpenCode SDK config, not something that can be set per `session.create()` call from the client side.

## Decision

Githueber now starts and owns its own OpenCode SDK server for daemon-managed OpenCode work instead of expecting the user to run `opencode serve` manually. This lets the daemon supply OpenCode `Config` overrides at server startup time.

## Implementation

- Reworked the OpenCode harness integration to use `createOpencode(...)` so the daemon gets both:
  - a live OpenCode client
  - a daemon-owned OpenCode server handle
- Removed the old `opencode.endpoint` dependency from the daemon config path.
- Added support for OpenCode server options under the YAML `opencode` section:
  - `hostname`
  - `port`
  - `timeout`
  - `permission`
- Added normalization for `opencode.permission.*` values in `ConfigManager`.
- Passed `opencode.permission` through to the OpenCode SDK `Config` object when spawning the server.
- Added shutdown plumbing so the spawned OpenCode server is closed when the daemon stops.
- Kept the resumable-session registry/restore logic compatible with the new daemon-owned server model by using the runtime server URL from the spawned OpenCode server.

## Resulting Config Shape

Example:

```yaml
opencode:
  port: 4100
  permission:
    external_directory: allow
    bash: ask
```

This is now the supported way to control server-side OpenCode permissions for daemon-managed sessions.

## Related Code Changes

Primary implementation updates were made in:

- `githueber/src/opencode/OpenCodeHarnessClient.ts`
- `githueber/src/startDaemon.ts`
- `githueber/src/config/ConfigManager.ts`
- `githueber/src/models/types.ts`
- `githueber/src/sessionManager/HarnessSessionManager.ts`
- `githueber/src/sessionManager/MultiHarnessSessionManager.ts`
- `githueber/src/daemon.ts`

Docs were updated in:

- `README.md`
- `githueber/docs/ARCHITECTURE.md`

## Validation

The change was implemented with test updates first where practical and verified with:

- `bun test`
- `bun run build:all`

Both passed after the final implementation.

## GitHub Follow-up

A summary of the change was posted back to issue `#18`:

- https://github.com/lkoelman/githueber/issues/18#issuecomment-4314807553
