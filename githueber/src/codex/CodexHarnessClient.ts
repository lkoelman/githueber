import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import type {
  HarnessClientLike,
  HarnessMessagePayload,
  HarnessSessionStartRequest
} from "../models/types.ts";
import type { ClientRequest } from "./generated/ClientRequest";
import type { InitializeParams } from "./generated/InitializeParams";
import type { ServerNotification } from "./generated/ServerNotification";
import type { ServerRequest } from "./generated/ServerRequest";
import type { CodexConfig } from "../models/types.ts";
import type { ThreadStartParams } from "./generated/v2/ThreadStartParams";
import type { TurnInterruptParams } from "./generated/v2/TurnInterruptParams";
import type { TurnStartParams } from "./generated/v2/TurnStartParams";
import type { TurnSteerParams } from "./generated/v2/TurnSteerParams";

interface ChildProcessLike {
  stdin: Writable & { write(chunk: string): boolean };
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): boolean;
}

type SpawnLike = (command: string, args: string[], options: { stdio: ["pipe", "pipe", "pipe"] }) => ChildProcessLike;
type RequestId = number | string;

interface PendingRequest {
  id: RequestId;
  method: ServerRequest["method"];
  params: ServerRequest["params"];
}

interface SessionRuntime {
  process: ChildProcessLike;
  nextRequestId: number;
  pendingResponses: Map<RequestId, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>;
  threadId?: string;
  activeTurnId?: string;
  pendingRequest?: PendingRequest;
  cwd?: string;
}

function splitArgs(args: string): string[] {
  return args.trim() ? args.trim().split(/\s+/) : [];
}

function buildUserInput(text: string) {
  return [{ type: "text", text, text_elements: [] }] as const;
}

/** Implements the daemon-facing harness contract over the Codex app-server stdio transport. */
class CodexStdioHarnessClient implements HarnessClientLike {
  private readonly listeners = new Map<string, Set<(payload: { sessionId: string }) => void>>();
  private readonly sessions = new Map<string, SessionRuntime>();

  constructor(
    private readonly config: CodexConfig,
    private readonly spawnImpl: SpawnLike
  ) {}

  /** Codex app-server is launched per session, so the shared daemon bootstrap has no upfront connection work. */
  async connect(): Promise<void> {}

  /** Registers a listener for daemon lifecycle events emitted by the Codex client. */
  on(eventName: string, callback: (payload: { sessionId: string }) => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(callback);
    this.listeners.set(eventName, listeners);
  }

  /** Creates a new per-session Codex app-server process, initializes it, and starts the first turn. */
  async createSession(request: HarnessSessionStartRequest): Promise<{ id: string }> {
    const runtime = this.createRuntime();
    await this.initializeRuntime(runtime);

    const threadResult = await this.sendRequest<{ thread: { id: string } }>(runtime, {
      method: "thread/start",
      id: runtime.nextRequestId++,
      params: {
        model: this.config.model,
        cwd: request.cwd ?? null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        experimentalRawEvents: false,
        persistExtendedHistory: false
      } satisfies ThreadStartParams
    });

    runtime.threadId = threadResult.thread.id;
    runtime.cwd = request.cwd;
    this.sessions.set(threadResult.thread.id, runtime);

    const turnResult = await this.sendRequest<{ turn: { id: string } }>(runtime, {
      method: "turn/start",
      id: runtime.nextRequestId++,
      params: {
        threadId: threadResult.thread.id,
        cwd: request.cwd ?? null,
        input: buildUserInput(request.initialPrompt)
      } satisfies TurnStartParams
    });

    runtime.activeTurnId = turnResult.turn.id;

    return { id: threadResult.thread.id };
  }

  /** Resumes an active Codex turn by resolving a pending request or steering the active turn. */
  async sendMessage(sessionId: string, payload: HarnessMessagePayload): Promise<void> {
    const runtime = this.getSession(sessionId);
    const pendingRequest = runtime.pendingRequest;

    if (pendingRequest) {
      runtime.pendingRequest = undefined;
      await this.respondToPendingRequest(runtime, pendingRequest, payload.text);

      if (
        pendingRequest.method !== "item/tool/requestUserInput" &&
        payload.text !== "User approved. Proceed."
      ) {
        await this.steerTurn(runtime, payload.text);
      }
      return;
    }

    await this.steerTurn(runtime, payload.text);
  }

  /** Interrupts the active turn, tears down the session process, and removes runtime state. */
  async stopSession(sessionId: string): Promise<void> {
    const runtime = this.getSession(sessionId);

    if (runtime.threadId && runtime.activeTurnId) {
      await this.sendRequest<Record<string, never>>(runtime, {
        method: "turn/interrupt",
        id: runtime.nextRequestId++,
        params: {
          threadId: runtime.threadId,
          turnId: runtime.activeTurnId
        } satisfies TurnInterruptParams
      });
    }

    runtime.process.kill();
    this.sessions.delete(sessionId);
  }

  /** Starts the stdio subprocess and begins consuming JSONL messages. */
  private createRuntime(): SessionRuntime {
    const commandArgs = splitArgs(this.config.args);
    const process = this.spawnImpl(this.config.command, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const runtime: SessionRuntime = {
      process,
      nextRequestId: 1,
      pendingResponses: new Map()
    };

    this.bindProcessOutput(runtime);
    return runtime;
  }

  /** Performs the initialize handshake required by the Codex app-server protocol. */
  private async initializeRuntime(runtime: SessionRuntime): Promise<void> {
    await this.sendRequest(runtime, {
      method: "initialize",
      id: runtime.nextRequestId++,
      params: {
        clientInfo: {
          name: "githueber",
          title: "Githueber",
          version: "0.1.0"
        }
      } satisfies InitializeParams
    });

    this.sendNotification(runtime, {
      method: "initialized",
      params: {}
    });
  }

  /** Binds stdout JSONL parsing to one runtime so responses and notifications can be dispatched. */
  private bindProcessOutput(runtime: SessionRuntime): void {
    let buffer = "";

    runtime.process.stdout.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          this.handleMessage(runtime, JSON.parse(line) as Record<string, unknown>);
        }
      }
    });
  }

  /** Sends one client notification to Codex over stdio. */
  private sendNotification(runtime: SessionRuntime, notification: { method: string; params?: unknown }): void {
    runtime.process.stdin.write(`${JSON.stringify(notification)}\n`);
  }

  /** Sends a request and resolves once Codex returns the matching JSON-RPC response id. */
  private sendRequest<TResult>(
    runtime: SessionRuntime,
    request: ClientRequest | { method: string; id: RequestId; params: unknown }
  ): Promise<TResult> {
    return new Promise((resolve, reject) => {
      runtime.pendingResponses.set(request.id, { resolve, reject });
      runtime.process.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  /** Handles responses, notifications, and server-initiated requests from the Codex process. */
  private handleMessage(runtime: SessionRuntime, message: Record<string, unknown>): void {
    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = runtime.pendingResponses.get(message.id as RequestId);
      if (!pending) {
        return;
      }

      runtime.pendingResponses.delete(message.id as RequestId);
      if ("error" in message && message.error) {
        pending.reject(new Error((message.error as { message?: string }).message ?? "Codex request failed"));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if ("method" in message && "id" in message) {
      this.handleServerRequest(runtime, message as unknown as ServerRequest);
      return;
    }

    if ("method" in message) {
      this.handleNotification(runtime, message as unknown as ServerNotification);
    }
  }

  /** Translates server-driven requests into daemon pause state until a user response is available. */
  private handleServerRequest(runtime: SessionRuntime, request: ServerRequest): void {
    const threadId = (request.params as { threadId?: string }).threadId;
    const turnId = (request.params as { turnId?: string }).turnId;

    if (turnId) {
      runtime.activeTurnId = turnId;
    }
    runtime.pendingRequest = {
      id: request.id,
      method: request.method,
      params: request.params
    };

    if (threadId) {
      this.emit("sessionPaused", { sessionId: threadId });
    }
  }

  /** Updates active turn state and emits completion when Codex finishes the turn. */
  private handleNotification(runtime: SessionRuntime, notification: ServerNotification): void {
    switch (notification.method) {
      case "turn/started":
        runtime.activeTurnId = notification.params.turn.id;
        break;
      case "turn/completed":
        runtime.activeTurnId = undefined;
        runtime.pendingRequest = undefined;
        this.emit("sessionCompleted", { sessionId: notification.params.threadId });
        break;
      default:
        break;
    }
  }

  /** Responds to the currently blocked Codex request using the GitHub-side operator message. */
  private async respondToPendingRequest(
    runtime: SessionRuntime,
    request: PendingRequest,
    text: string
  ): Promise<void> {
    switch (request.method) {
      case "item/fileChange/requestApproval":
      case "item/commandExecution/requestApproval":
        this.sendNotification(runtime, {
          id: request.id,
          result: { decision: "accept" }
        });
        return;
      case "item/tool/requestUserInput": {
        const questions = (request.params as { questions: Array<{ id: string }> }).questions;
        const answers = Object.fromEntries(
          questions.map((question) => [question.id, { answers: [text] }])
        );
        this.sendNotification(runtime, {
          id: request.id,
          result: { answers }
        });
        return;
      }
      default:
        throw new Error(`Unsupported Codex server request: ${request.method}`);
    }
  }

  /** Sends a follow-up steer message into the active turn. */
  private async steerTurn(runtime: SessionRuntime, text: string): Promise<void> {
    if (!runtime.threadId || !runtime.activeTurnId) {
      throw new Error("No active Codex turn is available to steer");
    }

    const params: TurnSteerParams = {
      threadId: runtime.threadId,
      expectedTurnId: runtime.activeTurnId,
      input: buildUserInput(text)
    };

    await this.sendRequest(runtime, {
      method: "turn/steer",
      id: runtime.nextRequestId++,
      params
    });
  }

  /** Returns a tracked runtime session or throws if the daemon has lost the mapping. */
  private getSession(sessionId: string): SessionRuntime {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      throw new Error(`Unknown Codex session: ${sessionId}`);
    }
    return runtime;
  }

  /** Emits one daemon lifecycle event from the Codex client. */
  private emit(eventName: string, payload: { sessionId: string }): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(payload);
    }
  }
}

/** Creates the Codex harness client used by the daemon. */
export function createCodexHarnessClient(
  config: CodexConfig,
  spawnImpl: SpawnLike = spawn
): HarnessClientLike {
  return new CodexStdioHarnessClient(config, spawnImpl);
}
