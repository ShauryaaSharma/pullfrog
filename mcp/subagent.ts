import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Effort } from "../external.ts";
import { markActivity } from "../utils/activity.ts";
import type { ResolvedInstructions } from "../utils/instructions.ts";
import { type SubagentState, startSubagentMcpServer, type ToolContext } from "./server.ts";

type CreateSubagentParams = {
  ctx: ToolContext;
  mode: string;
};

export function createSubagentState(params: CreateSubagentParams): SubagentState {
  const id = randomUUID();
  const stdoutFilePath = join(params.ctx.tmpdir, `subagent-${id}.log`);
  const state: SubagentState = {
    id,
    status: "running",
    mode: params.mode,
    stdoutFilePath,
    output: undefined,
    usage: undefined,
    startedAt: Date.now(),
    keepAliveInterval: undefined,
  };
  params.ctx.toolState.subagents.set(id, state);
  params.ctx.toolState.activeSubagentId = id;
  return state;
}

type CompleteSubagentParams = {
  ctx: ToolContext;
  subagent: SubagentState;
  success: boolean;
};

function completeSubagent(params: CompleteSubagentParams): void {
  params.subagent.status = params.success ? "completed" : "failed";
  if (params.subagent.keepAliveInterval) {
    clearInterval(params.subagent.keepAliveInterval);
    params.subagent.keepAliveInterval = undefined;
  }
  if (params.subagent.usage) {
    params.ctx.toolState.usageEntries.push(params.subagent.usage);
  }
  params.ctx.toolState.activeSubagentId = undefined;
  // keep completed subagents in the map for post-completion inspection
}

export function buildSubagentInstructions(orchestratorPrompt: string): ResolvedInstructions {
  return {
    full: orchestratorPrompt,
    system: "",
    user: orchestratorPrompt,
    eventInstructions: "",
    repo: "",
    event: "",
    runtime: "",
  };
}

type RunSubagentParams = {
  ctx: ToolContext;
  subagent: SubagentState;
  effort: Effort;
  instructions: string;
};

type RunSubagentResult = {
  success: boolean;
  error: string | undefined;
};

export async function runSubagent(params: RunSubagentParams): Promise<RunSubagentResult> {
  params.subagent.keepAliveInterval = setInterval(markActivity, 30_000);
  const mcpServer = await startSubagentMcpServer(params.ctx);
  try {
    const subagentPayload = { ...params.ctx.payload, effort: params.effort };
    const subagentInstructions = buildSubagentInstructions(params.instructions);
    const result = await params.ctx.agent.run({
      payload: subagentPayload,
      mcpServerUrl: mcpServer.url,
      tmpdir: params.ctx.tmpdir,
      instructions: subagentInstructions,
    });
    params.subagent.usage = result.usage;
    writeFileSync(params.subagent.stdoutFilePath, result.output ?? "", "utf-8");
    completeSubagent({ ctx: params.ctx, subagent: params.subagent, success: result.success });
    return { success: result.success, error: result.error };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      writeFileSync(params.subagent.stdoutFilePath, "", "utf-8");
    } catch {
      // best-effort
    }
    completeSubagent({ ctx: params.ctx, subagent: params.subagent, success: false });
    return { success: false, error: errorMessage };
  } finally {
    await mcpServer.stop();
  }
}
