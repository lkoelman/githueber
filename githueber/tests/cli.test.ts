import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../src/cli/args.ts";
import { formatCliError } from "../src/cli/index.ts";

describe("parseCliArgs", () => {
  test("builds start daemon command", () => {
    expect(parseCliArgs(["start"])).toEqual({
      kind: "START_DAEMON",
      echo: false,
      harness: undefined,
      verbose: false
    });
  });

  test("accepts verbose flag before the command", () => {
    expect(parseCliArgs(["--verbose", "start"])).toEqual({
      kind: "START_DAEMON",
      echo: false,
      harness: undefined,
      verbose: true
    });
  });

  test("builds start daemon command with echo enabled", () => {
    expect(parseCliArgs(["start", "--echo"])).toEqual({
      kind: "START_DAEMON",
      echo: true,
      harness: undefined,
      verbose: false
    });
  });

  test("accepts echo flag before the command", () => {
    expect(parseCliArgs(["--echo", "start"])).toEqual({
      kind: "START_DAEMON",
      echo: true,
      harness: undefined,
      verbose: false
    });
  });

  test("accepts a harness override for daemon startup", () => {
    expect(parseCliArgs(["start", "--harness", "codex"])).toEqual({
      kind: "START_DAEMON",
      echo: false,
      harness: "codex",
      verbose: false
    });
  });

  test("accepts a harness override before the command", () => {
    expect(parseCliArgs(["--harness", "opencode", "start"])).toEqual({
      kind: "START_DAEMON",
      echo: false,
      harness: "opencode",
      verbose: false
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

  test("builds harness install request", () => {
    expect(parseCliArgs(["harness-install", "codex"])).toEqual({
      kind: "INSTALL_HARNESS",
      harness: "codex",
      verbose: false
    });
  });

  test("accepts verbose flag with harness install", () => {
    expect(parseCliArgs(["--verbose", "harness-install", "gemini"])).toEqual({
      kind: "INSTALL_HARNESS",
      harness: "gemini",
      verbose: true
    });
  });

  test("rejects echo outside the start command", () => {
    expect(() => parseCliArgs(["sessions", "--echo"])).toThrow(
      "--echo can only be used with the start command"
    );
  });

  test("rejects harness outside the start command", () => {
    expect(() => parseCliArgs(["sessions", "--harness", "codex"])).toThrow(
      "--harness can only be used with the start command"
    );
  });

  test("rejects unknown harness names", () => {
    expect(() => parseCliArgs(["start", "--harness", "other"])).toThrow(
      "Unsupported harness: other. Supported harnesses: opencode, codex"
    );
  });

  test("rejects harness install without a harness name", () => {
    expect(() => parseCliArgs(["harness-install"])).toThrow(
      "Usage: gbr harness-install <opencode|codex|claude|gemini>"
    );
  });

  test("rejects unknown harness install names", () => {
    expect(() => parseCliArgs(["harness-install", "other"])).toThrow(
      "Unsupported install harness: other. Supported harnesses: opencode, codex, claude, gemini"
    );
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
