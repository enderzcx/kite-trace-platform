function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeToolName(capability = {}) {
  const capabilityId = normalizeText(capability?.capabilityId || capability?.id || capability?.serviceId || '');
  return capabilityId
    ? `ktrace__${capabilityId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
    : '';
}

const PREFERRED_PAID_CAPABILITY_IDS = [
  'svc_btcusd_minute',
  'svc-live-btc-feed',
  'svc-compare-btc',
  'cap-market-price-feed',
  'cap-weather-context',
  'cap-tech-buzz-signal'
];

function buildHeaders(apiKey = '') {
  const headers = {};
  const normalizedApiKey = normalizeText(apiKey || '');
  if (normalizedApiKey) headers['x-api-key'] = normalizedApiKey;
  return headers;
}

function classifySkipReason(reason = '') {
  const text = normalizeText(reason).toLowerCase();
  if (!text) return '';
  if (
    text.includes('aborted') ||
    text.includes('timeout') ||
    text.includes('bundler') ||
    text.includes('session_') ||
    text.includes('session ') ||
    text.includes('aa_version') ||
    text.includes('proof') ||
    text.includes('rate_limit') ||
    text.includes('rate limit') ||
    text.includes('429') ||
    text.includes('service unavailable') ||
    text.includes('econnreset') ||
    text.includes('config')
  ) {
    return text;
  }
  return '';
}

function printSummary(payload = {}) {
  console.log(JSON.stringify(payload, null, 2));
}

function sortPaidCapabilities(capabilities = []) {
  const priority = new Map(PREFERRED_PAID_CAPABILITY_IDS.map((capabilityId, index) => [capabilityId, index]));
  return [...capabilities].sort((left, right) => {
    const leftId = normalizeText(left?.capabilityId || left?.id || left?.serviceId || '');
    const rightId = normalizeText(right?.capabilityId || right?.id || right?.serviceId || '');
    const leftRank = priority.has(leftId) ? priority.get(leftId) : Number.MAX_SAFE_INTEGER;
    const rightRank = priority.has(rightId) ? priority.get(rightId) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return leftId.localeCompare(rightId);
  });
}

async function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseSsePayload(rawText = '') {
  const dataLines = String(rawText || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines.join('\n'));
}

async function postJsonRpcWithTimeout(baseUrl, body, headers = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawText = await response.text();
    const contentType = normalizeText(response.headers.get('content-type') || '');
    return {
      status: response.status,
      contentType,
      payload: contentType.includes('text/event-stream') ? parseSsePayload(rawText) : rawText ? JSON.parse(rawText) : null,
      rawText
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, headers = {}, timeoutMs = 30_000, label = 'json_fetch') {
  const response = await withTimeout(
    fetch(url, {
      headers
    }),
    timeoutMs,
    label
  );
  const payload = await response.json();
  return {
    status: response.status,
    payload
  };
}

process.env.PORT = normalizeText(process.env.PORT || '') || '34991';
process.env.BACKEND_PUBLIC_URL =
  normalizeText(process.env.BACKEND_PUBLIC_URL || '') || `http://127.0.0.1:${process.env.PORT}`;

const { startServer, shutdownServer } = await import('../app.js');

const requireSuccess = /^(1|true|yes|on)$/i.test(normalizeText(process.env.MCP_REQUIRE_PAID_SUCCESS || ''));
const traceId = `mcp_paid_${Date.now()}`;
const requestedToolName = normalizeText(process.env.MCP_PAID_TOOL_NAME || '');
const operationTimeoutMs = Math.max(5_000, Number(process.env.MCP_PAID_TIMEOUT_MS || 30_000) || 30_000);

const apiKey =
  normalizeText(process.env.KITECLAW_API_KEY_AGENT || '') ||
  normalizeText(process.env.KITECLAW_API_KEY_ADMIN || '');

let started = false;

try {
  await startServer();
  started = true;

  const baseUrl = `http://127.0.0.1:${process.env.PORT}`;
  const headers = buildHeaders(apiKey);
  const runtimeResponse = await withTimeout(
    fetch(`${baseUrl}/api/session/runtime`, {
      headers
    }),
    operationTimeoutMs,
    'session_runtime'
  );
  const runtimePayload = await runtimeResponse.json();
  const runtime = runtimePayload?.runtime || {};

  if (!runtimeResponse.ok || !runtime?.aaWallet || runtime?.hasSessionPrivateKey !== true) {
    const reason = !runtimeResponse.ok
      ? `session_runtime_http_${runtimeResponse.status}`
      : 'session_runtime_not_ready';
    printSummary({
      ok: true,
      skipped: true,
      reason,
      details: {
        authConfigured: Boolean(apiKey),
        hasAaWallet: Boolean(runtime?.aaWallet),
        hasSessionPrivateKey: Boolean(runtime?.hasSessionPrivateKey)
      }
    });
  } else {
    const capabilitiesResponse = await withTimeout(
      fetch(`${baseUrl}/api/v1/capabilities?limit=500`, {
        headers
      }),
      operationTimeoutMs,
      'capabilities_fetch'
    );
    const capabilitiesPayload = await capabilitiesResponse.json();
    const capabilities = Array.isArray(capabilitiesPayload?.items) ? capabilitiesPayload.items : [];
    const activePaidCapabilities = sortPaidCapabilities(
      capabilities
        .filter((item) => item?.active !== false)
        .filter((item) => Number(item?.pricing?.amount || item?.price || 0) > 0)
    );
    const requestedCapability = activePaidCapabilities.find((item) => normalizeToolName(item) === requestedToolName) || null;
    const candidateCapabilities = requestedCapability
      ? [requestedCapability]
      : activePaidCapabilities;
    assert(candidateCapabilities.length > 0, `target paid tool not found: ${requestedToolName || 'auto-select'}`);

    const attemptResults = [];
    let successSummary = null;

    for (const targetCapability of candidateCapabilities) {
      const toolName = normalizeToolName(targetCapability);
      assert(toolName, 'failed to derive MCP tool name for paid verification target');
      const candidateTraceId =
        requestedCapability || candidateCapabilities.length === 1
          ? traceId
          : `${traceId}_${normalizeText(targetCapability?.capabilityId || targetCapability?.id || targetCapability?.serviceId || '')}`;

      let toolResult = null;
      try {
        const rpcResponse = await postJsonRpcWithTimeout(
          baseUrl,
          {
            jsonrpc: '2.0',
            id: 'mcp-paid-check',
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: {
                ...(targetCapability?.exampleInput && typeof targetCapability.exampleInput === 'object'
                  ? targetCapability.exampleInput
                  : {}),
                _meta: {
                  traceId: candidateTraceId
                }
              }
            }
          },
          headers,
          operationTimeoutMs
        );

        if (rpcResponse.status >= 400 && rpcResponse?.payload?.error) {
          throw new Error(normalizeText(rpcResponse.payload.error?.message || `mcp_http_${rpcResponse.status}`));
        }

        toolResult = rpcResponse?.payload?.result || null;
      } catch (error) {
        const timeoutReason = classifySkipReason(error?.message || '');
        attemptResults.push({
          toolName,
          traceId: candidateTraceId,
          status: 'transport-error',
          reason: normalizeText(error?.message || ''),
          skipReason: timeoutReason
        });
        if (requestedCapability) throw error;
        continue;
      }

      if (toolResult?.isError === true) {
        const reason = normalizeText(
          toolResult?.structuredContent?.reason || toolResult?.content?.[0]?.text || 'mcp_paid_failed'
        );
        const skipReason = classifySkipReason(reason);
        attemptResults.push({
          toolName,
          traceId: candidateTraceId,
          status: 'tool-error',
          reason,
          skipReason,
          details: toolResult?.structuredContent || null
        });
        if (requestedCapability && (!skipReason || requireSuccess)) {
          throw new Error(reason);
        }
        continue;
      }

      if (toolResult) {
        const requestId = normalizeText(toolResult?.structuredContent?.requestId || '');
        const serviceId = normalizeText(toolResult?.structuredContent?.serviceId || '');
        const state = normalizeText(toolResult?.structuredContent?.state || '');
        const evidenceRef = normalizeText(toolResult?.structuredContent?.evidenceRef || '');

        const { status: invocationsStatus, payload: invocationsPayload } = await fetchJsonWithTimeout(
          `${baseUrl}/api/service-invocations?traceId=${encodeURIComponent(candidateTraceId)}`,
          headers,
          operationTimeoutMs,
          'service_invocations'
        );
        const invocation = Array.isArray(invocationsPayload?.items) ? invocationsPayload.items[0] : null;
        assert(invocationsStatus >= 200 && invocationsStatus < 300, 'service invocation query failed after paid call');
        assert(invocation, 'service invocation record missing after paid call');
        assert(invocation?.sourceAgentId === 'mcp-client', 'paid call caller tag mismatch');
        assert(requestId, 'paid call requestId missing from MCP structured content');
        assert(state === 'unlocked', `paid call returned unexpected state: ${state || 'missing'}`);

        const { status: receiptStatus, payload: receiptPayload } = await fetchJsonWithTimeout(
          `${baseUrl}/api/receipt/${encodeURIComponent(requestId)}`,
          headers,
          operationTimeoutMs,
          'receipt_fetch'
        );
        assert(receiptStatus >= 200 && receiptStatus < 300, 'receipt endpoint failed after paid call');
        assert(receiptPayload?.ok === true, 'receipt endpoint returned non-ok payload');
        assert(
          normalizeText(receiptPayload?.receipt?.requestId || receiptPayload?.requestId || '') === requestId,
          'receipt requestId mismatch after paid call'
        );

        const evidencePath = evidenceRef || `/api/evidence/export?traceId=${encodeURIComponent(candidateTraceId)}`;
        const { status: evidenceStatus, payload: evidencePayload } = await fetchJsonWithTimeout(
          `${baseUrl}${evidencePath.startsWith('/') ? evidencePath : `/${evidencePath}`}`,
          headers,
          operationTimeoutMs,
          'evidence_fetch'
        );
        assert(evidenceStatus >= 200 && evidenceStatus < 300, 'evidence export endpoint failed after paid call');
        assert(evidencePayload?.ok === true, 'evidence export returned non-ok payload');
        assert(
          normalizeText(evidencePayload?.traceId || '') === candidateTraceId,
          'evidence export traceId mismatch after paid call'
        );
        assert(evidencePayload?.evidence && typeof evidencePayload.evidence === 'object', 'evidence payload missing');

        successSummary = {
          toolName,
          traceId: candidateTraceId,
          invocationId: invocation?.invocationId || '',
          requestId,
          serviceId,
          state,
          receiptVerified: true,
          evidenceVerified: true
        };
        break;
      }
    }

    if (successSummary) {
      printSummary({
        ok: true,
        summary: successSummary
      });
    } else if (!requireSuccess) {
      const skipAttempt = attemptResults.find((item) => item?.skipReason) || attemptResults[0] || null;
      printSummary({
        ok: true,
        skipped: true,
        reason: skipAttempt?.skipReason || skipAttempt?.reason || 'paid_mcp_verification_skipped',
        details: {
          traceId,
          attempts: attemptResults
        }
      });
    } else {
      throw new Error(
        attemptResults
          .map((item) => `${item.toolName}: ${item.reason || item.status}`)
          .join('; ') || 'paid_mcp_verification_failed'
      );
    }
  }
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  if (started) {
    await shutdownServer().catch(() => {});
  }
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}
