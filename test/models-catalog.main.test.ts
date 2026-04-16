import { describe, expect, it } from "vitest";
import { type ModelProvider, modelAliases, providers } from "../models.ts";

// ── catalog drift tests — main-only ─────────────────────────────────────────────
//
// these tests fetch models.dev and openrouter.ai to verify that every alias in
// models.ts still corresponds to a live, non-deprecated upstream model. upstream
// catalog drift (new model ships, old model deprecated, etc.) causes failures
// that are unrelated to any code change in the PR — so these run only on main.
//
// run locally with `pnpm test:catalog`.
// in CI, gated to push events on main.

type ModelsDevModel = {
  name: string;
  status?: string;
  release_date?: string;
};

type ModelsDevProvider = {
  name: string;
  models: Record<string, ModelsDevModel>;
};

type ModelsDevApi = Record<string, ModelsDevProvider>;

const api = fetch("https://models.dev/api.json").then((r) => r.json() as Promise<ModelsDevApi>);

function parseResolve(resolve: string): { provider: string; modelId: string } {
  const idx = resolve.indexOf("/");
  return { provider: resolve.slice(0, idx), modelId: resolve.slice(idx + 1) };
}

describe("models.dev validity", async () => {
  const data = await api;

  for (const alias of modelAliases) {
    const parsed = parseResolve(alias.resolve);

    it(`${alias.resolve} exists on models.dev`, () => {
      const providerData = data[parsed.provider];
      expect(providerData, `provider "${parsed.provider}" not found on models.dev`).toBeDefined();
      const model = providerData.models[parsed.modelId];
      expect(
        model,
        `model "${parsed.modelId}" not found under ${parsed.provider} on models.dev`
      ).toBeDefined();
    });

    if (!alias.fallback) {
      it(`${alias.resolve} is not deprecated`, () => {
        const model = data[parsed.provider]?.models[parsed.modelId];
        if (!model) return; // covered by existence test above
        expect(model.status, `${alias.resolve} is deprecated on models.dev`).not.toBe("deprecated");
      });
    }
  }
});

describe("openRouterResolve models.dev validity", async () => {
  const data = await api;
  const seen = new Set<string>();

  for (const alias of modelAliases) {
    if (!alias.openRouterResolve) continue;
    if (seen.has(alias.openRouterResolve)) continue;
    seen.add(alias.openRouterResolve);

    const parsed = parseResolve(alias.openRouterResolve);

    it(`${alias.openRouterResolve} exists on models.dev`, () => {
      const providerData = data[parsed.provider];
      expect(providerData, `provider "${parsed.provider}" not found on models.dev`).toBeDefined();
      const model = providerData.models[parsed.modelId];
      expect(
        model,
        `model "${parsed.modelId}" not found under ${parsed.provider} on models.dev`
      ).toBeDefined();
    });
  }
});

type OpenRouterModel = { id: string };
type OpenRouterModelsResponse = { data: OpenRouterModel[] };

const openRouterApi = fetch("https://openrouter.ai/api/v1/models").then(
  (r) => r.json() as Promise<OpenRouterModelsResponse>
);

describe("openRouterResolve OpenRouter API validity", async () => {
  const orData = await openRouterApi;
  const orModelIds = new Set(orData.data.map((m) => m.id));
  const seen = new Set<string>();

  for (const alias of modelAliases) {
    if (!alias.openRouterResolve) continue;
    const orModelId = alias.openRouterResolve.slice("openrouter/".length);
    if (seen.has(orModelId)) continue;
    seen.add(orModelId);

    it(`${orModelId} exists on OpenRouter`, () => {
      expect(
        orModelIds.has(orModelId),
        `model "${orModelId}" not found in OpenRouter API (/api/v1/models)`
      ).toBe(true);
    });
  }
});

describe("latest model per provider snapshot", async () => {
  const data = await api;
  const providerKeys = Object.keys(providers) as ModelProvider[];

  const latestByProvider: Record<string, { modelId: string; releaseDate: string }> = {};

  for (const key of providerKeys) {
    const providerData = data[key];
    if (!providerData) continue;

    let latest: { modelId: string; releaseDate: string } | undefined;
    for (const [modelId, model] of Object.entries(providerData.models)) {
      // skip non-GA models so beta/nightly churn doesn't break the snapshot
      if (model.status) continue;
      const rd = model.release_date;
      if (!rd) continue;
      // tiebreak by modelId for stable ordering when release dates match
      if (
        !latest ||
        rd > latest.releaseDate ||
        (rd === latest.releaseDate && modelId > latest.modelId)
      ) {
        latest = { modelId, releaseDate: rd };
      }
    }
    if (latest) {
      latestByProvider[key] = latest;
    }
  }

  // when this fails, a provider shipped a new model. check whether we need
  // to add or update an alias in models.ts before updating the snapshot.
  it("matches snapshot", () => {
    expect(latestByProvider).toMatchSnapshot();
  });
});
