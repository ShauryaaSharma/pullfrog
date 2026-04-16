import { describe, expect, it } from "vitest";
import { modelAliases, resolveCliModel } from "../models.ts";

// ── pure alias-registry invariants ──────────────────────────────────────────────
//
// these tests validate our alias data structure without hitting external APIs.
// network-dependent checks (models.dev / OpenRouter catalog drift, latest-model
// snapshot) live in models-catalog.main.test.ts and run only on main.

// models that have no OpenRouter equivalent and require BYOK.
// add a model here ONLY when it genuinely doesn't exist on both models.dev and OpenRouter.
const BYOK_ONLY_MODELS = new Set(["openai/o3"]);

describe("openRouterResolve completeness", () => {
  for (const alias of modelAliases) {
    if (alias.isFree) continue;
    if (BYOK_ONLY_MODELS.has(alias.slug)) continue;
    it(`${alias.slug} has openRouterResolve`, () => {
      expect(
        alias.openRouterResolve,
        `non-free model "${alias.slug}" is missing openRouterResolve — add it or add to BYOK_ONLY_MODELS`
      ).toBeDefined();
    });
  }

  for (const alias of modelAliases) {
    if (!alias.isFree) continue;
    it(`${alias.slug} (free) does not need openRouterResolve`, () => {
      expect(alias.openRouterResolve).toBeUndefined();
    });
  }
});

describe("fallback chain resolution", () => {
  for (const alias of modelAliases.filter((a) => a.fallback)) {
    it(`${alias.slug} fallback chain resolves to a non-deprecated model`, () => {
      const resolved = resolveCliModel(alias.slug);
      expect(
        resolved,
        `fallback chain for "${alias.slug}" does not resolve to a non-deprecated model`
      ).toBeDefined();
    });
  }
});
