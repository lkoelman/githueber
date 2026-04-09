import { describe, expect, test } from "bun:test";
import { createSessionEventEchoListener } from "../src/sessionManager/sessionEvents.ts";
import type { SessionInteractionEvent } from "../src/models/types.ts";

const baseEvent: SessionInteractionEvent = {
  timestamp: "2026-04-07T00:00:00.000Z",
  sessionId: "ses_123",
  repositoryKey: "frontend",
  issueNumber: 42,
  agentName: "github-worker-agent",
  direction: "CONTROL",
  kind: "SESSION_STARTED"
};

describe("createSessionEventEchoListener", () => {
  test("renders outbound prompts in blue", () => {
    let output = "";
    const listener = createSessionEventEchoListener((chunk) => {
      output += chunk;
    });

    listener({
      ...baseEvent,
      direction: "OUTBOUND",
      kind: "PROMPT_SENT",
      message: "Start working on the task."
    });

    expect(output).toContain("\x1b[34m");
    expect(output).toContain("\x1b[0m");
  });

  test("renders inbound agent events in green", () => {
    let output = "";
    const listener = createSessionEventEchoListener((chunk) => {
      output += chunk;
    });

    listener({
      ...baseEvent,
      direction: "INBOUND",
      kind: "SESSION_PAUSED"
    });

    expect(output).toContain("\x1b[32m");
    expect(output).toContain("\x1b[0m");
  });

  test("leaves control events uncolored", () => {
    let output = "";
    const listener = createSessionEventEchoListener((chunk) => {
      output += chunk;
    });

    listener(baseEvent);

    expect(output).not.toContain("\x1b[34m");
    expect(output).not.toContain("\x1b[32m");
  });

  test("streams inbound assistant deltas as green text and closes the line before lifecycle events", () => {
    let output = "";
    const listener = createSessionEventEchoListener((chunk) => {
      output += chunk;
    });

    listener({
      ...baseEvent,
      direction: "INBOUND",
      kind: "MESSAGE_DELTA",
      message: "Working"
    });
    listener({
      ...baseEvent,
      direction: "INBOUND",
      kind: "MESSAGE_DELTA",
      message: " on it."
    });
    listener({
      ...baseEvent,
      direction: "INBOUND",
      kind: "SESSION_COMPLETED"
    });

    const plainTextOutput = output.replace(/\x1b\[[0-9;]*m/g, "");

    expect(output).toContain("\x1b[32m");
    expect(plainTextOutput).toContain("Working on it.");
    expect(plainTextOutput).toContain("SESSION_COMPLETED");
    expect(plainTextOutput).toContain("Working on it.\n");
    expect(output).not.toContain('MESSAGE_DELTA [frontend#42 ses_123] "Working"');
  });
});
