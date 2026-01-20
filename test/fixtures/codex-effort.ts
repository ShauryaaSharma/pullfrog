import type { Effort, Payload } from "../../external.ts";
import packageJson from "../../package.json" with { type: "json" };

/**
 * Test fixture for Codex effort levels.
 * Runs all three effort levels in sequence.
 *
 * Run with:
 *   AGENT_OVERRIDE=codex pnpm play codex-effort.ts
 *
 * Effort levels:
 *   - "mini": gpt-5.1-codex-mini + modelReasoningEffort: "low"
 *   - "auto": gpt-5.1-codex + default reasoning
 *   - "max": gpt-5.1-codex-max + modelReasoningEffort: "high"
 */

const efforts: Effort[] = ["mini", "auto", "max"];

export default efforts.map((effort) => ({
  "~pullfrog": true,
  version: packageJson.version,
  agent: "codex",
  prompt: "What is 2 + 2? Reply with just the number.",
  event: {
    trigger: "workflow_dispatch",
  },
  modes: [],
  effort,
})) satisfies Payload[];
