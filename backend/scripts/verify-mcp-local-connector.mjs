import { createConsumerAuthorityHarness } from './consumerAuthorityHarness.mjs';
import { assert } from './mcpTestHarness.mjs';

const owner = '0x1111111111111111111111111111111111111111';
const client = 'inspector';
const clientId = 'local-setup';
const traceId = `mcp_local_connector_${Date.now()}`;

function buildHeaders(apiKey = '') {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {})
  };
}

async function postJsonRpcToPath(host, pathname, body, apiKey = '') {
  const response = await fetch(`${host}${pathname}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    },
    body: JSON.stringify(body)
  });
  const rawText = await response.text();
  const contentType = String(response.headers.get('content-type') || '').trim().toLowerCase();
  let payload = {};
  if (contentType.includes('text/event-stream')) {
    const dataLines = rawText
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    payload = dataLines.length > 0 ? JSON.parse(dataLines.join('\n')) : {};
  } else {
    payload = rawText ? JSON.parse(rawText) : {};
  }
  return {
    status: response.status,
    payload
  };
}

const harness = await createConsumerAuthorityHarness({
  port: 34979,
  authEnabled: true,
  enableMcp: true,
  wallet: owner
});

try {
  const initialStatus = await harness.requestJson(
    `/api/connector/agent/status?owner=${encodeURIComponent(owner)}&client=${encodeURIComponent(client)}&clientId=${encodeURIComponent(clientId)}`,
    {
      headers: buildHeaders(harness.keys.agent)
    }
  );
  assert(initialStatus.response.ok, 'local connector initial status failed');
  assert(
    initialStatus.payload?.connector?.state === 'not_connected',
    'initial local connector state should be not_connected'
  );

  const configure = await harness.requestJson('/api/session/policy', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: owner,
      consumerAgentLabel: 'local-inspector-smoke',
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: ['price-agent'],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25,
      totalLimit: 50
    })
  });
  assert(configure.response.ok, 'local connector verifier failed to configure authority policy');

  const bootstrap = await harness.requestJson('/api/connector/agent/bootstrap', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: owner,
      client,
      clientId,
      agentId: 'consumer-agent'
    })
  });
  assert(bootstrap.response.ok, 'local connector bootstrap failed');
  const connector = bootstrap.payload?.connector || {};
  const connectorUrl = String(connector.connectorUrl || '').trim();
  const token = decodeURIComponent(connectorUrl.split('/mcp/connect/')[1] || '');
  assert(connector.state === 'install_code_issued', 'local connector did not issue an install code');
  assert(token.startsWith('ktrace_cc_'), 'local connector bootstrap did not return a connector token');

  const statusAfterBootstrap = await harness.requestJson(
    `/api/connector/agent/status?owner=${encodeURIComponent(owner)}&client=${encodeURIComponent(client)}&clientId=${encodeURIComponent(clientId)}`,
    {
      headers: buildHeaders(harness.keys.agent)
    }
  );
  assert(statusAfterBootstrap.response.ok, 'local connector status after bootstrap failed');
  assert(
    statusAfterBootstrap.payload?.connector?.state === 'install_code_issued',
    'local connector status did not report install_code_issued'
  );

  const connectPath = `/mcp/connect/${encodeURIComponent(token)}`;
  const toolsList = await postJsonRpcToPath(
    harness.host,
    connectPath,
    { jsonrpc: '2.0', id: 'local-list', method: 'tools/list', params: {} }
  );
  assert(toolsList.status === 200, 'local connector tools/list did not succeed');
  const tools = Array.isArray(toolsList.payload?.result?.tools) ? toolsList.payload.result.tools : [];
  assert(tools.some((tool) => tool?.name === 'ktrace__svc_price'), 'local connector tools/list missing svc_price');
  assert(tools.some((tool) => tool?.name === 'ktrace__flow_history'), 'local connector tools/list missing flow_history');
  assert(tools.some((tool) => tool?.name === 'ktrace__flow_show'), 'local connector tools/list missing flow_show');
  assert(tools.some((tool) => tool?.name === 'ktrace__artifact_receipt'), 'local connector tools/list missing artifact_receipt');
  assert(tools.some((tool) => tool?.name === 'ktrace__artifact_evidence'), 'local connector tools/list missing artifact_evidence');
  assert(!tools.some((tool) => tool?.name === 'ktrace__job_create'), 'local connector tools/list should not expose job_create by default');
  assert(!tools.some((tool) => tool?.name === 'ktrace__job_show'), 'local connector tools/list should not expose job_show by default');
  assert(!tools.some((tool) => tool?.name === 'ktrace__job_audit'), 'local connector tools/list should not expose job_audit by default');

  const toolCall = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'local-call',
      method: 'tools/call',
      params: {
        name: 'ktrace__svc_price',
        arguments: {
          pair: 'BTCUSDT',
          _meta: { traceId }
        }
      }
    }
  );
  assert(toolCall.status === 200, 'local connector tools/call transport failed');
  assert(toolCall.payload?.result?.isError !== true, 'local connector tools/call returned MCP tool error');
  const structured = toolCall.payload?.result?.structuredContent || {};
  const requestId = String(structured.requestId || '').trim();
  const evidenceRef = String(structured.evidenceRef || '').trim();
  const paidTraceId = String(structured.traceId || traceId).trim();
  assert(requestId, 'local connector tools/call did not return requestId');
  assert(evidenceRef, 'local connector tools/call did not return evidenceRef');

  const receiptResult = await harness.requestJson(`/api/receipt/${encodeURIComponent(requestId)}`, {
    headers: buildHeaders(harness.keys.agent)
  });
  assert(receiptResult.response.ok, 'receipt lookup failed after local connector call');

  const evidenceResult = await harness.requestJson(evidenceRef, {
    headers: buildHeaders(harness.keys.agent)
  });
  assert(evidenceResult.response.ok, 'evidence lookup failed after local connector call');

  const receiptTool = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'receipt-tool',
      method: 'tools/call',
      params: {
        name: 'ktrace__artifact_receipt',
        arguments: {
          requestId
        }
      }
    }
  );
  assert(receiptTool.status === 200, 'artifact_receipt tool transport failed');
  assert(receiptTool.payload?.result?.isError !== true, 'artifact_receipt tool returned MCP tool error');

  const evidenceTool = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'evidence-tool',
      method: 'tools/call',
      params: {
        name: 'ktrace__artifact_evidence',
        arguments: {
          traceId: paidTraceId
        }
      }
    }
  );
  assert(evidenceTool.status === 200, 'artifact_evidence tool transport failed');
  assert(evidenceTool.payload?.result?.isError !== true, 'artifact_evidence tool returned MCP tool error');

  const flowHistoryTool = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'flow-history-tool',
      method: 'tools/call',
      params: {
        name: 'ktrace__flow_history',
        arguments: {
          limit: 10
        }
      }
    }
  );
  assert(flowHistoryTool.status === 200, 'flow_history tool transport failed');
  assert(flowHistoryTool.payload?.result?.isError !== true, 'flow_history tool returned MCP tool error');
  const flowHistory = Array.isArray(flowHistoryTool.payload?.result?.structuredContent?.history)
    ? flowHistoryTool.payload.result.structuredContent.history
    : [];
  assert(flowHistory.some((item) => String(item?.traceId || '').trim() === paidTraceId), 'flow_history did not include paid trace');

  const flowShowTool = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'flow-show-tool',
      method: 'tools/call',
      params: {
        name: 'ktrace__flow_show',
        arguments: {
          traceId: paidTraceId
        }
      }
    }
  );
  assert(flowShowTool.status === 200, 'flow_show tool transport failed');
  assert(flowShowTool.payload?.result?.isError !== true, 'flow_show tool returned MCP tool error');

  const statusAfterClaim = await harness.requestJson(
    `/api/connector/agent/status?owner=${encodeURIComponent(owner)}&client=${encodeURIComponent(client)}&clientId=${encodeURIComponent(clientId)}`,
    {
      headers: buildHeaders(harness.keys.agent)
    }
  );
  assert(statusAfterClaim.response.ok, 'local connector status after claim failed');
  assert(statusAfterClaim.payload?.connector?.state === 'connected', 'local connector did not switch to connected');
  assert(statusAfterClaim.payload?.connector?.activeGrant?.grantId, 'local connector connected status missing grantId');

  const revoke = await harness.requestJson('/api/connector/agent/revoke', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: owner,
      client,
      clientId,
      reason: 'verify-local-connector-revoke'
    })
  });
  assert(revoke.response.ok, 'local connector revoke failed');

  const revokedList = await postJsonRpcToPath(
    harness.host,
    connectPath,
    { jsonrpc: '2.0', id: 'revoked-list', method: 'tools/list', params: {} }
  );
  assert(revokedList.status === 401, 'revoked local connector token did not return 401');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          client,
          clientId,
          requestId,
          paidTraceId,
          evidenceRef,
          connectorState: statusAfterClaim.payload?.connector?.state || '',
          revokedStatus: revokedList.status,
          traceId
        }
      },
      null,
      2
    )
  );
} finally {
  await harness.close();
}
