import type { AgentResult, TestRunnerOptions, ValidationCheck } from "../utils.ts";
import { defineFixture } from "../utils.ts";

/**
 * timeout test - validates timeout enforcement works correctly.
 * sets a very short timeout (5s) and gives the agent a task that takes longer.
 * the run should fail with a timeout error.
 */

const fixture = defineFixture(
  {
    prompt: `Call the delegate tool with mode "Build" and effort "mini", then analyze the result.
Then call delegate with mode "Review" and effort "mini".
Finally call set_output with "TIMEOUT TEST COMPLETED".`,
    timeout: "5s",
    effort: "mini",
  },
  { localOnly: true }
);

function validator(result: AgentResult): ValidationCheck[] {
  // run should have failed due to timeout
  const timedOut = !result.success && /timed out/i.test(result.output);
  return [{ name: "timeout_triggered", passed: timedOut }];
}

export const test: TestRunnerOptions = {
  name: "timeout",
  fixture,
  validator,
  expectFailure: true,
  env: { GITHUB_REPOSITORY: "pullfrog/test-repo" },
  tags: ["agnostic"],
};
