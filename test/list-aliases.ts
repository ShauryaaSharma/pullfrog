/**
 * emits a JSON array of { slug, agent, name } entries for the `models-live`
 * matrix job. `agent` is auto-derived from the alias provider and matches the
 * harness the runtime would pick in production.
 *
 * usage: `node action/test/list-aliases.ts`
 */
import { modelAliases } from "../models.ts";

function agentForSlug(slug: string): "claude" | "opencode" {
  return slug.startsWith("anthropic/") ? "claude" : "opencode";
}

const matrix = modelAliases.map((alias) => ({
  slug: alias.slug,
  agent: agentForSlug(alias.slug),
  // readable display name (GHA renders slashes awkwardly in matrix job titles)
  name: alias.slug.replace("/", "-"),
}));

process.stdout.write(JSON.stringify(matrix));
