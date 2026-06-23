/**
 * Predicate for transient network errors that should be retried (vs. fail fast
 * on explicit HTTP status / validation errors that carry their own message).
 *
 * Matches errors from `fetch` (`fetch failed`), TCP-level interruption
 * (`ECONNRESET`, `ETIMEDOUT`), and `AbortSignal.timeout` (`AbortError`).
 * Callers may pass `extraPatterns` to whitelist additional transient
 * substrings on `error.message` (e.g. provider-specific framings).
 */
export function isTransientNetworkError(error: unknown, extraPatterns: string[] = []): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  const patterns = ["fetch failed", "ECONNRESET", "ETIMEDOUT", ...extraPatterns];
  return patterns.some((p) => error.message.includes(p));
}
