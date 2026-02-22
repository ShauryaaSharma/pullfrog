import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type } from "arktype";
import { FastMCP } from "fastmcp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORCHESTRATOR_ONLY_TOOLS } from "./server.ts";
import { execute, tool } from "./shared.ts";
import { buildSubagentInstructions } from "./subagent.ts";

// ─── unit tests for pure exported functions ─────────────────────────────

describe("ORCHESTRATOR_ONLY_TOOLS", () => {
  it("includes delegation tools", () => {
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("select_mode");
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("delegate");
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("ask_question");
  });

  it("includes remote-mutating tools", () => {
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("push_branch");
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("push_tags");
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("delete_branch");
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("create_pull_request");
    expect(ORCHESTRATOR_ONLY_TOOLS).toContain("update_pull_request_body");
  });
});

describe("buildSubagentInstructions", () => {
  it("returns clean-room instructions with only the orchestrator prompt", () => {
    const prompt = "Read file.ts and fix the type error.";
    const instructions = buildSubagentInstructions(prompt);
    expect(instructions).toEqual({
      full: prompt,
      system: "",
      user: prompt,
      eventInstructions: "",
      repo: "",
      event: "",
      runtime: "",
    });
  });
});

// ─── per-server tool isolation integration test ─────────────────────────
// demonstrates the architecture: orchestrator and subagent get separate servers

function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") return reject(new Error("bad address"));
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function connectMcpClient(url: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  // @ts-expect-error — exactOptionalPropertyTypes mismatch: SDK Transport.sessionId?: string vs StreamableHTTPClientTransport getter returning string | undefined
  await client.connect(transport);
  return client;
}

function mockTool(name: string, description: string) {
  return tool({
    name,
    description,
    parameters: type({ value: "string" }),
    execute: execute(async () => ({ ok: true })),
  });
}

describe("per-server tool isolation - integration", () => {
  let orchestratorServer: FastMCP;
  let subagentServer: FastMCP;
  let orchestratorUrl: string;
  let subagentUrl: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    const [orchestratorPort, subagentPort] = await Promise.all([getRandomPort(), getRandomPort()]);
    orchestratorUrl = `http://127.0.0.1:${orchestratorPort}/mcp`;
    subagentUrl = `http://127.0.0.1:${subagentPort}/mcp`;

    // orchestrator gets ALL tools (common + delegation + remote mutation)
    orchestratorServer = new FastMCP({ name: "orchestrator", version: "0.0.1" });
    orchestratorServer.addTool(mockTool("file_read", "read a file"));
    orchestratorServer.addTool(mockTool("git", "run git commands"));
    orchestratorServer.addTool(mockTool("set_output", "set output"));
    orchestratorServer.addTool(mockTool("select_mode", "select a mode"));
    orchestratorServer.addTool(mockTool("delegate", "delegate a task"));
    orchestratorServer.addTool(mockTool("ask_question", "ask a question"));
    orchestratorServer.addTool(mockTool("push_branch", "push branch"));
    orchestratorServer.addTool(mockTool("create_pull_request", "create PR"));

    // subagent gets ONLY common tools (no delegation, no remote mutation)
    subagentServer = new FastMCP({ name: "subagent", version: "0.0.1" });
    subagentServer.addTool(mockTool("file_read", "read a file"));
    subagentServer.addTool(mockTool("git", "run git commands"));
    subagentServer.addTool(mockTool("set_output", "set output"));

    await Promise.all([
      orchestratorServer.start({
        transportType: "httpStream",
        httpStream: { port: orchestratorPort, host: "127.0.0.1", endpoint: "/mcp" },
      }),
      subagentServer.start({
        transportType: "httpStream",
        httpStream: { port: subagentPort, host: "127.0.0.1", endpoint: "/mcp" },
      }),
    ]);
  });

  afterAll(async () => {
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // best-effort cleanup
      }
    }
    await Promise.all([orchestratorServer.stop(), subagentServer.stop()]);
  });

  it("orchestrator sees all tools including delegation and mutation", async () => {
    const client = await connectMcpClient(orchestratorUrl);
    clients.push(client);
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("select_mode");
    expect(names).toContain("delegate");
    expect(names).toContain("ask_question");
    expect(names).toContain("push_branch");
    expect(names).toContain("create_pull_request");
    expect(names).toContain("file_read");
    expect(names).toContain("git");
    expect(names).toContain("set_output");
    expect(names.length).toBe(8);
  });

  it("subagent cannot see delegation or mutation tools", async () => {
    const client = await connectMcpClient(subagentUrl);
    clients.push(client);
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).not.toContain("select_mode");
    expect(names).not.toContain("delegate");
    expect(names).not.toContain("ask_question");
    expect(names).not.toContain("push_branch");
    expect(names).not.toContain("create_pull_request");
  });

  it("subagent sees only common tools", async () => {
    const client = await connectMcpClient(subagentUrl);
    clients.push(client);
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("file_read");
    expect(names).toContain("git");
    expect(names).toContain("set_output");
    expect(names.length).toBe(3);
  });
});
