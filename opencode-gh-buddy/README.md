# opencode-gh-buddy

TypeScript/Bun daemon package that bridges GitHub issue state to OpenCode agents over ACP.

## Requirements

- Bun installed
- GitHub CLI authenticated with `gh auth login`
- A running OpenCode server started with `opencode acp`
- One local checkout per configured repository
- `GITHUB_TOKEN` available to the daemon, or `gh auth token` available as fallback

## What it provides

- Multi-repository config loading for one daemon instance
- Repository-scoped issue routing and prompt generation
- ACP session management and GitHub polling wrappers
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

## Usage

1. Start the OpenCode ACP server in its own shell:

```bash
opencode acp --port 9000
```

2. Start the Githueber daemon service:

```bash
# after global install using `bun link`:
gbr start

# or in development mode
bun run src/index.ts

# or after a local build:
bun run dist/index.js
```

3. Make changes on Github and wait for `polling.intervalMs` or run `gbr poll`

## CLI

The CLI talks to the daemon over a Unix domain socket. The default socket path is `/tmp/opencode-gh-buddy.sock`.

Run commands from the package directory:

```bash
gbr start
gbr --verbose start
gbr sessions
gbr poll
gbr stop <session-id>
gbr config polling.intervalMs 60000
```

The `gbr` command can be replaced by `bun run src/cli/index/ts` during development, or by `bun run dist/cli.js` after building.

Available commands:

- `start`: start the daemon service directly from the CLI
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
```

Each repository is polled independently. Active sessions are tracked by repository key plus issue number, so `frontend#42` and `backend#42` remain distinct work items.

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
