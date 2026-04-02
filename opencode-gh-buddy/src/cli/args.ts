import type { IPCRequest } from "../models/types.ts";

export type CliCommand =
  | { kind: "START_DAEMON"; verbose: boolean }
  | { kind: "IPC"; verbose: boolean; request: IPCRequest };

export function parseCliArgs(argv: string[]): CliCommand {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const args = argv.filter((arg) => arg !== "--verbose" && arg !== "-v");

  const [command, ...rest] = args;

  switch (command) {
    case "start":
      return { kind: "START_DAEMON", verbose };
    case "sessions":
      return { kind: "IPC", verbose, request: { command: "LIST_SESSIONS", payload: {} } };
    case "stop":
      if (!rest[0]) {
        throw new Error("Missing session id");
      }
      return {
        kind: "IPC",
        verbose,
        request: { command: "STOP_SESSION", payload: { sessionId: rest[0] } }
      };
    case "poll":
      return { kind: "IPC", verbose, request: { command: "TRIGGER_POLL", payload: {} } };
    case "config":
      if (!rest[0] || rest[1] === undefined) {
        throw new Error("Usage: gbr config <key> <value>");
      }
      return {
        kind: "IPC",
        verbose,
        request: {
          command: "SET_CONFIG",
          payload: {
            key: rest[0],
            value: /^\d+$/.test(rest[1]) ? Number(rest[1]) : rest[1]
          }
        }
      };
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
}
