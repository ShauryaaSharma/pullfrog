type ProviderErrorPattern = { regex: RegExp; label: string };

// status codes are only treated as provider errors when they are adjacent to
// a recognised status key. this rejects commit SHAs that happen to contain
// "429", version strings, file hashes, etc.
const statusKey = `\\b(?:status[_ ]?code|http[_ ]?status|status)["']?\\s*[:=]\\s*["']?`;

const PROVIDER_ERROR_PATTERNS: ProviderErrorPattern[] = [
  { regex: new RegExp(`${statusKey}429\\b`, "i"), label: "rate limited (429)" },
  { regex: new RegExp(`${statusKey}500\\b`, "i"), label: "provider 500 error" },
  { regex: new RegExp(`${statusKey}503\\b`, "i"), label: "provider unavailable (503)" },
  // matches `rate limit`, `rate limited`, `rate limits exceeded`,
  // `rate_limit_error`, `rate_limit_exceeded`. the leading `\b` + `[_ ]`
  // separator rejects `x-ratelimit-*` / `anthropic-ratelimit-*` response
  // headers (no separator between "rate" and "limit") which routinely
  // appear in dumped 401 / 4xx error JSON.
  { regex: /\brate[_ ]limit/i, label: "rate limited" },
  { regex: /\bRESOURCE_EXHAUSTED\b/, label: "quota exhausted" },
  // Google gRPC `INTERNAL` status. word-boundary anchors reject
  // `INTERNAL_SERVER_ERROR` (HTTP 500 message that may appear in unrelated
  // log lines) and identifiers like `INTERNALS`.
  { regex: /\bINTERNAL\b/, label: "provider internal error" },
  { regex: /\bUNAVAILABLE\b/, label: "provider unavailable" },
  // matches `quota`, `insufficient_quota`, `quota_exceeded`, `quotaExceeded`.
  // word-character lookarounds would reject `_quota` / `quotaX`; `quota` is
  // specific enough that a plain substring match is safe.
  { regex: /quota/i, label: "quota error" },
  // explicit zero-quota response, e.g. `{"limit": 0}`. the `\b` anchor
  // around `limit` rejects keys like `time_limit` or `field_limit`.
  { regex: /["']?\blimit\b["']?\s*:\s*0\b/, label: "zero quota" },
];

export function detectProviderError(text: string): string | null {
  for (const entry of PROVIDER_ERROR_PATTERNS) {
    if (entry.regex.test(text)) return entry.label;
  }
  return null;
}
