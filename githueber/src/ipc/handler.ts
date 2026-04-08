import type { IPCRequest, IPCResponse, ManualPollSummary } from "../models/types.ts";

export interface IPCCommandTarget {
  getActiveSessions(): unknown;
  stopSession(sessionId: string): Promise<void>;
  triggerManualPoll(): Promise<ManualPollSummary>;
  updateConfig(key: string, value: unknown): void;
}

/** Dispatches one parsed IPC request to the daemon-backed command target. */
export async function handleIPCCommand(
  target: IPCCommandTarget,
  request: IPCRequest
): Promise<IPCResponse> {
  switch (request.command) {
    case "LIST_SESSIONS":
      return { status: "ok", data: target.getActiveSessions() };
    case "STOP_SESSION":
      await target.stopSession(String(request.payload.sessionId));
      return { status: "ok", message: `Session ${String(request.payload.sessionId)} stopped.` };
    case "TRIGGER_POLL":
      return {
        status: "ok",
        message: "Manual poll completed.",
        data: await target.triggerManualPoll()
      };
    case "SET_CONFIG":
      target.updateConfig(String(request.payload.key), request.payload.value);
      return {
        status: "ok",
        message: `Config ${String(request.payload.key)} updated.`
      };
    default:
      throw new Error(`Unknown command: ${(request as { command: string }).command}`);
  }
}
