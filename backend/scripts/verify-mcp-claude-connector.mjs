import { createConsumerAuthorityHarness } from './consumerAuthorityHarness.mjs';
import { assert } from './mcpTestHarness.mjs';

const ownerA = '0x1111111111111111111111111111111111111111';
const ownerB = '0x9999999999999999999999999999999999999999';
const traceId = `mcp_claude_connector_${Date.now()}`;

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
  port: 34969,
  authEnabled: true,
  enableMcp: true,
  wallet: ownerA
});

try {
  const configure = await harness.requestJson('/api/session/policy', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: ownerA,
      consumerAgentLabel: 'claude-connector-smoke',
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: ['price-agent'],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25,
      totalLimit: 50
    })
  });
  assert(configure.response.ok, 'connector verifier failed to configure authority policy');

  const missingOwnerInstall = await harness.requestJson('/api/connector/claude/install-code', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({})
  });
  assert(missingOwnerInstall.response.status === 400, 'missing owner install did not fail');
  assert(
    missingOwnerInstall.payload?.error === 'connector_setup_incomplete',
    'missing owner install failure code changed'
  );

  const install = await harness.requestJson('/api/connector/claude/install-code', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: ownerA
    })
  });
  assert(install.response.ok, 'connector install code request failed');
  const connector = install.payload?.connector || {};
  const connectorUrl = String(connector.connectorUrl || '').trim();
  const token = decodeURIComponent(connectorUrl.split('/mcp/connect/')[1] || '');
  assert(connector.state === 'install_code_issued', 'install route state mismatch');
  assert(connector.installCodeId, 'install route missing installCodeId');
  assert(connector.maskedPreview, 'install route missing masked preview');
  assert(token.startsWith('ktrace_cc_'), 'install route did not return a connector token');

  const statusAfterInstall = await harness.requestJson(`/api/connector/claude/status?owner=${encodeURIComponent(ownerA)}`, {
    headers: buildHeaders(harness.keys.agent)
  });
  assert(statusAfterInstall.response.ok, 'connector status after install failed');
  assert(
    statusAfterInstall.payload?.connector?.state === 'install_code_issued',
    'status did not report pending install code'
  );
  assert(
    !Object.prototype.hasOwnProperty.call(statusAfterInstall.payload?.connector?.pendingInstallCode || {}, 'connectorUrl'),
    'status leaked a connector URL after install'
  );

  const connectPath = `/mcp/connect/${encodeURIComponent(token)}`;
  const concurrentListResults = await Promise.all([
    postJsonRpcToPath(
      harness.host,
      connectPath,
      { jsonrpc: '2.0', id: 'claim-list-1', method: 'tools/list', params: {} }
    ),
    postJsonRpcToPath(
      harness.host,
      connectPath,
      { jsonrpc: '2.0', id: 'claim-list-2', method: 'tools/list', params: {} }
    )
  ]);
  for (const result of concurrentListResults) {
    assert(result.status === 200, 'connector tools/list did not succeed during claim');
    assert(Array.isArray(result.payload?.result?.tools), 'connector tools/list payload missing tools');
  }
  assert(harness.state.connectorGrants.length === 1, 'concurrent claim created duplicate grants');
  const grantedToolNames = concurrentListResults[0].payload.result.tools
    .map((tool) => String(tool?.name || '').trim())
    .filter(Boolean);
  assert(grantedToolNames.includes('ktrace__job_show'), 'claude connector default preset missing job_show');
  assert(grantedToolNames.includes('ktrace__job_claim'), 'claude connector default preset missing job_claim');
  assert(grantedToolNames.includes('ktrace__job_accept'), 'claude connector default preset missing job_accept');
  assert(grantedToolNames.includes('ktrace__job_submit'), 'claude connector default preset missing job_submit');
  assert(grantedToolNames.includes('ktrace__job_audit'), 'claude connector default preset missing job_audit');
  assert(!grantedToolNames.includes('ktrace__job_create'), 'claude connector default preset should not expose job_create');

  const statusAfterClaim = await harness.requestJson(`/api/connector/claude/status?owner=${encodeURIComponent(ownerA)}`, {
    headers: buildHeaders(harness.keys.agent)
  });
  assert(statusAfterClaim.payload?.connector?.state === 'connected', 'status did not switch to connected');
  assert(statusAfterClaim.payload?.connector?.activeGrant?.grantId, 'connected status missing grant id');

  const genericList = await postJsonRpcToPath(
    harness.host,
    '/mcp',
    { jsonrpc: '2.0', id: 'generic-list', method: 'tools/list', params: {} },
    harness.keys.viewer
  );
  assert(genericList.status === 200, 'generic MCP tools/list regressed');

  const connectorCall = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'connector-call',
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
  assert(connectorCall.status === 200, 'connector tools/call transport failed');
  assert(connectorCall.payload?.result?.isError !== true, 'connector tools/call returned MCP tool error');
  const connectorStructured = connectorCall.payload?.result?.structuredContent || {};
  const requestId = String(connectorStructured.requestId || '').trim();
  const evidenceRef = String(connectorStructured.evidenceRef || '').trim();
  assert(requestId, 'connector call did not return requestId');
  assert(evidenceRef, 'connector call did not return evidenceRef');

  const receiptResult = await harness.requestJson(`/api/receipt/${encodeURIComponent(requestId)}`, {
    headers: buildHeaders(harness.keys.agent)
  });
  assert(receiptResult.response.ok, 'receipt lookup failed after connector call');
  const receipt = receiptResult.payload?.receipt || null;
  assert(receipt?.authorityId, 'receipt missing authorityId after connector call');
  assert(
    String(receipt?.policySnapshotHash || '').startsWith('sha256:'),
    'receipt missing policySnapshotHash after connector call'
  );

  const evidenceResult = await harness.requestJson(evidenceRef, {
    headers: buildHeaders(harness.keys.agent)
  });
  assert(evidenceResult.response.ok, 'evidence lookup failed after connector call');
  assert(
    evidenceResult.payload?.evidence?.authorization?.authorityId === receipt.authorityId,
    'evidence authorityId mismatch after connector call'
  );

  harness.state.runtime = {
    ...harness.state.runtime,
    owner: ownerB,
    aaWallet: ownerB,
    sessionAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sessionId: 'session-owner-b'
  };
  const crossOwnerCall = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'cross-owner-call',
      method: 'tools/call',
      params: {
        name: 'ktrace__svc_price',
        arguments: {
          pair: 'BTCUSDT',
          _meta: { traceId: `${traceId}_cross_owner` }
        }
      }
    }
  );
  assert(crossOwnerCall.status === 200, 'cross-owner connector call did not return MCP envelope');
  assert(crossOwnerCall.payload?.result?.isError === true, 'cross-owner connector call unexpectedly succeeded');
  assert(
    crossOwnerCall.payload?.result?.structuredContent?.error === 'connector_runtime_not_ready',
    'cross-owner connector isolation error changed'
  );

  const revoke = await harness.requestJson('/api/connector/claude/revoke', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: ownerA,
      reason: 'verify-connector-revoke'
    })
  });
  assert(revoke.response.ok, 'connector revoke failed');

  const revokedList = await postJsonRpcToPath(
    harness.host,
    connectPath,
    { jsonrpc: '2.0', id: 'revoked-list', method: 'tools/list', params: {} }
  );
  assert(revokedList.status === 401, 'revoked connector token did not return 401');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          installCodeId: connector.installCodeId,
          grantId: statusAfterClaim.payload?.connector?.activeGrant?.grantId || '',
          requestId,
          authorityId: receipt?.authorityId || '',
          policySnapshotHash: receipt?.policySnapshotHash || '',
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
