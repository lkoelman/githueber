Bugs
- fix worker agent permissions (too many tools are disallowed)
- opencode http client text streaming: it seems to only stream the reasoning text
- when worktrees are enabled, it uses the primary repository path first to inspect the code and make a plan
    - we should make a worktree, then pull main, then inspect and plan
        - make the worktree on daemon side, not agent side
        - modify instructions in `githueber/src/harnessAssets/index.ts`

Improvements
- improve onboarding and README
    - installer script: install config into `~/.config/githueber/config.yaml`
    - update README: edit this config after installation
- (TOTEST) ensure `plan` mode is used when the plan is made
- one log file per session
    - always log what is printed when `--echo` is set
- error message when running `gbr` command and daemon is not active
    - gbr sessions -> `connect ENOENT /tmp/githueber.sock`

Support Opencode
- (IMPROVEMENT) use opencode SDK

Support Codex
- use app server (https://developers.openai.com/codex/app-server)

Support Claude
- the 'channels' approach seems good: easy to jump into an existing session

Bug: named and resumable sessions
- the OpenCode sessions created by the daemon are not listed when running `opencode session list`
- it is possible that the OpenCode HTTP endpoint does not have the same rich session management features as the SDK
- create a second OpenCode client (next to `OpenCodeHttpSseClient`) that uses https://opencode.ai/docs/sdk/

Attach to or Follow session
- add comand `gbr attach/follow <session-id>` so we can see what the agent is doing
- attach should be interactive (-> can just run the appropriate harness command)

Session management:
- change `gbr sessions` to `gbr session` and add sub-verbs
- sub-verb: `gbr session list`, `gbr session kill`

Easy installation
- one-liner for install + harness skills, agents install
- e.g. `gbr install-harness opencode`
- ! need global install of skills, agents
- ! need to modify agents and skill files (preludes) for different harnesses
