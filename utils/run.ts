import type { AgentResult } from "../agents/shared.ts";
import type { MainResult } from "../main.ts";
import { log } from "./cli.ts";

export function handleAgentResult(result: AgentResult): MainResult {
  if (!result.success) {
    return {
      success: false,
      error: result.error || "Agent execution failed",
      output: result.output!,
    };
  }

  log.success("Task complete.");

  return {
    success: true,
    output: result.output || "",
  };
}
