import type { AgentResult, TestRunnerOptions, ValidationCheck } from "../utils.ts";
import { defineFixture, generateAgentUuids, getStructuredOutput } from "../utils.ts";

/**
 * MCP merge tests - validate MCP server configuration with repo-level MCP configs present.
 *
 * uses GITHUB_REPOSITORY=pullfrog/test-repo-mcp which has robinMCP server.
 *
 * two variants:
 * - mcpmerge-full: validates repo-level MCP servers merge correctly with gh_pullfrog
 *   (claude, cursor, gemini, opencode - agents that auto-discover repo MCPs)
 * - mcpmerge-pullfrog-only: validates gh_pullfrog remains available when repo has MCP config
 *   (codex - doesn't auto-discover repo MCPs)
 */

// shared env for both tests
const sharedEnv = {
  GITHUB_REPOSITORY: "pullfrog/test-repo-mcp",
};

// --- mcpmerge-full: test repo-level MCP discovery ---

const fullTestUuids = generateAgentUuids(["PULLFROG_MCP_TEST"]);

const fullFixture = defineFixture(
  {
    prompt: `Call the get_test_value tool from the robinMCP server, then call set_output with the exact value returned.`,
    effort: "mini",
  },
  { localOnly: true }
);

function fullValidator(result: AgentResult): ValidationCheck[] {
  const output = getStructuredOutput(result);
  const setOutputCalled = output !== null;
  const expectedUuid = fullTestUuids.getUuid(result.agent, "PULLFROG_MCP_TEST");
  const correctValue = setOutputCalled && output === expectedUuid;

  return [
    { name: "set_output", passed: setOutputCalled },
    { name: "repo_mcp", passed: correctValue },
  ];
}

// --- mcpmerge-pullfrog-only: test gh_pullfrog availability only ---

const baseFixture = defineFixture(
  {
    prompt: `Call set_output with "PULLFROG_MCP_WORKS".`,
    effort: "mini",
  },
  { localOnly: true }
);

function baseValidator(result: AgentResult): ValidationCheck[] {
  const output = getStructuredOutput(result);
  const setOutputCalled = output !== null;
  const correctValue = setOutputCalled && output === "PULLFROG_MCP_WORKS";

  return [
    { name: "set_output", passed: setOutputCalled },
    { name: "correct_value", passed: correctValue },
  ];
}

// --- exports ---

export const tests: Record<string, TestRunnerOptions> = {
  "mcpmerge-full": {
    name: "mcpmerge-full",
    fixture: fullFixture,
    validator: fullValidator,
    tags: ["mcpmerge"],
    agents: ["claude", "cursor", "gemini", "opencode"],
    env: sharedEnv,
    agentEnv: fullTestUuids.agentEnv,
    fileAgentEnv: fullTestUuids.agentEnv,
  },
  "mcpmerge-pullfrog-only": {
    name: "mcpmerge-pullfrog-only",
    fixture: baseFixture,
    validator: baseValidator,
    tags: ["mcpmerge"],
    agents: ["codex"],
    env: sharedEnv,
  },
};
