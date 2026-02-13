import { log } from "./cli.ts";

/**
 * resolve the Pullfrog API base URL.
 *
 * in the action: API_URL is not explicitly set, so this falls back to https://pullfrog.com.
 * in local dev: API_URL=http://localhost:3000 (from .env).
 */
export function getApiUrl(): string {
  const url = process.env.API_URL || "https://pullfrog.com";
  log.debug(`resolved API_URL: ${url}`);
  return url;

}

/**
 * returns headers needed to bypass Vercel deployment protection on preview deployments.
 * when VERCEL_AUTOMATION_BYPASS_SECRET is set (preview repos), includes the bypass header.
 * otherwise returns an empty object (production / local dev).
 */
export function getVercelBypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return {};
  return { "x-vercel-protection-bypass": secret };
}
