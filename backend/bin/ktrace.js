#!/usr/bin/env node

import { runKtraceCli } from '../cli/runKtraceCli.js';

async function main() {
  const result = await runKtraceCli(process.argv.slice(2));
  process.exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 0;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  console.error(`ktrace: ${message}`);
  process.exitCode = 1;
});
