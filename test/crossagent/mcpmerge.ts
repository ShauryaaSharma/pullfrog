import type { AgentResult, TestRunnerOptions, ValidationCheck } from "../utils.ts";
import { defineFixture, generateAgentUuids, getStructuredOutput } from "../utils.ts";

/**
 * MCP merge test - validates repo-level MCP servers merge correctly with gh_pullfrog.
 *
 * uses GITHUB_REPOSITORY=pullfrog/test-repo-mcp which has robinMCP server.
 * all agents should auto-discover repo-level MCP configs and merge them with gh_pullfrog.
 */

const testUuids = generateAgentUuids(["PULLFROG_MCP_TEST"]);

const fixture = defineFixture(
  {
    prompt: `Call the get_test_value tool from the robinMCP server, then call set_output with the exact value returned.`,
    effort: "mini",
  },
  { localOnly: true }
);

function validator(result: AgentResult): ValidationCheck[] {
  const output = getStructuredOutput(result);
  const setOutputCalled = output !== null;
  const expectedUuid = testUuids.getUuid(result.agent, "PULLFROG_MCP_TEST");
  const correctValue = setOutputCalled && output === expectedUuid;

  return [
    { name: "set_output", passed: setOutputCalled },
    { name: "repo_mcp", passed: correctValue },
  ];
}

export const test: TestRunnerOptions = {
  name: "mcpmerge",
  fixture,
  validator,
  tags: ["mcpmerge"],
  env: { GITHUB_REPOSITORY: "pullfrog/test-repo-mcp" },
  agentEnv: testUuids.agentEnv,
  fileAgentEnv: testUuids.agentEnv,
};
