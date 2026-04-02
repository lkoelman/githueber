import { ConfigManager } from "./config/ConfigManager.ts";
import { ACPSessionManager, createACPClient } from "./acp/ACPSessionManager.ts";
import { DaemonCore } from "./daemon.ts";
import { GitHubPoller, createOctokit, resolveGitHubToken } from "./github/GitHubPoller.ts";
import { IPCServer } from "./ipc/IPCServer.ts";
import { StateRouter } from "./router/StateRouter.ts";
import { logger } from "./utils/logger.ts";

async function main(): Promise<void> {
  const configPath = process.env.GH_BUDDY_CONFIG ?? "./config/gh-buddy-config.yaml";
  const configManager = new ConfigManager(configPath);
  const config = configManager.getConfig();
  const githubToken = await resolveGitHubToken(
    config.github.repoOwner,
    config.github.repoName,
    process.env.GITHUB_TOKEN
  );

  const octokit = await createOctokit(githubToken);
  const poller = new GitHubPoller(octokit, config.github.repoOwner, config.github.repoName);
  const router = new StateRouter(config);
  const acpClient = await createACPClient(config.acp.endpoint);
  const acpManager = new ACPSessionManager(acpClient);
  const daemon = new DaemonCore(poller, router, acpManager, config);
  const ipc = new IPCServer(config.ipc.socketPath, {
    getActiveSessions: () => daemon.getActiveSessions(),
    stopSession: (sessionId) => daemon.stopSession(sessionId),
    triggerManualPoll: () => daemon.triggerManualPoll(),
    updateConfig: (key, value) => configManager.updateValue(key, value)
  });

  await daemon.start();
  ipc.start();
}

void main().catch((error: any) => {
  logger.error("Daemon failed", { error: error.message });
  process.exit(1);
});
