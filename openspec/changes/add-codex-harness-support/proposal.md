## Why

`githueber` currently hard-codes OpenCode as its only coding harness, which makes the daemon unusable in repositories that need to run through the OpenAI Codex app server instead. Harness choice now needs to become a first-class configuration concern so operators can adopt Codex incrementally without forking the daemon or maintaining separate entrypoints.

## What Changes

- Add configurable harness selection to daemon configuration, with a default harness and optional per-repository override.
- Add a `--harness` flag to `gbr start` so operators can override the configured default harness for a daemon run.
- Introduce a Codex harness client that can create/resume/stop sessions through the Codex app server protocol instead of the current OpenCode-specific ACP client.
- Refactor daemon startup and session management so harness-specific transport details are isolated behind a shared session manager/client contract.
- Update documentation and example configuration to describe supported harnesses, precedence rules, and required Codex app server setup.

## Capabilities

### New Capabilities
- `harness-selection`: Select the coding harness used by the daemon globally, per repository, or via a start-time CLI override, and run issue sessions against either OpenCode or Codex.

### Modified Capabilities

## Impact

- Affected code: `githueber/src/acp/ACPSessionManager.ts`, `githueber/src/startDaemon.ts`, `githueber/src/config/ConfigManager.ts`, `githueber/src/models/types.ts`, `githueber/src/cli/args.ts`, `githueber/src/cli/index.ts`, prompt/session event plumbing, config examples, and package docs.
- External systems: OpenCode server remains supported; Codex app server becomes a new supported runtime dependency.
- Dependencies: the implementation will need generated Codex app server protocol types or JSON schema artifacts sourced from the Codex CLI version used by operators.
