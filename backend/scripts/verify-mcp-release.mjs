import { spawn } from 'node:child_process';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

async function runStep(label, scriptPath, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label}_failed_exit_${normalizeText(code) || 'unknown'}`));
    });
  });
}

try {
  await runStep('mcp_smoke', '.\\scripts\\verify-mcp-smoke.mjs');
  await runStep('mcp_auth', '.\\scripts\\verify-mcp-auth.mjs');
  await runStep('mcp_consumer', '.\\scripts\\verify-mcp-consumer.mjs');
  await runStep('mcp_paid', '.\\scripts\\verify-mcp-paid.mjs', {
    ...(normalizeText(process.env.MCP_REQUIRE_PAID_SUCCESS || '')
      ? { MCP_REQUIRE_PAID_SUCCESS: normalizeText(process.env.MCP_REQUIRE_PAID_SUCCESS || '') }
      : {})
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          smoke: 'passed',
          auth: 'passed',
          consumer: 'passed',
          paid: 'passed'
        }
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
