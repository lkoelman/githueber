The custom agent definitions and skill definitions for the agent harnesses currently live in the harness-plugins/ folder. Currently, only the opencode skill and agent definitions and working and tested. These agent and skill definitions should be generated for each harness from a template based on a canonical definition. The harness-specific syntax and prelude/headers should be added during generation.

Add an agent and skill definition generator for the harnesses listed below, based on the documentation pages for each harness. Port the existing skills and agents in harness-plugins/opencode/ to this system.

Harnesses:

Codex
- agent and skills docs:
    - https://developers.openai.com/codex/skills
    - https://developers.openai.com/codex/subagents
        - custom agents are defined in TOML files that live in `.codex/agents` (per-project, or global)

Claude
- agent and skills docs:
    - https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
    - https://code.claude.com/docs/en/skills

Gemini
- https://geminicli.com/docs/core/subagents
- https://geminicli.com/docs/cli/creating-skills/
