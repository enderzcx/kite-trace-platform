#!/usr/bin/env node

import { applyNodeEnvProxyPreference } from '../lib/envProxy.js';

applyNodeEnvProxyPreference();

async function main() {
  const { runKtraceCli } = await import('../cli/runKtraceCli.js');
  const result = await runKtraceCli(process.argv.slice(2));
  process.exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 0;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  console.error(`ktrace: ${message}`);
  process.exitCode = 1;
});
