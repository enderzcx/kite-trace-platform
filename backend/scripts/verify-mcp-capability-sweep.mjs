import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import {
  createKiteProvider,
  envFlag,
  extractAaWalletFromReason,
  findConnectorGrantRecord,
  findX402RequestRecord,
  formatExpiry,
  loadWalletBalanceSummary,
  normalizeAddress,
  normalizeLower,
  normalizeText,
  parseJson,
  readJsonFileSafe,
  selectConsumerRuntimeContext
} from './mcpRuntimeContextHelpers.mjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSsePayload(rawText = '') {
  const dataLines = String(rawText || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return dataLines.length > 0 ? parseJson(dataLines.join('\n')) : {};
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeToolName(capabilityId = '') {
  return `ktrace__${normalizeText(capabilityId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function resolveApiKey() {
  return normalizeText(
    process.env.KTRACE_AGENT_API_KEY ||
      process.env.KITECLAW_API_KEY_AGENT ||
      process.env.API_KEY_AGENT ||
      process.env.KITECLAW_API_KEY_ADMIN ||
      process.env.KTRACE_ACCOUNT_API_KEY ||
      process.env.MCP_API_KEY ||
      ''
  );
}

function buildJsonHeaders(apiKey = '') {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {})
  };
}

function isZeroAddress(value = '') {
  return /^0x0{40}$/i.test(normalizeText(value));
}

function capabilityPrice(capability = {}) {
  const raw = capability?.pricing?.amount ?? capability?.price ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPaidCapability(capability = {}) {
  return capabilityPrice(capability) > 0;
}

function isHighRiskCapability(capability = {}, tool = null) {
  return (
    normalizeLower(capability?.capabilityId || capability?.id || '') === 'svc_hyperliquid_order_testnet' ||
    normalizeLower(capability?.action || '') === 'hyperliquid-order-testnet' ||
    tool?.annotations?.destructiveHint === true
  );
}

function summarizeBuiltinAvailability(names = [], expected = []) {
  const available = new Set(Array.isArray(names) ? names : []);
  return Object.fromEntries(expected.map((name) => [name, available.has(name)]));
}

function compactProfile(profile = {}) {
  return {
    subject: profile?.subject || null,
    reputation: {
      totalSignals: Number(profile?.reputation?.totalSignals || 0),
      positiveCount: Number(profile?.reputation?.positiveCount || 0),
      negativeCount: Number(profile?.reputation?.negativeCount || 0)
    },
    publications: {
      total: Number(profile?.publications?.total || 0),
      published: Number(profile?.publications?.published || 0),
      pending: Number(profile?.publications?.pending || 0),
      failed: Number(profile?.publications?.failed || 0),
      latestAnchorTxHash: normalizeText(profile?.publications?.latestAnchorTxHash || ''),
      latestPublication: profile?.publications?.latestPublication || null
    }
  };
}

function diffChainProfile(before = {}, after = {}) {
  return {
    reputation: {
      totalSignals: Number(after?.reputation?.totalSignals || 0) - Number(before?.reputation?.totalSignals || 0),
      positiveCount: Number(after?.reputation?.positiveCount || 0) - Number(before?.reputation?.positiveCount || 0),
      negativeCount: Number(after?.reputation?.negativeCount || 0) - Number(before?.reputation?.negativeCount || 0)
    },
    publications: {
      total: Number(after?.publications?.total || 0) - Number(before?.publications?.total || 0),
      published: Number(after?.publications?.published || 0) - Number(before?.publications?.published || 0),
      pending: Number(after?.publications?.pending || 0) - Number(before?.publications?.pending || 0),
      failed: Number(after?.publications?.failed || 0) - Number(before?.publications?.failed || 0)
    }
  };
}

function resolvePublicationStatusFromDelta(...deltas) {
  for (const status of ['published', 'pending', 'failed']) {
    if (
      deltas.some(
        (delta) =>
          delta &&
          delta.publications &&
          Number(delta.publications[status] || 0) > 0
      )
    ) {
      return status;
    }
  }
  return '';
}

function buildCapabilityArguments(capability = {}, context = {}) {
  const capabilityId = normalizeLower(capability?.capabilityId || capability?.id || '');
  const input = deepClone(capability?.exampleInput && typeof capability.exampleInput === 'object' ? capability.exampleInput : {}) || {};

  if (Object.prototype.hasOwnProperty.call(input, 'limit')) {
    const parsedLimit = Number(input.limit);
    if (Number.isFinite(parsedLimit) && parsedLimit > 5) {
      input.limit = 5;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'forecastDays')) {
    const parsedDays = Number(input.forecastDays);
    if (Number.isFinite(parsedDays) && parsedDays > 2) {
      input.forecastDays = 2;
    }
  }

  if (capabilityId === 'cap-wallet-pnl' && isZeroAddress(input.wallet_address || '')) {
    input.wallet_address = normalizeText(context.ownerEoa || context.aaWallet || input.wallet_address);
  }

  if (capabilityId === 'cap-news-signal' && Number(input.minScore || 0) > 40) {
    input.minScore = 40;
  }

  if (capabilityId === 'svc_hyperliquid_order_testnet') {
    // Keep the current example input as a safe validation probe:
    // the example omits `price` for a limit order, which should fail before any real trade path executes.
    delete input.price;
  }

  input._meta = {
    traceId: `mcp_capability_sweep_${Date.now()}_${normalizeToolName(capabilityId).replace(/^ktrace__/, '')}`
  };
  return input;
}

function isUpstreamFailure(reason = '') {
  const text = normalizeLower(reason);
  return (
    text.includes('aborted') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('service unavailable')
  );
}

function classifyCapabilityFailure({
  cwd = process.cwd(),
  reason = '',
  expectedAaWallet = '',
  requestId = '',
  traceId = ''
} = {}) {
  const expectedAa = normalizeAddress(expectedAaWallet);
  const x402Request = findX402RequestRecord({ cwd, requestId, traceId });
  const observedPayer = normalizeAddress(x402Request?.payer || '');
  const routedAaWallet = observedPayer || extractAaWalletFromReason(reason);
  if (expectedAa && routedAaWallet && routedAaWallet !== expectedAa) {
    return {
      toolStatus: 'runtime_routing_bug',
      observedPayer: routedAaWallet,
      skipReason: `runtime routed paid call to ${routedAaWallet} instead of ${expectedAa}; ${normalizeText(reason || 'runtime routing mismatch')}`
    };
  }
  if (isUpstreamFailure(reason)) {
    return {
      toolStatus: 'upstream_error',
      observedPayer: routedAaWallet,
      skipReason: normalizeText(reason || 'upstream_error')
    };
  }
  return {
    toolStatus: 'tool_error',
    observedPayer: routedAaWallet,
    skipReason: normalizeText(reason || 'mcp_tool_error')
  };
}

async function requestJson(baseUrl, pathname, { apiKey = '', method = 'GET', body = null, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: buildJsonHeaders(apiKey),
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    const rawText = await response.text();
    const payload = rawText ? parseJson(rawText) : {};
    if (!response.ok) {
      const error = new Error(
        normalizeText(payload?.reason || payload?.message || payload?.error?.message || `HTTP ${response.status}`)
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function postJsonRpc(baseUrl, pathname, body, { apiKey = '', timeoutMs = 90000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawText = await response.text();
    const contentType = normalizeLower(response.headers.get('content-type') || '');
    const payload = contentType.includes('text/event-stream')
      ? parseSsePayload(rawText)
      : rawText
        ? parseJson(rawText)
        : {};
    return {
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timer);
  }
}

async function listTools(baseUrl, pathname, { apiKey = '', timeoutMs = 60000 } = {}) {
  const response = await postJsonRpc(
    baseUrl,
    pathname,
    {
      jsonrpc: '2.0',
      id: `tools_list_${Date.now()}`,
      method: 'tools/list',
      params: {}
    },
    { apiKey, timeoutMs }
  );
  assert(response.status === 200, `tools/list failed for ${pathname} with status ${response.status}`);
  return Array.isArray(response.payload?.result?.tools) ? response.payload.result.tools : [];
}

async function callTool(baseUrl, pathname, name, args, { apiKey = '', timeoutMs = 90000 } = {}) {
  return postJsonRpc(
    baseUrl,
    pathname,
    {
      jsonrpc: '2.0',
      id: `${name}_${Date.now()}`,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    },
    { apiKey, timeoutMs }
  );
}

async function bootstrapConnector(baseUrl, apiKey, {
  ownerEoa,
  agentId,
  identityRegistry,
  client,
  clientId,
  allowedBuiltinTools = []
} = {}) {
  const payload = await requestJson(baseUrl, '/api/connector/agent/bootstrap', {
    apiKey,
    method: 'POST',
    body: {
      ownerEoa,
      client,
      clientId,
      agentId,
      identityRegistry,
      ...(allowedBuiltinTools.length > 0 ? { allowedBuiltinTools } : {})
    }
  });
  const connectorUrl = normalizeText(payload?.connector?.connectorUrl || '');
  const token = decodeURIComponent(connectorUrl.split('/mcp/connect/')[1] || '');
  assert(token.startsWith('ktrace_cc_'), `connector bootstrap did not return a usable token for ${clientId}`);
  return {
    token,
    connectPath: `/mcp/connect/${encodeURIComponent(token)}`,
    connector: payload?.connector || {}
  };
}

async function loadProviderMap(baseUrl, apiKey, capabilities = []) {
  const providerIds = Array.from(
    new Set(
      (Array.isArray(capabilities) ? capabilities : [])
        .map((item) => normalizeText(item?.providerId || item?.provider?.providerId || ''))
        .filter(Boolean)
    )
  );
  const providerMap = new Map();
  for (const providerId of providerIds) {
    try {
      const payload = await requestJson(baseUrl, `/api/v1/providers/${encodeURIComponent(providerId)}`, {
        apiKey,
        timeoutMs: 30000
      });
      providerMap.set(providerId, payload?.provider || null);
    } catch {
      providerMap.set(providerId, null);
    }
  }
  return providerMap;
}

async function loadChainProfile(baseUrl, apiKey, subject = null) {
  if (!subject?.agentId || !subject?.identityRegistry) {
    return null;
  }
  try {
    return await requestJson(
      baseUrl,
      `/api/v1/trust/chain-profile?agentId=${encodeURIComponent(subject.agentId)}&identityRegistry=${encodeURIComponent(subject.identityRegistry)}`,
      { apiKey, timeoutMs: 45000 }
    );
  } catch (error) {
    return {
      ok: false,
      error: normalizeText(error?.message || 'chain_profile_failed')
    };
  }
}

const apiKey = resolveApiKey();
const baseUrl = normalizeText(process.env.MCP_SWEEP_BASE_URL || 'http://127.0.0.1:3217').replace(/\/+$/, '');
const defaultIdentityRegistry = '0x60BF18964FCB1B2E987732B0477E51594B3659B1';
const consumerContext = selectConsumerRuntimeContext({
  cwd: process.cwd(),
  env: process.env,
  envPrefix: 'MCP_SWEEP',
  fallbackAgentId: normalizeText(process.env.MCP_LIVE_AGENT_ID || '1') || '1',
  fallbackIdentityRegistry: normalizeText(process.env.MCP_LIVE_IDENTITY_REGISTRY || defaultIdentityRegistry) || defaultIdentityRegistry,
  preferManagedConsumer: false
});
const rpcUrl = normalizeText(process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/');
const settlementTokenAddress = normalizeAddress(process.env.KITE_SETTLEMENT_TOKEN || '');
const requestedProbeToolName = normalizeText(process.env.MCP_SWEEP_PROBE_TOOL_NAME || '');
const requestedProbeCapabilityId = normalizeText(process.env.MCP_SWEEP_PROBE_CAPABILITY_ID || '');
const probeOnly = envFlag(process.env.MCP_SWEEP_PROBE_ONLY || '');
const defaultToolTimeoutMs = Math.max(30000, Number(process.env.MCP_SWEEP_TOOL_TIMEOUT_MS || 90000) || 90000);
const probeToolTimeoutMs = Math.max(defaultToolTimeoutMs, Number(process.env.MCP_SWEEP_PROBE_TIMEOUT_MS || 180000) || 180000);
const runId = `mcp_sweep_${Date.now()}`;
const outputPath = path.resolve(
  process.cwd(),
  normalizeText(process.env.MCP_SWEEP_OUTPUT || 'data/mcp_capability_sweep_latest.json')
);

let exitCode = 0;

try {
  assert(apiKey, 'Missing internal API key for MCP capability sweep.');
  assert(consumerContext.ownerEoa, 'Missing ownerEoa for connector bootstrap.');
  assert(consumerContext.agentId, 'Missing consumer agentId for connector bootstrap.');
  assert(consumerContext.identityRegistry, 'Missing consumer identityRegistry for connector bootstrap.');
  assert(consumerContext.aaWallet, 'Missing consumer aaWallet for MCP capability sweep.');

  const provider = createKiteProvider({
    rpcUrl,
    timeoutMs: Number(process.env.KITE_RPC_TIMEOUT_MS || 120000)
  });
  const balanceSummary = await loadWalletBalanceSummary({
    provider,
    tokenAddress: settlementTokenAddress,
    wallet: consumerContext.aaWallet
  });

  console.log(
    JSON.stringify(
      {
        event: 'mcp_sweep_preflight',
        baseUrl,
        runtimeSelection: consumerContext.selection,
        currentOwner: normalizeText(consumerContext.currentOwner || ''),
        ownerEoa: consumerContext.ownerEoa,
        aaWallet: consumerContext.aaWallet,
        sessionId: consumerContext.sessionId,
        sessionAddress: consumerContext.sessionAddress,
        runtimeSource: consumerContext.source,
        authorizationMode: consumerContext.authorizationMode,
        authorityId: consumerContext.authorityId,
        authorityStatus: consumerContext.authorityStatus,
        sessionExpiresAt: formatExpiry(consumerContext.sessionExpiresAt),
        authorityExpiresAt: formatExpiry(consumerContext.authorityExpiresAt),
        authorizationExpiresAt: formatExpiry(consumerContext.authorizationExpiresAt),
        balances: balanceSummary,
        probe: {
          toolName: requestedProbeToolName,
          capabilityId: requestedProbeCapabilityId,
          probeOnly
        }
      },
      null,
      2
    )
  );

  const connectorStatus = await requestJson(
    baseUrl,
    `/api/connector/agent/status?owner=${encodeURIComponent(consumerContext.ownerEoa)}&client=inspector&clientId=${encodeURIComponent(`${runId}_status`)}`,
    { apiKey, timeoutMs: 45000 }
  );
  const statusRuntime = connectorStatus?.setup?.runtime || {};
  assert(
    normalizeAddress(statusRuntime?.owner || '') === normalizeAddress(consumerContext.ownerEoa),
    `connector status resolved owner ${normalizeText(statusRuntime?.owner || '') || '-'} instead of ${consumerContext.ownerEoa}`
  );
  assert(
    normalizeAddress(statusRuntime?.aaWallet || '') === normalizeAddress(consumerContext.aaWallet),
    `connector status resolved aaWallet ${normalizeText(statusRuntime?.aaWallet || '') || '-'} instead of ${consumerContext.aaWallet}`
  );

  await requestJson(baseUrl, '/api/session/policy', {
    apiKey,
    method: 'POST',
    body: {
      ownerEoa: consumerContext.ownerEoa,
      consumerAgentLabel: `mcp-capability-sweep-${runId}`,
      allowedCapabilities: [],
      singleLimit: normalizeText(process.env.MCP_SWEEP_SINGLE_LIMIT || '0.05'),
      dailyLimit: normalizeText(process.env.MCP_SWEEP_DAILY_LIMIT || '0.50'),
      totalLimit: normalizeText(process.env.MCP_SWEEP_TOTAL_LIMIT || '2.00')
    }
  });

  const publicClientId = `${runId}_public`;
  const trustedClientId = `${runId}_trusted`;
  const publicConnector = await bootstrapConnector(baseUrl, apiKey, {
    ownerEoa: consumerContext.ownerEoa,
    agentId: consumerContext.agentId,
    identityRegistry: consumerContext.identityRegistry,
    client: 'inspector',
    clientId: publicClientId
  });
  const trustedConnector = await bootstrapConnector(baseUrl, apiKey, {
    ownerEoa: consumerContext.ownerEoa,
    agentId: consumerContext.agentId,
    identityRegistry: consumerContext.identityRegistry,
    client: 'inspector',
    clientId: trustedClientId,
    allowedBuiltinTools: ['artifact_receipt', 'artifact_evidence', 'flow_history', 'flow_show', 'job_create', 'job_show', 'job_audit']
  });

  const publicTools = await listTools(baseUrl, publicConnector.connectPath);
  const trustedTools = await listTools(baseUrl, trustedConnector.connectPath);
  const internalTools = await listTools(baseUrl, '/mcp', { apiKey });

  const publicGrant = findConnectorGrantRecord({
    cwd: process.cwd(),
    ownerEoa: consumerContext.ownerEoa,
    client: 'inspector',
    clientId: publicClientId,
    agentId: consumerContext.agentId,
    identityRegistry: consumerContext.identityRegistry
  });
  const trustedGrant = findConnectorGrantRecord({
    cwd: process.cwd(),
    ownerEoa: consumerContext.ownerEoa,
    client: 'inspector',
    clientId: trustedClientId,
    agentId: consumerContext.agentId,
    identityRegistry: consumerContext.identityRegistry
  });
  assert(publicGrant, 'Public connector grant was not persisted after tools/list.');
  assert(trustedGrant, 'Trusted connector grant was not persisted after tools/list.');
  assert(
    normalizeAddress(publicGrant?.aaWallet || '') === normalizeAddress(consumerContext.aaWallet),
    `public connector grant bound aaWallet ${normalizeText(publicGrant?.aaWallet || '') || '-'} instead of ${consumerContext.aaWallet}`
  );
  assert(
    normalizeAddress(trustedGrant?.aaWallet || '') === normalizeAddress(consumerContext.aaWallet),
    `trusted connector grant bound aaWallet ${normalizeText(trustedGrant?.aaWallet || '') || '-'} instead of ${consumerContext.aaWallet}`
  );

  const publicToolMap = new Map(publicTools.map((tool) => [normalizeText(tool?.name || ''), tool]));
  const trustedToolMap = new Map(trustedTools.map((tool) => [normalizeText(tool?.name || ''), tool]));
  const internalToolMap = new Map(internalTools.map((tool) => [normalizeText(tool?.name || ''), tool]));

  const capabilitiesPayload = await requestJson(baseUrl, '/api/v1/capabilities?limit=500', { apiKey, timeoutMs: 45000 });
  const capabilities = (Array.isArray(capabilitiesPayload?.items) ? capabilitiesPayload.items : []).filter(
    (item) => item?.active !== false
  );
  const probeTarget =
    capabilities.find((item) => normalizeText(item?.capabilityId || item?.id || '') === requestedProbeCapabilityId) ||
    capabilities.find((item) => normalizeToolName(item?.capabilityId || item?.id || '') === requestedProbeToolName) ||
    null;
  if (probeOnly) {
    assert(
      probeTarget,
      `Probe target not found for capabilityId=${requestedProbeCapabilityId || '-'} toolName=${requestedProbeToolName || '-'}`
    );
  }
  const orderedCapabilities = probeTarget
    ? [
        probeTarget,
        ...capabilities.filter(
          (item) =>
            normalizeText(item?.capabilityId || item?.id || '') !== normalizeText(probeTarget?.capabilityId || probeTarget?.id || '')
        )
      ]
    : capabilities;
  const capabilitiesToRun = probeOnly && probeTarget ? [probeTarget] : orderedCapabilities;
  const providerMap = await loadProviderMap(baseUrl, apiKey, capabilities);

  const consumerSubject = {
    agentId: consumerContext.agentId,
    identityRegistry: consumerContext.identityRegistry
  };
  let consumerProfile = await loadChainProfile(baseUrl, apiKey, consumerSubject);

  const providerProfileCache = new Map();
  for (const [providerId, provider] of providerMap.entries()) {
    const subject =
      provider?.identity?.agentId && provider?.identity?.registry
        ? {
            agentId: normalizeText(provider.identity.agentId),
            identityRegistry: normalizeText(provider.identity.registry)
          }
        : null;
    providerProfileCache.set(providerId, {
      subject,
      profile: await loadChainProfile(baseUrl, apiKey, subject)
    });
  }

  const results = [];

  for (const capability of capabilitiesToRun) {
    const capabilityId = normalizeText(capability?.capabilityId || capability?.id || '');
    const toolName = normalizeToolName(capabilityId);
    const tool = publicToolMap.get(toolName) || trustedToolMap.get(toolName) || null;
    const highRisk = isHighRiskCapability(capability, tool);
    const providerId = normalizeText(capability?.providerId || capability?.provider?.providerId || '');
    const providerRecord = providerMap.get(providerId) || null;
    const providerSubject =
      providerRecord?.identity?.agentId && providerRecord?.identity?.registry
        ? {
            agentId: normalizeText(providerRecord.identity.agentId),
            identityRegistry: normalizeText(providerRecord.identity.registry)
          }
        : null;

    const result = {
      capabilityId,
      toolName,
      paid: isPaidCapability(capability),
      providerId,
      providerSubject,
      transportStatus: tool ? 'not_called' : 'tool_missing',
      toolStatus: tool ? 'pending' : 'missing',
      traceId: '',
      requestId: '',
      observedPayer: '',
      receiptLoaded: false,
      evidenceLoaded: false,
      flowHistoryLoaded: false,
      flowShowLoaded: false,
      publicationStatus: '',
      skipReason: '',
      trust: {
        consumer: null,
        provider: null
      }
    };

    if (!tool) {
      results.push(result);
      continue;
    }

    const args = buildCapabilityArguments(capability, consumerContext);
    if (consumerContext.aaWallet) {
      args.payer = consumerContext.aaWallet;
    }
    console.log(`[mcp-sweep] calling ${toolName} owner=${consumerContext.ownerEoa} aa=${consumerContext.aaWallet}`);
    let toolResponse;
    try {
      toolResponse = await callTool(baseUrl, publicConnector.connectPath, toolName, args, {
        timeoutMs: probeTarget && normalizeText(probeTarget?.capabilityId || probeTarget?.id || '') === capabilityId
          ? probeToolTimeoutMs
          : highRisk
            ? 45000
            : defaultToolTimeoutMs
      });
      result.transportStatus = `http_${toolResponse.status}`;
    } catch (error) {
      result.transportStatus = normalizeText(error?.name || 'transport_error');
      result.toolStatus = isUpstreamFailure(normalizeText(error?.message || ''))
        ? 'upstream_error'
        : 'transport_error';
      result.skipReason = normalizeText(error?.message || 'tool_call_failed');
      results.push(result);
      continue;
    }

    const mcpResult = toolResponse?.payload?.result || {};
    const structured = mcpResult?.structuredContent && typeof mcpResult.structuredContent === 'object'
      ? mcpResult.structuredContent
      : {};
    const toolErrorText =
      normalizeText(mcpResult?.content?.[0]?.text || '') ||
      normalizeText(structured?.reason || structured?.error || '');

    result.traceId = normalizeText(structured?.traceId || args?._meta?.traceId || '');
    result.requestId = normalizeText(structured?.requestId || '');
    result.observedPayer = normalizeAddress(
      findX402RequestRecord({
        cwd: process.cwd(),
        requestId: result.requestId,
        traceId: result.traceId
      })?.payer || ''
    );

    if (mcpResult?.isError === true) {
      if (highRisk) {
        result.toolStatus = 'protected';
        result.skipReason = normalizeText(toolErrorText || 'high_risk_tool_rejected_or_guarded');
      } else {
        const failure = classifyCapabilityFailure({
          cwd: process.cwd(),
          reason: toolErrorText,
          expectedAaWallet: consumerContext.aaWallet,
          requestId: result.requestId,
          traceId: result.traceId
        });
        result.toolStatus = failure.toolStatus;
        result.observedPayer = failure.observedPayer || result.observedPayer;
        result.skipReason = failure.skipReason;
      }
      if (probeTarget && normalizeText(probeTarget?.capabilityId || probeTarget?.id || '') === capabilityId) {
        console.log(
          `[mcp-sweep] probe ${toolName} failed owner=${consumerContext.ownerEoa} aa=${consumerContext.aaWallet} requestId=${result.requestId || '-'} traceId=${result.traceId || '-'} observedPayer=${result.observedPayer || '-'} reason=${result.skipReason || '-'}`
        );
      }
      results.push(result);
      continue;
    }

    if (highRisk) {
      result.toolStatus = 'guard_probe_returned_success';
      result.skipReason = 'high_risk_tool_not_followed_with_real_trade_validation';
      results.push(result);
      continue;
    }

    result.toolStatus = 'success';
    if (probeTarget && normalizeText(probeTarget?.capabilityId || probeTarget?.id || '') === capabilityId) {
      console.log(
        `[mcp-sweep] probe ${toolName} success owner=${consumerContext.ownerEoa} aa=${consumerContext.aaWallet} requestId=${result.requestId || '-'} traceId=${result.traceId || '-'} observedPayer=${result.observedPayer || '-'}`
      );
    }

    if (result.paid && result.requestId) {
      const receiptResponse = await callTool(baseUrl, publicConnector.connectPath, 'ktrace__artifact_receipt', {
        requestId: result.requestId
      }).catch(() => null);
      result.receiptLoaded = Boolean(receiptResponse?.payload?.result?.structuredContent?.receipt);
    }

    if (result.paid && result.traceId) {
      const evidenceResponse = await callTool(baseUrl, publicConnector.connectPath, 'ktrace__artifact_evidence', {
        traceId: result.traceId
      }).catch(() => null);
      result.evidenceLoaded = Boolean(evidenceResponse?.payload?.result?.structuredContent?.evidence);

      const historyResponse = await callTool(baseUrl, publicConnector.connectPath, 'ktrace__flow_history', {
        limit: 30
      }).catch(() => null);
      const historyItems = Array.isArray(historyResponse?.payload?.result?.structuredContent?.history)
        ? historyResponse.payload.result.structuredContent.history
        : [];
      result.flowHistoryLoaded = historyItems.some((item) => normalizeText(item?.traceId || '') === result.traceId);

      const flowShowResponse = await callTool(baseUrl, publicConnector.connectPath, 'ktrace__flow_show', {
        traceId: result.traceId
      }).catch(() => null);
      result.flowShowLoaded = Boolean(
        flowShowResponse?.payload?.result?.structuredContent?.workflow ||
        flowShowResponse?.payload?.result?.structuredContent?.invocation ||
        flowShowResponse?.payload?.result?.structuredContent?.purchase ||
        flowShowResponse?.payload?.result?.structuredContent?.job
      );
    }

    const previousConsumerProfile = consumerProfile;
    const currentConsumerProfile = await loadChainProfile(baseUrl, apiKey, consumerSubject);
    const consumerDelta =
      previousConsumerProfile?.ok !== false && currentConsumerProfile?.ok !== false
        ? diffChainProfile(compactProfile(previousConsumerProfile), compactProfile(currentConsumerProfile))
        : null;
    consumerProfile = currentConsumerProfile || consumerProfile;

    const previousProviderState = providerProfileCache.get(providerId) || { subject: providerSubject, profile: null };
    const currentProviderProfile = await loadChainProfile(baseUrl, apiKey, providerSubject);
    const providerDelta =
      previousProviderState?.profile?.ok !== false && currentProviderProfile?.ok !== false
        ? diffChainProfile(compactProfile(previousProviderState.profile || {}), compactProfile(currentProviderProfile))
        : null;
    providerProfileCache.set(providerId, {
      subject: providerSubject,
      profile: currentProviderProfile || previousProviderState.profile
    });

    result.trust.consumer = {
      subject: consumerSubject,
      delta: consumerDelta,
      profile: currentConsumerProfile
        ? {
            reputation: currentConsumerProfile.reputation || null,
            publications: currentConsumerProfile.publications || null
          }
        : null
    };
    result.trust.provider = providerSubject
      ? {
          subject: providerSubject,
          delta: providerDelta,
          profile: currentProviderProfile
            ? {
                reputation: currentProviderProfile.reputation || null,
                publications: currentProviderProfile.publications || null
              }
            : null
        }
      : null;

    result.publicationStatus = resolvePublicationStatusFromDelta(consumerDelta, providerDelta);
    results.push(result);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    runId,
    baseUrl,
    consumerContext: {
      selection: consumerContext.selection,
      currentOwner: consumerContext.currentOwner,
      ownerEoa: consumerContext.ownerEoa,
      agentId: consumerContext.agentId,
      identityRegistry: consumerContext.identityRegistry,
      aaWallet: consumerContext.aaWallet,
      sessionId: consumerContext.sessionId,
      sessionAddress: consumerContext.sessionAddress,
      source: consumerContext.source,
      authorizationMode: consumerContext.authorizationMode,
      authorityId: consumerContext.authorityId,
      authorityStatus: consumerContext.authorityStatus,
      sessionExpiresAt: formatExpiry(consumerContext.sessionExpiresAt),
      authorityExpiresAt: formatExpiry(consumerContext.authorityExpiresAt),
      authorizationExpiresAt: formatExpiry(consumerContext.authorizationExpiresAt),
      balances: balanceSummary
    },
    probe: {
      toolName: requestedProbeToolName,
      capabilityId: requestedProbeCapabilityId,
      probeOnly,
      matchedCapabilityId: normalizeText(probeTarget?.capabilityId || probeTarget?.id || '')
    },
    connectorValidation: {
      publicGrantId: normalizeText(publicGrant?.grantId || ''),
      publicGrantAaWallet: normalizeText(publicGrant?.aaWallet || ''),
      trustedGrantId: normalizeText(trustedGrant?.grantId || ''),
      trustedGrantAaWallet: normalizeText(trustedGrant?.aaWallet || '')
    },
    toolSurface: {
      publicToolCount: publicTools.length,
      trustedToolCount: trustedTools.length,
      internalToolCount: internalTools.length,
      publicBuiltins: summarizeBuiltinAvailability(
        publicTools.map((item) => normalizeText(item?.name || '')),
        ['ktrace__flow_history', 'ktrace__flow_show', 'ktrace__artifact_receipt', 'ktrace__artifact_evidence']
      ),
      trustedBuiltins: summarizeBuiltinAvailability(
        trustedTools.map((item) => normalizeText(item?.name || '')),
        ['ktrace__job_create', 'ktrace__job_show', 'ktrace__job_audit']
      ),
      internalBuiltins: summarizeBuiltinAvailability(
        internalTools.map((item) => normalizeText(item?.name || '')),
        ['ktrace__job_prepare_funding', 'ktrace__job_fund', 'ktrace__job_accept', 'ktrace__job_submit', 'ktrace__job_validate']
      )
    },
    counts: {
      capabilities: capabilities.length,
      executedCapabilities: capabilitiesToRun.length,
      success: results.filter((item) => item.toolStatus === 'success').length,
      protected: results.filter((item) => item.toolStatus === 'protected').length,
      missing: results.filter((item) => item.toolStatus === 'missing').length,
      upstreamErrors: results.filter((item) => item.toolStatus === 'upstream_error').length,
      runtimeRoutingBugs: results.filter((item) => item.toolStatus === 'runtime_routing_bug').length,
      errors: results.filter((item) => !['success', 'protected', 'missing'].includes(item.toolStatus)).length,
      receiptLoaded: results.filter((item) => item.receiptLoaded).length,
      evidenceLoaded: results.filter((item) => item.evidenceLoaded).length,
      publicationPublished: results.filter((item) => item.publicationStatus === 'published').length,
      publicationPending: results.filter((item) => item.publicationStatus === 'pending').length,
      publicationFailed: results.filter((item) => item.publicationStatus === 'failed').length
    },
    results
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(error?.stack || error?.message || error);
} finally {
  process.exitCode = exitCode;
}
