import { type } from "arktype";
import { ghPullfrogMcpName } from "../external.ts";
import { log } from "../utils/cli.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";
import { createSubagentState, runSubagent } from "./subagent.ts";

export const AskQuestionParams = type({
  question: type.string.describe(
    "the question to answer about the codebase, architecture, or implementation details"
  ),
});

function buildQuestionPrompt(question: string): string {
  return `You are a focused research subagent. Answer the following question by exploring the codebase using the available MCP tools (${ghPullfrogMcpName}/file_read, ${ghPullfrogMcpName}/list_directory, etc.).

Be thorough in your investigation but concise in your answer. When done, call ${ghPullfrogMcpName}/set_output with a maximally concise answer — key facts only, no filler, no preamble.

Question: ${question}`;
}

export function AskQuestionTool(ctx: ToolContext) {
  return tool({
    name: "ask_question",
    description:
      "Ask a question about the codebase and get a concise answer from a lightweight research subagent. The intermediate exploration context stays in the subagent — only the concise answer returns to you.",
    parameters: AskQuestionParams,
    execute: execute(async (params) => {
      if (ctx.toolState.activeSubagentId) {
        return { error: "cannot ask questions while a subagent is already running" };
      }

      const subagent = createSubagentState({ ctx, mode: "ask_question" });
      log.info(`» ask_question subagent=${subagent.id}: ${params.question.slice(0, 100)}`);

      const result = await runSubagent({
        ctx,
        subagent,
        effort: "mini",
        instructions: buildQuestionPrompt(params.question),
      });
      log.info(`» ask_question completed (success=${result.success})`);

      return {
        success: result.success,
        answer:
          subagent.output ??
          result.error ??
          "no answer produced — the subagent may not have called set_output. check stdoutFile for details.",
        stdoutFile: subagent.stdoutFilePath,
      };
    }),
  });
}
