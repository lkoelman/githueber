import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../src/cli/args.ts";

describe("parseCliArgs", () => {
  test("builds list sessions request", () => {
    expect(parseCliArgs(["sessions"])).toEqual({
      command: "LIST_SESSIONS",
      payload: {}
    });
  });

  test("builds stop session request", () => {
    expect(parseCliArgs(["stop", "abc123"])).toEqual({
      command: "STOP_SESSION",
      payload: { sessionId: "abc123" }
    });
  });

  test("builds trigger poll request", () => {
    expect(parseCliArgs(["poll"])).toEqual({
      command: "TRIGGER_POLL",
      payload: {}
    });
  });
});
