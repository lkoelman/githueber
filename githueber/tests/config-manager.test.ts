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
  harness: "opencode"
  auto_approve: false
  concurrency: 2
  approval_comment: "/approve"
  revise_comment: "/revise"
  opencode_model: null
  timeout: 3600
opencode:
  endpoint: "http://127.0.0.1:9000"
polling:
  interval_ms: 300000
ipc:
  socket_path: "/tmp/githueber.sock"
isolation:
  worktrees: "/tmp/githueber-worktrees"
`;

describe("ConfigManager", () => {
  test("loads a multi-repository config into a normalized repository map", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-config-"));
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
    expect(config.ipc.socketPath).toBe("/tmp/githueber.sock");
    expect(config.isolation.worktrees).toBe("/tmp/githueber-worktrees");
    expect(config.execution.harness).toBe("opencode");
    expect(config.repositories.frontend.harness).toBeUndefined();
    expect(config.opencode.endpoint).toBe("http://127.0.0.1:9000");

    rmSync(dir, { recursive: true, force: true });
  });

  test("supports a per-repository harness override and Codex config", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-harness-config-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      sampleConfig
        .replace('  frontend:\n', '  frontend:\n    harness: "codex"\n')
        .concat(
          `
codex:
  command: "codex"
  args: "app-server"
  model: "gpt-5.4"
`
        )
    );

    const config = new ConfigManager(configPath).getConfig();

    expect(config.repositories.frontend.harness).toBe("codex");
    expect(config.repositories.backend.harness).toBeUndefined();
    expect(config.codex).toEqual({
      command: "codex",
      args: "app-server",
      model: "gpt-5.4"
    });

    rmSync(dir, { recursive: true, force: true });
  });

  test("defaults the daemon harness to opencode when omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-default-harness-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, sampleConfig.replace('  harness: "opencode"\n', ""));

    const config = new ConfigManager(configPath).getConfig();

    expect(config.execution.harness).toBe("opencode");

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects unsupported harness names", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-invalid-harness-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      sampleConfig.replace('  harness: "opencode"', '  harness: "unsupported"')
    );

    expect(() => new ConfigManager(configPath)).toThrow(
      "Unsupported harness for execution.harness: unsupported"
    );

    rmSync(dir, { recursive: true, force: true });
  });

  test("requires Codex config only when a repository resolves to codex", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-missing-codex-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      sampleConfig.replace('  frontend:\n', '  frontend:\n    harness: "codex"\n')
    );

    expect(() => new ConfigManager(configPath)).toThrow(
      "Expected non-empty string for codex.command"
    );

    rmSync(dir, { recursive: true, force: true });
  });

  test("treats false or null worktree config as disabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-worktrees-disabled-"));
    const falsePath = join(dir, "false.yaml");
    const nullPath = join(dir, "null.yaml");

    writeFileSync(
      falsePath,
      sampleConfig.replace('  worktrees: "/tmp/githueber-worktrees"', "  worktrees: false")
    );
    writeFileSync(
      nullPath,
      sampleConfig.replace('  worktrees: "/tmp/githueber-worktrees"', "  worktrees: null")
    );

    expect(new ConfigManager(falsePath).getConfig().isolation.worktrees).toBeNull();
    expect(new ConfigManager(nullPath).getConfig().isolation.worktrees).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects relative worktree directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-invalid-worktrees-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      sampleConfig.replace('  worktrees: "/tmp/githueber-worktrees"', '  worktrees: "relative/worktrees"')
    );

    expect(() => new ConfigManager(configPath)).toThrow(
      "Expected absolute path, false, or null for isolation.worktrees"
    );

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects configs that do not define repositories", () => {
    const dir = mkdtempSync(join(tmpdir(), "githueber-invalid-config-"));
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
