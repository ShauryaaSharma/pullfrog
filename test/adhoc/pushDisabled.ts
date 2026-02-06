import type { AgentResult, TestRunnerOptions, ValidationCheck } from "../utils.ts";
import { defineFixture, getAgentOutput, getStructuredOutput } from "../utils.ts";

/**
 * push disabled test - validates that all push operations are blocked.
 *
 * run with: pnpm runtest pushDisabled
 */

const fixture = defineFixture(
  {
    prompt: `You are testing git permissions with push: disabled.

## Test 1: Read Operations (should work)
Try these git commands via the git MCP tool:
1. \`git status\`
2. \`git log --oneline -3\`

## Test 2: Push Operations (should all fail)
Try each of these and report the exact error:
1. Call push_branch tool - should fail
2. Call delete_branch tool with branchName "any-branch" - should fail
3. Call push_tags tool with tag "v1.0.0" - should fail

Call set_output with a JSON object containing:
{
  "git_status_works": true/false,
  "git_log_works": true/false,
  "push_branch_blocked": true/false,
  "push_branch_error": "exact error",
  "delete_branch_blocked": true/false,
  "push_tags_blocked": true/false
}`,
    push: "disabled",
    bash: "restricted",
    effort: "auto",
    timeout: "5m",
  },
  { localOnly: true }
);

function validator(result: AgentResult): ValidationCheck[] {
  const output = getStructuredOutput(result);
  const setOutputCalled = output !== null;

  let parsed: Record<string, unknown> = {};
  if (output) {
    try {
      parsed = JSON.parse(output);
    } catch {
      // not valid JSON
    }
  }

  // read operations should work
  const gitStatusWorks = parsed.git_status_works === true;
  const gitLogWorks = parsed.git_log_works === true;

  // all push operations should be blocked
  const pushBranchBlocked = parsed.push_branch_blocked === true;
  const deleteBranchBlocked = parsed.delete_branch_blocked === true;
  const pushTagsBlocked = parsed.push_tags_blocked === true;

  return [
    { name: "set_output", passed: setOutputCalled },
    { name: "git_status_works", passed: gitStatusWorks },
    { name: "git_log_works", passed: gitLogWorks },
    { name: "push_branch_blocked", passed: pushBranchBlocked },
    { name: "delete_branch_blocked", passed: deleteBranchBlocked },
    { name: "push_tags_blocked", passed: pushTagsBlocked },
  ];
}

export const test: TestRunnerOptions = {
  name: "push-disabled",
  fixture,
  validator,
  env: { GITHUB_REPOSITORY: "pullfrog/test-repo" },
  tags: ["adhoc", "agnostic"],
};
