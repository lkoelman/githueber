import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../../install-githueber.sh", import.meta.url));
const repoRoot = dirname(scriptPath);

function runShell(command: string, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bash", "-lc", command],
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe"
  });
}

function makeFakeBin(commands: string[]): string {
  const binDir = mkdtempSync(join(tmpdir(), "githueber-install-bin-"));

  for (const command of commands) {
    const path = join(binDir, command);
    writeFileSync(path, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(path, 0o755);
  }

  return binDir;
}

describe("install script", () => {
  test("prints help text with the auto-install flag", () => {
    const result = runShell(`bash ${JSON.stringify(scriptPath)} --help`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage:");
    expect(result.stdout.toString()).toContain("-y, --yes");
    expect(result.stdout.toString()).toContain("--harness <opencode|codex|claude|gemini>");
  });

  test("builds the expected GitHub archive URL", () => {
    const result = runShell(
      `source ${JSON.stringify(scriptPath)} && build_archive_url main`
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(
      "https://codeload.github.com/lkoelman/githueber/tar.gz/refs/heads/main"
    );
  });

  test("prefers Homebrew when resolving the gh install command", () => {
    const binDir = makeFakeBin(["brew"]);

    try {
      const result = runShell(
        `PATH=${JSON.stringify(`${binDir}:${process.env.PATH ?? ""}`)} source ${JSON.stringify(scriptPath)} && resolve_gh_install_command`,
        { PATH: `${binDir}:${process.env.PATH ?? ""}` }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe("brew install gh");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test("uses the official Bun install script", () => {
    const result = runShell(
      `source ${JSON.stringify(scriptPath)} && resolve_bun_install_command`
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("curl -fsSL https://bun.sh/install | bash");
  });

  test("rejects unsupported harness names", () => {
    const result = runShell(
      `source ${JSON.stringify(scriptPath)} && validate_harness unsupported`,
      { PATH: process.env.PATH ?? "" }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Unsupported harness: unsupported. Supported harnesses: opencode, codex, claude, gemini"
    );
  });
});