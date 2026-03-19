import { assert, postJsonRpc } from './mcpTestHarness.mjs';
import { createConsumerAuthorityHarness } from './consumerAuthorityHarness.mjs';

const traceId = `mcp_consumer_${Date.now()}`;

function buildHeaders(apiKey = '') {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {})
  };
}

const harness = await createConsumerAuthorityHarness({
  port: 34968,
  authEnabled: true,
  enableMcp: true
});

try {
  const configure = await harness.requestJson('/api/session/policy', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      consumerAgentLabel: 'mcp-consumer-smoke',
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: ['price-agent'],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25,
      totalLimit: 50
    })
  });
  assert(configure.response.ok, 'consumer authority setup failed for MCP verifier');

  const viewerList = await postJsonRpc(
    harness.host,
    { jsonrpc: '2.0', id: 'viewer-list', method: 'tools/list', params: {} },
    harness.keys.viewer
  );
  assert(viewerList.status === 200, 'viewer tools/list failed in MCP consumer verifier');
  const tools = Array.isArray(viewerList.payload?.result?.tools) ? viewerList.payload.result.tools : [];
  const paidTool = tools.find((tool) => tool?.name === 'ktrace__svc_price') || null;
  assert(paidTool, 'paid harness tool was not exposed through MCP tools/list');

  const viewerCall = await postJsonRpc(
    harness.host,
    {
      jsonrpc: '2.0',
      id: 'viewer-call',
      method: 'tools/call',
      params: {
        name: paidTool.name,
        arguments: {
          pair: 'BTCUSDT',
          payer: '0x1111111111111111111111111111111111111111',
          _meta: { traceId: `${traceId}_viewer` }
        }
      }
    },
    harness.keys.viewer
  );
  assert(viewerCall.status === 403, 'viewer tools/call did not return 403');
  assert(viewerCall.payload?.error?.code === -32003, 'viewer tools/call JSON-RPC auth failure changed');

  const successCall = await postJsonRpc(
    harness.host,
    {
      jsonrpc: '2.0',
      id: 'agent-call',
      method: 'tools/call',
      params: {
        name: paidTool.name,
        arguments: {
          pair: 'BTCUSDT',
          payer: '0x1111111111111111111111111111111111111111',
          _meta: { traceId }
        }
      }
    },
    harness.keys.agent
  );
  assert(successCall.status === 200, 'agent tools/call transport failed');
  assert(successCall.payload?.result?.isError !== true, 'agent paid tools/call returned MCP tool error');

  const structuredContent = successCall.payload?.result?.structuredContent || {};
  const requestId = String(structuredContent?.requestId || '').trim();
  const evidenceRef = String(structuredContent?.evidenceRef || '').trim();
  assert(requestId, 'successful MCP paid call did not return requestId');
  assert(evidenceRef, 'successful MCP paid call did not return evidenceRef');

  const successfulInvocations = harness.state.serviceInvocations.length;
  const successfulX402Requests = harness.state.x402Requests.length;
  const successfulRecords = harness.state.records.length;
  assert(successfulInvocations === 1, 'successful MCP paid call did not create one invocation');
  assert(successfulX402Requests === 1, 'successful MCP paid call did not create one x402 request');
  assert(successfulRecords >= 1, 'successful MCP paid call did not create payment records');

  const receiptResult = await harness.requestJson(`/api/receipt/${encodeURIComponent(requestId)}`, {
    headers: {
      Accept: 'application/json',
      'x-api-key': harness.keys.agent
    }
  });
  assert(receiptResult.response.ok, 'receipt lookup failed after MCP paid call');
  const receipt = receiptResult.payload?.receipt || null;
  assert(receipt?.authorityId, 'receipt did not expose authorityId for MCP paid call');
  assert(
    String(receipt?.policySnapshotHash || '').startsWith('sha256:'),
    'receipt did not expose policySnapshotHash for MCP paid call'
  );

  const evidenceResult = await harness.requestJson(evidenceRef, {
    headers: {
      Accept: 'application/json',
      'x-api-key': harness.keys.agent
    }
  });
  assert(evidenceResult.response.ok, 'internal evidence lookup failed after MCP paid call');
  const authorization = evidenceResult.payload?.evidence?.authorization || null;
  assert(authorization?.authorityId === receipt.authorityId, 'internal evidence authorityId mismatch for MCP paid call');
  assert(
    authorization?.policySnapshotHash === receipt.policySnapshotHash,
    'internal evidence policySnapshotHash mismatch for MCP paid call'
  );
  assert(
    authorization?.validationDecision === 'allowed',
    'internal evidence validationDecision mismatch for MCP paid call'
  );

  const revoke = await harness.requestJson('/api/session/policy/revoke', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      revocationReason: 'authority_revoked_for_mcp_test'
    })
  });
  assert(revoke.response.ok, 'consumer authority revoke failed in MCP verifier');

  const deniedTraceId = `${traceId}_revoked`;
  const deniedCall = await postJsonRpc(
    harness.host,
    {
      jsonrpc: '2.0',
      id: 'agent-call-revoked',
      method: 'tools/call',
      params: {
        name: paidTool.name,
        arguments: {
          pair: 'BTCUSDT',
          payer: '0x1111111111111111111111111111111111111111',
          _meta: { traceId: deniedTraceId }
        }
      }
    },
    harness.keys.agent
  );
  assert(deniedCall.status === 200, 'revoked MCP tools/call did not return MCP tool envelope');
  assert(deniedCall.payload?.result?.isError === true, 'revoked MCP tools/call did not return MCP tool error');
  assert(
    deniedCall.payload?.result?.structuredContent?.error === 'authority_revoked',
    'revoked MCP tools/call did not preserve authority_revoked denial code'
  );

  assert(
    harness.state.serviceInvocations.length === successfulInvocations,
    'revoked MCP tools/call unexpectedly created a successful invocation'
  );
  assert(
    harness.state.x402Requests.length === successfulX402Requests,
    'revoked MCP tools/call unexpectedly created a new payment artifact'
  );
  assert(
    harness.state.records.length === successfulRecords,
    'revoked MCP tools/call unexpectedly created a new payment record'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          toolName: paidTool.name,
          requestId,
          authorityId: receipt.authorityId,
          policySnapshotHash: receipt.policySnapshotHash,
          deniedCode: deniedCall.payload?.result?.structuredContent?.error || '',
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
