/**
 * Secret detection and env filtering utilities
 */

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
