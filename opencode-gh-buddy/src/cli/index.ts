#!/usr/bin/env /home/lkoel/.bun/bin/bun
import net from "node:net";
import { parseCliArgs } from "./args.ts";
import type { IPCResponse, ManualPollSummary } from "../models/types.ts";
import { startDaemon } from "../startDaemon.ts";

function formatUsage(): string {
  return [
    "Usage:",
    "  gbr [--verbose|-v] start",
    "  gbr [--verbose|-v] sessions",
    "  gbr [--verbose|-v] stop <sessionId>",
    "  gbr [--verbose|-v] poll",
    "  gbr [--verbose|-v] config <key> <value>"
  ].join("\n");
}

export function formatCliError(error: unknown, verbose: boolean): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (verbose) {
    return error.stack ?? error.message;
  }

  return error.message;
}

export function formatManualPollSummary(summary: ManualPollSummary): string {
  const lines = ["Manual poll completed."];

  for (const repository of summary.repositories) {
    lines.push(`Repository ${repository.repositoryKey}`);
    lines.push(
      repository.fetchedIssues.length > 0
        ? `  Fetched issues: ${repository.fetchedIssues
            .map((issue) => `#${issue.issueNumber} ${issue.title}`)
            .join("; ")}`
        : "  Fetched issues: none"
    );
    lines.push(
      repository.dispatchedIssues.length > 0
        ? `  Dispatched: ${repository.dispatchedIssues
            .map((issue) =>
              `#${issue.issueNumber} ${issue.title} -> ${issue.action}${
                issue.agentName ? ` (${issue.agentName})` : ""
              }`
            )
            .join("; ")}`
        : "  Dispatched: none"
    );
  }

  return lines.join("\n");
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
    const command = parseCliArgs(process.argv.slice(2));

    if (command.kind === "START_DAEMON") {
      await startDaemon();
      return;
    }

    const response = await sendCommand(socketPath, command.request);

    if (command.request.command === "TRIGGER_POLL" && response.data) {
      console.log(formatManualPollSummary(response.data as ManualPollSummary));
      return;
    }

    if (response.data) {
      console.log(JSON.stringify(response.data, null, 2));
      return;
    }

    if (response.message) {
      console.log(response.message);
    }
  } catch (error: unknown) {
    const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
    console.error(formatCliError(error, verbose));
    console.log(formatUsage());
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
