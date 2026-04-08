## 1. Harness configuration and startup plumbing

- [x] 1.1 Add typed harness configuration to the daemon model and config loader, including a default harness, optional `repositories.<key>.harness`, and Codex-specific settings while preserving OpenCode as the implicit default.
- [x] 1.2 Extend `gbr start` argument parsing and startup wiring to accept `--harness <name>`, validate supported harnesses, and pass the CLI override into daemon startup.
- [x] 1.3 Add tests for config normalization and harness precedence covering repository override, CLI override, implicit default, and invalid harness values.

## 2. Harness abstraction refactor

- [x] 2.1 Refactor the current ACP-specific session manager into a harness-neutral manager/client contract that `DaemonCore` can use without transport-specific knowledge.
- [x] 2.2 Adapt the existing OpenCode client and lifecycle mapping to the new harness interface without changing current OpenCode behavior.
- [x] 2.3 Add regression tests for OpenCode-backed session start, resume, completion, pause, and stop behavior through the new abstraction.

## 3. Codex harness implementation

- [x] 3.1 Generate and commit Codex app server TypeScript protocol types from the Codex CLI, and document the pinned generation command used for updates.
- [x] 3.2 Implement a Codex harness client that launches `codex app-server` over `stdio`, performs initialization, starts threads/turns, resumes existing sessions, and stops sessions.
- [x] 3.3 Map Codex app server lifecycle and approval events into the daemon's normalized `RUNNING`, `PAUSED_AWAITING_APPROVAL`, and `COMPLETED` session states.
- [x] 3.4 Add focused tests for Codex session start/resume/stop flows, configuration validation failures, and lifecycle normalization.

## 4. Multi-harness daemon integration

- [x] 4.1 Add a harness factory or registry in daemon startup that constructs only the clients required by the resolved repository harness set.
- [x] 4.2 Update session tracking and event emission so repository-scoped sessions can run through either harness while keeping existing GitHub routing and label transitions intact.
- [x] 4.3 Add integration tests covering mixed repository configuration, where one repository uses OpenCode and another uses Codex in the same daemon instance.

## 5. Documentation and examples

- [x] 5.1 Update `githueber/README.md` with supported harnesses, Codex setup requirements, and `gbr start --harness` usage.
- [x] 5.2 Update `githueber/docs/ARCHITECTURE.md` and the example config file to describe the harness abstraction, config precedence, and Codex app server integration.
