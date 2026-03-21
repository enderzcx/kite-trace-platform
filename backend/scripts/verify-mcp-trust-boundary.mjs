import crypto from 'node:crypto';

import { createConsumerAuthorityHarness } from './consumerAuthorityHarness.mjs';
import { assert } from './mcpTestHarness.mjs';

const owner = '0x1111111111111111111111111111111111111111';
const foreignOwner = '0x9999999999999999999999999999999999999999';

function pickPort(base = 35000, spread = 5000) {
  return base + Math.floor(Math.random() * spread);
}

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

async function configureAuthority(harness, { client, clientId, ownerEoa = owner } = {}) {
  const configure = await harness.requestJson('/api/session/policy', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa,
      consumerAgentLabel: `${client}-${clientId}`,
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: ['price-agent'],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25,
      totalLimit: 50
    })
  });
  assert(configure.response.ok, 'failed to configure authority policy');
}

async function bootstrapConnector(harness, { client, clientId, agentId, allowedBuiltinTools = [] } = {}) {
  const bootstrap = await harness.requestJson('/api/connector/agent/bootstrap', {
    method: 'POST',
    headers: buildHeaders(harness.keys.agent),
    body: JSON.stringify({
      ownerEoa: owner,
      client,
      clientId,
      agentId,
      ...(allowedBuiltinTools.length > 0 ? { allowedBuiltinTools } : {})
    })
  });
  assert(bootstrap.response.ok, `bootstrap failed for ${client}:${clientId}`);
  const connector = bootstrap.payload?.connector || {};
  const connectorUrl = String(connector.connectorUrl || '').trim();
  const token = decodeURIComponent(connectorUrl.split('/mcp/connect/')[1] || '');
  assert(token.startsWith('ktrace_cc_'), `bootstrap did not return a connector token for ${client}:${clientId}`);
  return {
    token,
    connectPath: `/mcp/connect/${encodeURIComponent(token)}`
  };
}

async function listToolNames(harness, connectPath) {
  const toolsList = await postJsonRpcToPath(
    harness.host,
    connectPath,
    { jsonrpc: '2.0', id: 'list-tools', method: 'tools/list', params: {} }
  );
  assert(toolsList.status === 200, 'tools/list failed');
  const tools = Array.isArray(toolsList.payload?.result?.tools) ? toolsList.payload.result.tools : [];
  return tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
}

async function invokePriceTool(harness, connectPath, traceId) {
  const toolCall = await postJsonRpcToPath(
    harness.host,
    connectPath,
    {
      jsonrpc: '2.0',
      id: 'price-call',
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
  assert(toolCall.status === 200, 'svc_price transport failed');
  assert(toolCall.payload?.result?.isError !== true, 'svc_price returned tool error');
  return toolCall.payload?.result?.structuredContent || {};
}

function seedLegacyGrant(harness, secret = 'ktrace_cc_legacy_route_c_seed') {
  const tokenHash = crypto.createHash('sha256').update(secret).digest('hex');
  harness.state.connectorGrants.unshift({
    grantId: 'legacy-grant',
    installCodeId: 'legacy-install',
    ownerEoa: owner,
    aaWallet: owner,
    authorityId: 'legacy-authority',
    policySnapshotHash: 'sha256:legacy',
    tokenHash,
    prefix: secret.slice(0, 20),
    maskedPreview: `${secret.slice(0, 16)}...seed`,
    client: 'agent',
    clientId: 'legacy',
    createdAt: Date.now(),
    claimedAt: Date.now(),
    lastUsedAt: 0,
    expiresAt: Date.now() + 3600_000,
    revokedAt: 0,
    revocationReason: ''
  });
  return secret;
}

function seedForeignTrace(harness) {
  const traceId = 'foreign-trace-route-c';
  const requestId = 'foreign-request-route-c';
  harness.state.workflows.unshift({
    traceId,
    requestId,
    type: 'btc-price-feed',
    state: 'success',
    payer: foreignOwner,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: {
      summary: 'foreign trace'
    }
  });
  harness.state.x402Requests.unshift({
    requestId,
    action: 'btc-price-feed',
    payer: foreignOwner,
    amount: '0.001',
    tokenAddress: '0x4444444444444444444444444444444444444444',
    recipient: '0x3333333333333333333333333333333333333333',
    status: 'paid',
    paymentTxHash: `0x${'d'.repeat(64)}`,
    identity: {
      agentId: 'foreign-agent',
      registry: '0x7777777777777777777777777777777777777777'
    },
    createdAt: Date.now()
  });
  harness.state.serviceInvocations.unshift({
    invocationId: 'foreign-invoke-route-c',
    serviceId: 'svc-price',
    action: 'btc-price-feed',
    traceId,
    requestId,
    state: 'success',
    payer: foreignOwner,
    sourceAgentId: 'mcp-client',
    targetAgentId: 'price-agent',
    amount: '0.001',
    tokenAddress: '0x4444444444444444444444444444444444444444',
    recipient: '0x3333333333333333333333333333333333333333',
    summary: 'foreign invoke',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  harness.state.jobs.unshift({
    jobId: 'foreign-job-route-c',
    traceId: 'foreign-job-trace-route-c',
    state: 'completed',
    provider: 'price-agent',
    capability: 'svc-price',
    payer: foreignOwner,
    requesterRuntimeAddress: foreignOwner,
    summary: 'foreign job',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return {
    traceId,
    requestId,
    jobId: 'foreign-job-route-c'
  };
}

async function verifyPublicationMode(mode, expectedStatus) {
  const harness = await createConsumerAuthorityHarness({
    port: pickPort(),
    authEnabled: true,
    enableMcp: true,
    wallet: owner,
    trustPublicationMode: mode
  });

  try {
    await configureAuthority(harness, { client: 'inspector', clientId: mode });
    const publicConnector = await bootstrapConnector(harness, {
      client: 'inspector',
      clientId: mode,
      agentId: 'consumer-agent'
    });

    const publicTools = await listToolNames(harness, publicConnector.connectPath);
    assert(publicTools.includes('ktrace__svc_price'), 'public connector missing svc_price');
    assert(publicTools.includes('ktrace__flow_history'), 'public connector missing flow_history');
    assert(!publicTools.includes('ktrace__job_create'), 'public connector unexpectedly exposes job_create');
    assert(!publicTools.includes('ktrace__job_show'), 'public connector unexpectedly exposes job_show');
    assert(!publicTools.includes('ktrace__job_audit'), 'public connector unexpectedly exposes job_audit');

    const structured = await invokePriceTool(harness, publicConnector.connectPath, `trust_boundary_${mode}_${Date.now()}`);
    const requestId = String(structured.requestId || '').trim();
    const paidTraceId = String(structured.traceId || '').trim();
    assert(requestId, `missing requestId for ${mode}`);
    assert(paidTraceId, `missing traceId for ${mode}`);

    const signalAgentIds = harness.state.reputationSignals.map((item) => String(item?.agentId || '').trim());
    assert(signalAgentIds.includes('consumer-agent'), `consumer reputation missing for ${mode}`);
    assert(signalAgentIds.includes('42'), `provider reputation missing for ${mode}`);

    const publicationStatuses = harness.state.trustPublications.map((item) => String(item?.status || '').trim().toLowerCase());
    assert(publicationStatuses.filter((item) => item === expectedStatus).length >= 2, `expected ${expectedStatus} trust publications for ${mode}`);

    const chainProfile = await harness.requestJson(
      `/api/v1/trust/chain-profile?agentId=${encodeURIComponent('consumer-agent')}&identityRegistry=${encodeURIComponent('0x7777777777777777777777777777777777777777')}`
    );
    assert(chainProfile.response.ok, `chain-profile failed for ${mode}`);
    assert(chainProfile.payload?.publications?.[expectedStatus] >= 1, `chain-profile missing ${expectedStatus} publication count for ${mode}`);
    assert(chainProfile.payload?.reputation?.totalSignals >= 1, `chain-profile missing reputation count for ${mode}`);

    const foreign = seedForeignTrace(harness);
    const flowShowForeign = await postJsonRpcToPath(
      harness.host,
      publicConnector.connectPath,
      {
        jsonrpc: '2.0',
        id: 'foreign-flow-show',
        method: 'tools/call',
        params: {
          name: 'ktrace__flow_show',
          arguments: { traceId: foreign.traceId }
        }
      }
    );
    assert(flowShowForeign.status === 200, 'foreign flow_show transport failed');
    assert(flowShowForeign.payload?.result?.isError === true, 'foreign flow_show should be forbidden');
    assert(
      String(flowShowForeign.payload?.result?.structuredContent?.error || '').trim() === 'forbidden',
      'foreign flow_show should return forbidden'
    );

    const evidenceForeign = await postJsonRpcToPath(
      harness.host,
      publicConnector.connectPath,
      {
        jsonrpc: '2.0',
        id: 'foreign-evidence',
        method: 'tools/call',
        params: {
          name: 'ktrace__artifact_evidence',
          arguments: { traceId: foreign.traceId }
        }
      }
    );
    assert(evidenceForeign.status === 200, 'foreign artifact_evidence transport failed');
    assert(evidenceForeign.payload?.result?.isError === true, 'foreign artifact_evidence should be forbidden');

    const trustedConnector = await bootstrapConnector(harness, {
      client: 'inspector',
      clientId: `${mode}-trusted`,
      agentId: 'consumer-agent',
      allowedBuiltinTools: ['artifact_receipt', 'artifact_evidence', 'flow_history', 'flow_show', 'job_create', 'job_show', 'job_audit']
    });
    const trustedTools = await listToolNames(harness, trustedConnector.connectPath);
    assert(trustedTools.includes('ktrace__job_create'), 'trusted connector missing job_create');
    assert(trustedTools.includes('ktrace__job_show'), 'trusted connector missing job_show');
    assert(trustedTools.includes('ktrace__job_audit'), 'trusted connector missing job_audit');
  } finally {
    await harness.close();
  }
}

async function verifyLegacyReconnect() {
  const harness = await createConsumerAuthorityHarness({
    port: pickPort(),
    authEnabled: true,
    enableMcp: true,
    wallet: owner
  });
  try {
    const token = seedLegacyGrant(harness);
    const response = await postJsonRpcToPath(
      harness.host,
      `/mcp/connect/${encodeURIComponent(token)}`,
      { jsonrpc: '2.0', id: 'legacy-list', method: 'tools/list', params: {} }
    );
    assert(response.status === 401, 'legacy connector token should return 401');
  } finally {
    await harness.close();
  }
}

try {
  await verifyLegacyReconnect();
  await verifyPublicationMode('pending', 'pending');
  await verifyPublicationMode('published', 'published');
  await verifyPublicationMode('fail', 'failed');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          legacyReconnect: 'passed',
          pendingMode: 'passed',
          publishedMode: 'passed',
          failedMode: 'passed'
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
