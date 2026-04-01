Here is the implementation plan for the systemd scaffolding, robust logging, and the local CLI.

To make the CLI talk to the background daemon securely and efficiently, we will use a **Unix Domain Socket (UDS)** for Inter-Process Communication (IPC). This is the standard Linux approach (similar to how `docker` or `systemctl` work) and ensures only users with access to the socket file can control the daemon.

### 1. Robust Logging (Winston + Systemd)

Systemd's `journald` captures standard output and standard error automatically. The best practice is to output structured logs (JSON) or cleanly formatted text without timestamps (since `journald` adds its own timestamps). We will use `winston`.

```typescript
// src/utils/logger.ts
import winston from 'winston';

const isSystemd = process.env.INVOCATION_ID !== undefined; // systemd injects this

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    // If running under systemd, drop the timestamp and colors, let journald handle it
    format: isSystemd
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                return `[${timestamp}] ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            })
        ),
    transports: [
        new winston.transports.Console()
    ]
});
```

### 2. Systemd Service Scaffold

We define a standard `Type=simple` service. It will automatically restart on failure and load environment variables from a `.env` file.

```ini
# systemd/gh-daemon.service
[Unit]
Description=GitHub Agent Orchestrator Daemon
After=network.target

[Service]
Type=simple
User=ghdaemon
Group=ghdaemon
WorkingDirectory=/opt/gh-daemon
# Node needs to be in the path, or provide absolute path to node
ExecStart=/usr/bin/node /opt/gh-daemon/dist/index.js
Restart=on-failure
RestartSec=5
# Load secrets (GitHub Token, etc.) securely
EnvironmentFile=/etc/gh-daemon/.env

# Security measures
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Installation Script (`scripts/install.sh`):**
```bash
#!/bin/bash
echo "Installing gh-daemon service..."
npm run build
sudo mkdir -p /opt/gh-daemon
sudo cp -r dist package.json config /opt/gh-daemon/
cd /opt/gh-daemon && sudo npm install --production

sudo cp systemd/gh-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gh-daemon
sudo systemctl start gh-daemon
echo "Done! View logs with: journalctl -u gh-daemon -f"
```

### 3. IPC Control Server (Daemon Side)

The Daemon needs to listen for commands from our CLI. We will add an `IPCServer` class that creates a Unix Domain Socket (e.g., `/tmp/gh-daemon.sock`) and processes commands.

```typescript
// src/ipc/IPCServer.ts
import net from 'net';
import fs from 'fs';
import { DaemonCore } from '../daemon';
import { logger } from '../utils/logger';

const SOCKET_PATH = '/tmp/gh-daemon.sock';

export class IPCServer {
    private server: net.Server;

    constructor(private daemon: DaemonCore) {
        this.server = net.createServer((socket) => {
            socket.on('data', async (data) => {
                try {
                    const req = JSON.parse(data.toString());
                    const response = await this.handleCommand(req);
                    socket.write(JSON.stringify(response) + '\n');
                } catch (e: any) {
                    socket.write(JSON.stringify({ error: e.message }) + '\n');
                }
            });
        });
    }

    private async handleCommand(req: any) {
        logger.info(`Received CLI command: ${req.command}`, { payload: req.payload });
        switch (req.command) {
            case 'LIST_SESSIONS':
                return { status: 'ok', data: this.daemon.getActiveSessions() };
            case 'STOP_SESSION':
                await this.daemon.stopSession(req.payload.sessionId);
                return { status: 'ok', message: `Session ${req.payload.sessionId} stopped.` };
            case 'TRIGGER_POLL':
                await this.daemon.triggerManualPoll();
                return { status: 'ok', message: 'Manual poll triggered.' };
            case 'SET_CONFIG':
                this.daemon.updateConfig(req.payload.key, req.payload.value);
                return { status: 'ok', message: `Config ${req.payload.key} updated to ${req.payload.value}.` };
            default:
                throw new Error('Unknown command');
        }
    }

    public start() {
        if (fs.existsSync(SOCKET_PATH)) {
            fs.unlinkSync(SOCKET_PATH);
        }
        this.server.listen(SOCKET_PATH, () => {
            // Ensure the CLI user can write to the socket
            fs.chmodSync(SOCKET_PATH, '0660');
            logger.info(`IPC Server listening on ${SOCKET_PATH}`);
        });
    }
}
```

*Note: You would instantiate `IPCServer(this)` inside `DaemonCore.start()`.*

### 4. The CLI Tool (`gh-daemon-cli`)

We will use the `commander` library to build a clean CLI that connects to the IPC socket, sends a JSON payload, and prints the result.

```typescript
// src/cli/index.ts
import { Command } from 'commander';
import net from 'net';

const SOCKET_PATH = '/tmp/gh-daemon.sock';
const program = new Command();

program
  .name('gh-daemon-cli')
  .description('CLI to control the GitHub Agent Orchestrator Daemon')
  .version('1.0.0');

// Helper to send commands to the daemon
function sendCommand(command: string, payload: any = {}) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ path: SOCKET_PATH }, () => {
            client.write(JSON.stringify({ command, payload }));
        });

        client.on('data', (data) => {
            const response = JSON.parse(data.toString());
            client.end();
            if (response.error) reject(new Error(response.error));
            else resolve(response);
        });

        client.on('error', (err) => {
            console.error(`Failed to connect to daemon at ${SOCKET_PATH}. Is it running?`);
            reject(err);
        });
    });
}

// Command: List Sessions
program.command('sessions')
  .description('List all active agent sessions')
  .action(async () => {
      const res: any = await sendCommand('LIST_SESSIONS');
      console.table(res.data);
  });

// Command: Stop Session
program.command('stop <sessionId>')
  .description('Stop a specific agent session')
  .action(async (sessionId) => {
      const res: any = await sendCommand('STOP_SESSION', { sessionId });
      console.log(res.message);
  });

// Command: Trigger Poll
program.command('poll')
  .description('Manually trigger a GitHub state poll')
  .action(async () => {
      const res: any = await sendCommand('TRIGGER_POLL');
      console.log(res.message);
  });

// Command: Set Config
program.command('config <key> <value>')
  .description('Temporarily update a configuration value (e.g., pollInterval)')
  .action(async (key, value) => {
      // Basic type casting for numbers if applicable
      const parsedValue = isNaN(Number(value)) ? value : Number(value);
      const res: any = await sendCommand('SET_CONFIG', { key, value: parsedValue });
      console.log(res.message);
  });

program.parse(process.argv);
```

### 5. Updating `package.json`

To make the CLI easy to use globally on your system, you can map the bin command in your `package.json`:

```json
{
  "name": "gh-daemon-service",
  "version": "1.0.0",
  "bin": {
    "gh-daemon": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "winston": "^3.11.0",
    "@octokit/rest": "^20.0.0",
    "@agentclientprotocol/sdk": "^1.0.0"
  }
}
```

Once installed globally (`npm link` or `npm install -g .`), you can type `gh-daemon sessions` or `gh-daemon poll` from anywhere in your terminal, and it will interact smoothly with the background service logging directly into `journalctl`.