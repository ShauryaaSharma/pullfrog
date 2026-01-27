#!/usr/bin/env node

/**
 * simple check that GITHUB_TOKEN env var exists
 */

const token = process.env.GITHUB_TOKEN;

if (token) {
  console.log(`GITHUB_TOKEN exists`);
  console.log(`token prefix: ${token.substring(0, 10)}...`);
} else {
  console.error("GITHUB_TOKEN does not exist");
  // github actions workflow command to fail the step
  console.log("::error::GITHUB_TOKEN does not exist");
  process.exit(1);
}
