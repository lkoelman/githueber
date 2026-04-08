import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getCanonicalAgentDefinition,
  getCanonicalSkillDefinition,
  installHarnessAssets,
  listRenderedHarnessAssets,
  renderHarnessAssets
} from "../src/harnessAssets/index.ts";
describe("canonical harness assets", () => {
  test("preserves the github-cli skill source metadata", () => {
    expect(getCanonicalSkillDefinition("github-cli")).toMatchObject({
      name: "github-cli",
      description:
        "Use GitHub `gh` client for issue, pull request, and issue-thread workflows driven from GitHub."
    });
  });

  test("preserves the worker and orchestrator agent descriptions", () => {
    expect(getCanonicalAgentDefinition("github-worker-agent").description).toBe(
      "Executes GitHub issue work through a plan, approval, implementation, and PR workflow."
    );
    expect(getCanonicalAgentDefinition("github-orchestrator-agent").description).toBe(
      "Decomposes GitHub epics or refactors into actionable child issues for the daemon worker pool."
    );
  });
});

describe("cross-harness rendering", () => {
  test("renders codex agent TOML and codex skill directories", () => {
    const rendered = renderHarnessAssets("codex");
    const worker = rendered.files.find(
      (file) => file.relativePath === ".codex/agents/github-worker-agent.toml"
    );
    const skill = rendered.files.find(
      (file) => file.relativePath === ".codex/skills/github-cli/SKILL.md"
    );

    expect(worker?.content).toContain('name = "github-worker-agent"');
    expect(worker?.content).toContain('sandbox_mode = "workspace-write"');
    expect(worker?.content).toContain("developer_instructions = '''");
    expect(skill?.content).toContain("---");
    expect(skill?.content).toContain("name: github-cli");
  });

  test("renders claude and gemini agents with YAML frontmatter", () => {
    const claude = renderHarnessAssets("claude");
    const gemini = renderHarnessAssets("gemini");
    const claudeWorker = claude.files.find(
      (file) => file.relativePath === ".claude/agents/github-worker-agent.md"
    );
    const geminiWorker = gemini.files.find(
      (file) => file.relativePath === ".gemini/agents/github-worker-agent.md"
    );

    expect(claudeWorker?.content).toContain("name: github-worker-agent");
    expect(claudeWorker?.content).toContain("tools:");
    expect(geminiWorker?.content).toContain("name: github-worker-agent");
    expect(geminiWorker?.content).toContain("description:");
  });
});

describe("harness asset installation", () => {
  test("installs codex assets into the user home tree without touching unrelated files", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "githueber-home-"));
    const unrelatedDir = join(homeDir, ".codex", "agents");
    const unrelatedFile = join(unrelatedDir, "custom-agent.toml");
    mkdirSync(unrelatedDir, { recursive: true });
    writeFileSync(unrelatedFile, 'name = "custom-agent"\n');

    const summary = installHarnessAssets({ harness: "codex", homeDir });

    expect(summary.harness).toBe("codex");
    expect(summary.filesWritten).toBe(listRenderedHarnessAssets("codex").length);
    expect(
      existsSync(join(homeDir, ".codex", "agents", "github-worker-agent.toml"))
    ).toBe(true);
    expect(
      existsSync(join(homeDir, ".codex", "skills", "github-cli", "SKILL.md"))
    ).toBe(true);
    expect(readFileSync(unrelatedFile, "utf8")).toBe('name = "custom-agent"\n');

    rmSync(homeDir, { recursive: true, force: true });
  });

  test("reinstalls managed opencode files idempotently", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "githueber-opencode-home-"));
    const target = join(homeDir, ".opencode", "agents", "github-worker-agent.md");

    installHarnessAssets({ harness: "opencode", homeDir });
    writeFileSync(target, "tampered\n");
    installHarnessAssets({ harness: "opencode", homeDir });

    const rendered = renderHarnessAssets("opencode");
    const expected = rendered.files.find(
      (file) => file.relativePath === ".opencode/agents/github-worker-agent.md"
    );

    expect(readFileSync(target, "utf8")).toBe(expected?.content);

    rmSync(homeDir, { recursive: true, force: true });
  });
});
