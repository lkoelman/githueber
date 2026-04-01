#!/usr/bin/env /home/lkoel/.bun/bin/bun
import net from "node:net";
import { parseCliArgs } from "./args.ts";
import type { IPCResponse } from "../models/types.ts";

function formatUsage(): string {
  return [
    "Usage:",
    "  gh-buddy sessions",
    "  gh-buddy stop <sessionId>",
    "  gh-buddy poll",
    "  gh-buddy config <key> <value>"
  ].join("\n");
}

function sendCommand(socketPath: string, request: object): Promise<IPCResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ path: socketPath }, () => {
      client.write(JSON.stringify(request));
    });

    client.on("data", (data) => {
      const parsed = JSON.parse(data.toString()) as IPCResponse & { error?: string };
      client.end();
      if (parsed.error) {
        reject(new Error(parsed.error));
        return;
      }
      resolve(parsed);
    });

    client.on("error", (error) => {
      reject(error);
    });
  });
}

async function main(): Promise<void> {
  const socketPath = process.env.GH_BUDDY_SOCKET_PATH ?? "/tmp/opencode-gh-buddy.sock";

  if (process.argv.length <= 2) {
    console.log(formatUsage());
    process.exit(1);
  }

  try {
    const request = parseCliArgs(process.argv.slice(2));
    const response = await sendCommand(socketPath, request);

    if (response.data) {
      console.log(JSON.stringify(response.data, null, 2));
      return;
    }

    if (response.message) {
      console.log(response.message);
    }
  } catch (error: any) {
    console.error(error.message);
    console.log(formatUsage());
    process.exit(1);
  }
}

void main();
