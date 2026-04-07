
Session cleanup:
- when interrupting the daemon service (ctrl+c), ensure all ACP sessions are closed cleanly

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