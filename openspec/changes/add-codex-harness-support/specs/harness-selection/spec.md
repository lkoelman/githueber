## ADDED Requirements

### Requirement: The daemon SHALL resolve a harness for each repository
The daemon SHALL support selecting a coding harness from configuration, with a default harness for the daemon and an optional per-repository override. Supported harness names MUST include `opencode` and `codex`.

#### Scenario: Repository override takes precedence
- **WHEN** the daemon configuration sets the default harness to `opencode` and a repository sets `harness: codex`
- **THEN** issues from that repository SHALL run with the `codex` harness

#### Scenario: Default harness applies when repository override is absent
- **WHEN** the daemon configuration sets the default harness to `codex` and a repository does not define `harness`
- **THEN** issues from that repository SHALL run with the `codex` harness

#### Scenario: OpenCode remains the implicit default
- **WHEN** no harness is specified in daemon configuration, repository configuration, or CLI flags
- **THEN** the daemon SHALL resolve the harness as `opencode`

### Requirement: The CLI SHALL support overriding the configured default harness for daemon startup
The `gbr start` command SHALL accept a `--harness <name>` flag that overrides the configured default harness for that daemon process without replacing explicit per-repository harness selections.

#### Scenario: CLI override changes the daemon default
- **WHEN** `gbr start --harness codex` is used and a repository does not define `harness`
- **THEN** that repository SHALL run with the `codex` harness for that daemon process

#### Scenario: CLI override does not replace repository override
- **WHEN** `gbr start --harness opencode` is used and a repository defines `harness: codex`
- **THEN** that repository SHALL continue to run with the `codex` harness

#### Scenario: Invalid harness is rejected
- **WHEN** an operator starts the daemon with `gbr start --harness unknown`
- **THEN** the CLI SHALL fail with a validation error that lists the supported harness names

### Requirement: The daemon SHALL validate harness-specific configuration before starting work
The daemon SHALL fail startup when a resolved harness is missing required configuration, and it SHALL only require config sections for harnesses that may actually be selected by the resolved configuration set.

#### Scenario: Missing Codex configuration fails startup
- **WHEN** a repository resolves to the `codex` harness and the Codex harness configuration is incomplete
- **THEN** daemon startup SHALL fail with an error identifying the missing Codex configuration field

#### Scenario: Unused Codex configuration is optional
- **WHEN** all repositories resolve to `opencode`
- **THEN** the daemon SHALL start without requiring a Codex configuration block

### Requirement: The daemon SHALL support Codex sessions through the Codex app server protocol
When a repository resolves to the `codex` harness, the daemon SHALL create, resume, and stop coding sessions through a Codex harness client that uses the Codex app server protocol.

#### Scenario: New issue starts a Codex-backed session
- **WHEN** a queued issue resolves to the `codex` harness and the router selects `START_SESSION`
- **THEN** the daemon SHALL create a Codex session for that repository issue and mark it as running

#### Scenario: Revision comment resumes a Codex-backed session
- **WHEN** a tracked Codex-backed session is awaiting approval and the router selects `RESUME_REVISED`
- **THEN** the daemon SHALL send the revision message to the existing Codex session instead of creating a new one

#### Scenario: Stop command terminates a Codex-backed session
- **WHEN** an operator stops an active Codex-backed session through the daemon
- **THEN** the daemon SHALL forward the stop request to the Codex harness client and remove the tracked session mapping

### Requirement: The daemon SHALL normalize Codex lifecycle events into daemon session states
The Codex harness client SHALL translate Codex app server lifecycle events into the daemon's existing session states and callback model so GitHub label transitions remain consistent across harnesses.

#### Scenario: Approval-needed state pauses the daemon session
- **WHEN** the Codex app server emits a state that requires human approval or user input before work can continue
- **THEN** the daemon SHALL mark the session as `PAUSED_AWAITING_APPROVAL`

#### Scenario: Completed turn marks the daemon session as completed
- **WHEN** the Codex app server reports that the active turn has completed without a pending approval state
- **THEN** the daemon SHALL mark the session as `COMPLETED`

### Requirement: Documentation SHALL describe harness selection and Codex setup
The package documentation and example configuration SHALL explain supported harnesses, resolution precedence, the `gbr start --harness` flag, and the Codex app server setup required for Codex-backed repositories.

#### Scenario: Operator reads setup docs for Codex
- **WHEN** an operator follows the package README and example config to enable `codex`
- **THEN** the documentation SHALL describe the required Codex app server configuration and how harness precedence is resolved
