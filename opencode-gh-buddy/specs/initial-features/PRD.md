I want to create a daemon-like service that monitors my GitHub repo / project and dispatches any issues that are marked for agent interaction to a coding agent.

The general idea is that the GitHub project and issue pool serves as the high-level memory for the agentic worker pool (i.e. for tracking work to be done and WIP), but also as a communication interface with the user, through the existing web interface.

Constraints:
- run as a persistent daemon service
- use OpenCode as the coding harness
- target Ubuntu 24 and other linux distros
- implement the project in TypeScript so that we can make use of the ACP TypeScript SDK and octokit/rest.js
- use octokit/rest.js to interact with GitHub in our daemon service
    - however, let coding agents use the `gh` CLI tool for github interaction
- create an OpenCode session for each task (for example, implementing an issue)
    - this allows us to manually restart the session at a later time
- use Agent Client Protocol (ACP) for communication with the agent, so that I can swap out the agent backend in the future
- the agent must use a custom agent definition in markdown (for example, see "Documentation Agent" on https://opencode.ai/docs/agents/), containing instructions to deal with work coming from GithHub (issue, pull request, etc)
    - the custom agent definition should describe in detail the process that the agent should follow to deal with the request. It is important that this agent definition contains a prompt that takes into account best practices for prompting coding agents.
    - you may add additional agent definitions, tool definitions (see https://opencode.ai/docs/custom-tools) or skill definitions (https://opencode.ai/docs/skills/) to support the workflow
- the main responsibility for our daemon service is to push state updates summarized as a useful context to our coding agent harness
    - the coding agent itself should use this context (project id, issue id, etc.) to post updates to GitHub autonomously, by relying on a suitable SKILL.md file [skill example](../opencode/.opencode/skills/github-cli/SKILL.md)
- as much as possible, keep the agent and coding logic inside agent and skill definitions
    -  Use our daemon service code mainly for connecting Agent Harness <-> GitHub

Features:
- see features implemented in [github agent orchestrator in python](../gh-orchestrator/src/gh-orchestrator)
    - inspect this implementation for the features only, not for the logic
    - Configuration file illustrating configurable features: /home/lkoel/code/agents-config/gh-orchestrator/config/gh-orchestrator-config.example.yaml
- transparent logging (preferably through systemctl/systemd integration)
- monitor github by checking the project state at fixed intervals
- ask for user approval: only let agents execute when issue are appropriately labeled, or triggered by keywords in issue comments
- intelligently fetch the GitHub project state, taking into account rate limits (don't fetch the entire project state with each status check)
- example workflow
    - implement an feature request or bugfix described in an issue and submit a PR
        - by default, let the agent write a plan first and submit it for approval by posting a comment in the issue thread
    - refine a high-level feature request or epic into sub-tasks, and add them back to github
        - when an issue is refined / subdivided: use appropriate tagging and labeling to keep track of the 'master' issue or epic, and sub-issues or tasks


Resources (decide yourself which ones to consult):
- [GitHub REST API client for JavaScript: octokit/rest.js](https://github.com/octokit/rest.js)
    - documentation: https://octokit.github.io/rest.js/v22/
- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/architecture)
- [ACP: protocol](https://agentclientprotocol.com/protocol/overview)
    - https://agentclientprotocol.com/protocol/session-setup
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- [OpenCode docs: ACP support](https://opencode.ai/docs/acp/)
