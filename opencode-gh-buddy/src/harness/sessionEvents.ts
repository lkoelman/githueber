import type { SessionInteractionEvent } from "../models/types.ts";

type SessionEventWriter = (chunk: string) => void;

const ANSI_RESET = "\x1b[0m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_GREEN = "\x1b[32m";

function formatScope(event: SessionInteractionEvent): string {
  const segments = [];

  if (event.repositoryKey && event.issueNumber !== undefined) {
    segments.push(`${event.repositoryKey}#${event.issueNumber}`);
  }

  if (event.sessionId) {
    segments.push(event.sessionId);
  }

  return segments.length > 0 ? ` [${segments.join(" ")}]` : "";
}

function formatMessage(event: SessionInteractionEvent): string {
  return event.message ? ` ${JSON.stringify(event.message)}` : "";
}

/** Formats session interaction events for terminal echo and future IPC subscribers. */
export function formatSessionInteractionEvent(event: SessionInteractionEvent): string {
  return `${event.timestamp} ${event.direction} ${event.kind}${formatScope(event)}${formatMessage(event)}`;
}

function colorizeSessionInteractionEvent(line: string, event: SessionInteractionEvent): string {
  if (event.direction === "OUTBOUND" && event.kind === "PROMPT_SENT") {
    return `${ANSI_BLUE}${line}${ANSI_RESET}`;
  }

  if (event.direction === "INBOUND") {
    return `${ANSI_GREEN}${line}${ANSI_RESET}`;
  }

  return line;
}

/** Builds a console-oriented sink for session interaction events. */
export function createSessionEventEchoListener(
  write: SessionEventWriter = (chunk) => process.stdout.write(chunk)
): (event: SessionInteractionEvent) => void {
  return (event) => {
    write(`${colorizeSessionInteractionEvent(formatSessionInteractionEvent(event), event)}\n`);
  };
}
