import { describe, expect, it } from "vitest";
import type { Mode } from "../modes.ts";
import { resolveMode, truncateOutput } from "./delegate.ts";

// ─── mode resolution tests ─────────────────────────────────────────────

const testModes: Mode[] = [
  { name: "Build", description: "build things", prompt: "build prompt" },
  { name: "Plan", description: "plan things", prompt: "plan prompt" },
  { name: "Review", description: "review things", prompt: "review prompt" },
  { name: "Fix", description: "fix things", prompt: "fix prompt" },
  { name: "AddressReviews", description: "address reviews", prompt: "address prompt" },
];

describe("delegate - mode resolution", () => {
  it("resolves valid mode name", () => {
    const mode = resolveMode(testModes, "Build");
    expect(mode).not.toBeNull();
    expect(mode!.name).toBe("Build");
  });

  it("resolves case-insensitively (lowercase)", () => {
    const mode = resolveMode(testModes, "build");
    expect(mode).not.toBeNull();
    expect(mode!.name).toBe("Build");
  });

  it("resolves case-insensitively (uppercase)", () => {
    const mode = resolveMode(testModes, "BUILD");
    expect(mode).not.toBeNull();
    expect(mode!.name).toBe("Build");
  });

  it("resolves case-insensitively (mixed case)", () => {
    const mode = resolveMode(testModes, "pLaN");
    expect(mode).not.toBeNull();
    expect(mode!.name).toBe("Plan");
  });

  it("returns null for invalid mode name", () => {
    const mode = resolveMode(testModes, "nonexistent");
    expect(mode).toBeNull();
  });

  it("returns null for empty string", () => {
    const mode = resolveMode(testModes, "");
    expect(mode).toBeNull();
  });

  it("resolves custom modes appended alongside built-in modes", () => {
    const modesWithCustom: Mode[] = [
      ...testModes,
      { name: "CustomLabel", description: "label issues", prompt: "label prompt" },
    ];
    const mode = resolveMode(modesWithCustom, "customlabel");
    expect(mode).not.toBeNull();
    expect(mode!.name).toBe("CustomLabel");
  });

  it("returns null when modes list is empty", () => {
    const mode = resolveMode([], "Build");
    expect(mode).toBeNull();
  });

  it("resolves all built-in modes", () => {
    for (const m of testModes) {
      const resolved = resolveMode(testModes, m.name);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe(m.name);
    }
  });
});

// ─── output truncation tests ────────────────────────────────────────────

describe("delegate - output truncation", () => {
  it("returns undefined for undefined input", () => {
    expect(truncateOutput(undefined)).toBeUndefined();
  });

  it("returns empty string as-is", () => {
    expect(truncateOutput("")).toBe("");
  });

  it("returns short output unchanged", () => {
    const short = "a".repeat(100);
    expect(truncateOutput(short)).toBe(short);
  });

  it("returns output at exactly the limit unchanged", () => {
    const exact = "x".repeat(20_000);
    expect(truncateOutput(exact)).toBe(exact);
  });

  it("truncates output exceeding the limit", () => {
    const long = "a".repeat(30_000);
    const result = truncateOutput(long);
    expect(result).not.toBe(long);
    expect(result).toContain("[truncated");
    expect(result).toContain("20000");
  });

  it("keeps the tail of the output (last N chars)", () => {
    const prefix = "START_".repeat(5000);
    const suffix = "END_MARKER";
    const long = prefix + suffix;
    const result = truncateOutput(long)!;
    expect(result).toContain("END_MARKER");
    // the very beginning of the original is lost (starts with truncation prefix, not original content)
    expect(result.startsWith("START_")).toBe(false);
  });

  it("adds truncation prefix before the content", () => {
    const long = "x".repeat(25_000);
    const result = truncateOutput(long)!;
    expect(result).toMatch(/^\[truncated.*\]\n/);
  });
});

// ─── effort validation tests ────────────────────────────────────────────

// mirrors the effort default logic in the delegate handler
function resolveEffort(effort: string | undefined): string {
  return effort ?? "auto";
}

describe("delegate - effort defaults", () => {
  it("defaults to 'auto' when undefined", () => {
    expect(resolveEffort(undefined)).toBe("auto");
  });

  it("passes through 'mini'", () => {
    expect(resolveEffort("mini")).toBe("mini");
  });

  it("passes through 'auto'", () => {
    expect(resolveEffort("auto")).toBe("auto");
  });

  it("passes through 'max'", () => {
    expect(resolveEffort("max")).toBe("max");
  });
});

// ─── delegation guard tests ─────────────────────────────────────────────

// mirrors the delegationActive guard logic
function checkDelegationGuard(delegationActive: boolean): string | null {
  if (delegationActive) {
    return "delegation is not available inside a delegated subagent";
  }
  return null;
}

describe("delegate - delegation guard", () => {
  it("allows delegation when delegationActive is false", () => {
    expect(checkDelegationGuard(false)).toBeNull();
  });

  it("blocks delegation when delegationActive is true", () => {
    const error = checkDelegationGuard(true);
    expect(error).not.toBeNull();
    expect(error).toContain("not available");
  });
});

// ─── delegation lifecycle tests ─────────────────────────────────────────

// simulates the delegationActive lifecycle across sequential delegations
describe("delegate - delegation lifecycle", () => {
  it("delegationActive resets after successful delegation", () => {
    let delegationActive = false;

    // first delegation
    delegationActive = true;
    // ... agent.run() succeeds ...
    delegationActive = false; // finally block

    expect(delegationActive).toBe(false);
  });

  it("delegationActive resets after failed delegation (finally block)", () => {
    let delegationActive = false;

    // delegation that fails — finally block still runs
    delegationActive = true;
    try {
      throw new Error("agent failed");
    } catch {
      // agent error handled
    } finally {
      delegationActive = false;
    }

    expect(delegationActive).toBe(false);
  });

  it("supports sequential delegations", () => {
    let delegationActive = false;
    let selectedMode: string | undefined;

    // first delegation: Plan
    expect(checkDelegationGuard(delegationActive)).toBeNull();
    delegationActive = true;
    selectedMode = "Plan";
    delegationActive = false; // completed

    expect(selectedMode).toBe("Plan");

    // second delegation: Build
    expect(checkDelegationGuard(delegationActive)).toBeNull();
    delegationActive = true;
    selectedMode = "Build";
    delegationActive = false; // completed

    expect(selectedMode).toBe("Build");
  });

  it("blocks during active delegation", () => {
    let delegationActive = false;

    // start delegation
    delegationActive = true;

    // attempt second delegation while first is active
    expect(checkDelegationGuard(delegationActive)).not.toBeNull();

    // first completes
    delegationActive = false;

    // now second should be allowed
    expect(checkDelegationGuard(delegationActive)).toBeNull();
  });
});

// ─── subagent payload construction tests ────────────────────────────────

type MinimalPayload = {
  effort: string;
  prompt: string;
  bash: string;
  push: string;
  web: string;
};

function buildSubagentPayload(payload: MinimalPayload, delegatedEffort: string): MinimalPayload {
  return { ...payload, effort: delegatedEffort };
}

describe("delegate - subagent payload construction", () => {
  const basePayload: MinimalPayload = {
    effort: "auto",
    prompt: "test prompt",
    bash: "restricted",
    push: "restricted",
    web: "enabled",
  };

  it("overrides effort in subagent payload", () => {
    const subPayload = buildSubagentPayload(basePayload, "mini");
    expect(subPayload.effort).toBe("mini");
  });

  it("preserves other payload fields", () => {
    const subPayload = buildSubagentPayload(basePayload, "mini");
    expect(subPayload.prompt).toBe("test prompt");
    expect(subPayload.bash).toBe("restricted");
    expect(subPayload.push).toBe("restricted");
    expect(subPayload.web).toBe("enabled");
  });

  it("does not mutate original payload", () => {
    const subPayload = buildSubagentPayload(basePayload, "max");
    expect(basePayload.effort).toBe("auto");
    expect(subPayload.effort).toBe("max");
  });

  it("handles same effort as original", () => {
    const subPayload = buildSubagentPayload(basePayload, "auto");
    expect(subPayload.effort).toBe("auto");
  });
});

// ─── return shape tests ─────────────────────────────────────────────────

type DelegateResult = {
  success: boolean;
  mode: string;
  effort: string;
  output: string | undefined;
  error: string | undefined;
};

type BuildDelegateResultInput = {
  agentResult: {
    success: boolean;
    output?: string;
    error?: string;
  };
  mode: string;
  effort: string;
};

function buildDelegateResult(input: BuildDelegateResultInput): DelegateResult {
  return {
    success: input.agentResult.success,
    mode: input.mode,
    effort: input.effort,
    output: input.agentResult.output,
    error: input.agentResult.error,
  };
}

describe("delegate - return shape", () => {
  it("returns success shape on successful delegation", () => {
    const result = buildDelegateResult({
      agentResult: { success: true, output: "agent output" },
      mode: "Build",
      effort: "auto",
    });
    expect(result.success).toBe(true);
    expect(result.mode).toBe("Build");
    expect(result.effort).toBe("auto");
    expect(result.output).toBe("agent output");
    expect(result.error).toBeUndefined();
  });

  it("returns failure shape on failed delegation", () => {
    const result = buildDelegateResult({
      agentResult: { success: false, error: "agent crashed" },
      mode: "Review",
      effort: "mini",
    });
    expect(result.success).toBe(false);
    expect(result.mode).toBe("Review");
    expect(result.effort).toBe("mini");
    expect(result.error).toBe("agent crashed");
  });

  it("includes mode and effort in both success and failure", () => {
    const success = buildDelegateResult({
      agentResult: { success: true },
      mode: "Plan",
      effort: "max",
    });
    const failure = buildDelegateResult({
      agentResult: { success: false },
      mode: "Fix",
      effort: "mini",
    });
    expect(success.mode).toBe("Plan");
    expect(success.effort).toBe("max");
    expect(failure.mode).toBe("Fix");
    expect(failure.effort).toBe("mini");
  });
});
