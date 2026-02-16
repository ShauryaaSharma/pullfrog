import assert from "node:assert/strict";
import * as core from "@actions/core";
import type { PushPermission } from "../external.ts";
import { log } from "./cli.ts";
import { acquireNewToken } from "./github.ts";
import { isGitHubActions } from "./globals.ts";

// re-export for get-installation-token action
export { acquireNewToken as acquireInstallationToken };
export { revokeGitHubInstallationToken as revokeInstallationToken };

// store MCP token in memory for getGitHubInstallationToken()
let mcpTokenValue: string | undefined;

function setEnvironmentVariable(name: string, value: string | undefined) {
  const hadValue = Object.hasOwn(process.env, name);
  const originalValue = process.env[name];

  if (typeof value === "string") {
    process.env[name] = value;
  } else {
    delete process.env[name];
  }

  return () => {
    if (hadValue) {
      process.env[name] = originalValue;
    } else {
      delete process.env[name];
    }
  };
}

/**
 * get the job-scoped token from action input.
 * this token has permissions defined by the workflow's permissions block.
 *
 * fallback order:
 * 1. INPUT_TOKEN (from workflow `with: token:`)
 * 2. GH_TOKEN (external token override)
 * 3. GITHUB_TOKEN (pre-acquired in tests or from GHA env)
 */
export function getJobToken(): string {
  const inputToken = core.getInput("token");
  if (inputToken) {
    return inputToken;
  }

  // fallback for test environment and local dev
  const fallbackToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fallbackToken) {
    return fallbackToken;
  }

  throw new Error("token input is required");
}

export type TokenRef = {
  gitToken: string;
  mcpToken: string;
  [Symbol.asyncDispose]: () => Promise<void>;
};

type ResolveTokensParams = {
  push: PushPermission;
};

/**
 * resolve tokens for the action run.
 *
 * creates two separate tokens:
 * - gitToken: contents permission based on `push` setting (assumed exfiltratable)
 *   - push: enabled → contents:write (can push)
 *   - push: disabled → contents:read (read-only)
 * - mcpToken: full installation token - used for GitHub API calls in MCP tools (not exfiltratable)
 *
 * security-conscious users can pass their own token via GH_TOKEN env var or inputs.token.
 */
export async function resolveTokens(params: ResolveTokensParams): Promise<TokenRef> {
  assert(!mcpTokenValue, "tokens are already resolved");

  const externalToken = process.env.GH_TOKEN;

  // external token takes precedence - use for both git and MCP
  if (externalToken) {
    const revertGithubToken = setEnvironmentVariable("GITHUB_TOKEN", externalToken);
    mcpTokenValue = externalToken;

    if (isGitHubActions) {
      core.setSecret(externalToken);
    }

    log.info("» using external GH_TOKEN for both git and MCP");

    return {
      gitToken: externalToken,
      mcpToken: externalToken,
      async [Symbol.asyncDispose]() {
        mcpTokenValue = undefined;
        revertGithubToken();
        // GH_TOKEN isn't acquired here, so it's not revoked here either
      },
    };
  }

  // create git token based on push permission (assumed exfiltratable)
  // disabled = read-only, restricted/enabled = write (MCP tools enforce branch restrictions)
  // workflows permission is write-only in the API, so only requested when pushing is allowed
  const gitPermissions =
    params.push === "disabled"
      ? { contents: "read" as const }
      : { contents: "write" as const, workflows: "write" as const };
  const gitToken = await acquireNewToken({ permissions: gitPermissions });
  if (isGitHubActions) {
    core.setSecret(gitToken);
  }
  log.info(
    `» acquired git token (${Object.entries(gitPermissions)
      .map((e) => e.join(":"))
      .join(", ")})`
  );

  // create full MCP token - not exfiltratable (only accessible via MCP tools)
  const mcpToken = await acquireNewToken();
  if (isGitHubActions) {
    core.setSecret(mcpToken);
  }
  log.info("» acquired full MCP token");

  // set MCP token as GITHUB_TOKEN for compatibility
  const revertGithubToken = setEnvironmentVariable("GITHUB_TOKEN", mcpToken);
  mcpTokenValue = mcpToken;

  return {
    gitToken,
    mcpToken,
    async [Symbol.asyncDispose]() {
      mcpTokenValue = undefined;
      revertGithubToken();
      // revoke both tokens
      await Promise.all([
        revokeGitHubInstallationToken(gitToken),
        revokeGitHubInstallationToken(mcpToken),
      ]);
    },
  };
}

/**
 * get the MCP token from memory.
 * this is the token used for GitHub API calls in MCP tools.
 */
export function getGitHubInstallationToken(): string {
  assert(mcpTokenValue, "tokens not set. call resolveTokens first.");
  return mcpTokenValue;
}

export async function revokeGitHubInstallationToken(token: string): Promise<void> {
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";

  try {
    await fetch(`${apiUrl}/installation/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    log.debug("» installation token revoked");
  } catch (error) {
    log.warning(
      `Failed to revoke installation token: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
