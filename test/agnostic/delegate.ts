import type { AgentResult, TestRunnerOptions, ValidationCheck } from "../utils.ts";
import { defineFixture, getAgentOutput, getStructuredOutput } from "../utils.ts";

/**
 * delegate test - validates core end-to-end delegation flow.
 *
 * the orchestrator delegates to Plan mode with mini effort, passing instructions
 * that tell the subagent to call set_output with a specific value.
 * validates that the subagent executed and the result flows back.
 */

const fixture = defineFixture(
  {
    prompt: `Delegate to the Plan mode with mini effort. Pass these instructions to the subagent:
"This is a delegation test. Your only task is to call set_output with the value 'DELEGATE_BASIC_PASSED'. Do not create plans, branches, or PRs. Just call set_output."`,
    effort: "mini",
    timeout: "5m",
  },
  { localOnly: true }
);

function validator(result: AgentResult): ValidationCheck[] {
  const output = getStructuredOutput(result);
  const agentOutput = getAgentOutput(result);

  const setOutputCalled = output !== null;
  const correctValue = setOutputCalled && /DELEGATE_BASIC_PASSED/i.test(output);
  // check for the specific log line emitted by the delegate tool handler
  const delegationOccurred = /» delegating to \w+ mode/i.test(agentOutput);

  return [
    { name: "set_output", passed: setOutputCalled },
    { name: "correct_value", passed: correctValue },
    { name: "delegation_occurred", passed: delegationOccurred },
  ];
}

export const test: TestRunnerOptions = {
  name: "delegate",
  fixture,
  validator,
  env: { GITHUB_REPOSITORY: "pullfrog/test-repo" },
  tags: ["agnostic"],
};
