You are a senior software engineer that is a systems design expert. Create a high-level design for synchronising GitHub project primitives (issues, milestones, pull requests, issue labels, etc) with a local data store.

The goal is to pull a set of project-related issues, work on them, and push them seamlessly back to GitHub while resolving conflicts if the remote state has changed. Once pulled locally, issues can be dispatched to multiple agents that work on them synchronously and might request modifications / updates to the project structure (for example, modify issue state, create new issues, etc).

The general idea is that the project and issue pool serves as the memory and state of the agentic worker pool (i.e. for tracking work to be done and WIP), but also as a communication interface with the user, through the existing web interface. Cover the general system design and potential choices of libraries and databases. Do not go into implementation details. The language is Python.

------------------------------------------------------


I want to create a daemon-like service that monitors my GitHub repo's issues using the `gh` command-line tool and dispatches any issues that are marked for agent interaction to a coding agent.

Constraints:
- use OpenCode as the coding harness
- targets Ubuntu 24 and other linux distros
- implement the project in TypeScript so that we can make use of the ACP TypeScript SDK and octokit/rest.js
- use octokit/rest.js to interact with GitHub
    - let coding agents use the `gh` CLI tool for github interaction
- create an OpenCode session for each task (for example, implementing an issue)
    - this allows us to manually restart the session at a later time
- use Agent Client Protocol (ACP) for communication with the agent, so that I can swap out the agent backend in the future
- the agent must use a custom agent definition in markdown (see https://opencode.ai/docs/agents/), containing instructions to deal with the issue, pull request, etc
    - the custom agent should describe in detail the process that the agent should follow to deal with the request, with a prompt that takes into account best practices for coding agents
    - you may add additinal supporting agent definitions, tool definitions (see https://opencode.ai/docs/custom-tools) or skill definitions (https://opencode.ai/docs/skills/) to facilitate the workflow
- the main responsibility for our TypeScript service is to push state updates summarized as a useful context to our coding agent
    - the coding agent itself should use this context (project id, issue id, etc.) to post updates to GitHub autonomously, by relying on a suitable SKILL.md file [skill example](opencode/.opencode/skills/github-cli/SKILL.md)
- as much as possible, keep the agent and coding logic inside agent and skill definitions. Use our custom service code mainly for connecting Agent Harness <-> GitHub

Features:
- see features implemented in [github agent orchestrator in python](/home/lkoel/code/agents-config/gh-orchestrator/src/gh-orchestrator)
    - inspect this implementation for the features only, not for the logic
    - Configuration file illustrating configurable features: /home/lkoel/code/agents-config/gh-orchestrator/config/gh-orchestrator-config.example.yaml
- run as a persistent service on system start
- transparent logging (preferably through systemctl/systemd integration)
- monitor github by checking the project state at fixed intervals using the `gh` tool
- only let agents execute when issue are appropriately labeled, or triggered by keywords in issue comments
- intelligent sync: don't fetch the entire github project state, only new or changed issues
- example workflow
    - implement an feature request or bugfix described in an issue and submit a PR
        - by default, let the agent write a plan first and submit it for approval by posting a comment in the issue thread
    - refine a high-level feature request or epic into sub-tasks, and add them back to github
        - when an issue is refined / subdivided: use appropriate tagging and labeling to keep track of the 'master' issue or epic, and sub-issues or tasks


Resources
- [GitHub REST API client for JavaScript: octokit/rest.js](https://github.com/octokit/rest.js)
    - documentation: https://octokit.github.io/rest.js/v22/
- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/architecture)
- [ACP: protocol](https://agentclientprotocol.com/protocol/overview)
    - https://agentclientprotocol.com/protocol/session-setup
- [ACP Python SDK](https://github.com/agentclientprotocol/python-sdk)
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode docs: SDK](https://opencode.ai/docs/sdk/)
- [OpenCode docs: Server](https://opencode.ai/docs/server/)
- [OpenCode docs: ACP support](https://opencode.ai/docs/acp/)
- OpenCode example plugins and agents
    - https://github.com/darrenhinde/OpenAgentsControl
    - https://github.com/code-yeongyu/oh-my-openagent


Your goal is to think of a system design that makes intelligent use of the ACP protocol and subagent capabilities of code harnesses, which can be invoked using ACP tool calls. For example: a key question is whether to have simple code logic to gate and pass filtered Github project state as context to new agent harness sessions, or to use a custom 'orchestrator' agent that decides intelligently about prioritization and parallel tasks. If an orchestrator is used, a key consideration is whether it runs on the side of our service or inside the coding harness. If running inside the harness, this orchestrator must be able to spawn subagents intelligently, in a way controlled by our service through ACP. A middle ground would be to filter and condense the project context based on labeling and scoping rules, then pass this to the orchestrator, and let it decide how to tackle tasks based on the ongoing/alredy running agents.

First propose a high-level system diagram of the system. Pause at this point so I can review. Then we will write an implementation plan that details the different components and interfaces through class stubs, interface definitions, etc.