
# Claude Control

To manage Claude Code from a different process, you can use its Headless Mode or the Channels system. While it doesn't have a persistent server like opencode acp by default, these features allow for programmatic automation and external message pushing. [1, 2, 3, 4, 5]

## 1. Headless Mode (claude -p)
You can initiate coding sessions and send prompts via the CLI using the -p (or --print) flag. This mode is designed for CI/CD and scripts, returning structured output that your process can parse. [1, 6, 7, 8, 9]

* Initiate & Prompt: Run claude -p "Your prompt here".
* Structured Responses: Use --output-format json to get a JSON object containing the result, usage, and cost_usd.
* JSON Schema: You can enforce a specific response structure by providing a schema with --json-schema '{"type": "object", ...}'.
* Session Management: To resume a previous conversation programmatically, you can point to existing session files located in ~/.claude/projects/<encoded-cwd>/. [6, 10, 11]

## 2. Channels (Pushing Messages)
If you have a Claude Code session already running, you can use the Channels feature to push prompts into it from an external source without manually typing in the terminal. [12]

* Setup: Install a channel plugin (e.g., fakechat) via /plugin install fakechat@claude-plugins-official.
* Usage: Start Claude with --channels plugin:fakechat. You can then send HTTP requests to the local channel server (typically localhost:8787) to "inject" messages into the active session. [12]

## 3. Agent SDK (Full Control)
For deeper integration, [Anthropic](https://www.anthropic.com/) provides an Agent SDK (available for Python and TypeScript). This allows you to: [13]

* Embed the Claude Code agent loop directly into your own application logic.
* Programmatically handle tool approvals and multi-turn sessions with native message objects instead of raw CLI strings. [13, 14]

## Comparison at a Glance

| Feature [15, 16, 17, 18, 19] | Best For | Persistent? |
|---|---|---|
| Headless Mode | One-off tasks or batch scripts | No (Process ends after response) |
| Channels | Interacting with a running session | Yes (Session stays open) |
| Agent SDK | Building a custom "Claude-powered" app | Yes (Custom implementation) |

Would you like a code example for managing a headless session via Python/Node.js, or more details on setting up a Channel?

[1] [https://institute.sfeir.com](https://institute.sfeir.com/en/claude-code/claude-code-headless-mode-and-ci-cd/command-reference/)
[2] [https://medium.com](https://medium.com/@1kg/claude-code-what-is-claude-code-df66bb412cf7#:~:text=Claude%20Code%20offers%20multiple%20modes%20of%20operation%2C,flexibility%20for%20different%20workflows%20and%20use%20cases.)
[3] [https://www.linkedin.com](https://www.linkedin.com/posts/dan-m-rosenthal_idea-activity-7442193624232157184-RafT#:~:text=2%E2%83%A3%20Channels%20%28Mar%2020%29%20Claude%20Code%20now,on%20a%20server%20and%20hit%20a%20wall.)
[4] [https://playbooks.com](https://playbooks.com/skills/openclaw/skills/opencode-acp-control#:~:text=This%20skill%20lets%20you%20control%20OpenCode%20via,maintain%20OpenCode%20instances%20tied%20to%20project%20workdirs.)
[5] [https://mlearning.substack.com](https://mlearning.substack.com/p/cursor-automations-vs-openclaw-acp-skills-vs-claude-code-hook-loops-60-tips-tricks-to-build-ai-that-codes-while-you-sleep-0-free-march-2026#:~:text=ACP%20lets%20an%20external%20CLI%20%28like%20Claude,a%20running%20OpenClaw%20gateway%20over%20its%20WebSocket.)
[6] [https://institute.sfeir.com](https://institute.sfeir.com/en/claude-code/claude-code-headless-mode-and-ci-cd/faq/)
[7] [https://code.claude.com](https://code.claude.com/docs/en/headless#:~:text=Basic%20usage%20Add%20the%20%2Dp%20%28or%20%2D%2Dprint,%2Dp%20%22What%20does%20the%20auth%20module%20do?%22)
[8] [https://www.mindstudio.ai](https://www.mindstudio.ai/blog/what-is-claude-code-loop-scheduled-recurring-tasks#:~:text=Claude%20Code%20Loop%20runs%20through%20the%20terminal,or%20research%20tasks%20without%20any%20technical%20setup.)
[9] [https://www.linkedin.com](https://www.linkedin.com/posts/andrewchen323_boris-cherny-borischerny-on-threads-activity-7416937985818132480-ydMA#:~:text=Most%20devs%20use%20Claude%20Code%20the%20obvious,the%20CLI%20that%20most%20people%20never%20touch.)
[10] [https://code.claude.com](https://code.claude.com/docs/en/headless)
[11] [https://platform.claude.com](https://platform.claude.com/docs/en/agent-sdk/sessions)
[12] [https://code.claude.com](https://code.claude.com/docs/en/channels)
[13] [https://code.claude.com](https://code.claude.com/docs/en/headless)
[14] [https://platform.claude.com](https://platform.claude.com/docs/en/agent-sdk/agent-loop#:~:text=How%20the%20agent%20loop%20works%20Understand%20the,autonomous%20agent%20loop%20in%20your%20own%20applications.)
[15] [https://www.mindstudio.ai](https://www.mindstudio.ai/blog/claude-code-token-management-hacks-2#:~:text=18.%20Use%20Headless%20Mode%20for%20Repetitive%20Tasks,mode%29%20runs%20a%20single%20prompt%20and%20exits.)
[16] [https://kylestratis.com](https://kylestratis.com/posts/a-better-practices-guide-to-using-claude-code/#:~:text=Headless%20mode%20%28%20%2Dp%20%29%20runs%20Claude,ideal%20for%20CI%2C%20scripts%2C%20and%20batch%20operations.)
[17] [https://www.reddit.com](https://www.reddit.com/r/ClaudeAI/comments/1mch9uz/anthropic_were_glad_you_like_claude_code_but_stop/#:~:text=Use%20headless%20mode%20to%20automate%20your%20infra.,CI%2C%20pre%2Dcommit%20hooks%2C%20build%20scripts%2C%20and%20automation.)
[18] [https://code.claude.com](https://code.claude.com/docs/en/headless#:~:text=Run%20Claude%20Code%20programmatically%20The%20CLI%20was,commands%20are%20only%20available%20in%20interactive%20mode.)
[19] [https://www.productcompass.pm](https://www.productcompass.pm/p/claude-dispatch-guide)
