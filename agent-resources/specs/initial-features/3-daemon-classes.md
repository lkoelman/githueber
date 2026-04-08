Here is the implementation plan for the TypeScript Daemon. We will start with the project layout, followed by the core interfaces and class stubs that define the control flow.

### 1. Project Layout

A standard, modular Node.js/TypeScript project structure. We separate the GitHub API logic, the deterministic routing logic, and the ACP communication logic.

```text
gh-daemon-service/
├── package.json
├── tsconfig.json
├── config/
│   └── gh-orchestrator-config.yaml    # The YAML configuration file
├── src/
│   ├── index.ts                       # Entry point: initializes and starts the daemon
│   ├── daemon.ts                      # Core orchestrator tying Poller, Router, and ACP together
│   ├── config/
│   │   └── ConfigManager.ts           # Parses and validates the YAML config
│   ├── github/
│   │   └── GitHubPoller.ts            # Wraps Octokit, handles rate-limiting, ETags, and polling
│   ├── router/
│   │   └── StateRouter.ts             # Deterministic logic: maps GH state to Agent actions
│   ├── acp/
│   │   └── ACPSessionManager.ts       # Wraps ACP TypeScript SDK, manages OpenCode sessions
│   ├── models/
│   │   └── types.ts                   # Shared TypeScript interfaces (IssueState, RoutingRule, etc.)
│   └── utils/
│       └── logger.ts                  # Systemd-friendly transparent logging (e.g., Winston/Pino)
└── systemd/
    └── gh-daemon.service              # systemd unit file for running as a persistent daemon
```

---

### 2. Core Interfaces (`src/models/types.ts`)

First, we define the data structures that flow through the system.

```typescript
// src/models/types.ts

export type GitHubIssue = {
    id: number;
    number: number;
    title: string;
    body: string;
    labels: string[];
    state: 'open' | 'closed';
    updatedAt: string;
};

export type TaskAction = 'START_SESSION' | 'RESUME_APPROVED' | 'RESUME_REVISED' | 'IGNORE';

export interface RouteDecision {
    action: TaskAction;
    agentName?: string;         // e.g., 'github-worker-agent'
    promptContext?: string;     // The synthesized prompt for the agent
    acpSessionId?: string;      // If interacting with an existing session
}

export interface AgentSessionRecord {
    sessionId: string;
    issueNumber: number;
    status: 'INITIALIZING' | 'RUNNING' | 'PAUSED_AWAITING_APPROVAL' | 'COMPLETED';
    agentName: string;
}
```

---

### 3. Class Stubs & Implementation Plan

#### A. The Config Manager (`src/config/ConfigManager.ts`)
Responsible for loading the user's YAML file and providing strongly-typed configuration to the rest of the app.

```typescript
import * as yaml from 'yaml';
import * as fs from 'fs';

export class ConfigManager {
    private config: any;

    constructor(configPath: string) {
        const file = fs.readFileSync(configPath, 'utf8');
        this.config = yaml.parse(file);
    }

    getGitHubToken(): string { /* ... */ }
    getRepoOwner(): string { /* ... */ }
    getRepoName(): string { /* ... */ }
    getPollingIntervalMs(): number { /* ... */ }
    // Retrieves mapping of labels to agent names
    getAgentRoutingRules(): Array<{ label: string, agent: string }> { /* ... */ }
}
```

#### B. The GitHub Poller (`src/github/GitHubPoller.ts`)
This class uses `@octokit/rest`. To respect rate limits, it relies heavily on the `If-None-Match` (ETag) or `If-Modified-Since` headers. It acts as an `EventEmitter` to notify the daemon of changes.

```typescript
import { Octokit } from '@octokit/rest';
import { EventEmitter } from 'events';
import { GitHubIssue } from '../models/types';

export class GitHubPoller extends EventEmitter {
    private octokit: Octokit;
    private lastEtag: string | null = null;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(token: string, private owner: string, private repo: string) {
        super();
        this.octokit = new Octokit({ auth: token });
    }

    public start(intervalMs: number) {
        this.intervalId = setInterval(() => this.poll(), intervalMs);
    }

    public stop() { /* clear interval */ }

    private async poll() {
        try {
            // Use ETags to only fetch if the issue list has changed
            const response = await this.octokit.issues.listForRepo({
                owner: this.owner,
                repo: this.repo,
                state: 'open',
                headers: this.lastEtag ? { 'If-None-Match': this.lastEtag } : {}
            });

            this.lastEtag = response.headers.etag || null;

            if (response.status === 200) {
                const issues = response.data;
                // Compare with local cache, emit events for changes
                this.emit('issuesUpdated', issues);
            }
        } catch (error: any) {
            if (error.status === 304) {
                // 304 Not Modified - Rate limit friendly, do nothing
                return;
            }
            // Handle actual errors
        }
    }

    // Helper method used by the Daemon to update labels
    public async updateIssueLabel(issueNumber: number, newLabel: string, removeLabel?: string) {
        // Octokit logic to add newLabel and optionally remove old label
    }
}
```

#### C. The State Router (`src/router/StateRouter.ts`)
This is the purely deterministic brain of the daemon. It looks at an issue's labels, comments, and the current active sessions, and decides what ACP action needs to be taken.

```typescript
import { GitHubIssue, RouteDecision, AgentSessionRecord } from '../models/types';
import { ConfigManager } from '../config/ConfigManager';

export class StateRouter {
    constructor(private config: ConfigManager) {}

    public evaluateIssueState(
        issue: GitHubIssue,
        latestComment: string | null,
        activeSession?: AgentSessionRecord
    ): RouteDecision {

        // 1. Check for pending approvals on active sessions
        if (issue.labels.includes('await-plan') && activeSession) {
            if (latestComment?.startsWith('/approve')) {
                return { action: 'RESUME_APPROVED', acpSessionId: activeSession.sessionId };
            }
            if (latestComment?.startsWith('/revise')) {
                return {
                    action: 'RESUME_REVISED',
                    acpSessionId: activeSession.sessionId,
                    promptContext: latestComment
                };
            }
            return { action: 'IGNORE' }; // Still waiting for user
        }

        // 2. Check for new work
        if (issue.labels.includes('agent-queue') && !activeSession) {
            const rules = this.config.getAgentRoutingRules();

            // Map the issue label to the correct markdown agent definition
            const matchedRule = rules.find(r => issue.labels.includes(r.label));

            if (matchedRule) {
                return {
                    action: 'START_SESSION',
                    agentName: matchedRule.agent, // e.g., 'github-orchestrator-agent.md'
                    promptContext: `ISSUE #${issue.number}: ${issue.title}\n\n${issue.body}`
                };
            }
        }

        return { action: 'IGNORE' };
    }
}
```

#### D. The ACP Session Manager (`src/acp/ACPSessionManager.ts`)
This uses the `@agentclientprotocol/sdk` to talk to the OpenCode harness.

```typescript
import { Client } from '@agentclientprotocol/sdk'; // Hypothetical TS SDK import
import { AgentSessionRecord } from '../models/types';

export class ACPSessionManager {
    private acpClient: Client;
    private activeSessions: Map<number, AgentSessionRecord> = new Map(); // issueNumber -> Session

    constructor(acpEndpoint: string) {
        this.acpClient = new Client({ url: acpEndpoint });
    }

    public async initialize() {
        await this.acpClient.connect();
    }

    public getSessionForIssue(issueNumber: number): AgentSessionRecord | undefined {
        return this.activeSessions.get(issueNumber);
    }

    public async startNewSession(issueNumber: number, agentName: string, contextPrompt: string): Promise<void> {
        // Call ACP to start a session with the specific agent definition
        const session = await this.acpClient.createSession({
            agentDefinition: agentName,
            initialPrompt: contextPrompt
        });

        this.activeSessions.set(issueNumber, {
            sessionId: session.id,
            issueNumber: issueNumber,
            agentName: agentName,
            status: 'RUNNING'
        });
    }

    public async sendMessageToSession(sessionId: string, message: string): Promise<void> {
        await this.acpClient.sendMessage(sessionId, { text: message });
    }

    // Listeners for ACP events (e.g., when the agent pauses or completes)
    public onSessionPaused(callback: (sessionId: string) => void) { /* ... */ }
    public onSessionCompleted(callback: (sessionId: string) => void) { /* ... */ }
}
```

#### E. The Daemon Core (`src/daemon.ts`)
This ties everything together. It subscribes to the poller, uses the router to make decisions, and commands the ACP manager.

```typescript
import { GitHubPoller } from './github/GitHubPoller';
import { StateRouter } from './router/StateRouter';
import { ACPSessionManager } from './acp/ACPSessionManager';
import { ConfigManager } from './config/ConfigManager';

export class DaemonCore {
    constructor(
        private poller: GitHubPoller,
        private router: StateRouter,
        private acpManager: ACPSessionManager,
        private config: ConfigManager
    ) {
        this.setupEventBindings();
    }

    private setupEventBindings() {
        this.poller.on('issuesUpdated', async (issues) => {
            for (const issue of issues) {
                await this.processIssue(issue);
            }
        });

        // Listen for agent state changes from OpenCode via ACP
        this.acpManager.onSessionPaused(async (sessionId) => {
            // Update GitHub label to 'await-plan' via Poller
        });
    }

    private async processIssue(issue: any) {
        // 1. Get active session if it exists
        const activeSession = this.acpManager.getSessionForIssue(issue.number);

        // 2. Fetch latest comments if we are awaiting approval
        let latestComment = null;
        if (issue.labels.includes('await-plan')) {
            // (pseudo-code) latestComment = await this.poller.getLatestComment(issue.number);
        }

        // 3. Let the deterministic router decide what to do
        const decision = this.router.evaluateIssueState(issue, latestComment, activeSession);

        // 4. Execute decision
        switch (decision.action) {
            case 'START_SESSION':
                await this.acpManager.startNewSession(issue.number, decision.agentName!, decision.promptContext!);
                await this.poller.updateIssueLabel(issue.number, 'agent-processing', 'agent-queue');
                break;
            case 'RESUME_APPROVED':
                await this.acpManager.sendMessageToSession(decision.acpSessionId!, "User approved. Proceed.");
                await this.poller.updateIssueLabel(issue.number, 'agent-processing', 'await-plan');
                break;
            case 'RESUME_REVISED':
                await this.acpManager.sendMessageToSession(decision.acpSessionId!, `Revise plan: ${decision.promptContext}`);
                break;
            case 'IGNORE':
            default:
                break; // Do nothing
        }
    }

    public async start() {
        await this.acpManager.initialize();
        this.poller.start(this.config.getPollingIntervalMs());
        console.log("Daemon started. Monitoring GitHub...");
    }
}
```

With these interfaces, the separation of concerns is strict:
* The **GitHub** code only knows about HTTP and ETags.
* The **ACP** code only knows about WebSockets/RPC to OpenCode.
* The **Router** contains your business logic but NO side effects.
* The **Daemon** wires them together.
