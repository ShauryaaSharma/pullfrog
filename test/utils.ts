import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { agentsManifest } from "../external.ts";
import type { Inputs } from "../main.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const actionDir = join(__dirname, "..");

// load .env files
config({ path: join(actionDir, ".env") });
config({ path: join(actionDir, "..", ".env") });

const LOCAL_TEST_WARNING = "This is a local test - do not post any comments to GitHub.";

export type FixtureOptions = {
  localOnly?: boolean;
};

// type-safe fixture builder with optional local test warning
export function defineFixture(inputs: Inputs, options?: FixtureOptions): Inputs {
  if (options?.localOnly) {
    return {
      ...inputs,
      prompt: `${inputs.prompt}\n\n${LOCAL_TEST_WARNING}`,
    };
  }
  return inputs;
}

export const agents = Object.keys(agentsManifest) as (keyof typeof agentsManifest)[];

export type AgentUuids<T extends string> = {
  // get marker value for a specific agent and env var
  getUuid: (agent: string, envVar: T) => string;
  // pre-built agentEnv map for runTests
  agentEnv: Map<string, Record<string, string>>;
};

// create unique per-agent markers for env vars (useful for detecting if agent executed something)
export function generateAgentUuids<T extends string>(envVarNames: T[]): AgentUuids<T> {
  // generate unique markers: envVar -> agent -> marker
  const markers = new Map<T, Map<string, string>>();
  for (const envVar of envVarNames) {
    const agentMap = new Map<string, string>();
    for (const agent of agents) {
      agentMap.set(agent, randomUUID());
    }
    markers.set(envVar, agentMap);
  }

  // build agentEnv map for runTests
  const agentEnv = new Map<string, Record<string, string>>();
  for (const agent of agents) {
    const env: Record<string, string> = {};
    for (const envVar of envVarNames) {
      env[envVar] = markers.get(envVar)!.get(agent)!;
    }
    agentEnv.set(agent, env);
  }

  return {
    getUuid: (agent, envVar) => markers.get(envVar)?.get(agent) ?? "",
    agentEnv,
  };
}

// assign consistent colors to agents (using ANSI codes)
const AGENT_COLORS: Record<string, string> = {
  claude: "\x1b[35m", // magenta
  codex: "\x1b[32m", // green
  cursor: "\x1b[36m", // cyan
  gemini: "\x1b[33m", // yellow
  opencode: "\x1b[34m", // blue
};
const RESET = "\x1b[0m";

function getAgentPrefix(agent: string): string {
  const color = AGENT_COLORS[agent] ?? "\x1b[37m";
  return `${color}[${agent}]${RESET}`;
}

export interface AgentResult {
  agent: string;
  success: boolean;
  output: string;
}

// get agent output with GitHub Actions masking commands filtered out
// ::add-mask:: lines contain env var values but aren't actual agent output
export function getAgentOutput(result: AgentResult): string {
  return result.output
    .split("\n")
    .filter((line) => !line.includes("::add-mask::"))
    .join("\n");
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
}

export interface ValidationResult {
  agent: string;
  passed: boolean;
  checks: ValidationCheck[];
  output: string;
}

export type ValidatorFn = (result: AgentResult) => ValidationCheck[];

export interface RunOptions {
  fixture: Inputs;
  env?: Record<string, string> | undefined;
}

// run agent and stream output with prefix labels
export async function runAgentStreaming(agent: string, options: RunOptions): Promise<AgentResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const prefix = getAgentPrefix(agent);

    const child = spawn("node", ["play.ts"], {
      cwd: actionDir,
      env: {
        ...process.env,
        AGENT_OVERRIDE: agent,
        PLAY_FIXTURE: JSON.stringify(options.fixture),
        ...options.env,
      },
      stdio: "pipe",
    });

    // buffer for incomplete lines
    let buffer = "";

    function processChunk(data: Buffer): void {
      chunks.push(data);
      buffer += data.toString();

      // split on newlines and print complete lines with prefix
      const lines = buffer.split("\n");
      // keep the last incomplete line in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) {
          console.log(`${prefix} ${line}`);
        }
      }
    }

    child.stdout?.on("data", processChunk);
    child.stderr?.on("data", processChunk);

    child.on("close", (code) => {
      // flush any remaining buffer
      if (buffer.trim()) {
        console.log(`${prefix} ${buffer}`);
      }
      resolve({
        agent,
        success: code === 0,
        output: Buffer.concat(chunks).toString(),
      });
    });
  });
}

// run agent silently (collect output without streaming)
export async function runAgent(agent: string, options: RunOptions): Promise<AgentResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    const child = spawn("node", ["play.ts"], {
      cwd: actionDir,
      env: {
        ...process.env,
        AGENT_OVERRIDE: agent,
        PLAY_FIXTURE: JSON.stringify(options.fixture),
        ...options.env,
      },
      stdio: "pipe",
    });

    child.stdout?.on("data", (data) => chunks.push(data));
    child.stderr?.on("data", (data) => chunks.push(data));

    child.on("close", (code) => {
      resolve({
        agent,
        success: code === 0,
        output: Buffer.concat(chunks).toString(),
      });
    });
  });
}

export function validateResult(result: AgentResult, validator: ValidatorFn): ValidationResult {
  const checks = validator(result);
  const allPassed = checks.every((c) => c.passed);

  return {
    agent: result.agent,
    passed: result.success && allPassed,
    checks,
    output: result.output,
  };
}

export interface RunAllOptions {
  fixture: Inputs;
  env?: Record<string, string> | undefined;
  // per-agent env vars (for unique markers)
  agentEnv?: Map<string, Record<string, string>> | undefined;
}

// run all agents in parallel with streaming output
export async function runAllAgentsStreaming(options: RunAllOptions): Promise<AgentResult[]> {
  return Promise.all(
    agents.map((agent) => {
      const env = { ...options.env, ...options.agentEnv?.get(agent) };
      return runAgentStreaming(agent, { fixture: options.fixture, env });
    })
  );
}

export interface TestRunnerOptions {
  name: string;
  fixture: Inputs;
  validator: ValidatorFn;
  env?: Record<string, string>;
  // per-agent env vars (for unique markers)
  agentEnv?: Map<string, Record<string, string>>;
}

export async function runTests(options: TestRunnerOptions): Promise<void> {
  const agentArg = process.argv[2];

  if (agentArg) {
    // single agent mode
    if (!agents.includes(agentArg as (typeof agents)[number])) {
      console.error(`unknown agent: ${agentArg}`);
      console.error(`available agents: ${agents.join(", ")}`);
      process.exit(1);
    }
    console.log(`running ${options.name} for: ${agentArg}\n`);
    const env = { ...options.env, ...options.agentEnv?.get(agentArg) };
    const result = await runAgentStreaming(agentArg, { fixture: options.fixture, env });
    const validation = validateResult(result, options.validator);
    console.log();
    printSingleValidation(validation);
    process.exit(validation.passed ? 0 : 1);
  }

  // parallel mode with streaming
  console.log(`running ${options.name} for: ${agents.join(", ")}\n`);

  const results = await runAllAgentsStreaming({
    fixture: options.fixture,
    env: options.env,
    agentEnv: options.agentEnv,
  });

  console.log();
  const validations = results.map((r) => validateResult(r, options.validator));

  printResults(validations);

  const failed = validations.filter((v) => !v.passed);
  process.exit(failed.length > 0 ? 1 : 0);
}

export function printSingleValidation(validation: ValidationResult): void {
  const checksStr = validation.checks.map((c) => `${c.name}=${c.passed ? "✓" : "✗"}`).join(" ");
  console.log(`\nvalidation: ${checksStr}`);
}

export function printResults(validations: ValidationResult[]): void {
  // build header from check names
  const checkNames = validations[0]?.checks.map((c) => c.name) ?? [];
  const headerCols = checkNames.map((n) => n.toUpperCase().padEnd(14)).join("");

  console.log("Results:");
  console.log("-".repeat(70));
  console.log(`STATUS  AGENT       ${headerCols}`);
  console.log("-".repeat(70));

  for (const v of validations) {
    const color = AGENT_COLORS[v.agent] ?? "";
    const status = v.passed ? "✅ PASS" : "❌ FAIL";
    const checkCols = v.checks.map((c) => (c.passed ? "✓" : "✗").padEnd(14)).join("");
    console.log(`${status}  ${color}${v.agent.padEnd(10)}${RESET}  ${checkCols}`);
  }
  console.log("-".repeat(70));

  const passed = validations.filter((v) => v.passed);
  console.log(`\n${passed.length}/${validations.length} passed`);
}
