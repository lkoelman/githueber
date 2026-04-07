import { ConfigManager } from "./config/ConfigManager.ts";
import { ACPSessionManager, createACPClient } from "./acp/ACPSessionManager.ts";
import { DaemonCore } from "./daemon.ts";
import { GitHubPoller, createOctokit, resolveGitHubToken } from "./github/GitHubPoller.ts";
import { IPCServer } from "./ipc/IPCServer.ts";
import { StateRouter } from "./router/StateRouter.ts";

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
}
