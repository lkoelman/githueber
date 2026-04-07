
GH Interaction Workflow:
- when waiting for approval, label the issue as 'agent-waiting'
    - must include this label in the prompt -> agent must label it itself -> or ask the router do label it appropriately
- post follow-ups in PR thread
    - final feature summary
    - PR link

Use bidirectional ACP session:
- the interface in [ACPClientLike](../src/acp/ACPSessionManager.ts) looks wrong when comparing to https://agentclientprotocol.com/protocol/prompt-turn
- need `session/update` messages sent back to ACP Client
    - report these when `--echo` is set


Use worktrees:
- add entry in config file to enable worktrees, and where to put them (section 'isolation')
- modify prompts.js

Agent workflows:
- improve agent workflows
    - emphasize sync/pull
    - depending on worktree or not

Agent and skill installation
- install them, hide it behind `gbr init agents --global`

Attach/follow session
- add comand `gbr follow <session-id>` so we can see what the agent is doing
- add `--echo` flag to `gbr start` to echo interaction with the agent through ACP

Session management:
- change `gbr sessions` to `gbr session` and add sub-verbs
- sub-verb: `gbr session list`, `gbr session kill`