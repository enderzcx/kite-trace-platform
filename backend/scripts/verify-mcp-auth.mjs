import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { assert, postJsonRpc, startMcpTestHarness } from './mcpTestHarness.mjs';

const port = 34962;
const traceId = `mcp_auth_${Date.now()}`;

let harness = null;
let transport = null;

try {
  harness = await startMcpTestHarness({ port, authEnabled: true });

  const noKeyList = await postJsonRpc(
    harness.baseUrl,
    { jsonrpc: '2.0', id: 'no-key-list', method: 'tools/list', params: {} }
  );
  assert(noKeyList.status === 401, 'missing key did not return 401');
  assert(noKeyList.payload?.error?.code === -32001, 'missing key JSON-RPC error code mismatch');

  const viewerList = await postJsonRpc(
    harness.baseUrl,
    { jsonrpc: '2.0', id: 'viewer-list', method: 'tools/list', params: {} },
    harness.keys.viewer
  );
  assert(viewerList.status === 200, 'viewer tools/list failed');
  assert(Array.isArray(viewerList.payload?.result?.tools), 'viewer tools/list result missing');

  const viewerCall = await postJsonRpc(
    harness.baseUrl,
    {
      jsonrpc: '2.0',
      id: 'viewer-call',
      method: 'tools/call',
      params: {
        name: 'ktrace__cap_example_query',
        arguments: {
          symbol: 'BTCUSDT',
          _meta: { traceId }
        }
      }
    },
    harness.keys.viewer
  );
  assert(viewerCall.status === 403, 'viewer tools/call did not return 403');
  assert(viewerCall.payload?.error?.code === -32003, 'viewer tools/call JSON-RPC error code mismatch');

  const invalidTool = await postJsonRpc(
    harness.baseUrl,
    {
      jsonrpc: '2.0',
      id: 'invalid-tool',
      method: 'tools/call',
      params: {
        name: 'ktrace__does_not_exist',
        arguments: {
          _meta: { traceId }
        }
      }
    },
    harness.keys.agent
  );
  assert(invalidTool.status === 200, 'invalid tool call did not return 200 tool error envelope');
  assert(invalidTool.payload?.result?.isError === true, 'invalid tool did not return MCP tool error');

  const client = new Client({ name: 'mcp-auth-verifier', version: '1.0.0' }, { capabilities: {} });
  transport = new StreamableHTTPClientTransport(new URL(`${harness.baseUrl}/mcp`), {
    requestInit: {
      headers: {
        'x-api-key': harness.keys.agent
      }
    }
  });
  await client.connect(transport);

  const toolsResult = await client.listTools();
  assert(Array.isArray(toolsResult?.tools) && toolsResult.tools.length >= 2, 'agent tools/list failed');

  const agentCall = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'ktrace__cap_paid_demo',
        arguments: {
          vsCurrency: 'usd',
          ids: 'bitcoin,ethereum',
          limit: 2,
          _meta: {
            traceId
          }
        }
      }
    },
    CallToolResultSchema
  );
  assert(agentCall?.isError !== true, 'agent tools/call returned an unexpected error');
  assert(agentCall?.structuredContent?.serviceId === 'cap-paid-demo', 'agent tools/call serviceId mismatch');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          noKeyStatus: noKeyList.status,
          viewerListStatus: viewerList.status,
          viewerCallStatus: viewerCall.status,
          invalidToolStatus: invalidTool.status,
          agentServiceId: agentCall?.structuredContent?.serviceId || '',
          traceId
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
  if (transport) {
    await transport.close().catch(() => {});
  }
  if (harness) {
    await harness.stop().catch(() => {});
  }
}
