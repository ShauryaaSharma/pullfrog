import "./arkConfig.ts";
import { createServer } from "node:net";
// this must be imported first
import { FastMCP, type Tool } from "fastmcp";
import type { Agent } from "../agents/index.ts";
import { ghPullfrogMcpName } from "../external.ts";
import type { Mode } from "../modes.ts";
import type { PrepResult } from "../prep/index.ts";
import type { OctokitWithPlugins } from "../utils/github.ts";
import type { ResolvedPayload } from "../utils/payload.ts";

export type BackgroundProcess = {
  pid: number;
  outputPath: string;
  pidPath: string;
};

export interface ToolState {
  prNumber?: number;
  issueNumber?: number;
  selectedMode?: string;
  backgroundProcesses: Map<string, BackgroundProcess>;
  review?: {
    id: number;
    nodeId: string;
  };
  dependencyInstallation?: {
    status: "not_started" | "in_progress" | "completed" | "failed";
    promise: Promise<PrepResult[]> | undefined;
    results: PrepResult[] | undefined;
  };
  progressCommentId: number | null;
  lastProgressBody?: string;
  wasUpdated?: boolean;
}

import type { ResolveRunResult } from "../utils/workflow.ts";

interface InitToolStateParams {
  runInfo: ResolveRunResult;
}

export function initToolState(ctx: InitToolStateParams): ToolState {
  const progressCommentIdStr = ctx.runInfo.workflowRunInfo.progressCommentId;
  const progressCommentId = progressCommentIdStr ? parseInt(progressCommentIdStr, 10) : null;
  const resolvedId = Number.isNaN(progressCommentId) ? null : progressCommentId;

  return {
    progressCommentId: resolvedId,
    backgroundProcesses: new Map(),
  };
}

export interface ToolContext {
  repo: RunContextData["repo"];
  payload: ResolvedPayload;
  octokit: OctokitWithPlugins;
  githubInstallationToken: string;
  apiToken: string;
  agent: Agent;
  modes: Mode[];
  toolState: ToolState;
  runId: string;
  jobId: string | undefined;
}

import type { RunContextData } from "../utils/runContextData.ts";
import { BashTool, KillBackgroundTool } from "./bash.ts";
import { CheckoutPrTool } from "./checkout.ts";
import { GetCheckSuiteLogsTool } from "./checkSuite.ts";
import {
  CreateCommentTool,
  EditCommentTool,
  ReplyToReviewCommentTool,
  ReportProgressTool,
} from "./comment.ts";
import { CommitInfoTool } from "./commitInfo.ts";
import {
  AwaitDependencyInstallationTool,
  StartDependencyInstallationTool,
} from "./dependencies.ts";
import { CommitFilesTool, CreateBranchTool, PushBranchTool } from "./git.ts";
import { IssueTool } from "./issue.ts";
import { GetIssueCommentsTool } from "./issueComments.ts";
import { GetIssueEventsTool } from "./issueEvents.ts";
import { IssueInfoTool } from "./issueInfo.ts";
import { AddLabelsTool } from "./labels.ts";
import { CreatePullRequestTool } from "./pr.ts";
import { PullRequestInfoTool } from "./prInfo.ts";
import { CreatePullRequestReviewTool } from "./review.ts";
import { GetReviewCommentsTool, ListPullRequestReviewsTool } from "./reviewComments.ts";
import { SelectModeTool } from "./selectMode.ts";
import { addTools } from "./shared.ts";
import { UploadFileTool } from "./upload.ts";

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const checkPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => {
        server.close();
        resolve(false);
      });
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
    });
  };

  let port = startPort;
  while (port < startPort + 100) {
    if (await checkPort(port)) {
      return port;
    }
    port++;
  }
  throw new Error(`Could not find available port starting from ${startPort}`);
}

async function killBackgroundProcesses(toolState: ToolState): Promise<void> {
  const backgroundProcesses = toolState.backgroundProcesses;
  if (backgroundProcesses.size === 0) return;
  for (const proc of backgroundProcesses.values()) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const proc of backgroundProcesses.values()) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
  backgroundProcesses.clear();
}

/**
 * Start the MCP HTTP server and return the URL and close function
 */
export async function startMcpHttpServer(
  ctx: ToolContext
): Promise<{ url: string; [Symbol.asyncDispose]: () => Promise<void> }> {
  const server = new FastMCP({
    name: ghPullfrogMcpName,
    version: "0.0.1",
  });

  // create all tools as factories, passing ctx
  const tools: Tool<any, any>[] = [
    SelectModeTool(ctx),
    StartDependencyInstallationTool(ctx),
    AwaitDependencyInstallationTool(ctx),
    CreateCommentTool(ctx),
    EditCommentTool(ctx),
    ReplyToReviewCommentTool(ctx),
    IssueTool(ctx),
    IssueInfoTool(ctx),
    GetIssueCommentsTool(ctx),
    GetIssueEventsTool(ctx),
    CreatePullRequestTool(ctx),
    CreatePullRequestReviewTool(ctx),
    PullRequestInfoTool(ctx),
    CommitInfoTool(ctx),
    CheckoutPrTool(ctx),
    GetReviewCommentsTool(ctx),
    ListPullRequestReviewsTool(ctx),
    GetCheckSuiteLogsTool(ctx),
    AddLabelsTool(ctx),
    CreateBranchTool(ctx),
    CommitFilesTool(ctx),
    PushBranchTool(ctx),
    UploadFileTool(ctx),
  ];

  // only add BashTool when bash is "restricted"
  // - "enabled": native bash only (no MCP bash needed)
  // - "restricted": MCP bash only (native blocked, env filtered)
  // - "disabled": no bash at all
  if (ctx.payload.bash === "restricted") {
    tools.push(BashTool(ctx));
    tools.push(KillBackgroundTool(ctx));
  }

  tools.push(ReportProgressTool(ctx));

  addTools(ctx, server, tools);

  const port = await findAvailablePort(3764);
  const host = "127.0.0.1";
  const endpoint = "/mcp";

  await server.start({
    transportType: "httpStream",
    httpStream: {
      port,
      host,
      endpoint,
    },
  });

  const url = `http://${host}:${port}${endpoint}`;

  return {
    url,
    [Symbol.asyncDispose]: async () => {
      await killBackgroundProcesses(ctx.toolState);
      await server.stop();
    },
  };
}
