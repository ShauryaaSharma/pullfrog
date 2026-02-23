import { type } from "arktype";
import { Effort } from "../external.ts";
import { log } from "../utils/cli.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";
import { createSubagentState, runSubagent } from "./subagent.ts";

export const DelegateParams = type({
  instructions: type.string.describe(
    "the complete prompt for the subagent. the subagent receives ONLY this text — include all context it needs (file paths, constraints, conventions, tool usage instructions). craft a focused, self-contained task description."
  ),
  "effort?": Effort.describe(
    'effort level for the subagent: "mini" (low-effort and fast, only for simple tasks), "auto" (medium-effort, good for typical tasks that don\'t require significant reasoning), or "max" (high-effort, good for PR reviews and complex coding tasks)'
  ),
});

export function DelegateTool(ctx: ToolContext) {
  return tool({
    name: "delegate",
    description:
      "Delegate a task to a subagent. The subagent receives ONLY the instructions you provide — no other context is added. Use select_mode first to get guidance on how to craft the instructions for a given mode. Subagents have access to file operations, local git, bash, commenting, and review tools. They do NOT have push_branch, create_pull_request, update_pull_request_body, delete_branch, push_tags, delegate, ask_question, or select_mode — remote-mutating operations are your responsibility as orchestrator.",
    parameters: DelegateParams,
    execute: execute(async (params) => {
      if (ctx.toolState.activeSubagentId) {
        return {
          error:
            "delegation is not available inside a subagent. you are already running as a delegated subagent. complete the task directly using the available tools.",
        };
      }

      const effort = params.effort ?? "auto";
      const mode = ctx.toolState.selectedMode ?? "unknown";
      if (!ctx.toolState.selectedMode) {
        log.info(`» warning: delegating without calling select_mode first (mode=${mode})`);
      }
      const subagent = createSubagentState({ ctx, mode });

      log.info(`» delegating subagent=${subagent.id} (mode=${mode}, effort=${effort})`);
      const result = await runSubagent({
        ctx,
        subagent,
        effort,
        instructions: params.instructions,
      });
      log.info(`» delegation completed (mode=${mode}, success=${result.success})`);

      return {
        success: result.success,
        mode,
        effort,
        summary:
          subagent.output ??
          result.error ??
          "no output produced — the subagent may not have called set_output. check stdoutFile for full logs.",
        stdoutFile: subagent.stdoutFilePath,
        error: result.error,
      };
    }),
  });
}
