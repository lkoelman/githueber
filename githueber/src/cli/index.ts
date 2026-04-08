#!/usr/bin/env /home/lkoel/.bun/bin/bun
import net from "node:net";
import { parseCliArgs } from "./args.ts";
import type { IPCResponse, ManualPollSummary } from "../models/types.ts";
import { startDaemon } from "../startDaemon.ts";

/** Returns the CLI help text shared by normal usage and error paths. */
function formatUsage(): string {
  return [
    "Usage:",
    "  gbr [--verbose|-v] [--echo] [--harness <opencode|codex>] start",
    "  gbr [--verbose|-v] sessions",
    "  gbr [--verbose|-v] stop <sessionId>",
    "  gbr [--verbose|-v] poll",
    "  gbr [--verbose|-v] config <key> <value>"
  ].join("\n");
}

/** Formats CLI failures tersely by default, with optional stack traces for verbose mode. */
export function formatCliError(error: unknown, verbose: boolean): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (verbose) {
    return error.stack ?? error.message;
  }

  return error.message;
}

/** Renders the daemon's repository-by-repository manual poll result for terminal output. */
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

/** Sends a single JSON IPC request to the daemon and resolves with the parsed response payload. */
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

/** Entry point for the operator CLI, covering both daemon startup and IPC commands. */
async function main(): Promise<void> {
  const socketPath = process.env.GITHUBER_SOCKET_PATH ?? "/tmp/githueber.sock";

  if (process.argv.length <= 2) {
    console.log(formatUsage());
    process.exit(1);
  }

  try {
    const command = parseCliArgs(process.argv.slice(2));

    if (command.kind === "START_DAEMON") {
      await startDaemon({
        echoSessionEvents: command.echo,
        harnessOverride: command.harness
      });
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
