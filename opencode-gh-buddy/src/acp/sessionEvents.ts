import type { SessionInteractionEvent } from "../models/types.ts";

type SessionEventWriter = (chunk: string) => void;

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

/** Builds a console-oriented sink for session interaction events. */
export function createSessionEventEchoListener(
  write: SessionEventWriter = (chunk) => process.stdout.write(chunk)
): (event: SessionInteractionEvent) => void {
  return (event) => {
    write(`${formatSessionInteractionEvent(event)}\n`);
  };
}
