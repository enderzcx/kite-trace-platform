export function createSystemCommandHandlers({
  parseSystemStartFreshArgs,
  fileURLToPath,
  runPowerShellScript,
  createEnvelope,
  importMetaUrl
}) {
  async function handleSystemStartFresh(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseSystemStartFreshArgs(commandArgs);
    const scriptPath = fileURLToPath(new URL('../scripts/start-backend-fresh.ps1', importMetaUrl));
    const args = [];
    if (options.port) {
      args.push('-Port', options.port);
    }
    if (options.tokenFile) {
      args.push('-TokenFile', options.tokenFile);
    }
    if (options.dryRun) {
      args.push('-NoRun');
    }
    const result = await runPowerShellScript(scriptPath, args);
    const port = String(options.port || process.env.PORT || '3399').trim();
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'system', action: 'start-fresh', display: 'ktrace system start-fresh' },
      runtime,
      data: {
        port,
        dryRun: options.dryRun,
        suggestedBaseUrl: `http://127.0.0.1:${port}`,
        stdout: result.stdout,
        stderr: result.stderr
      },
      message: options.dryRun
        ? `Fresh backend dry run prepared for port ${port}.`
        : `Fresh backend start launched for port ${port}.`
    });
  }

  return {
    handleSystemStartFresh
  };
}
