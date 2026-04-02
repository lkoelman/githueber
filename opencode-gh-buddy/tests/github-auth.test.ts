import { describe, expect, mock, test } from "bun:test";
import { resolveGitHubToken } from "../src/github/GitHubPoller.ts";

describe("resolveGitHubToken", () => {
  test("prefers the environment token when it can access the configured repository", async () => {
    const validateAccess = mock(async (token: string) => token === "env-token");
    const readFallbackToken = mock(() => "gh-token");

    const token = await resolveGitHubToken(
      "lkoelman",
      "vla-recipes",
      "env-token",
      validateAccess,
      readFallbackToken
    );

    expect(token).toBe("env-token");
    expect(validateAccess.mock.calls).toEqual([["env-token", "lkoelman", "vla-recipes"]]);
    expect(readFallbackToken).not.toHaveBeenCalled();
  });

  test("falls back to gh auth token when the environment token cannot access the repository", async () => {
    const validateAccess = mock(async (token: string) => token === "gh-token");
    const readFallbackToken = mock(() => "gh-token");

    const token = await resolveGitHubToken(
      "lkoelman",
      "vla-recipes",
      "env-token",
      validateAccess,
      readFallbackToken
    );

    expect(token).toBe("gh-token");
    expect(validateAccess.mock.calls).toEqual([
      ["env-token", "lkoelman", "vla-recipes"],
      ["gh-token", "lkoelman", "vla-recipes"]
    ]);
  });

  test("throws a clear error when no available token can access the repository", async () => {
    const validateAccess = mock(async () => false);

    await expect(
      resolveGitHubToken("lkoelman", "vla-recipes", "env-token", validateAccess, () => null)
    ).rejects.toThrow(
      "No GitHub token could access lkoelman/vla-recipes. Check GITHUB_TOKEN or run gh auth login."
    );
  });
});
