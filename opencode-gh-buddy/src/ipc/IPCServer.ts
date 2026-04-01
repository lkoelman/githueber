import { chmodSync, existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import { handleIPCCommand } from "./handler.ts";
import { logger } from "../utils/logger.ts";
import type { IPCCommandTarget, } from "./handler.ts";

export class IPCServer {
  private server?: net.Server;

  constructor(
    private readonly socketPath: string,
    private readonly target: IPCCommandTarget
  ) {}

  start(): void {
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    this.server = net.createServer((socket) => {
      socket.on("data", async (data) => {
        try {
          const request = JSON.parse(data.toString());
          const response = await handleIPCCommand(this.target, request);
          socket.write(`${JSON.stringify(response)}\n`);
        } catch (error: any) {
          socket.write(`${JSON.stringify({ error: error.message })}\n`);
        }
      });
    });

    this.server.listen(this.socketPath, () => {
      chmodSync(this.socketPath, 0o660);
      logger.info("IPC server listening", { socketPath: this.socketPath });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
  }
}
