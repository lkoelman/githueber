## Context

`opencode-gh-buddy` currently assumes every routed GitHub issue is executed through one OpenCode-specific client implementation in `src/acp/ACPSessionManager.ts`. The daemon startup path constructs exactly one OpenCode client from `acp.endpoint`, and the CLI `start` command only toggles `--echo`. That makes harness selection impossible at configuration time and couples session lifecycle handling to OpenCode transport details.

Supporting Codex is broader than adding one extra endpoint. The Codex app server uses a different protocol surface than the existing OpenCode HTTP plus SSE integration: JSON-RPC 2.0 messages over `stdio` by default, with client initialization, thread and turn lifecycle methods, and server-driven approval or user-input requests. The official Codex docs also state that protocol types should be generated from the installed Codex CLI version via `codex app-server generate-ts` or `codex app-server generate-json-schema`, so the daemon should not hand-maintain that schema.

## Goals / Non-Goals

**Goals:**
- Allow the daemon to select a harness from config, with optional repository-level override.
- Allow `gbr start --harness <name>` to override the configured default harness for that daemon process.
- Preserve OpenCode support without changing existing issue routing semantics.
- Add a Codex session client built on the Codex app server protocol and map its lifecycle into the daemon's existing `RUNNING`, `PAUSED_AWAITING_APPROVAL`, and `COMPLETED` states.
- Isolate harness-specific transports behind a stable daemon-facing contract so future harnesses do not require reworking `DaemonCore`.

**Non-Goals:**
- Replacing GitHub polling, routing, labels, or prompt construction semantics.
- Exposing the full Codex app server UI protocol through the CLI in this change.
- Supporting every Codex transport on day one; one production path is sufficient.
- Implementing mixed-turn tool approval UX beyond what is needed to preserve the current GitHub approval loop.

## Decisions

### Introduce a first-class harness abstraction

Add a new daemon-facing harness client contract that covers:
- connectivity/bootstrap
- start session
- resume session
- stop session
- lifecycle callbacks for pause and completion

`ACPSessionManager` should be refactored into a harness-neutral manager or replaced with a `SessionManager` that depends on a `HarnessClientLike` interface. OpenCode and Codex implementations will each adapt their transport-specific protocols to that shared contract.

Rationale:
- `DaemonCore` already consumes a generic manager interface, so the main coupling lives one layer below.
- A shared contract allows the daemon to host multiple harness backends concurrently when repository overrides require it.

Alternatives considered:
- Extend `ACPSessionManager` with `if (harness === "...")` branches. Rejected because it keeps OpenCode naming and transport assumptions in the core session layer.
- Create separate daemon implementations per harness. Rejected because routing, label transitions, and IPC behavior are shared and should remain single-sourced.

### Use repository-resolved harness selection with explicit precedence

Harness resolution should be:
1. `repositories.<key>.harness` when set
2. CLI `gbr start --harness <name>` override
3. top-level configured default harness
4. implicit default of `opencode`

The CLI flag acts as a daemon-run default, not as a forced override of explicit repository configuration.

Rationale:
- This matches the user's requirement for per-repo overrides while still allowing quick operator selection at startup.
- It keeps a single daemon instance usable across heterogeneous repositories.

Alternatives considered:
- Make `--harness` override every repository. Rejected because it would silently defeat explicit repository config.
- Only allow one daemon-wide harness. Rejected because it conflicts with the requested per-repo override support.

### Keep harness-specific config in dedicated sections

Add:
- a top-level default harness field
- an optional `harness` field on each repository
- dedicated top-level config blocks for `opencode` and `codex`

OpenCode keeps its endpoint-based config. Codex gets its own section for app-server launch/connect settings. The config loader validates only the sections required by the selected harnesses.

Rationale:
- `acp.endpoint` is OpenCode-specific already; Codex needs materially different settings.
- Dedicated sections avoid a generic config object that loses validation clarity.

Alternatives considered:
- Rename `acp` to a generic `harness` block immediately. Rejected because that creates unnecessary migration churn for existing OpenCode users.

### Prefer Codex app server `stdio` transport for the first implementation

The first Codex client should spawn `codex app-server` and communicate over newline-delimited JSON-RPC on stdio. The docs describe `stdio` as the default transport, while WebSocket is marked experimental.

The Codex config should therefore describe how to invoke the CLI, for example:
- executable path or command
- optional extra args
- model
- working defaults needed for thread creation or turn execution

Rationale:
- `stdio` is the documented default and avoids introducing a second long-lived network service to manage.
- Process lifecycle can be owned directly by the daemon, which simplifies startup and shutdown.

Alternatives considered:
- WebSocket transport only. Rejected because the docs mark it experimental.
- Require operators to launch app-server separately and provide a socket URL. Rejected for the first version because it complicates setup and supervision.

### Generate and vendor Codex protocol types from the CLI

The implementation should generate TypeScript protocol types from the Codex CLI using `codex app-server generate-ts` and commit the generated artifacts into the package. The generated output should be treated as version-pinned contract code, with regeneration called out in docs/tasks when the Codex CLI version changes.

Rationale:
- The docs explicitly say generated artifacts are version-specific.
- Checked-in generated types make builds deterministic and remove a runtime or install-time generator dependency.

Alternatives considered:
- Handwritten protocol types. Rejected because they will drift.
- JSON Schema only. Rejected because the TypeScript output is a better fit for this Bun/TypeScript codebase.

### Map Codex lifecycle events into the existing daemon approval model

Codex sessions expose richer item and approval flows than OpenCode. For this daemon, the initial implementation should reduce those events into the existing daemon lifecycle:
- session/turn start => `RUNNING`
- an approval or user-input state that requires human action in GitHub => `PAUSED_AWAITING_APPROVAL`
- turn completion without pending approval => `COMPLETED`

The Codex client should capture enough event detail internally to decide whether a turn has paused awaiting approval versus completed, but only emit the normalized daemon lifecycle events unless additional session-event richness is needed for `--echo`.

Rationale:
- Preserves the current GitHub label state machine and avoids a wider workflow redesign.
- Keeps Codex support additive rather than changing the operator model.

Alternatives considered:
- Expose every Codex item directly to the daemon. Rejected because it would couple daemon workflow to one harness's protocol details.

## Risks / Trade-offs

- [Codex protocol complexity is higher than OpenCode's current pause/completion heuristic] -> Mitigation: isolate it in a dedicated Codex client with protocol-generated types and explicit event-state tests.
- [Per-repository harness resolution may require multiple backend clients in one daemon] -> Mitigation: add a harness registry/factory rather than a single global client instance.
- [Existing config shape is OpenCode-centric] -> Mitigation: keep OpenCode config intact and add Codex sections incrementally, with clear precedence documentation.
- [Generated Codex types can drift from the installed CLI version] -> Mitigation: pin the Codex CLI version in docs/tooling and document regeneration as part of upgrades.
- [Codex approval requests may not map perfectly onto the current GitHub approval loop] -> Mitigation: define a minimal supported subset in the spec and defer richer interactive flows.

## Migration Plan

1. Add the new config fields with `opencode` as the implicit default so existing configs still start.
2. Add the CLI `--harness` flag and pass the resolved default into daemon startup.
3. Refactor session orchestration around a harness-neutral interface and preserve the OpenCode implementation behind it.
4. Add the Codex client, generated protocol types, and tests for lifecycle mapping.
5. Update config examples and docs with Codex setup and selection precedence.

Rollback is straightforward: switch the selected harness back to `opencode` and run the existing OpenCode path. The refactor should preserve OpenCode support throughout.

## Open Questions

- Which Codex app-server model and per-thread settings should be configurable in the first release versus deferred?
- Should `gbr start --harness` accept only known harness names or also support aliases such as `openai-codex`?
- Does the project want to expose richer Codex session events through `--echo` immediately, or only after the basic lifecycle integration lands?
