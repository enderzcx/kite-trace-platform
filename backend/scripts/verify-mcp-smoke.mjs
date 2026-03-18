import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { assert, startMcpTestHarness } from './mcpTestHarness.mjs';

const port = 34961;
const traceId = `mcp_smoke_${Date.now()}`;

let harness = null;
let transport = null;

try {
  harness = await startMcpTestHarness({ port, authEnabled: false });

  const wellKnownResponse = await fetch(`${harness.baseUrl}/.well-known/mcp.json`);
  const wellKnown = await wellKnownResponse.json();
  assert(wellKnownResponse.ok, 'well-known endpoint is not reachable');
  assert(wellKnown?.name === 'Kite Trace MCP Server', 'well-known name mismatch');
  assert(wellKnown?.transport === 'streamable-http', 'well-known transport mismatch');
  assert(wellKnown?.toolNamePrefix === 'ktrace__', 'well-known tool prefix mismatch');

  const client = new Client({ name: 'mcp-smoke-verifier', version: '1.0.0' }, { capabilities: {} });
  transport = new StreamableHTTPClientTransport(new URL(`${harness.baseUrl}/mcp`));
  await client.connect(transport);

  const toolsResult = await client.listTools();
  const tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
  const toolNames = tools.map((tool) => tool.name);

  assert(toolNames.includes('ktrace__cap_example_query'), 'query tool missing from tools/list');
  assert(toolNames.includes('ktrace__cap_paid_demo'), 'paid demo tool missing from tools/list');
  assert(!toolNames.includes('ktrace__cap_hidden_inactive'), 'inactive tool leaked into tools/list');

  const fallbackTool = tools.find((tool) => tool.name === 'ktrace__cap_example_query');
  const fallbackProperties = Object.keys(fallbackTool?.inputSchema?.properties || {});
  assert(fallbackProperties.length >= 2, 'schema fallback did not expose exampleInput properties');

  const toolResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'ktrace__cap_example_query',
        arguments: {
          symbol: 'BTCUSDT',
          source: 'stub',
          _meta: {
            traceId
          }
        }
      }
    },
    CallToolResultSchema
  );

  assert(toolResult?.isError !== true, 'query tool returned an unexpected MCP error');
  assert(toolResult?.structuredContent?.traceId === traceId, 'tool result traceId mismatch');
  assert(toolResult?.structuredContent?.serviceId === 'cap-example-query', 'tool result serviceId mismatch');
  assert(toolResult?.structuredContent?.invocationId, 'tool result invocationId missing');
  assert(toolResult?.structuredContent?.evidenceRef, 'tool result evidenceRef missing');

  const invocationsResponse = await fetch(
    `${harness.baseUrl}/api/service-invocations?traceId=${encodeURIComponent(traceId)}`
  );
  const invocationsPayload = await invocationsResponse.json();
  const invocation = Array.isArray(invocationsPayload?.items) ? invocationsPayload.items[0] : null;
  assert(invocationsResponse.ok, 'service invocation query failed');
  assert(invocation, 'service invocation record was not written');
  assert(invocation?.sourceAgentId === 'mcp-client', 'service invocation caller tag mismatch');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          toolCount: tools.length,
          calledTool: 'ktrace__cap_example_query',
          traceId,
          invocationId: invocation?.invocationId || '',
          schemaProperties: fallbackProperties
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
