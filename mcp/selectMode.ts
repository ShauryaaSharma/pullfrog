import { type } from "arktype";
import { ghPullfrogMcpName } from "../external.ts";
import type { Mode } from "../modes.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const SelectModeParams = type({
  mode: type.string.describe(
    "the name of the mode to select (e.g., 'Build', 'Plan', 'Review', 'Fix', 'AddressReviews', 'Prompt')"
  ),
});

function resolveMode(modes: Mode[], modeName: string): Mode | null {
  return modes.find((m) => m.name.toLowerCase() === modeName.toLowerCase()) ?? null;
}

function defaultGuidance(mode: Mode): string {
  return `Delegate a single subagent for this "${mode.name}" task. Craft a self-contained prompt that includes all context the subagent needs. Include \`${ghPullfrogMcpName}/report_progress\` for user-facing updates and \`${ghPullfrogMcpName}/set_output\` to return results back to you. Subagents do NOT have push or PR creation tools — if the task involves code changes, you must push and create the PR yourself after the subagent completes.`;
}

const modeGuidance: Record<string, string> = {
  Build: `For Build tasks, consider a multi-phase approach:

1. **plan phase** (optional, for complex tasks): delegate a subagent to analyze the requirements, read AGENTS.md and relevant code, and produce a step-by-step implementation plan. Include \`${ghPullfrogMcpName}/set_output\` with the plan so it returns to you. Use mini or auto effort.

2. **build phase**: delegate a subagent with the implementation task. Include in its prompt:
   - the plan (if you ran a plan phase)
   - specific files to modify and why
   - branch naming: \`pullfrog/<issue-number>-<description>\`
   - testing expectations: run relevant tests/lints before committing
   - commit changes locally (do NOT instruct to push or create a PR — subagents cannot do that)
   - call \`${ghPullfrogMcpName}/report_progress\` with a summary of changes
   - call \`${ghPullfrogMcpName}/set_output\` with a concise summary including the branch name (this is how results get back to you)

3. **post-delegation** (your responsibility as orchestrator): after the build subagent completes:
   - push the branch via \`${ghPullfrogMcpName}/push_branch\`
   - create a PR via \`${ghPullfrogMcpName}/create_pull_request\`
   - call \`${ghPullfrogMcpName}/report_progress\` with the final summary including PR link

4. **review phase** (optional, for high-stakes changes): delegate a review subagent to verify the implementation.

For simple, well-defined tasks, a single build subagent is sufficient — skip the plan and review phases.

Your subagent receives ONLY what you write. Include file paths, constraints, conventions, and any context from AGENTS.md or the codebase directly in the prompt. Subagents do NOT have push_branch, create_pull_request, or other remote-mutating tools.`,

  AddressReviews: `Delegate a single subagent to address PR review feedback:

Include in its prompt:
- the PR number to checkout via \`${ghPullfrogMcpName}/checkout_pr\`
- instruct it to fetch review comments via \`${ghPullfrogMcpName}/get_review_comments\`
- reply to EACH comment individually via \`${ghPullfrogMcpName}/reply_to_review_comment\`
- resolve threads via \`${ghPullfrogMcpName}/resolve_review_thread\` after addressing them
- test changes and commit locally (do NOT instruct to push — subagents cannot do that)
- call \`${ghPullfrogMcpName}/report_progress\` with a brief summary
- call \`${ghPullfrogMcpName}/set_output\` with a concise summary of what was addressed (this is how results get back to you)

After the subagent completes, push the changes via \`${ghPullfrogMcpName}/push_branch\`.

Use auto or max effort depending on review complexity.`,

  Review: `Delegate a single review subagent:

Include in its prompt:
- the PR number to checkout via \`${ghPullfrogMcpName}/checkout_pr\`
- what aspects to focus on (if any specific concerns exist)
- instruct it to read the diff, trace data flow, check boundaries, and verify assumptions
- draft inline comments with NEW line numbers from the diff
- submit via \`${ghPullfrogMcpName}/create_pull_request_review\`
- use GitHub permalink format for code references
- call \`${ghPullfrogMcpName}/set_output\` with a concise review summary (this is how results get back to you)

Use max effort for thorough reviews.`,

  Plan: `Delegate a single planning subagent:

Include in its prompt:
- the task to plan for
- relevant codebase context (file paths, architecture notes from AGENTS.md)
- instruct it to produce a structured, actionable plan with clear milestones
- call \`${ghPullfrogMcpName}/report_progress\` with the plan
- call \`${ghPullfrogMcpName}/set_output\` with the plan (this is how results get back to you — you'll need the plan to craft the next subagent's prompt)

Use mini or auto effort. After receiving the plan, you may delegate a Build subagent to implement it.`,

  Fix: `For CI fix tasks, consider a focused single-phase approach:

Delegate a single fix subagent with:
- the check_suite_id to fetch logs via \`${ghPullfrogMcpName}/get_check_suite_logs\`
- the PR number to checkout via \`${ghPullfrogMcpName}/checkout_pr\`
- CRITICAL: instruct it to verify the failure was INTRODUCED BY THIS PR before fixing. If unrelated, abort and report.
- instruct it to read the workflow file, reproduce locally, fix, verify, and commit (do NOT instruct to push — subagents cannot do that)
- call \`${ghPullfrogMcpName}/report_progress\` with what was fixed
- call \`${ghPullfrogMcpName}/set_output\` with a concise summary of the fix (this is how results get back to you)

After the subagent completes, push the changes via \`${ghPullfrogMcpName}/push_branch\`.

Use auto effort.`,

  Prompt: `Delegate a single subagent for this general-purpose task:

Include in its prompt:
- the full task description with all relevant context
- if code changes are needed: branch naming, testing, commit instructions (do NOT instruct to push or create PR)
- call \`${ghPullfrogMcpName}/report_progress\` with results
- call \`${ghPullfrogMcpName}/set_output\` with a concise summary (this is how results get back to you)

If the task involved code changes, push via \`${ghPullfrogMcpName}/push_branch\` and create a PR via \`${ghPullfrogMcpName}/create_pull_request\` after the subagent completes.

Use mini effort for simple tasks (labeling, commenting), auto for typical tasks.`,
};

type OrchestratorGuidance = {
  modeName: string;
  description: string;
  orchestratorGuidance: string;
};

function buildOrchestratorGuidance(mode: Mode): OrchestratorGuidance {
  const guidance = modeGuidance[mode.name] ?? defaultGuidance(mode);
  return {
    modeName: mode.name,
    description: mode.description,
    orchestratorGuidance: guidance,
  };
}

export function SelectModeTool(ctx: ToolContext) {
  return tool({
    name: "select_mode",
    description:
      "Select a mode and receive orchestrator-level guidance on how to handle it, including suggested delegation flows and prompt-crafting tips. Call this before delegating to understand the best approach for the task.",
    parameters: SelectModeParams,
    execute: execute(async (params) => {
      const selectedMode = resolveMode(ctx.modes, params.mode);

      if (!selectedMode) {
        const availableModes = ctx.modes.map((m) => m.name).join(", ");
        return {
          error: `mode "${params.mode}" not found. available modes: ${availableModes}`,
          availableModes: ctx.modes.map((m) => ({
            name: m.name,
            description: m.description,
          })),
        };
      }

      ctx.toolState.selectedMode = selectedMode.name;
      return buildOrchestratorGuidance(selectedMode);
    }),
  });
}
