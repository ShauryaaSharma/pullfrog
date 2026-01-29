import { type } from "arktype";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const SetOutputParams = type({
  value: type.string.describe("the output value to expose as a GitHub Action output"),
});

export function SetOutputTool(ctx: ToolContext) {
  return tool({
    name: "set_output",
    description:
      "Set the action output for consumption by subsequent workflow steps. The value will be available as the 'result' output of the action.",
    parameters: SetOutputParams,
    execute: execute(async (params) => {
      ctx.toolState.output = params.value;
      return { success: true };
    }),
  });
}
