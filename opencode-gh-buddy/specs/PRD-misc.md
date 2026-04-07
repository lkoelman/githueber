Support OpenCode session take-over
- do we need to use https://opencode.ai/docs/sdk/ -> probably not, given that we just create session in different way now

Support Codex app server (https://developers.openai.com/codex/app-server)

Support Claude
- the 'channels' approach seems good: easy to jump into an existing session


Agent and skill installation
- install them, hide it behind `gbr init agents --global`

Attach/follow session
- add comand `gbr follow <session-id>` so we can see what the agent is doing
- add `--echo` flag to `gbr start` to echo interaction with the agent through ACP

Session management:
- change `gbr sessions` to `gbr session` and add sub-verbs
- sub-verb: `gbr session list`, `gbr session kill`
