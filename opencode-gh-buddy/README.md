# opencode-gh-buddy

TypeScript/Bun daemon package that bridges GitHub issue state to OpenCode agents over ACP.

## Requirements

- Bun installed
- GitHub CLI authenticated with `gh auth login`
- A running OpenCode server started with `opencode acp`
- One local checkout per configured repository
- Optional absolute parent directory for issue worktrees when `isolation.worktrees` is enabled
- `GITHUB_TOKEN` available to the daemon, or `gh auth token` available as fallback

## What it provides

- Multi-repository config loading for one daemon instance
- Repository-scoped issue routing and prompt generation
- Bidirectional OpenCode session management over HTTP plus SSE and GitHub polling wrappers
- Unix domain socket IPC server and `gh-buddy` CLI
- Example config and systemd unit scaffold

## Installation

```bash
cd agents-config/opencode-gh-buddy

# install dependencies
bun install

# create config
cp config/gh-buddy-config.example.yaml config/gh-buddy-config.yaml
```

Edit `config/gh-buddy-config.yaml` and define every repository under `repositories:`. Each repository entry needs:

- `owner`
- `repo`
- `local_repo_path`
- `labels.*`
- `agent_mapping`

Set the shared daemon config:

- `execution.*`
- `polling.interval_ms`
- `acp.endpoint`
- `ipc.socket_path`
- `isolation.worktrees`

Export the daemon environment:

```bash
export GITHUB_TOKEN=your_token_here
export GH_BUDDY_CONFIG=/path/to/gh-buddy-config.yaml
```

If `GITHUB_TOKEN` is unset or cannot access a configured repository, the daemon falls back to `gh auth token`.

Build the daemon and CLI:

```bash
bun run build:all
```

Install the CLI (`gbr` command) globally:

```bash
bun link
```

TODO: install the agent and skill definitions for your coding agents
- then map them in your config file
- explain the defaults

## Usage

1. Start the OpenCode ACP server in its own shell:

```bash
opencode acp --port 9000
```

2. Start the Githueber daemon service:

```bash
# after global install using `bun link`:
gbr start
gbr start --echo

# or in development mode
bun run src/index.ts

# or after a local build:
bun run dist/index.js
```

Press `Ctrl+C` to stop the daemon gracefully. It will print a shutdown message, stop polling, and close tracked ACP sessions before exiting.

3. Make changes on Github and wait for `polling.intervalMs` or run `gbr poll`

## CLI

The CLI talks to the daemon over a Unix domain socket. The default socket path is `/tmp/opencode-gh-buddy.sock`.

Run commands from the package directory:

```bash
gbr start
gbr start --echo
gbr --verbose start
gbr sessions
gbr poll
gbr stop <session-id>
gbr config polling.intervalMs 60000
```

The `gbr` command can be replaced by `bun run src/cli/index.ts` during development, or by `bun run dist/cli.js` after building.

Available commands:

- `start`: start the daemon service directly from the CLI
  - `--echo`: print structured ACP session interaction events to stdout as sessions start, resume, pause, and complete
- `sessions`: list active ACP sessions, including repository key and owner/repo identity
- `poll`: trigger an immediate GitHub poll cycle across all configured repositories and print the fetched and dispatched issues
- `stop <session-id>`: stop a tracked ACP session by session id
- `config <key> <value>`: change an in-memory config value in the running daemon

Global options:

- `--verbose`, `-v`: print a full stack trace when the CLI exits due to an error

If the daemon uses a non-default socket path:

```bash
export GH_BUDDY_SOCKET_PATH=/custom/path/opencode-gh-buddy.sock
```

## Multi-Repository Config Shape

```yaml
repositories:
  frontend:
    owner: your-org
    repo: frontend-repo
    local_repo_path: /repos/frontend-repo
    labels:
      queue_label: agent-queue
      processing_label: agent-processing
      await_plan_label: await-plan
      completed_label: agent-completed
      failed_label: agent-failed
      revising_label: agent-revising
    agent_mapping:
      bug-fix: github-worker-agent
      epic: github-orchestrator-agent

isolation:
  worktrees: /repos/worktrees
```

Each repository is polled independently. Active sessions are tracked by repository key plus issue number, so `frontend#42` and `backend#42` remain distinct work items.

When `isolation.worktrees` is set to an absolute directory, prompt generation switches issue execution into a deterministic per-issue worktree path like `/repos/worktrees/your-org-frontend-repo-issue-42`. Set it to `null` or `false` to keep working directly in `local_repo_path`.

The ACP integration also emits a structured session interaction stream inside the daemon. `gbr start --echo` attaches a console sink to that stream today, and the same interface is intended to back a future `gbr follow <session-id>` IPC command.

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
