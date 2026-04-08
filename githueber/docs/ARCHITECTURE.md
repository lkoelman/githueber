# Architecture

`githueber` is a Bun/TypeScript daemon that acts as the deterministic control plane between GitHub and coding harnesses. GitHub is the system of record for work state and human approval, while the selected harness performs the non-deterministic agent work. The daemon polls GitHub, decides what should happen next, starts or resumes agent sessions, and exposes local operational control through a Unix domain socket and CLI.

## System Diagram

```text
                     +-------------------------------+
                     |           GitHub              |
                     | issues, labels, comments, PRs |
                     +---------------+---------------+
                                     ^
                                     | poll state / update labels
                                     |
                   +-----------------+------------------+
                   |       githueber daemon     |
                   |                                    |
                   |  +------------------------------+  |
                   |  | ConfigManager                |  |
                   |  | loads repo-scoped config     |  |
                   |  +--------------+---------------+  |
                   |                 |                  |
                   |  +--------------v---------------+  |
                   |  | GitHubPoller (per repo)      |  |
                   |  | fetches issues/comments      |  |
                   |  +--------------+---------------+  |
                   |                 | issues           |
                   |  +--------------v---------------+  |
                   |  | StateRouter                  |  |
                   |  | decides START/RESUME/IGNORE  |  |
                   |  +--------------+---------------+  |
                   |                 | decisions        |
                   |  +--------------v---------------+  |
                   |  | DaemonCore                   |  |
                   |  | coordinates pollers +        |  |
                   |  | harness sessions             |  |
                   |  +------+---------------+-------+  |
                   |         |               |          |
                   |         | Harness calls | IPC     |
                   |  +------v------+   +----v-------+  |
                   |  | Session     |   | IPCServer  |  |
                   |  | Managers    |   | unix socket|  |
                   |  +------+------+   +----+-------+  |
                   +---------|---------------|----------+
                             |               ^
                             |               |
                             v               |
                  +-------------------+      |
                  | OpenCode / Codex  |      |
                  | harness runtime   |      |
                  +---------+---------+      |
                            |                |
                            v                |
                  +-------------------+      |
                  | local repo        |      |
                  | gh / git / tests  |      |
                  +-------------------+      |
                                             |
                                 +-----------+-----------+
                                 | gbr CLI                |
                                 | sessions/poll/stop    |
                                 +-----------------------+
```

## Main Components

### 1. Configuration Layer

- Responsibility: load and validate daemon configuration, especially repository-scoped settings such as owner/repo pairs, local checkout paths, labels, and agent mappings.
- Implementation: [ConfigManager.ts](../src/config/ConfigManager.ts)
- Primary interface:
  - `new ConfigManager(configPath)`
  - `getConfig(): DaemonConfig`
  - `updateValue(key, value)`

`ConfigManager` is the root of dependency construction. `src/index.ts` uses it to build the runtime graph for all repositories and shared settings such as ACP endpoint, polling interval, and socket path.

### 2. Shared Domain Model

- Responsibility: define the types that move between the daemon subsystems.
- Implementation: [types.ts](../src/models/types.ts)
- Main interfaces:
  - `DaemonConfig`
  - `RepositoryConfig`
  - `GitHubIssue`
  - `AgentSessionRecord`
  - `GitHubPollerLike`
  - `ACPManagerLike`
  - `RouterLike`
  - IPC request/response types

These types are the contract between configuration, polling, routing, ACP session management, and IPC.

### 3. GitHub Integration Layer

- Responsibility: talk to GitHub with `@octokit/rest`, poll issues and comments, and update labels in a rate-limit-friendly way.
- Implementation: [GitHubPoller.ts](../src/github/GitHubPoller.ts)
- Main interfaces:
  - `createOctokit(token)`
  - `resolveGitHubToken(owner, repo, envToken)`
  - `GitHubPoller.start(intervalMs)`
  - `GitHubPoller.pollNow()`
  - `GitHubPoller.getLatestComment(issueNumber)`
  - `GitHubPoller.updateIssueLabel(issueNumber, addLabel, removeLabel?)`
  - `GitHubPoller.onIssuesUpdated(callback)`

There is one `GitHubPoller` instance per configured repository. Each poller is repository-scoped and emits normalized `GitHubIssue` objects that already include repository identity.

### 4. Deterministic Routing Layer

- Responsibility: convert repository-scoped issue state into control-plane actions.
- Implementation: [StateRouter.ts](../src/router/StateRouter.ts)
- Main interface:
  - `evaluateIssueState(issue, latestComment?, activeSession?) => RouteDecision`

`StateRouter` contains the daemon's decision logic but no side effects. It decides whether the daemon should:

- start a new session
- resume an approved session
- resume a revised session
- ignore the issue for now

It uses repository-local labels and agent mappings from `DaemonConfig`.

### 5. Prompt Construction

- Responsibility: synthesize the initialization prompt sent to OpenCode.
- Implementation: [prompts.ts](../src/prompts.ts)
- Main interface:
  - `buildInitializationPrompt(issue, agentName, worktreeRoot)`

The prompt builder converts a `GitHubIssue` into structured context, including repository key, owner/repo, checkout path, issue id, and label state. When `isolation.worktrees` is configured, it resolves a deterministic per-issue worktree path and tells the agent to create or reuse that worktree before doing any coding work.

### 6. Harness Integration Layer

- Responsibility: create and manage coding sessions through harness-specific clients behind a shared daemon-facing session manager contract.
- Implementation:
  - [HarnessSessionManager.ts](../src/harness/HarnessSessionManager.ts)
  - [MultiHarnessSessionManager.ts](../src/harness/MultiHarnessSessionManager.ts)
  - [OpenCodeHarnessClient.ts](../src/opencode/OpenCodeHarnessClient.ts)
  - [CodexHarnessClient.ts](../src/codex/CodexHarnessClient.ts)
- Main interfaces:
  - `createOpenCodeHarnessClient(endpoint, fetchImpl?)`
  - `createCodexHarnessClient(config, spawnImpl?)`
  - `initialize()`
  - `getSessionForIssue(repositoryKey, issueNumber)`
  - `startNewSession(issue, agentName, prompt)`
  - `sendMessageToSession(sessionId, message)`
  - `stopSession(sessionId)`
  - `onSessionPaused(callback)`
  - `onSessionCompleted(callback)`
  - `onSessionEvent(callback)`

`HarnessSessionManager` stores active sessions keyed by repository plus issue number so identical issue numbers in different repositories remain isolated. `MultiHarnessSessionManager` composes one harness-specific manager per required backend and routes repository-scoped issues to the correct one at runtime.

The OpenCode harness client opens `/global/event`, translates session turn updates into daemon pause/completion lifecycle events, and reuses the previous OpenCode transport. The Codex harness client launches `codex app-server` over stdio, performs the initialize handshake, starts a thread and turn, and maps app-server approval or user-input states into the daemon's normalized pause/completion lifecycle.

### 7. Daemon Coordinator

- Responsibility: wire pollers, router, session managers, and label updates into one control loop.
- Implementation: [daemon.ts](../src/daemon.ts)
- Main interfaces:
  - `start()`
  - `stop()`
  - `processIssue(issue)`
  - `triggerManualPoll()`
  - `getActiveSessions()`
  - `stopSession(sessionId)`

`DaemonCore` is the center of the application. Its job is:

- subscribe to each `GitHubPoller`
- fetch the current active session for each issue
- ask `StateRouter` what to do
- start or resume sessions through the repository's resolved harness manager
- update GitHub labels through the correct repository poller

It also reacts to harness pause/completion callbacks by mapping the session back to its repository-scoped issue identity and applying the corresponding GitHub label transition.
On process shutdown, it stops polling and closes all tracked sessions before the daemon exits.

### 8. IPC Server

- Responsibility: expose daemon control operations locally over a Unix domain socket.
- Implementation:
  - [IPCServer.ts](../src/ipc/IPCServer.ts)
  - [handler.ts](../src/ipc/handler.ts)
- Main interfaces:
  - `IPCServer.start()`
  - `IPCServer.stop()`
  - `handleIPCCommand(target, request)`

The IPC server is intentionally thin. It receives JSON commands from the CLI, routes them to a target object backed by `DaemonCore`, and returns JSON responses.

Supported commands are:

- `LIST_SESSIONS`
- `STOP_SESSION`
- `TRIGGER_POLL` returns a repository-scoped summary of fetched issues and any issues dispatched to an agent session
- `SET_CONFIG`

### 9. Command-Line Tool

- Responsibility: provide operator access to the running daemon without reaching into process internals.
- Implementation:
  - [src/cli/index.ts](../src/cli/index.ts)
  - [src/cli/args.ts](../src/cli/args.ts)
- Main interfaces:
  - `parseCliArgs(argv) => CliCommand`
  - CLI commands: `start [--echo] [--harness <opencode|codex>]`, `sessions`, `poll`, `stop <sessionId>`, `config <key> <value>`

The CLI does not implement daemon behavior itself. It translates shell arguments into an `IPCRequest`, opens a Unix socket connection to the daemon, sends one JSON message, and prints the JSON response or status message. For `poll`, the CLI renders a readable repository-by-repository summary of fetched issues and dispatches. For `start --echo`, it starts the daemon in-process and subscribes a terminal sink to the session interaction stream. `start --harness` overrides the configured default harness for repositories that do not define their own `harness`.

## Component Interaction

### GitHub to Daemon

1. `src/index.ts` builds one `GitHubPoller` per configured repository.
2. Each poller periodically calls GitHub and emits normalized issues.
3. `DaemonCore` receives those issues and checks for any existing active session.
4. If the issue is awaiting approval, `DaemonCore` asks the poller for the latest comment.
5. `StateRouter` evaluates the issue state and returns a `RouteDecision`.
6. `DaemonCore` executes that decision by calling the resolved harness session manager and then updating GitHub labels through the correct poller.

### Daemon to Harness

1. `StateRouter` selects an agent name based on issue labels.
2. `buildInitializationPrompt` constructs repository-aware agent context.
3. The daemon resolves the repository's harness using repository config, then CLI override, then daemon default.
4. The selected harness client creates or resumes a session.
5. The harness performs the non-deterministic work: read issues, plan, code, test, and create PRs.
6. Harness pause or completion events flow back into `DaemonCore`, which applies label changes in GitHub.
7. Optional session-event subscribers, such as the `--echo` console sink, observe the same session interaction stream without affecting daemon control flow.

### CLI to Daemon through IPC

The CLI-to-daemon path is local and synchronous:

1. The operator runs `gbr sessions`, `gbr poll`, `gbr stop <id>`, or `gbr config <key> <value>`.
2. [args.ts](../src/cli/args.ts) parses the command into an `IPCRequest`.
3. [src/cli/index.ts](../src/cli/index.ts) opens a Unix socket connection to the path configured by `GITHUBER_SOCKET_PATH` or the default socket path.
4. [IPCServer.ts](../src/ipc/IPCServer.ts) accepts the connection and parses the JSON payload.
5. [handler.ts](../src/ipc/handler.ts) dispatches the request to the `DaemonCore`-backed target:
   - `LIST_SESSIONS` reads the active session table
   - `STOP_SESSION` aborts a session by session id
   - `TRIGGER_POLL` forces an immediate poll cycle across repositories and returns the fetched/dispatched issue summary
   - `SET_CONFIG` changes an in-memory config value
6. The server writes a JSON response back to the CLI.
7. The CLI prints the result for the operator.

This keeps the CLI stateless and keeps all authoritative runtime state inside the daemon process.

## Execution Plane

The initial architecture documents separate deterministic daemon logic from non-deterministic coding logic. In that model:

- the daemon owns polling, routing, harness selection, session orchestration, and label transitions
- the selected harness owns planning, coding, Git operations, and PR creation
- GitHub remains the user-facing state machine and approval interface

The execution-plane definitions themselves live outside this package, in the selected harness configuration:

- worker and orchestrator agents
- the `github-cli` skill
- any additional OpenCode-side tools or skills

`githueber` therefore should be read as the control-plane package, not the full agent runtime.
