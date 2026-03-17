#!/usr/bin/env node

if (
  !String(process.env.NODE_USE_ENV_PROXY || '').trim() &&
  (
    String(process.env.HTTP_PROXY || '').trim() ||
    String(process.env.HTTPS_PROXY || '').trim() ||
    String(process.env.ALL_PROXY || '').trim()
  )
) {
  process.env.NODE_USE_ENV_PROXY = '1';
}

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
