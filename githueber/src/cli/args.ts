import type { HarnessName, IPCRequest } from "../models/types.ts";

export type CliCommand =
  | { kind: "START_DAEMON"; verbose: boolean; echo: boolean; harness?: HarnessName }
  | { kind: "IPC"; verbose: boolean; request: IPCRequest };

/** Validates a CLI harness flag value. */
function parseHarnessFlag(value: string | undefined): HarnessName {
  if (value === "opencode" || value === "codex") {
    return value;
  }

  throw new Error(`Unsupported harness: ${value ?? "(missing)"}. Supported harnesses: opencode, codex`);
}

/** Parses shell arguments into either a daemon-start action or a concrete IPC request. */
export function parseCliArgs(argv: string[]): CliCommand {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const echo = argv.includes("--echo");
  const harnessFlagIndex = argv.indexOf("--harness");
  const harness =
    harnessFlagIndex === -1 ? undefined : parseHarnessFlag(argv[harnessFlagIndex + 1]);
  const args = argv.filter((arg, index) =>
    arg !== "--verbose" &&
    arg !== "-v" &&
    arg !== "--echo" &&
    arg !== "--harness" &&
    (harnessFlagIndex === -1 || index !== harnessFlagIndex + 1)
  );

  const [command, ...rest] = args;

  if (echo && command !== "start") {
    throw new Error("--echo can only be used with the start command");
  }
  if (harness !== undefined && command !== "start") {
    throw new Error("--harness can only be used with the start command");
  }

  switch (command) {
    case "start":
      return { kind: "START_DAEMON", verbose, echo, harness };
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
