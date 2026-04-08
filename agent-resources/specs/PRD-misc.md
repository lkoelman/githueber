Support Codex
- use app server (https://developers.openai.com/codex/app-server)
- agent and skills docs:
    - https://developers.openai.com/codex/skills
    - https://developers.openai.com/codex/subagents
        - custom agents are defined in TOML files that live in `.codex/agents` (per-project, or global)

Support Claude
- the 'channels' approach seems good: easy to jump into an existing session
- agent and skills docs:
    - https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
    - https://code.claude.com/docs/en/skills


Support OpenCode
- agent and skills docs:
    - https://opencode.ai/docs/agents/#markdown
    - https://opencode.ai/docs/skills/

Support Gemini
- https://geminicli.com/docs/core/subagents

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