function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function encodeEvidenceRef(traceId = '') {
  const normalizedTraceId = normalizeText(traceId);
  return normalizedTraceId ? `/api/evidence/export?traceId=${encodeURIComponent(normalizedTraceId)}` : '';
}

function classifyError(payload = {}, status = 500, fallbackReason = '') {
  const reason = normalizeText(payload?.reason || payload?.error || fallbackReason || '');
  const lowerReason = reason.toLowerCase();
  let error = normalizeText(payload?.error || '');
  let upstreamStatus = null;

  if (
    lowerReason.includes('rate_limited') ||
    lowerReason.includes('rate limit') ||
    lowerReason.includes('too many requests') ||
    lowerReason.includes('http 429')
  ) {
    error = 'upstream_rate_limited';
    upstreamStatus = 429;
  } else if (
    lowerReason.includes('request_aborted') ||
    lowerReason.includes('aborted') ||
    lowerReason.includes('timeout') ||
    lowerReason.includes('timed out') ||
    lowerReason.includes('fetch failed') ||
    lowerReason.includes('econnreset') ||
    lowerReason.includes('service unavailable')
  ) {
    error = error && error !== 'invoke_failed' ? error : 'upstream_unavailable';
  } else if (!error || error === 'invoke_failed') {
    if (status === 401) error = 'unauthorized';
    else if (status === 402) error = 'payment_required';
    else if (status === 403) error = 'forbidden';
    else if (status === 404) error = 'service_not_found';
    else if (status === 409) error = 'request_mismatch';
    else if (status === 422) error = 'invoke_failed';
    else error = 'execution_failure';
  }

  return {
    error,
    upstreamStatus
  };
}

function pickTraceId(args = {}, extra = {}) {
  return normalizeText(
    extra?._meta?.traceId ||
    extra?.requestInfo?.meta?.traceId ||
    args?._meta?.traceId ||
    args?.traceId ||
    ''
  );
}

function buildInvokeInput(args = {}) {
  const reservedKeys = new Set([
    '_meta',
    'traceId',
    'payer',
    'sourceAgentId',
    'targetAgentId',
    'requestId',
    'paymentProof',
    'x402Mode'
  ]);
  const input = {};
  for (const [key, value] of Object.entries(isPlainObject(args) ? args : {})) {
    if (reservedKeys.has(key)) continue;
    input[key] = value;
  }
  return input;
}

function buildInvokePayload(tool = {}, args = {}, extra = {}, paymentMode = '') {
  const normalizedArgs = isPlainObject(args) ? args : {};
  const traceId = pickTraceId(normalizedArgs, extra);
  const payload = {
    input: buildInvokeInput(normalizedArgs),
    sourceAgentId: normalizeText(normalizedArgs?.sourceAgentId || '') || 'mcp-client'
  };

  const payer = normalizeText(normalizedArgs?.payer || '');
  const targetAgentId = normalizeText(normalizedArgs?.targetAgentId || '');
  const requestId = normalizeText(normalizedArgs?.requestId || '');
  const x402Mode = normalizeText(paymentMode || normalizedArgs?.x402Mode || '');
  const paymentProof = isPlainObject(normalizedArgs?.paymentProof) ? normalizedArgs.paymentProof : null;

  if (traceId) payload.traceId = traceId;
  if (payer) payload.payer = payer;
  if (targetAgentId) payload.targetAgentId = targetAgentId;
  if (requestId) payload.requestId = requestId;
  if (paymentProof) payload.paymentProof = paymentProof;
  if (x402Mode) payload.x402Mode = x402Mode;
  if (normalizeText(tool?.action || '')) payload.action = normalizeText(tool.action);

  return payload;
}

function buildSuccessResult(tool = {}, payload = {}, traceId = '') {
  const effectiveTraceId = normalizeText(payload?.traceId || traceId || '');
  const summary =
    normalizeText(payload?.receipt?.result?.summary || '') ||
    normalizeText(payload?.workflow?.result?.summary || '') ||
    normalizeText(payload?.result?.summary || '') ||
    normalizeText(payload?.reason || '') ||
    `MCP tool ${normalizeText(tool?.name || tool?.capabilityId || 'call')} completed.`;

  return {
    content: [
      {
        type: 'text',
        text: summary
      }
    ],
    structuredContent: {
      traceId: effectiveTraceId,
      requestId: normalizeText(payload?.requestId || payload?.workflow?.requestId || ''),
      invocationId: normalizeText(payload?.invocationId || ''),
      serviceId: normalizeText(payload?.serviceId || tool?.serviceId || tool?.capabilityId || ''),
      state: normalizeText(payload?.state || payload?.workflow?.state || 'success') || 'success',
      summary,
      txHash: normalizeText(payload?.txHash || payload?.workflow?.txHash || ''),
      userOpHash: normalizeText(payload?.userOpHash || payload?.workflow?.userOpHash || ''),
      result: payload?.result ?? null,
      receipt: payload?.receipt ?? null,
      evidenceRef: encodeEvidenceRef(effectiveTraceId)
    }
  };
}

function buildErrorResult(tool = {}, payload = {}, status = 500, traceId = '', fallbackReason = '') {
  const effectiveTraceId = normalizeText(payload?.traceId || traceId || '');
  const reason =
    normalizeText(payload?.reason || payload?.error || fallbackReason || '') ||
    'MCP tool call failed.';
  const classified = classifyError(payload, status, reason);

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: reason
      }
    ],
    structuredContent: {
      error: classified.error,
      reason,
      status,
      ...(classified.upstreamStatus ? { upstreamStatus: classified.upstreamStatus } : {}),
      traceId: effectiveTraceId,
      requestId: normalizeText(payload?.requestId || payload?.workflow?.requestId || ''),
      invocationId: normalizeText(payload?.invocationId || ''),
      serviceId: normalizeText(payload?.serviceId || tool?.serviceId || tool?.capabilityId || ''),
      state: normalizeText(payload?.state || payload?.workflow?.state || 'failed') || 'failed',
      txHash: normalizeText(payload?.txHash || payload?.workflow?.txHash || ''),
      userOpHash: normalizeText(payload?.userOpHash || payload?.workflow?.userOpHash || ''),
      result: payload?.result ?? null,
      receipt: payload?.receipt ?? null,
      evidenceRef: encodeEvidenceRef(effectiveTraceId)
    }
  };
}

export function createMcpInvokeAdapter({ fetchLoopbackJson }) {
  async function callTool({
    tool = {},
    args = {},
    extra = {},
    apiKey = '',
    paymentMode = ''
  } = {}) {
    const invokePayload = buildInvokePayload(tool, args, extra, paymentMode);
    const traceId = normalizeText(invokePayload.traceId || '');

    try {
      const { status, payload } = await fetchLoopbackJson({
        pathname: `/api/services/${encodeURIComponent(normalizeText(tool?.serviceId || tool?.capabilityId || ''))}/invoke`,
        method: 'POST',
        body: invokePayload,
        apiKey,
        traceId
      });

      if (status >= 200 && status < 300 && payload?.ok !== false) {
        return buildSuccessResult(tool, payload, traceId);
      }

      return buildErrorResult(tool, payload, status, traceId, `HTTP ${status}`);
    } catch (error) {
      return buildErrorResult(
        tool,
        {},
        500,
        traceId,
        normalizeText(error?.message || 'invoke_failed') || 'invoke_failed'
      );
    }
  }

  return {
    callTool
  };
}
