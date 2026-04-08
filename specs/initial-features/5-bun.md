Switching to **Bun** is an excellent choice for a daemon like this. It natively executes TypeScript, dramatically speeds up module resolution and package installation, and can even bundle the entire project into a standalone executable.

Here are the specific modifications required to transition the project from Node/npm to Bun.

### 1. Updated `package.json`

Bun can run TypeScript files directly without needing `tsc`, but for a production daemon, we will use `bun build` to bundle everything into an optimized file. We also update the `bin` entry and the `scripts`.

```json
{
  "name": "gh-daemon-service",
  "version": "1.0.0",
  "bin": {
    "gh-daemon": "./dist/cli.js"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "build": "bun build ./src/index.ts --target=bun --outfile=dist/index.js",
    "build:cli": "bun build ./src/cli/index.ts --target=bun --outfile=dist/cli.js",
    "build:all": "bun run build && bun run build:cli"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "winston": "^3.11.0",
    "@octokit/rest": "^20.0.0",
    "@agentclientprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/bun": "^1.0.0"
  }
}
```

### 2. Modified CLI Entry Point (`src/cli/index.ts`)

Because you want the CLI to be executed directly from the terminal (e.g., typing `gh-daemon sessions`), we need to add the Bun shebang at the very top of the CLI file.

```typescript
#!/usr/bin/env bun
// src/cli/index.ts
import { Command } from 'commander';
import net from 'net'; // Bun fully supports Node's net module natively

// ... (Rest of the CLI code remains exactly the same)
```

### 3. Updated Systemd Service (`systemd/gh-daemon.service`)

You must provide the absolute path to the `bun` executable in `ExecStart`. Note that `bun` is usually installed in `~/.bun/bin/bun` for a specific user. For a system daemon, it's best to create a symlink in `/usr/local/bin/` or `/usr/bin/`.

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

# Point directly to the bun executable and run the bundled JS
ExecStart=/usr/local/bin/bun run /opt/gh-daemon/dist/index.js

Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/gh-daemon/.env

# Security measures
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### 4. Updated Installation Script (`scripts/install.sh`)

We replace `npm` commands with `bun` commands. Bun is significantly faster, so this installation will be near-instant.

```bash
#!/bin/bash
echo "Installing gh-daemon service with Bun..."

# Ensure bun is available system-wide (assuming it's installed for the current user)
if [ ! -f /usr/local/bin/bun ]; then
    sudo ln -s $(which bun) /usr/local/bin/bun
fi

# Install dependencies and build bundles
bun install
bun run build:all

# Setup daemon directory
sudo mkdir -p /opt/gh-daemon
sudo cp -r dist package.json config /opt/gh-daemon/
cd /opt/gh-daemon && sudo bun install --production

# Setup systemd
sudo cp systemd/gh-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gh-daemon
sudo systemctl start gh-daemon

echo "Done! View logs with: journalctl -u gh-daemon -f"
```

### 5. (Optional) Idiomatic Bun IPC Server

While Node's `net` module works perfectly fine in Bun (as written in the original `IPCServer.ts`), Bun actually has a faster, native way to handle Unix Domain Sockets using `Bun.listen`.

If you want to fully embrace the Bun runtime for the IPC Server, you can rewrite `src/ipc/IPCServer.ts` like this:

```typescript
// src/ipc/IPCServer.ts
import fs from 'fs';
import { DaemonCore } from '../daemon';
import { logger } from '../utils/logger';

const SOCKET_PATH = '/tmp/gh-daemon.sock';

export class IPCServer {
    private server: any;

    constructor(private daemon: DaemonCore) {}

    public start() {
        if (fs.existsSync(SOCKET_PATH)) {
            fs.unlinkSync(SOCKET_PATH);
        }

        // Native Bun TCP/Unix socket server
        this.server = Bun.listen({
            unix: SOCKET_PATH,
            socket: {
                data: async (socket, data) => {
                    try {
                        const req = JSON.parse(data.toString());
                        const response = await this.handleCommand(req);
                        socket.write(JSON.stringify(response) + '\n');
                    } catch (e: any) {
                        socket.write(JSON.stringify({ error: e.message }) + '\n');
                    }
                },
                error: (socket, error) => {
                    logger.error(`IPC Socket Error: ${error.message}`);
                }
            }
        });

        // Ensure the CLI user can write to the socket
        fs.chmodSync(SOCKET_PATH, '0660');
        logger.info(`Bun IPC Server listening on ${SOCKET_PATH}`);
    }

    private async handleCommand(req: any) {
        // ... (Same logic as before)
    }
}
```