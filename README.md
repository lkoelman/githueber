<p align="center">
  <img src="githueber/docs/githueber-logo.jpg" alt="Githueber logo" width="320" />
</p>

<h1 align="center">Githueber</h1>

<p align="center">
  Use GitHub as frontend to orchestrate your coding harness (Claude, Codex, OpenCode)
</p>


<p align="center">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/lkoelman/githueber">
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/lkoelman/githueber">
  <img alt="GitHub Issues or Pull Requests" src="https://img.shields.io/github/issues/lkoelman/githueber">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ESM-3178C6?logo=typescript&logoColor=white" />
  <img alt="GitHub License" src="https://img.shields.io/github/license/lkoelman/githueber">
</p>

Githueber lets you use GitHub as a frontend to manage your coding harness and sessions right on your local device. The philosophy is "GitHub is already a very good UI/UX for managing a repo, its issues and PRs. S let's use it as the control center for coordinating your agents".

## Why Githueber?

You may be interested in Githueber if:

- you've already spent effort configuring and tweaking your coding harness, and don't want to enter a new config rabbithole like OpenClaw
- you don't want a shiny new frontend to manage your coding harness and agents: the GitHub UI offers everything you need to manage a repo and (agentic) collaborators
- you're a serious developer and want something simpler than OpenClaw focused on just development

## Requirements

- GitHub CLI authenticated with `gh auth login`
- supported harness installed (OpenCode, Codex, Claude Code [WIP])
- One local checkout per configured repository

## Installation

Install `gbr`, the Githueber CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/lkoelman/githueber/main/install-githueber.sh | bash
```

Common options:

```bash
# install without prompting for confirmation
curl -fsSL https://raw.githubusercontent.com/lkoelman/githueber/main/install-githueber.sh | bash -s -- -y

# install a different harness asset set
curl -fsSL https://raw.githubusercontent.com/lkoelman/githueber/main/install-githueber.sh | bash -s -- --harness codex
```

The installer installs and links the `gbr` command globally using `bun link`.

Manual install remains available:

```bash
cd githueber/githueber

# install dependencies
bun install

# create config
cp config/githueber-config.example.yaml config/githueber-config.yaml
```

Edit `config/githueber-config.yaml` and define every repository under `repositories:`. Each repository entry needs:

- `owner`
- `repo`
- `local_repo_path`
- optional `harness`
- `labels.*`
- `agent_mapping`

Set the shared daemon config:

- `execution.*`
- `opencode.*` and/or `codex.*` for the harnesses you plan to use
- `polling.interval_ms`
- `ipc.socket_path`
- `isolation.worktrees`

Export the daemon environment:

```bash
export GITHUB_TOKEN=your_token_here
export GITHUEBER_CONFIG=/path/to/githueber-config.yaml
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

Install skill and agent definitions into your harness's global config folder:

```bash
gbr harness-install <opencode|codex|claude|gemini>
```

## Usage

1. Start the OpenCode ACP server in its own shell:

```bash
opencode acp --port 9000
```

2. Start the Githueber daemon service:

```bash
# after global install using `bun link`:
gbr start [--echo]
```

Press `Ctrl+C` to stop the daemon gracefully. It will print a shutdown message, stop polling, and close tracked ACP sessions before exiting.

3. Make changes on Github and wait for `polling.intervalMs` or run `gbr poll`

## CLI

The CLI talks to the daemon over a Unix domain socket. The default socket path is `/tmp/githueber.sock`.

Run commands from the package directory:

```bash
gbr harness-install codex
gbr start
gbr start --harness codex
gbr start --echo
gbr --verbose start
gbr sessions
gbr poll
gbr stop <session-id>
gbr config polling.intervalMs 60000
```

The `gbr` command can be replaced by `bun run src/cli/index.ts` during development, or by `bun run dist/cli.js` after building.

Available commands:

- `harness-install <opencode|codex|claude|gemini>`: install generated agent and skill definitions into the selected harness's user-home directories
- `start`: start the daemon service directly from the CLI
  - `--harness <opencode|codex>`: override the configured default harness for repositories that do not set their own `harness`
  - `--echo`: stream assistant response text to stdout in real time while keeping lifecycle markers for prompts, pauses, and completion
- `sessions`: list active ACP sessions, including repository key and owner/repo identity
- `poll`: trigger an immediate GitHub poll cycle across all configured repositories and print the fetched and dispatched issues
- `stop <session-id>`: stop a tracked ACP session by session id
- `config <key> <value>`: change an in-memory config value in the running daemon

Global options:

- `--verbose`, `-v`: print a full stack trace when the CLI exits due to an error

If the daemon uses a non-default socket path:

```bash
export GITHUBER_SOCKET_PATH=/custom/path/githueber.sock
```

## Multi-Repository Config Shape

```yaml
repositories:
  frontend:
    owner: your-org
    repo: frontend-repo
    local_repo_path: /repos/frontend-repo
    harness: opencode
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
  backend:
    owner: your-org
    repo: backend-repo
    local_repo_path: /repos/backend-repo
    harness: codex

execution:
  harness: opencode

opencode:
  endpoint: http://127.0.0.1:9000

codex:
  command: codex
  args: app-server
  model: gpt-5.4

isolation:
  worktrees: /repos/worktrees
```

Each repository is polled independently. Active sessions are tracked by repository key plus issue number, so `frontend#42` and `backend#42` remain distinct work items.

Harness resolution precedence is:

1. `repositories.<key>.harness`
2. `gbr start --harness <name>`
3. `execution.harness`
4. implicit default `opencode`

When `isolation.worktrees` is set to an absolute directory, prompt generation switches issue execution into a deterministic per-issue worktree path like `/repos/worktrees/your-org-frontend-repo-issue-42`. Set it to `null` or `false` to keep working directly in `local_repo_path`.

The ACP integration also emits a structured session interaction stream inside the daemon. `gbr start --echo` now renders streamed assistant response text from that event stream in real time, while the same interface remains suitable for a future `gbr follow <session-id>` IPC command.

## Codex Harness Notes

The Codex harness launches `codex app-server` over stdio for each daemon-managed session. This implementation was generated and tested against `codex-cli 0.118.0`.

The vendored protocol types under `src/codex/generated/` can be regenerated with:

```bash
codex app-server generate-ts --out /tmp/codex-app-server-schema
rm -rf src/codex/generated
cp -R /tmp/codex-app-server-schema src/codex/generated
```

## systemd

An example unit file is provided at `systemd/githueber.service`.

Typical deployment flow:

```bash
cd githueber/githueber
bun install
bun run build:all
```

Then copy the built `dist/` directory, your config file, and the systemd unit into the target host layout, point `EnvironmentFile` at your secrets file, and enable the service with `systemctl`.

## Development

Run the test suite:

```bash
bun test
```