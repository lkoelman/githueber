import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../src/cli/args.ts";
import { formatCliError } from "../src/cli/index.ts";

describe("parseCliArgs", () => {
  test("builds start daemon command", () => {
    expect(parseCliArgs(["start"])).toEqual({
      kind: "START_DAEMON",
      verbose: false
    });
  });

  test("accepts verbose flag before the command", () => {
    expect(parseCliArgs(["--verbose", "start"])).toEqual({
      kind: "START_DAEMON",
      verbose: true
    });
  });

  test("accepts short verbose flag before the command", () => {
    expect(parseCliArgs(["-v", "sessions"])).toEqual({
      kind: "IPC",
      verbose: true,
      request: {
        command: "LIST_SESSIONS",
        payload: {}
      }
    });
  });

  test("accepts verbose flag after the command", () => {
    expect(parseCliArgs(["sessions", "--verbose"])).toEqual({
      kind: "IPC",
      verbose: true,
      request: {
        command: "LIST_SESSIONS",
        payload: {}
      }
    });
  });

  test("builds list sessions request", () => {
    expect(parseCliArgs(["sessions"])).toEqual({
      kind: "IPC",
      verbose: false,
      request: {
        command: "LIST_SESSIONS",
        payload: {}
      }
    });
  });

  test("builds stop session request", () => {
    expect(parseCliArgs(["stop", "abc123"])).toEqual({
      kind: "IPC",
      verbose: false,
      request: {
        command: "STOP_SESSION",
        payload: { sessionId: "abc123" }
      }
    });
  });

  test("builds trigger poll request", () => {
    expect(parseCliArgs(["poll"])).toEqual({
      kind: "IPC",
      verbose: false,
      request: {
        command: "TRIGGER_POLL",
        payload: {}
      }
    });
  });
});

describe("formatCliError", () => {
  test("prints only the message by default", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at line 1";

    expect(formatCliError(error, false)).toBe("boom");
  });

  test("prints the full stack trace in verbose mode", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at line 1";

    expect(formatCliError(error, true)).toBe("Error: boom\n    at line 1");
  });
});
