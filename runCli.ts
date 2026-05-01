import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import actionPackageJson from "./package.json" with { type: "json" };

interface RunPullfrogCliParams {
  cliArgs: string[];
  swallowErrors?: boolean;
}

interface RuntimeContext {
  actionRef: string | undefined;
  actionRepository: string | undefined;
  actionRoot: string;
  nodeBinDir: string;
  env: NodeJS.ProcessEnv;
}

const NPM_REGISTRY = "https://registry.npmjs.org";
const FALLBACK_PACKAGE_SPEC = `pullfrog@^${actionPackageJson.version}`;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canAccessExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    if (process.platform !== "win32") {
      return false;
    }
  }

  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(params: { command: string; env: NodeJS.ProcessEnv }): string | null {
  const pathValue = params.env.PATH ?? "";
  const pathEntries = pathValue.split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (params.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(pathEntry, `${params.command}${extension.toLowerCase()}`);
      if (canAccessExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function createRuntimeContext(): RuntimeContext {
  const actionRoot = dirname(fileURLToPath(import.meta.url));
  const nodeBinDir = dirname(process.execPath);
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.npm_config_registry = NPM_REGISTRY;
  env.COREPACK_NPM_REGISTRY = NPM_REGISTRY;
  const currentPath = process.env.PATH ?? "";
  env.PATH = currentPath ? `${nodeBinDir}${delimiter}${currentPath}` : nodeBinDir;

  return {
    actionRef: process.env.GITHUB_ACTION_REF,
    actionRepository: process.env.GITHUB_ACTION_REPOSITORY,
    actionRoot,
    nodeBinDir,
    env,
  };
}

function runCommand(params: { context: RuntimeContext; command: string; args: string[] }): void {
  execFileSync(params.command, params.args, {
    cwd: process.env.GITHUB_WORKSPACE || params.context.actionRoot,
    stdio: "inherit",
    env: params.context.env,
  });
}

// resolve a launcher binary by walking PATH (which already has the action
// runtime's nodeBinDir prepended). some hosted Node 24 runner pools ship
// `node` at `externals/node24/bin/node` without the sibling `npx`/`corepack`,
// so a hardcoded sibling path can't be relied on — fall back to whatever the
// runner image provides on PATH.
function requireExecutable(params: {
  context: RuntimeContext;
  command: string;
  purpose: string;
}): string {
  const resolved = resolveExecutable({ command: params.command, env: params.context.env });
  if (!resolved) {
    throw new Error(
      `could not find ${params.command} on PATH (needed to ${params.purpose}); ` +
        `runtime PATH was: ${params.context.env.PATH ?? "<empty>"}`
    );
  }
  return resolved;
}

function runPackageCli(context: RuntimeContext, packageSpec: string, cliArgs: string[]): void {
  const npxPath = resolveExecutable({ command: "npx", env: context.env });
  if (npxPath) {
    runCommand({ context, command: npxPath, args: ["--yes", packageSpec, ...cliArgs] });
    return;
  }

  const corepackPath = resolveExecutable({ command: "corepack", env: context.env });
  if (corepackPath) {
    console.warn("» npx not found, using corepack pnpm dlx");
    runCommand({ context, command: corepackPath, args: ["pnpm", "dlx", packageSpec, ...cliArgs] });
    return;
  }

  throw new Error(
    `could not find npx or corepack on PATH to run ${packageSpec}; ` +
      `runtime PATH was: ${context.env.PATH ?? "<empty>"}`
  );
}

function ensureActionDependencies(context: RuntimeContext): void {
  const nodeModulesPath = join(context.actionRoot, "node_modules");
  if (existsSync(nodeModulesPath)) {
    return;
  }

  const corepackPath = requireExecutable({
    context,
    command: "corepack",
    purpose: "install action dependencies via pnpm",
  });
  const adjacentCorepack = join(
    context.nodeBinDir,
    process.platform === "win32" ? "corepack.cmd" : "corepack"
  );
  if (corepackPath !== adjacentCorepack) {
    // bad-runner case: GitHub's externals/node24/bin/ is missing the corepack
    // sibling, so we resolved via PATH instead. logging this lets us correlate
    // bootstrap path to runner pool when validating the fix.
    console.warn(
      `» nodeBinDir corepack missing (${adjacentCorepack}); using PATH-resolved ${corepackPath}`
    );
  }
  execFileSync(corepackPath, ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: context.actionRoot,
    stdio: "inherit",
    env: context.env,
  });
}

function runLocalCli(context: RuntimeContext, cliArgs: string[]): void {
  ensureActionDependencies(context);
  execFileSync(process.execPath, ["cli.ts", ...cliArgs], {
    cwd: context.actionRoot,
    stdio: "inherit",
    env: context.env,
  });
}

function runPullfrogCliInner(context: RuntimeContext, cliArgs: string[]): void {
  if (process.env.PULLFROG_FORCE_LOCAL_CLI === "1") {
    runLocalCli(context, cliArgs);
    return;
  }

  if (context.actionRef === "main" && context.actionRepository === "pullfrog/pullfrog") {
    runLocalCli(context, cliArgs);
    return;
  }

  runPackageCli(context, FALLBACK_PACKAGE_SPEC, cliArgs);
}

export function runPullfrogCli(params: RunPullfrogCliParams): void {
  const context = createRuntimeContext();

  if (params.swallowErrors) {
    try {
      runPullfrogCliInner(context, params.cliArgs);
    } catch (error) {
      console.warn(`» pullfrog cleanup bootstrap failed: ${getErrorMessage(error)}`);
      // best-effort cleanup
    }
    return;
  }

  runPullfrogCliInner(context, params.cliArgs);
}
