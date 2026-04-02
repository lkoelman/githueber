## Why

`opencode-gh-buddy` currently assumes a single GitHub repository and a single local checkout in its configuration and routing flow. That blocks using one daemon instance to watch and dispatch work across multiple repositories, which is the next practical step if the daemon is meant to act as a persistent control plane for a broader agent pool.

## What Changes

- Add first-class support for configuring multiple GitHub repositories in one daemon instance.
- Route issue polling, session creation, and label updates against the correct repository-specific configuration.
- Include repository identity in the ACP initialization context so OpenCode agents operate in the correct checkout.
- Extend the CLI and runtime session model so active sessions show which repository they belong to.
- Do NOT maintain backward compatibility with current single-repository behavior and config structure.

## Capabilities

### New Capabilities
- `multi-repository-dispatch`: Configure, poll, route, and manage agent sessions for multiple GitHub repositories from one daemon process.

### Modified Capabilities

None.

## Impact

- `opencode-gh-buddy` configuration parsing and validation
- GitHub polling and label update logic
- Session tracking, prompt generation, and IPC/CLI output
- OpenCode agent context passed through ACP
