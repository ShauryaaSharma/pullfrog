#!/usr/bin/env node

/**
 * simple check that GITHUB_TOKEN env var exists
 */

import * as core from "@actions/core";

async function run(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    core.info(`GITHUB_TOKEN exists`);
    core.info(`token prefix: ${token.substring(0, 10)}...`);
  } else {
    core.setFailed("GITHUB_TOKEN does not exist");
  }
}

await run();
