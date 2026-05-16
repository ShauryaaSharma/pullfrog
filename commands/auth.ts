// `pullfrog auth <provider>` — manage credentials for a configured repo
// without going through the full `init` flow. currently supports:
//
//   pullfrog auth codex   mint a Codex subscription credential and save it
//                         as the `CODEX_AUTH_JSON` Pullfrog secret
//
// the `codex` subcommand runs `codex login --device-auth` against an
// isolated `CODEX_HOME` (so the user's existing ~/.codex/auth.json is never
// touched), validates the resulting auth.json, and posts it to the Pullfrog
// secrets API. used both for first-time setup of a Codex subscription on a
// repo and for rotating a stale credential.

import * as p from "@clack/prompts";
import arg from "arg";
import pc from "picocolors";
import { mintCodexAuth, refreshCodexAuth } from "../utils/codexAuth.ts";
import {
  bail,
  fetchStatus,
  getGhToken,
  handleCancel,
  PULLFROG_API_URL,
  parseGitRemote,
  promptScope,
  type SecretScope,
  setActiveSpin,
  setPullfrogSecret,
} from "./_shared.ts";

const CODEX_AUTH_SECRET = "CODEX_AUTH_JSON";

/** strip CSI ANSI escapes (color, cursor) from a string so callers can re-style
 * the visible text without inheriting the source's formatting. covers what
 * Codex emits during device auth (mostly `\x1b[<digits>m` color codes).
 */
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars by design
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

interface AuthCliParams {
  args: string[];
  prog: string;
  showHelp?: boolean;
}

function printAuthUsage(params: { stream: typeof console.log; prog: string }): void {
  params.stream(`usage: ${params.prog} auth <provider>\n`);
  params.stream("manage provider credentials for the current repository.");
  params.stream("");
  params.stream("providers:");
  params.stream("  codex   mint a Codex (ChatGPT) subscription credential");
  params.stream("");
  params.stream("options:");
  params.stream("  -h, --help   show help");
}

function printCodexUsage(params: { stream: typeof console.log; prog: string }): void {
  params.stream(`usage: ${params.prog} auth codex [options]\n`);
  params.stream("mint a Codex subscription credential and save it as CODEX_AUTH_JSON.");
  params.stream("");
  params.stream("options:");
  params.stream("  --scope <account|repo>  where to store the secret in Pullfrog. on");
  params.stream("                          org-owned repos you're prompted to choose");
  params.stream("                          interactively; user-owned repos always use");
  params.stream("                          `account`. pass this flag to skip the prompt.");
  params.stream("  -h, --help              show help");
}

export async function runCli(params: AuthCliParams): Promise<void> {
  // route `auth --help` (no subcommand) to top-level usage. when the user
  // passes `auth codex --help`, we leave the flag in the rest args so the
  // subcommand's own parser handles it.
  const firstArg = params.args[0];
  const helpAtTopLevel =
    params.showHelp ||
    params.args.length === 0 ||
    (params.args.length === 1 && (firstArg === "--help" || firstArg === "-h"));
  if (helpAtTopLevel) {
    printAuthUsage({ stream: console.log, prog: params.prog });
    return;
  }

  const subcommand = firstArg;
  const rest = params.args.slice(1);

  if (subcommand === "codex") {
    await runCodex({ args: rest, prog: params.prog });
    return;
  }

  console.error(`unknown auth provider: ${pc.bold(subcommand)}\n`);
  printAuthUsage({ stream: console.error, prog: params.prog });
  process.exit(1);
}

interface CodexCliParams {
  args: string[];
  prog: string;
}

function parseCodexArgs(args: string[]) {
  return arg(
    {
      "--help": Boolean,
      "--scope": String,
      "-h": "--help",
    },
    { argv: args }
  );
}

async function runCodex(params: CodexCliParams): Promise<void> {
  let parsed: ReturnType<typeof parseCodexArgs>;
  try {
    parsed = parseCodexArgs(params.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${message}\n`);
    printCodexUsage({ stream: console.error, prog: params.prog });
    process.exit(1);
  }

  if (parsed["--help"]) {
    printCodexUsage({ stream: console.log, prog: params.prog });
    return;
  }

  const rawScope = parsed["--scope"];
  let explicitScope: SecretScope | null = null;
  if (rawScope !== undefined) {
    if (rawScope === "account" || rawScope === "repo") {
      explicitScope = rawScope;
    } else {
      console.error(`invalid --scope: ${rawScope} (must be "account" or "repo")\n`);
      printCodexUsage({ stream: console.error, prog: params.prog });
      process.exit(1);
    }
  }

  await runCodexAuth({ explicitScope });
}

interface RunCodexAuthCtx {
  explicitScope: SecretScope | null;
}

async function runCodexAuth(ctx: RunCodexAuthCtx): Promise<void> {
  p.intro(pc.bgGreen(pc.black(" pullfrog auth codex ")));

  const spin = p.spinner();
  setActiveSpin(spin);

  try {
    spin.start("authenticating with github");
    const token = getGhToken();
    spin.stop("github authenticated");

    spin.start("detecting repository");
    const remote = parseGitRemote();
    spin.stop(`detected repo ${pc.cyan(`${remote.owner}/${remote.repo}`)}`);

    spin.start("checking pullfrog app installation");
    const status = await fetchStatus({ token, owner: remote.owner, repo: remote.repo });
    if (!status.installed) {
      spin.stop(pc.red("pullfrog app not installed on this repo"));
      bail(
        `install pullfrog on ${pc.bold(`${remote.owner}/${remote.repo}`)} before configuring auth.\n` +
          `  ${pc.dim("run:")} ${pc.cyan(`npx pullfrog init`)}`
      );
    }
    spin.stop(`pullfrog app is installed on ${pc.cyan(`@${remote.owner}`)}`);

    if (status.pullfrogSecrets.includes(CODEX_AUTH_SECRET)) {
      const overwrite = await p.select({
        message: `${pc.cyan(CODEX_AUTH_SECRET)} is already configured — overwrite?`,
        options: [
          { value: true, label: "overwrite", hint: "rotate to a freshly minted credential" },
          { value: false, label: "cancel" },
        ],
      });
      handleCancel(overwrite);
      if (!overwrite) {
        p.cancel("canceled.");
        return;
      }
    }

    // user-owned repos can only ever be "account" (Pullfrog has no per-repo
    // store for user accounts), so we never bother prompting. on org-owned
    // repos, default to interactive prompt — matches `init`'s behavior —
    // unless the caller passed `--scope` to skip it.
    let scope: SecretScope;
    if (ctx.explicitScope) {
      scope = ctx.explicitScope;
    } else if (status.isOrg) {
      scope = await promptScope({ owner: remote.owner, repo: remote.repo });
    } else {
      scope = "account";
    }

    p.log.info(
      [
        `signing in via Codex device authorization. open the URL Codex prints`,
        `below, enter the one-time code, and approve in your browser.`,
        ``,
        `${pc.dim("note:")} if your ChatGPT account doesn't have device-code auth enabled,`,
        `Codex will exit early. enable it at ${pc.cyan(`https://chatgpt.com/#settings/Security`)}`,
        `then re-run ${pc.cyan(`${process.env.PULLFROG_BIN_NAME || "pullfrog"} auth codex`)}.`,
      ].join("\n")
    );

    // tracks the most recent exit so the retry prompt can tell the user
    // *why* no auth.json was written (timeout vs. early-exit).
    let lastTimedOut = false;
    const auth = await mintCodexAuth({
      childStdio: "pipe",
      onChildLine: (line) => {
        // dim Codex's own colored output (URL/code in cyan, boilerplate in
        // gray) so the user reads it as sub-process noise, not Pullfrog's
        // own prompts. the rail char matches @clack/prompts so the column
        // reads as one continuous flow.
        process.stdout.write(`${pc.gray(p.S_BAR)}  ${pc.dim(stripAnsi(line))}\n`);
      },
      onProgress: (event) => {
        if (event.kind === "start") {
          lastTimedOut = false;
          if (event.attempt > 1) p.log.info(`retry attempt ${event.attempt}`);
          // shell-prompt style header so the user sees what Pullfrog is
          // about to spawn, with the rail to keep the visual column.
          process.stdout.write(`${pc.gray(p.S_BAR)}\n`);
          process.stdout.write(`${pc.gray(p.S_BAR)}  $ codex login --device-auth\n`);
        }
        if (event.kind === "exit") {
          if (event.timedOut) lastTimedOut = true;
          // trailing blank rail so the next clack prompt isn't crammed
          // against the last codex output line.
          process.stdout.write(`${pc.gray(p.S_BAR)}\n`);
        }
      },
      shouldRetry: async () => {
        const message = lastTimedOut
          ? "device authorization timed out — retry?"
          : "no auth.json was written — retry?";
        const retry = await p.select({
          message,
          options: [
            { value: true, label: "retry", hint: "after enabling device-code auth" },
            { value: false, label: "cancel" },
          ],
        });
        handleCancel(retry);
        return retry;
      },
    });

    // eager refresh: bump the OAuth chain once before persisting so the
    // saved token is one Pullfrog has used. otherwise the user's laptop's
    // codex CLI could refresh first and strand our copy.
    spin.start("refreshing token");
    let savable: typeof auth;
    try {
      savable = await refreshCodexAuth(auth);
      spin.stop("refreshed");
    } catch (err) {
      spin.stop(pc.yellow("refresh failed — saving minted token as-is"));
      p.log.warn(err instanceof Error ? err.message : String(err));
      savable = auth;
    }

    spin.start(`saving ${pc.cyan(CODEX_AUTH_SECRET)} to Pullfrog`);
    const result = await setPullfrogSecret({
      token,
      owner: remote.owner,
      repo: remote.repo,
      name: CODEX_AUTH_SECRET,
      value: savable.json,
      scope,
    });
    if (!result.saved) {
      spin.stop(pc.red("could not save secret"));
      p.log.warn(
        `${result.error}\n  ${pc.dim("set it manually at:")} ${PULLFROG_API_URL}/console/${remote.owner}`
      );
      process.exit(1);
    }
    spin.stop(`saved ${pc.cyan(CODEX_AUTH_SECRET)} to Pullfrog (${scope})`);

    setActiveSpin(null);
    p.outro("done.");
  } catch (error) {
    // mirror what `bail` does: stop the spinner with a red "failed" glyph
    // before clearing it, otherwise an in-flight spinner keeps animating
    // above the error message we're about to print.
    spin.stop(pc.red("failed"));
    setActiveSpin(null);
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(message);
    process.exit(1);
  }
}
