import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { assert, startMcpTestHarness } from './mcpTestHarness.mjs';

const port = 34965;
let harness = null;
let client = null;
let transport = null;
let tempDir = '';

try {
  harness = await startMcpTestHarness({ port, authEnabled: false });
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ktrace-mcp-bridge-'));
  const sessionRuntimePath = path.join(tempDir, 'ktrace-session-runtime.json');
  await writeFile(
    sessionRuntimePath,
    `${JSON.stringify(
      {
        schema: 'ktrace-local-session-runtime-v1',
        createdAt: Date.now(),
        runtime: {
          owner: '0x1111111111111111111111111111111111111111',
          aaWallet: '0x1111111111111111111111111111111111111111',
          sessionAddress: '0x2222222222222222222222222222222222222222',
          sessionPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          sessionId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sessionTxHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          tokenAddress: '0x000000000000000000000000000000000000c0de',
          gatewayRecipient: '0x000000000000000000000000000000000000beef',
          maxPerTx: 1,
          dailyLimit: 5,
          agentId: '1',
          agentWallet: '0x2222222222222222222222222222222222222222',
          identityRegistry: '0x3333333333333333333333333333333333333333',
          chainId: 'kite-testnet',
          runtimePurpose: 'consumer',
          source: 'test'
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  transport = new StdioClientTransport({
    command: 'node',
    args: [
      './bin/ktrace.js',
      '--base-url',
      harness.baseUrl,
      'mcp',
      'bridge',
      '--session-runtime',
      sessionRuntimePath
    ],
    cwd: process.cwd(),
    stderr: 'pipe',
    env: {
      KTRACE_MCP_BRIDGE_FAKE_PAYMENT: '1'
    }
  });
  client = new Client({ name: 'mcp-bridge-paid-verifier', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  const toolsResult = await client.listTools();
  const toolNames = Array.isArray(toolsResult?.tools) ? toolsResult.tools.map((tool) => tool.name) : [];
  assert(toolNames.includes('ktrace__cap_paid_demo'), 'paid demo tool missing from bridge tools/list');

  const traceId = `bridge_paid_${Date.now()}`;
  const result = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'ktrace__cap_paid_demo',
        arguments: {
          vsCurrency: 'usd',
          ids: 'bitcoin',
          limit: 1,
          _meta: {
            traceId
          }
        }
      }
    },
    CallToolResultSchema
  );

  assert(result?.isError !== true, 'bridge paid call returned MCP error');
  assert(result?.structuredContent?.paymentStatus === 'payment_settled_result', 'bridge did not settle the payment challenge');
  assert(result?.structuredContent?.requestId, 'paid result requestId missing');
  assert(result?.structuredContent?.traceId === traceId, 'paid result traceId mismatch');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          calledTool: 'ktrace__cap_paid_demo',
          traceId,
          requestId: result?.structuredContent?.requestId || '',
          paymentStatus: result?.structuredContent?.paymentStatus || '',
          serviceId: result?.structuredContent?.serviceId || ''
        }
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  if (client) {
    await client.close().catch(() => {});
  }
  if (transport) {
    await transport.close().catch(() => {});
  }
  if (harness) {
    await harness.stop().catch(() => {});
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
