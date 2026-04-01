import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../src/config/ConfigManager.ts";

const sampleConfig = `
github:
  repo_owner: "acme"
  repo_name: "widget"
  target_repo_path: "/repos/widget"
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
  test("loads nested YAML-style config and exposes typed accessors", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-buddy-config-"));
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, sampleConfig);

    const config = new ConfigManager(configPath);

    expect(config.getRepoOwner()).toBe("acme");
    expect(config.getRepoName()).toBe("widget");
    expect(config.getTargetRepoPath()).toBe("/repos/widget");
    expect(config.getPollingIntervalMs()).toBe(300000);
    expect(config.getApprovalComment()).toBe("/approve");
    expect(config.getReviseComment()).toBe("/revise");
    expect(config.getSocketPath()).toBe("/tmp/opencode-gh-buddy.sock");
    expect(config.getAgentRoutingRules()).toEqual([
      { label: "bug-fix", agent: "github-worker-agent" },
      { label: "epic", agent: "github-orchestrator-agent" }
    ]);

    rmSync(dir, { recursive: true, force: true });
  });
});
