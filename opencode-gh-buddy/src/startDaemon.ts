import { ConfigManager } from "./config/ConfigManager.ts";
import { ACPSessionManager, createACPClient } from "./acp/ACPSessionManager.ts";
import { DaemonCore } from "./daemon.ts";
import { GitHubPoller, createOctokit, resolveGitHubToken } from "./github/GitHubPoller.ts";
import { IPCServer } from "./ipc/IPCServer.ts";
import { StateRouter } from "./router/StateRouter.ts";
import { logger } from "./utils/logger.ts";

interface ShutdownProcessLike {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  exit(code?: number): void;
}

interface ShutdownLoggerLike {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface ShutdownHandlerDeps {
  daemon: { stop(): Promise<void> };
  ipc: { stop(): void };
  logger: ShutdownLoggerLike;
  processRef: Pick<ShutdownProcessLike, "exit">;
}

/** Builds the shared shutdown routine used by the daemon's signal handlers. */
export function createShutdownHandler(
  { daemon, ipc, logger, processRef }: ShutdownHandlerDeps
): (signal: "SIGINT" | "SIGTERM") => Promise<void> {
  let shuttingDown = false;

  return async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Closing ACP sessions before shutdown.", { signal });

    try {
      await daemon.stop();
      ipc.stop();
      processRef.exit(0);
    } catch (error: any) {
      logger.error("Failed to close ACP sessions during shutdown.", {
        signal,
        error: error.message
      });
      processRef.exit(1);
    }
  };
}

/** Registers process signal handlers that gracefully stop the daemon runtime. */
export function registerShutdownHandlers(
  daemon: { stop(): Promise<void> },
  ipc: { stop(): void },
  processRef: ShutdownProcessLike = process
): void {
  const shutdown = createShutdownHandler({ daemon, ipc, logger, processRef });

  processRef.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  processRef.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

/** Builds the runtime graph from config and starts the daemon plus its IPC control socket. */
export async function startDaemon(): Promise<void> {
  const configPath = process.env.GH_BUDDY_CONFIG ?? "./config/gh-buddy-config.yaml";
  const configManager = new ConfigManager(configPath);
  const config = configManager.getConfig();

  const pollers = Object.fromEntries(
    await Promise.all(
      Object.values(config.repositories).map(async (repository) => {
        const token = await resolveGitHubToken(
          repository.owner,
          repository.repo,
          process.env.GITHUB_TOKEN
        );
        const octokit = await createOctokit(token);
        return [
          repository.key,
          new GitHubPoller(
            octokit,
            repository.key,
            repository.owner,
            repository.repo,
            repository.localRepoPath
          )
        ] as const;
      })
    )
  );

  const router = new StateRouter(config);
  const acpClient = await createACPClient(config.acp.endpoint);
  const acpManager = new ACPSessionManager(acpClient);
  const daemon = new DaemonCore(pollers, router, acpManager, config);
  const ipc = new IPCServer(config.ipc.socketPath, {
    getActiveSessions: () => daemon.getActiveSessions(),
    stopSession: (sessionId) => daemon.stopSession(sessionId),
    triggerManualPoll: () => daemon.triggerManualPoll(),
    updateConfig: (key, value) => configManager.updateValue(key, value)
  });

  await daemon.start();
  ipc.start();
  registerShutdownHandlers(daemon, ipc);
}
