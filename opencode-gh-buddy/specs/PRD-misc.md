Support Codex
- use app server (https://developers.openai.com/codex/app-server)

Support Claude
- the 'channels' approach seems good: easy to jump into an existing session

Bug: named and resumable sessions
- the OpenCode sessions created by the daemon are not listed when running `opencode session list`
- it is possible that the OpenCode HTTP endpoint does not have the same rich session management features as the SDK
- create a second OpenCode client (next to `OpenCodeHttpSseClient`) that uses https://opencode.ai/docs/sdk/

Attach/follow session
- add comand `gbr follow <session-id>` so we can see what the agent is doing
- add `--echo` flag to `gbr start` to echo interaction with the agent through ACP

Session management:
- change `gbr sessions` to `gbr session` and add sub-verbs
- sub-verb: `gbr session list`, `gbr session kill`

Easy installation
- one-liner for install + harness skills, agents install
- e.g. `gbr install-harness opencode`
- ! need global install of skills, agents
- ! need to modify agents and skill files (preludes) for different harnesses