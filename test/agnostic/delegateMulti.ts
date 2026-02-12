import type { AgentResult, TestRunnerOptions, ValidationCheck } from "../utils.ts";
import { defineFixture, getAgentOutput, getStructuredOutput } from "../utils.ts";

/**
 * delegateMulti test - validates multi-phase delegation with context passing.
 *
 * the orchestrator delegates twice:
 * 1. first to Plan mode (subagent calls set_output with PHASE_1_MARKER)
 * 2. then to Plan mode again with context from phase 1 (subagent calls set_output with MULTI_DELEGATE_PASSED)
 *
 * validates that both delegations executed and the final set_output value is correct.
 */

const fixture = defineFixture(
  {
    prompt: `This is a multi-delegation test. You must delegate exactly twice:

Phase 1: Delegate to Plan mode with mini effort. Pass these instructions:
"Your task is to call set_output with the value 'PHASE_1_MARKER'. Do not create plans or PRs."

Phase 2: After Phase 1 completes, delegate to Plan mode again with mini effort. Pass these instructions (include the result from Phase 1 as context):
"Your task is to call set_output with the value 'MULTI_DELEGATE_PASSED'. Do not create plans or PRs."

Both delegations must complete successfully.`,
    effort: "mini",
    timeout: "8m",
  },
  { localOnly: true }
);

function validator(result: AgentResult): ValidationCheck[] {
  const output = getStructuredOutput(result);
  const agentOutput = getAgentOutput(result);

  const setOutputCalled = output !== null;
  // the last set_output call wins — should be from Phase 2
  const finalValue = setOutputCalled && /MULTI_DELEGATE_PASSED/i.test(output);

  // count delegation evidence — match the exact log line format from the delegate handler
  const delegationMatches = agentOutput.match(/» delegating to/g);
  const twoDelegations = delegationMatches !== null && delegationMatches.length >= 2;

  return [
    { name: "set_output", passed: setOutputCalled },
    { name: "final_value", passed: finalValue },
    { name: "two_delegations", passed: twoDelegations },
  ];
}

export const test: TestRunnerOptions = {
  name: "delegate-multi",
  fixture,
  validator,
  env: { GITHUB_REPOSITORY: "pullfrog/test-repo" },
  tags: ["agnostic"],
};
