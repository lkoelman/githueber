import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../src/config/ConfigManager.ts";

const sampleConfig = `
repositories:
  frontend:
    owner: "acme"
    repo: "frontend"
    local_repo_path: "/repos/frontend"
    labels:
      queue_label: "agent-queue"
      processing_label: "agent-processing"
      await_plan_label: "await-plan"
      completed_label: "agent-completed"
      failed_label: "agent-failed"
      revising_label: "agent-revising"
    agent_mapping:
      "bug-fix": "github-worker-agent"
      "epic": "github-orchestrator-agent"
  backend:
    owner: "acme"
    repo: "backend"
    local_repo_path: "/repos/backend"
    labels:
      queue_label: "agent-queue"
      processing_label: "agent-processing"
      await_plan_label: "await-plan"
      completed_label: "agent-completed"
      failed_label: "agent-failed"
      revising_label: "agent-revising"
    agent_mapping:
      "feature-request": "github-worker-agent"
execution:
  auto_approve: false
  concurrency: 2
  approval_comment: "/approve"
  revise_comment: "/revise"
  opencode_model: null
  timeout: 3600
polling:
  interval_ms: 300000
acp:
  endpoint: "http://127.0.0.1:9000"
ipc:
  socket_path: "/tmp/opencode-gh-buddy.sock"
`;

describe("ConfigManager", () => {
  test("loads a multi-repository config into a normalized repository map", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-buddy-config-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, sampleConfig);

    const config = new ConfigManager(configPath).getConfig();

    expect(Object.keys(config.repositories)).toEqual(["frontend", "backend"]);
    expect(config.repositories.frontend).toMatchObject({
      key: "frontend",
      owner: "acme",
      repo: "frontend",
      localRepoPath: "/repos/frontend"
    });
    expect(config.repositories.frontend.agentMapping).toEqual({
      "bug-fix": "github-worker-agent",
      epic: "github-orchestrator-agent"
    });
    expect(config.repositories.backend).toMatchObject({
      key: "backend",
      owner: "acme",
      repo: "backend",
      localRepoPath: "/repos/backend"
    });
    expect(config.polling.intervalMs).toBe(300000);
    expect(config.execution.approvalComment).toBe("/approve");
    expect(config.ipc.socketPath).toBe("/tmp/opencode-gh-buddy.sock");

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects configs that do not define repositories", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-buddy-invalid-config-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
github:
  repo_owner: "acme"
  repo_name: "frontend"
`
    );

    expect(() => new ConfigManager(configPath)).toThrow("Expected mapping for repositories");

    rmSync(dir, { recursive: true, force: true });
  });
});
