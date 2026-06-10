import { performance } from "node:perf_hooks";
import { log } from "../utils/cli.ts";
import { spawn } from "../utils/subprocess.ts";
import { installNodeDependencies } from "./installNodeDependencies.ts";
import { installPythonDependencies } from "./installPythonDependencies.ts";
import type { PrepDefinition, PrepOptions, PrepResult } from "./types.ts";

export type { PrepOptions, PrepResult } from "./types.ts";

// register all prep steps here
const prepSteps: PrepDefinition[] = [installNodeDependencies, installPythonDependencies];

/** tracked paths with staged or unstaged modifications. */
async function dirtyTrackedPaths(): Promise<Set<string>> {
  const result = await spawn({
    cmd: "git",
    args: ["diff", "--name-only", "HEAD"],
    env: process.env,
    activityTimeout: 0,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git diff --name-only HEAD failed (exit ${result.exitCode}): ${result.stderr.trim() || "(no stderr)"}`
    );
  }
  return new Set(result.stdout.split("\n").filter(Boolean));
}

/**
 * discard tracked-file mods left by prep steps so the customer checkout is
 * clean before agent tools run (#906: frozen installs run package lifecycle
 * scripts that rewrite tracked generated files like the msw worker, and the
 * resulting dirt makes `checkout_pr` refuse). only paths that were clean
 * before prep are restored — pre-existing dirt and files the agent touched
 * elsewhere are never clobbered. untracked files (e.g. node_modules) are
 * unaffected.
 */
async function restorePrepDirtiedFiles(preDirty: Set<string>): Promise<void> {
  const dirtied = [...(await dirtyTrackedPaths())].filter((path) => !preDirty.has(path));
  if (dirtied.length === 0) return;
  const result = await spawn({
    cmd: "git",
    args: ["restore", "--staged", "--worktree", "--", ...dirtied],
    env: process.env,
    activityTimeout: 0,
  });
  if (result.exitCode !== 0) {
    log.warning(
      `» failed to restore ${dirtied.length} tracked file(s) modified by prep: ${result.stderr.trim() || "(no stderr)"}`
    );
    return;
  }
  log.info(`» restored ${dirtied.length} tracked file(s) modified by prep: ${dirtied.join(", ")}`);
}

/**
 * run all prep steps sequentially.
 * failures are logged as warnings but don't stop the run.
 */
export async function runPrepPhase(options: PrepOptions): Promise<PrepResult[]> {
  log.debug("» starting prep phase...");
  const startTime = performance.now();
  const results: PrepResult[] = [];

  // prep is non-mutating by contract; snapshot so any tracked drift from
  // lifecycle scripts can be attributed to prep and restored, even when a
  // step fails partway through.
  const preDirty = await dirtyTrackedPaths();

  try {
    for (const step of prepSteps) {
      const shouldRun = await step.shouldRun();
      if (!shouldRun) {
        log.debug(`» skipping ${step.name} (not applicable)`);
        continue;
      }

      log.debug(`» running ${step.name}...`);
      const result = await step.run(options);
      results.push(result);

      if (result.dependenciesInstalled) {
        log.debug(`» ${step.name}: dependencies installed`);
      } else if (result.issues.length > 0) {
        log.warning(`» ${step.name}: ${result.issues[0]}`);
      }
    }
  } finally {
    await restorePrepDirtiedFiles(preDirty);
  }

  const totalDurationMs = performance.now() - startTime;
  log.debug(`» prep phase completed (${Math.round(totalDurationMs)}ms)`);

  return results;
}
