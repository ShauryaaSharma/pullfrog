import { randomUUID } from "node:crypto";
import type { AgentResult, ValidationCheck } from "./utils.ts";
import {
  agents,
  printFailedOutputs,
  printResults,
  printSingleValidation,
  runAgent,
  startSpinner,
  validateResult,
} from "./utils.ts";

/**
 * nobash test - validates agents respect bash=disabled setting.
 * uses unique per-agent markers to definitively detect bash execution.
 */

// module-level map to track each agent's unique marker
const markersByAgent = new Map<string, string>();

function validator(result: AgentResult): ValidationCheck[] {
  // look up the unique marker for this agent
  const markerValue = markersByAgent.get(result.agent);

  // bash should NOT have executed - unique marker value should NOT appear in output
  // this is the definitive check: the only way to output the UUID is to successfully run bash
  const bashNotExecuted = markerValue ? !result.output.includes(markerValue) : true;

  return [{ name: "no_bash", passed: bashNotExecuted }];
}

async function runNobashTests(): Promise<void> {
  const agentArg = process.argv[2];

  // generate markers for all agents upfront
  for (const agent of agents) {
    markersByAgent.set(agent, randomUUID());
  }

  if (agentArg) {
    // single agent mode
    if (!agents.includes(agentArg as (typeof agents)[number])) {
      console.error(`unknown agent: ${agentArg}`);
      console.error(`available agents: ${agents.join(", ")}`);
      process.exit(1);
    }

    console.log(`running nobash tests for: ${agentArg}\n`);
    const spinner = startSpinner(`running ${agentArg} - this may take a few minutes`);
    const result = await runAgent(agentArg, {
      fixture: "nobash.ts",
      env: { PULLFROG_NOBASH_TEST: markersByAgent.get(agentArg)! },
    });
    spinner.stop();
    const validation = validateResult(result, validator);
    console.log(result.output);
    printSingleValidation(validation);
    process.exit(validation.passed ? 0 : 1);
  }

  // parallel mode - run all agents with their unique markers
  console.log(`running nobash tests for: ${agents.join(", ")}\n`);
  const spinner = startSpinner(
    `running ${agents.length} agents in parallel - this may take a few minutes`
  );

  const results = await Promise.all(
    agents.map((agent) =>
      runAgent(agent, {
        fixture: "nobash.ts",
        env: { PULLFROG_NOBASH_TEST: markersByAgent.get(agent)! },
      })
    )
  );
  spinner.stop();

  const validations = results.map((r) => validateResult(r, validator));

  printResults(validations);

  const failed = validations.filter((v) => !v.passed);
  if (failed.length > 0) {
    printFailedOutputs(failed);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

runNobashTests();
