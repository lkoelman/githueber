import type { IPCRequest } from "../models/types.ts";

export function parseCliArgs(argv: string[]): IPCRequest {
  const [command, ...rest] = argv;

  switch (command) {
    case "sessions":
      return { command: "LIST_SESSIONS", payload: {} };
    case "stop":
      if (!rest[0]) {
        throw new Error("Missing session id");
      }
      return { command: "STOP_SESSION", payload: { sessionId: rest[0] } };
    case "poll":
      return { command: "TRIGGER_POLL", payload: {} };
    case "config":
      if (!rest[0] || rest[1] === undefined) {
        throw new Error("Usage: gh-buddy config <key> <value>");
      }
      return {
        command: "SET_CONFIG",
        payload: {
          key: rest[0],
          value: /^\d+$/.test(rest[1]) ? Number(rest[1]) : rest[1]
        }
      };
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
}
