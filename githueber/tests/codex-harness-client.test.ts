import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { createCodexHarnessClient } from "../src/codex/CodexHarnessClient.ts";

interface FakeChildProcess {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: () => void;
}

function createFakeCodexProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: unknown[] = [];
  let killed = false;

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().trim().split("\n")) {
        if (line) {
          writes.push(JSON.parse(line));
        }
      }
      callback();
    }
  });
 
  return {
    process: {
      stdin,
      stdout,
      stderr,
      kill: () => {
        killed = true;
      }
    } satisfies FakeChildProcess,
    writes,
    get killed() {
      return killed;
    },
    send(message: unknown) {
      stdout.write(`${JSON.stringify(message)}\n`);
    }
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start > 1000) {
      throw new Error("Timed out waiting for test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("createCodexHarnessClient", () => {
  test("creates a Codex-backed session, pauses on approval, and resumes by steering the active turn", async () => {
    const fake = createFakeCodexProcess();
    const paused: string[] = [];
    const completed: string[] = [];
    const deltas: Array<{ sessionId: string; message: string }> = [];

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4"
      },
      () => fake.process
    );

    client.on?.("sessionPaused", ({ sessionId }) => paused.push(sessionId));
    client.on?.("sessionCompleted", ({ sessionId }) => completed.push(sessionId));
    client.on?.("sessionMessageDelta", ({ sessionId, message }) => deltas.push({ sessionId, message }));

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length === 3);
    fake.send({ id: 2, result: { thread: { id: "thr_123" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_123", items: [], status: "in_progress", error: null } } });

    const session = await createPromise;
    expect(session).toEqual({ id: "thr_123" });

    fake.send({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_123",
        turnId: "turn_123",
        itemId: "item_message_1",
        delta: "Working on it."
      }
    });

    fake.send({
      method: "item/fileChange/requestApproval",
      id: 99,
      params: {
        threadId: "thr_123",
        turnId: "turn_123",
        itemId: "item_1"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(paused).toEqual(["thr_123"]);

    const sendPromise = client.sendMessage("thr_123", { text: "Please revise the plan." });
    await waitFor(() => fake.writes.length === 6);
    fake.send({ id: 4, result: { turnId: "turn_123" } });
    await sendPromise;

    fake.send({
      method: "turn/completed",
      params: {
        threadId: "thr_123",
        turn: { id: "turn_123", items: [], status: "completed", error: null }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(completed).toEqual(["thr_123"]);
    expect(deltas).toEqual([{ sessionId: "thr_123", message: "Working on it." }]);
    expect(fake.writes).toEqual([
      {
        method: "initialize",
        id: 1,
        params: {
          clientInfo: {
            name: "githueber",
            title: "Githueber",
            version: "0.1.0"
          }
        }
      },
      { method: "initialized", params: {} },
      {
        method: "thread/start",
        id: 2,
        params: {
          model: "gpt-5.4",
          cwd: "/repos/frontend",
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          experimentalRawEvents: false,
          persistExtendedHistory: false
        }
      },
      {
        method: "turn/start",
        id: 3,
        params: {
          threadId: "thr_123",
          cwd: "/repos/frontend",
          input: [{ type: "text", text: "Start working on issue 42.", text_elements: [] }]
        }
      },
      {
        id: 99,
        result: {
          decision: "accept"
        }
      },
      {
        method: "turn/steer",
        id: 4,
        params: {
          threadId: "thr_123",
          expectedTurnId: "turn_123",
          input: [{ type: "text", text: "Please revise the plan.", text_elements: [] }]
        }
      }
    ]);
  });

  test("uses configured approval policy and sandbox when starting a thread", async () => {
    const fake = createFakeCodexProcess();

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4",
        approvalPolicy: "never",
        sandbox: "danger-full-access"
      },
      () => fake.process
    );

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length >= 3);

    expect(fake.writes[2]).toEqual({
      method: "thread/start",
      id: 2,
      params: {
        model: "gpt-5.4",
        cwd: "/repos/frontend",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        experimentalRawEvents: false,
        persistExtendedHistory: false
      }
    });

    fake.send({ id: 2, result: { thread: { id: "thr_custom" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_custom", items: [], status: "in_progress", error: null } } });

    await createPromise;
  });

  test("answers request_user_input prompts with the provided message", async () => {
    const fake = createFakeCodexProcess();
    const paused: string[] = [];

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4"
      },
      () => fake.process
    );

    client.on?.("sessionPaused", ({ sessionId }) => paused.push(sessionId));

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length === 3);
    fake.send({ id: 2, result: { thread: { id: "thr_456" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_456", items: [], status: "in_progress", error: null } } });
    await createPromise;

    fake.send({
      method: "item/tool/requestUserInput",
      id: 77,
      params: {
        threadId: "thr_456",
        turnId: "turn_456",
        itemId: "item_2",
        questions: [{ id: "reason", header: "Reason", question: "Why?", isOther: true, isSecret: false, options: null }]
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(paused).toEqual(["thr_456"]);

    await client.sendMessage("thr_456", { text: "Need a revised approach." });

    expect(fake.writes.at(-1)).toEqual({
      id: 77,
      result: {
        answers: {
          reason: { answers: ["Need a revised approach."] }
        }
      }
    });
  });

  test("interrupts the active turn and kills the app-server process when stopped", async () => {
    const fake = createFakeCodexProcess();

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4"
      },
      () => fake.process
    );

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length === 3);
    fake.send({ id: 2, result: { thread: { id: "thr_stop" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_stop", items: [], status: "in_progress", error: null } } });
    await createPromise;

    const stopPromise = client.stopSession?.("thr_stop");
    await waitFor(() => fake.writes.length === 5);
    fake.send({ id: 4, result: {} });
    await stopPromise;

    expect(fake.killed).toBe(true);
    expect(fake.writes.at(-1)).toEqual({
      method: "turn/interrupt",
      id: 4,
      params: {
        threadId: "thr_stop",
        turnId: "turn_stop"
      }
    });
  });

  test("streams plan, command, and file-change output while still ignoring reasoning", async () => {
    const fake = createFakeCodexProcess();
    const deltas: Array<{ sessionId: string; message: string }> = [];

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4"
      },
      () => fake.process
    );

    client.on?.("sessionMessageDelta", ({ sessionId, message }) => deltas.push({ sessionId, message }));

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length === 3);
    fake.send({ id: 2, result: { thread: { id: "thr_noise" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_noise", items: [], status: "in_progress", error: null } } });
    await createPromise;

    fake.send({
      method: "item/plan/delta",
      params: {
        threadId: "thr_noise",
        turnId: "turn_noise",
        itemId: "item_plan",
        delta: "1. Inspect the failing path\n"
      }
    });
    fake.send({
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_noise",
        turnId: "turn_noise",
        itemId: "item_cmd",
        delta: "npm test\n"
      }
    });
    fake.send({
      method: "item/fileChange/outputDelta",
      params: {
        threadId: "thr_noise",
        turnId: "turn_noise",
        itemId: "item_file",
        delta: "Updated src/index.ts\n"
      }
    });
    fake.send({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thr_noise",
        turnId: "turn_noise",
        itemId: "item_reasoning",
        summaryIndex: 0,
        delta: "Thinking..."
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deltas).toEqual([
      { sessionId: "thr_noise", message: "1. Inspect the failing path\n" },
      { sessionId: "thr_noise", message: "npm test\n" },
      { sessionId: "thr_noise", message: "Updated src/index.ts\n" }
    ]);
  });

  test("falls back to completed agent and plan items when no deltas were streamed", async () => {
    const fake = createFakeCodexProcess();
    const deltas: Array<{ sessionId: string; message: string }> = [];

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4"
      },
      () => fake.process
    );

    client.on?.("sessionMessageDelta", ({ sessionId, message }) => deltas.push({ sessionId, message }));

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length === 3);
    fake.send({ id: 2, result: { thread: { id: "thr_completed" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_completed", items: [], status: "in_progress", error: null } } });
    await createPromise;

    fake.send({
      method: "item/completed",
      params: {
        threadId: "thr_completed",
        turnId: "turn_completed",
        item: {
          type: "plan",
          id: "plan_1",
          text: "1. Reproduce the bug\n2. Patch the transport"
        }
      }
    });
    fake.send({
      method: "item/completed",
      params: {
        threadId: "thr_completed",
        turnId: "turn_completed",
        item: {
          type: "agentMessage",
          id: "msg_1",
          text: "Bug fixed.",
          phase: "final_answer",
          memoryCitation: null
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deltas).toEqual([
      {
        sessionId: "thr_completed",
        message: "1. Reproduce the bug\n2. Patch the transport"
      },
      {
        sessionId: "thr_completed",
        message: "Bug fixed."
      }
    ]);
  });

  test("does not duplicate completed agent or plan items after deltas already streamed", async () => {
    const fake = createFakeCodexProcess();
    const deltas: Array<{ sessionId: string; message: string }> = [];

    const client = createCodexHarnessClient(
      {
        command: "codex",
        args: "app-server",
        model: "gpt-5.4"
      },
      () => fake.process
    );

    client.on?.("sessionMessageDelta", ({ sessionId, message }) => deltas.push({ sessionId, message }));

    const createPromise = client.createSession({
      agentDefinition: "github-worker-agent",
      initialPrompt: "Start working on issue 42.",
      cwd: "/repos/frontend"
    });

    await waitFor(() => fake.writes.length === 1);
    fake.send({ id: 1, result: { userAgent: "codex" } });
    await waitFor(() => fake.writes.length === 3);
    fake.send({ id: 2, result: { thread: { id: "thr_dup" } } });
    await waitFor(() => fake.writes.length === 4);
    fake.send({ id: 3, result: { turn: { id: "turn_dup", items: [], status: "in_progress", error: null } } });
    await createPromise;

    fake.send({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_dup",
        turnId: "turn_dup",
        itemId: "msg_dup",
        delta: "Still working"
      }
    });
    fake.send({
      method: "item/plan/delta",
      params: {
        threadId: "thr_dup",
        turnId: "turn_dup",
        itemId: "plan_dup",
        delta: "1. Verify the patch"
      }
    });
    fake.send({
      method: "item/completed",
      params: {
        threadId: "thr_dup",
        turnId: "turn_dup",
        item: {
          type: "agentMessage",
          id: "msg_dup",
          text: "Still working",
          phase: "final_answer",
          memoryCitation: null
        }
      }
    });
    fake.send({
      method: "item/completed",
      params: {
        threadId: "thr_dup",
        turnId: "turn_dup",
        item: {
          type: "plan",
          id: "plan_dup",
          text: "1. Verify the patch"
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deltas).toEqual([
      { sessionId: "thr_dup", message: "Still working" },
      { sessionId: "thr_dup", message: "1. Verify the patch" }
    ]);
  });
});
