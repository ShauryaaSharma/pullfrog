/**
 * Secret detection and redaction utilities
 * Redacts actual secret values rather than using pattern matching
 */

import { agentsManifest } from "../external.ts";
import { getGitHubInstallationToken } from "./token.ts";

// patterns for sensitive env var names
export const SENSITIVE_PATTERNS = [
  /_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /_CREDENTIAL$/i,
];

export function isSensitiveEnvName(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

/** filter env vars, removing sensitive values (tokens, keys, secrets) */
export function filterEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (isSensitiveEnvName(key)) continue;
    filtered[key] = value;
  }
  return filtered;
}

export type EnvMode = "restricted" | "inherit" | Record<string, string>;

/**
 * resolve env mode to actual env object
 * - "restricted" (default): filterEnv() to prevent secret leakage
 * - "inherit": full process.env
 * - object: custom env merged with restricted base
 */
export function resolveEnv(mode: EnvMode | undefined): Record<string, string | undefined> {
  if (mode === "inherit") {
    return process.env;
  }
  if (mode === "restricted" || mode === undefined) {
    return filterEnv();
  }
  // custom env object - merge with restricted base
  return { ...filterEnv(), ...mode };
}

function getAllSecrets(): string[] {
  const secrets: string[] = [];

  // get all API key values from agent manifest
  for (const agent of Object.values(agentsManifest)) {
    for (const keyName of agent.apiKeyNames) {
      const envKey = keyName.toUpperCase();
      const value = process.env[envKey];
      if (value) {
        secrets.push(value);
      }
    }
  }

  // for OpenCode: also scan all API_KEY environment variables (since apiKeyNames is empty)
  const opencodeAgent = agentsManifest.opencode;
  if (opencodeAgent && opencodeAgent.apiKeyNames.length === 0) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && typeof value === "string" && key.includes("API_KEY")) {
        secrets.push(value);
      }
    }
  }

  // add GitHub installation token
  try {
    const token = getGitHubInstallationToken();
    if (token) {
      secrets.push(token);
    }
  } catch {
    // token not set yet, ignore
  }

  return secrets;
}

export function redactSecrets(content: string, secrets?: string[]): string {
  const secretsToRedact = [...(secrets ?? []), ...getAllSecrets()];
  let redacted = content;
  for (const secret of secretsToRedact) {
    if (secret) {
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      redacted = redacted.replaceAll(new RegExp(escaped, "g"), "[REDACTED_SECRET]");
    }
  }
  return redacted;
}
