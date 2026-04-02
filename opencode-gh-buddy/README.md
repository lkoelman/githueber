# opencode-gh-buddy

TypeScript/Bun daemon package that bridges GitHub issue state to OpenCode agents over ACP.

## Requirements

- Bun installed
- GitHub CLI authenticated with `gh auth login`
- A reachable ACP-compatible OpenCode endpoint
- A local repository checkout agents can work in
- `GITHUB_TOKEN` available to the daemon

## What it provides

- YAML-style config loading for the daemon control plane
- Deterministic issue routing and prompt generation
- ACP session management and GitHub polling wrappers
- Unix domain socket IPC server and `gh-buddy` CLI
- Example config and systemd unit scaffold

## Installation

Install dependencies:

```bash
cd agents-config/opencode-gh-buddy
bun install
```

Create a config file from the example:

```bash
cp config/gh-buddy-config.example.yaml config/gh-buddy-config.yaml
```

Edit these values before running:

- `github.repo_owner`
- `github.repo_name`
- `github.local_repo_path`
- `acp.endpoint`

Export the daemon environment:

```bash
export GITHUB_TOKEN=your_token_here
export GH_BUDDY_CONFIG=/path/to/gh-buddy-config.yaml
```

## Usage

Run the daemon directly in development:

```bash
cd agents-config/opencode-gh-buddy
bun run src/index.ts
```

Build the daemon and CLI:

```bash
bun run build:all
```

Run the bundled daemon:

```bash
bun run dist/index.js
```

## CLI

The CLI talks to the daemon over a Unix domain socket. The default socket path is `/tmp/opencode-gh-buddy.sock`.

Run commands from the package directory:

```bash
bun run src/cli/index.ts sessions
bun run src/cli/index.ts poll
bun run src/cli/index.ts stop <session-id>
bun run src/cli/index.ts config polling.intervalMs 60000
```

After building, you can also use:

```bash
bun run dist/cli.js sessions
```

Available commands:

- `sessions`: list active ACP sessions tracked by the daemon
- `poll`: trigger an immediate GitHub poll cycle
- `stop <session-id>`: stop a tracked ACP session
- `config <key> <value>`: change an in-memory config value in the running daemon

If the daemon uses a non-default socket path:

```bash
export GH_BUDDY_SOCKET_PATH=/custom/path/opencode-gh-buddy.sock
```

## systemd

An example unit file is provided at `systemd/opencode-gh-buddy.service`.

Typical deployment flow:

```bash
cd agents-config/opencode-gh-buddy
bun install
bun run build:all
```

Then copy the built `dist/` directory, your config file, and the systemd unit into the target host layout, point `EnvironmentFile` at your secrets file, and enable the service with `systemctl`.

## Development

Run the test suite:

```bash
bun test
```
