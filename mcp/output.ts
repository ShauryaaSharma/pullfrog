import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { Ajv } from "ajv";
import { type } from "arktype";
import { log } from "../utils/cli.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const SetOutputParams = type({
  value: type.string.describe("the output value to expose as a GitHub Action output"),
});

type JsonSchema = Record<string, unknown>;

function jsonSchemaToStandardSchema({
  $schema: _,
  ...jsonSchema
}: JsonSchema): StandardJSONSchemaV1<any> & StandardSchemaV1<any> {
  const ajv = new Ajv();
  const validate = ajv.compile(jsonSchema);

  return {
    "~standard": {
      version: 1,
      vendor: "json-schema",
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
      validate(input: unknown) {
        if (validate(input)) {
          return { value: input };
        }
        return {
          issues: (validate.errors ?? []).map((err) => ({
            message: `${err.instancePath || "/"}: ${err.message ?? "validation error"}`,
            path: err.instancePath ? err.instancePath.split("/").filter(Boolean) : [],
          })),
        };
      },
    },
  };
}

function storeOutput(ctx: ToolContext, value: string) {
  const selfId = ctx.toolState.selfSubagentId;
  if (selfId) {
    const subagent = ctx.toolState.subagents.get(selfId);
    if (subagent) {
      subagent.output = value;
      log.debug(`set_output: routed to subagent ${selfId} (value=${value.slice(0, 80)})`);
      return { success: true, routed: "subagent" as const };
    }
    log.warning(
      `set_output: selfSubagentId=${selfId} but subagent not found in map — routing to action output`
    );
  }
  ctx.toolState.output = value;
  return { success: true, routed: "action_output" as const };
}

export function SetOutputTool(ctx: ToolContext, outputSchema?: JsonSchema) {
  if (outputSchema) {
    return tool({
      name: "set_output",
      description:
        "Set the structured action output. You MUST call this tool before finishing — the output is required. Pass the output object directly as the tool arguments (no wrapping needed).",
      parameters: jsonSchemaToStandardSchema(outputSchema),
      execute: execute(async (params) => {
        return storeOutput(ctx, JSON.stringify(params));
      }),
    });
  }

  return tool({
    name: "set_output",
    description:
      "Set the action output. When called by a subagent, returns a summary result to the orchestrator — this is the ONLY way to pass results back. When called by the orchestrator in standalone mode (trigger: unknown), exposes the value as the 'result' GitHub Action output for downstream workflow steps. Do NOT use this for progress reporting — use report_progress instead.",
    parameters: SetOutputParams,
    execute: execute(async (params) => {
      return storeOutput(ctx, params.value);
    }),
  });
}
