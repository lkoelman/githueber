import { describe, expect, test } from "bun:test";
import { createShutdownHandler } from "../src/startDaemon.ts";

describe("createShutdownHandler", () => {
  test("logs ACP shutdown, stops the daemon, stops IPC, and exits cleanly", async () => {
    const events: string[] = [];
    const infos: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    let exitCode: number | undefined;

    const shutdown = createShutdownHandler({
      daemon: {
        async stop(): Promise<void> {
          events.push("daemon.stop");
        }
      },
      ipc: {
        stop(): void {
          events.push("ipc.stop");
        }
      },
      logger: {
        info(message, meta) {
          infos.push({ message, meta });
        },
        error() {}
      },
      processRef: {
        exit(code?: number): void {
          exitCode = code;
        }
      }
    });

    await shutdown("SIGINT");

    expect(infos).toEqual([
      {
        message: "Closing ACP sessions before shutdown.",
        meta: { signal: "SIGINT" }
      }
    ]);
    expect(events).toEqual(["daemon.stop", "ipc.stop"]);
    expect(exitCode).toBe(0);
  });
});
