Here are additional modifications required to transition the project from Node/npm to Bun.

### Idiomatic Bun IPC Server

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