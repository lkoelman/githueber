import { dirname, join } from "node:path";
import { ConfigManager } from "./config/ConfigManager.ts";
import { createSessionEventEchoListener } from "./sessionManager/sessionEvents.ts";
import { createCodexHarnessClient } from "./codex/CodexHarnessClient.ts";
import { CodexSessionManager } from "./codex/CodexSessionManager.ts";
import { CodexSessionRegistry } from "./codex/CodexSessionRegistry.ts";
import { DaemonCore } from "./daemon.ts";
import { GitHubPoller, createOctokit, resolveGitHubToken } from "./github/GitHubPoller.ts";
import { MultiHarnessSessionManager } from "./sessionManager/MultiHarnessSessionManager.ts";
import { IPCServer } from "./ipc/IPCServer.ts";
import type { DaemonConfig, HarnessName, RepositoryConfig, SessionManagerLike } from "./models/types.ts";
import { createOpenCodeHarnessClient } from "./opencode/OpenCodeHarnessClient.ts";
import { OpenCodeSessionRegistry } from "./opencode/OpenCodeSessionRegistry.ts";
import { OpenCodeSessionManager } from "./opencode/OpenCodeSessionManager.ts";
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

export interface StartDaemonOptions {
  echoSessionEvents?: boolean;
  sessionEventWriter?: (chunk: string) => void;
  harnessOverride?: HarnessName;
  stateRoot?: string;
}

/** Resolves the runtime harness for one repository using repo, CLI, config, then implicit defaults. */
export function resolveRepositoryHarness(
  repository: RepositoryConfig,
  config: Pick<DaemonConfig, "execution">,
  options: Pick<StartDaemonOptions, "harnessOverride"> = {}
): HarnessName {
  return repository.harness ?? options.harnessOverride ?? config.execution.harness ?? "opencode";
}

interface SessionManagerFactoryDeps {
  createOpenCodeClient?: typeof createOpenCodeHarnessClient;
  createCodexClient?: typeof createCodexHarnessClient;
}

/** Builds only the harness session managers required by the resolved repository harness set. */
export async function createSessionManagerForConfig(
  config: DaemonConfig,
  options: Pick<StartDaemonOptions, "harnessOverride" | "stateRoot"> = {},
  deps: SessionManagerFactoryDeps = {}
): Promise<SessionManagerLike> {
  const createOpenCodeClient = deps.createOpenCodeClient ?? createOpenCodeHarnessClient;
  const createCodexClient = deps.createCodexClient ?? createCodexHarnessClient;
  const harnessManagers = new Map<HarnessName, SessionManagerLike>();

  for (const repository of Object.values(config.repositories)) {
    const harness = resolveRepositoryHarness(repository, config, options);
    if (harnessManagers.has(harness)) {
      continue;
    }

    if (harness === "opencode") {
      if (!config.opencode) {
        throw new Error("OpenCode harness is not configured for this daemon");
      }
      const client = await createOpenCodeClient(config.opencode);
      harnessManagers.set(
        "opencode",
        new OpenCodeSessionManager(
          client,
          new OpenCodeSessionRegistry(
            join(options.stateRoot ?? process.cwd(), "runtime", "opencode-sessions.json")
          ),
          client.getServerUrl?.() ?? "opencode://embedded"
        )
      );
      continue;
    }

    if (!config.codex) {
      throw new Error("Codex harness is not configured for this daemon");
    }
    const client = createCodexClient(config.codex);
    harnessManagers.set(
      "codex",
      new CodexSessionManager(
        client,
        new CodexSessionRegistry(
          join(options.stateRoot ?? process.cwd(), "runtime", "codex-sessions.json")
        )
      )
    );
  }

  return new MultiHarnessSessionManager(
    Array.from(harnessManagers.values()),
    config.repositories,
    (repository) => harnessManagers.get(resolveRepositoryHarness(repository, config, options))!
  );
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
    logger.info("Closing harness sessions before shutdown.", { signal });

    try {
      await daemon.stop();
      ipc.stop();
      processRef.exit(0);
    } catch (error: any) {
      logger.error("Failed to close harness sessions during shutdown.", {
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
export async function startDaemon(options: StartDaemonOptions = {}): Promise<void> {
  const configPath = process.env.GITHUEBER_CONFIG ?? "./config/githueber-config.yaml";
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
  const sessionManager = await createSessionManagerForConfig(config, {
    ...options,
    stateRoot: options.stateRoot ?? dirname(configPath)
  });

  if (options.echoSessionEvents) {
    sessionManager.onSessionEvent(
      createSessionEventEchoListener(
        options.sessionEventWriter ?? ((chunk) => process.stdout.write(chunk))
      )
    );
  }

  const daemon = new DaemonCore(pollers, router, sessionManager, config);
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
