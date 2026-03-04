export function createRuntimeSupportHelpers(deps = {}) {
  const {
    AGENT001_BIND_TIMEOUT_MS,
    AGENT001_PREBIND_ONLY,
    API_KEY_ADMIN,
    API_KEY_AGENT,
    API_KEY_VIEWER,
    KITE_AGENT1_ID,
    KITE_AGENT2_ID,
    PORT,
    X_READER_MAX_CHARS_DEFAULT,
    buildLatestWorkflowByRequestId,
    createTraceId,
    normalizeAddress,
    normalizeRiskScoreParams,
    normalizeXReaderParams,
    readWorkflows,
    readX402Requests,
    resolveWorkflowTraceId
  } = deps;

  function parseBooleanFlag(value, fallback = false) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return Boolean(fallback);
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return Boolean(fallback);
  }

  function waitMs(ms = 0) {
    const duration = Math.max(0, Number(ms) || 0);
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function taskIdSafeToken(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24);
  }

  function safeNormalizeAddress(value = '') {
    if (typeof normalizeAddress === 'function') {
      return normalizeAddress(value);
    }
    return String(value || '').trim().toLowerCase();
  }

  function isRealTxHash(value = '') {
    const txHash = String(value || '').trim();
    if (!txHash) return false;
    return !txHash.toLowerCase().startsWith('mock_');
  }

  function buildFallbackX402Evidence({ requestId = '', txHash = '' } = {}) {
    const normalizedRequestId = String(requestId || '').trim();
    const normalizedTxHash = String(txHash || '').trim();
    if (!normalizedRequestId || !isRealTxHash(normalizedTxHash)) return null;
    const explorer = `https://testnet.kitescan.ai/tx/${normalizedTxHash}`;
    return {
      mode: 'x402',
      requestId: normalizedRequestId,
      txHash: normalizedTxHash,
      block: null,
      status: 'pending',
      explorer,
      verifiedAt: '',
      receiptRef: {
        requestId: normalizedRequestId,
        txHash: normalizedTxHash,
        block: null,
        status: 'pending',
        explorer,
        verifiedAt: '',
        endpoint: `/api/receipt/${normalizedRequestId}`
      }
    };
  }

  function resolveX402EvidenceByRequestId(requestId = '', workflowByRequestId = null) {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) return null;
    const reqItem =
      readX402Requests().find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
    if (!reqItem) return null;

    const workflowLookup =
      workflowByRequestId instanceof Map
        ? workflowByRequestId
        : typeof buildLatestWorkflowByRequestId === 'function'
          ? buildLatestWorkflowByRequestId(readWorkflows())
          : new Map();
    const workflow = workflowLookup.get(normalizedRequestId) || null;
    const txHash = String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim();
    const blockRaw = reqItem?.proofVerification?.details?.blockNumber;
    const block = Number.isFinite(Number(blockRaw)) ? Number(blockRaw) : null;
    const proofStatus =
      reqItem?.proofVerification
        ? 'success'
        : ['failed', 'error', 'expired', 'rejected'].includes(String(reqItem?.status || '').trim().toLowerCase())
          ? 'failed'
          : 'pending';
    const explorer = txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : '';
    const verifiedAtRaw = Number(reqItem?.proofVerification?.verifiedAt || 0);
    const verifiedAt = verifiedAtRaw > 0 ? new Date(verifiedAtRaw).toISOString() : '';
    return {
      mode: reqItem?.proofVerification ? 'x402' : 'mock',
      requestId: normalizedRequestId,
      txHash,
      block,
      status: proofStatus,
      explorer,
      verifiedAt,
      receiptRef: {
        requestId: normalizedRequestId,
        txHash,
        block,
        status: proofStatus,
        explorer,
        verifiedAt,
        endpoint: `/api/receipt/${normalizedRequestId}`
      }
    };
  }

  async function resolveX402EvidenceAfterWorkflowRun(requestId = '', workflowResult = {}) {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) {
      return {
        evidence: null,
        source: 'missing_request_id'
      };
    }
    const workflowTxHash = String(
      workflowResult?.txHash || workflowResult?.workflow?.txHash || workflowResult?.payment?.txHash || ''
    ).trim();
    const waitLimitMs = Math.max(0, Math.min(Number(process.env.AGENT001_BIND_EVIDENCE_WAIT_MS || 9_000), 45_000));
    const pollMs = Math.max(120, Math.min(Number(process.env.AGENT001_BIND_EVIDENCE_POLL_MS || 350), 2_000));
    const deadline = Date.now() + waitLimitMs;
    while (true) {
      const evidence = resolveX402EvidenceByRequestId(normalizedRequestId);
      if (isRealTxHash(evidence?.txHash)) {
        return {
          evidence,
          source: 'x402_request_store'
        };
      }
      if (Date.now() >= deadline) break;
      await waitMs(pollMs);
    }
    const fallbackEvidence = buildFallbackX402Evidence({
      requestId: normalizedRequestId,
      txHash: workflowTxHash
    });
    if (fallbackEvidence) {
      return {
        evidence: fallbackEvidence,
        source: 'workflow_response_txhash'
      };
    }
    return {
      evidence: null,
      source: 'missing_evidence'
    };
  }

  function shouldRetryAgent001PrebindReason(reason = '') {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes('timeout') ||
      text.includes('timed out') ||
      text.includes('network') ||
      text.includes('socket') ||
      text.includes('transport') ||
      text.includes('stream') ||
      text.includes('econnreset') ||
      text.includes('econnrefused') ||
      text.includes('503') ||
      text.includes('502') ||
      text.includes('504') ||
      text.includes('tls') ||
      text.includes('fetch failed') ||
      text.includes('eth_estimateuseroperationgas') ||
      text.includes('reverted') ||
      text.includes('bundler') ||
      text.includes('replacement fee too low') ||
      text.includes('replacement transaction underpriced')
    );
  }

  async function runAgent001PrebindWorkflowWithRetry({
    endpoint = '',
    payload = {},
    label = 'agent001 prebind'
  } = {}) {
    const port = String(PORT || process.env.PORT || 3001).trim() || '3001';
    const url = `http://127.0.0.1:${port}${String(endpoint || '').trim()}`;
    const maxAttempts = Math.max(1, Math.min(Number(process.env.AGENT001_PREBIND_RETRIES || 5), 5));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { response, payload: body } = await fetchJsonResponseWithTimeout(url, {
          method: 'POST',
          headers: buildInternalAgentHeaders(),
          timeoutMs: Number(AGENT001_BIND_TIMEOUT_MS || 210_000),
          label,
          body: JSON.stringify(payload)
        });
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.reason || body?.error || `${label} failed: HTTP ${response.status}`);
        }
        return { body, attempt, attempts: attempt };
      } catch (error) {
        const reason = String(error?.message || 'agent001_prebind_failed').trim();
        const retryable = shouldRetryAgent001PrebindReason(reason);
        lastError = new Error(reason || 'agent001_prebind_failed');
        lastError.attempt = attempt;
        lastError.retryable = retryable;
        if (!retryable || attempt >= maxAttempts) break;
        await waitMs(1200 * attempt);
      }
    }
    throw lastError || new Error('agent001_prebind_failed');
  }

  async function buildRiskScorePaymentIntentForTask({
    body = {},
    traceId = '',
    fallbackRequestId = '',
    defaultTask = { symbol: 'BTCUSDT', source: 'hyperliquid', horizonMin: 60 }
  } = {}) {
    const inputTask =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : defaultTask;
    const normalizeRisk = typeof normalizeRiskScoreParams === 'function' ? normalizeRiskScoreParams : (v = {}) => v;
    const normalizedTask = normalizeRisk({
      symbol: inputTask?.symbol || inputTask?.pair || defaultTask.symbol || 'BTCUSDT',
      source: inputTask?.source || defaultTask.source || 'hyperliquid',
      horizonMin: inputTask?.horizonMin ?? defaultTask.horizonMin ?? 60
    });
    const rawIntent =
      body?.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
        ? body.paymentIntent
        : {};
    const bindRealX402 = parseBooleanFlag(body?.bindRealX402, false);
    const strictBinding = parseBooleanFlag(body?.strictBinding, false);
    const shouldBindRealX402 =
      bindRealX402 ||
      (String(rawIntent?.mode || '').trim().toLowerCase() === 'x402' &&
        (!String(rawIntent?.requestId || '').trim() || !String(rawIntent?.txHash || '').trim()));
    const prebindOnly = parseBooleanFlag(body?.prebindOnly, AGENT001_PREBIND_ONLY);
    const workflowAction =
      String(body?.action || '').trim().toLowerCase() === 'technical-analysis-feed'
        ? 'technical-analysis-feed'
        : 'risk-score-feed';

    let paymentIntent = {
      mode: String(rawIntent?.mode || 'mock').trim().toLowerCase() || 'mock',
      requestId: String(rawIntent?.requestId || fallbackRequestId || '').trim(),
      txHash: String(rawIntent?.txHash || '').trim(),
      block: Number.isFinite(Number(rawIntent?.block)) ? Number(rawIntent.block) : null,
      status: String(rawIntent?.status || '').trim().toLowerCase(),
      explorer: String(rawIntent?.explorer || '').trim(),
      verifiedAt: String(rawIntent?.verifiedAt || '').trim()
    };

    const warnings = [];
    let workflowBinding = null;
    if (shouldBindRealX402) {
      try {
        const payload = {
          ...normalizedTask,
          traceId:
            typeof resolveWorkflowTraceId === 'function'
              ? resolveWorkflowTraceId(body?.paymentTraceId || createTraceId('risk_bind'))
              : body?.paymentTraceId || createTraceId('risk_bind'),
          payer: safeNormalizeAddress(body?.payer || ''),
          sourceAgentId: String(body?.sourceAgentId || KITE_AGENT1_ID || '1').trim(),
          targetAgentId: String(body?.targetAgentId || KITE_AGENT2_ID || '2').trim(),
          action: workflowAction,
          prebindOnly
        };
        const { body: result, attempts } = await runAgent001PrebindWorkflowWithRetry({
          endpoint: '/api/workflow/risk-score/run',
          payload,
          label: 'agent001 risk prebind'
        });
        const boundRequestId = String(result?.requestId || result?.workflow?.requestId || '').trim();
        const { evidence, source } = await resolveX402EvidenceAfterWorkflowRun(boundRequestId, result);
        if (!boundRequestId || !isRealTxHash(evidence?.txHash)) {
          throw new Error('x402 evidence missing after workflow run');
        }
        if (source === 'workflow_response_txhash') {
          warnings.push('x402 evidence store lagging; using workflow txHash fallback');
        }
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
        workflowBinding = {
          ok: true,
          traceId: String(result?.traceId || result?.workflow?.traceId || '').trim(),
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          attempts,
          evidenceSource: source
        };
      } catch (error) {
        const reason = String(error?.message || 'bind_real_x402_failed').trim();
        warnings.push(reason);
        if (strictBinding) {
          throw new Error(reason);
        }
      }
    } else if (paymentIntent.mode === 'x402' && paymentIntent.requestId) {
      const evidence = resolveX402EvidenceByRequestId(paymentIntent.requestId);
      if (evidence?.txHash) {
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
      }
    }

    if (!paymentIntent.mode) paymentIntent.mode = 'mock';
    if (!paymentIntent.requestId) paymentIntent.requestId = fallbackRequestId;
    if (paymentIntent.mode === 'x402' && !isRealTxHash(paymentIntent.txHash)) {
      warnings.push('x402 evidence unavailable, fallback to mock payment intent');
      paymentIntent.mode = 'mock';
      paymentIntent.txHash = '';
      paymentIntent.explorer = '';
      paymentIntent.verifiedAt = '';
      paymentIntent.status = 'pending';
    }
    if (!paymentIntent.txHash && paymentIntent.mode === 'mock') {
      paymentIntent.txHash = `mock_${taskIdSafeToken(traceId || fallbackRequestId || 'risk')}`;
    }

    return {
      paymentIntent,
      normalizedTask,
      workflowBinding,
      warnings
    };
  }

  async function buildInfoPaymentIntentForTask({
    body = {},
    traceId = '',
    fallbackRequestId = '',
    defaultTask = {
      url: 'https://newshacker.me/',
      topic: 'btc market sentiment today',
      mode: 'auto',
      maxChars: X_READER_MAX_CHARS_DEFAULT
    }
  } = {}) {
    const inputTask =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : defaultTask;
    const normalizeReader = typeof normalizeXReaderParams === 'function' ? normalizeXReaderParams : (v = {}) => v;
    const normalizedTask = normalizeReader({
      url: inputTask?.url || inputTask?.resourceUrl || '',
      topic: inputTask?.topic || inputTask?.query || inputTask?.keyword || defaultTask.topic || '',
      mode: inputTask?.mode || inputTask?.source || defaultTask.mode || 'auto',
      maxChars: inputTask?.maxChars ?? defaultTask.maxChars ?? X_READER_MAX_CHARS_DEFAULT
    });
    const rawIntent =
      body?.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
        ? body.paymentIntent
        : {};
    const bindRealX402 = parseBooleanFlag(body?.bindRealX402, false);
    const strictBinding = parseBooleanFlag(body?.strictBinding, false);
    const shouldBindRealX402 =
      bindRealX402 ||
      (String(rawIntent?.mode || '').trim().toLowerCase() === 'x402' &&
        (!String(rawIntent?.requestId || '').trim() || !String(rawIntent?.txHash || '').trim()));
    const prebindOnly = parseBooleanFlag(body?.prebindOnly, AGENT001_PREBIND_ONLY);
    const workflowAction = 'info-analysis-feed';

    let paymentIntent = {
      mode: String(rawIntent?.mode || 'mock').trim().toLowerCase() || 'mock',
      requestId: String(rawIntent?.requestId || fallbackRequestId || '').trim(),
      txHash: String(rawIntent?.txHash || '').trim(),
      block: Number.isFinite(Number(rawIntent?.block)) ? Number(rawIntent.block) : null,
      status: String(rawIntent?.status || '').trim().toLowerCase(),
      explorer: String(rawIntent?.explorer || '').trim(),
      verifiedAt: String(rawIntent?.verifiedAt || '').trim()
    };

    const warnings = [];
    let workflowBinding = null;
    if (shouldBindRealX402) {
      try {
        const payload = {
          ...normalizedTask,
          traceId:
            typeof resolveWorkflowTraceId === 'function'
              ? resolveWorkflowTraceId(body?.paymentTraceId || createTraceId('reader_bind'))
              : body?.paymentTraceId || createTraceId('reader_bind'),
          payer: safeNormalizeAddress(body?.payer || ''),
          sourceAgentId: String(body?.sourceAgentId || KITE_AGENT1_ID || '1').trim(),
          targetAgentId: String(body?.targetAgentId || KITE_AGENT2_ID || '2').trim(),
          action: workflowAction,
          prebindOnly
        };
        const { body: result, attempts } = await runAgent001PrebindWorkflowWithRetry({
          endpoint: '/api/workflow/info/run',
          payload,
          label: 'agent001 info prebind'
        });
        const boundRequestId = String(result?.requestId || result?.workflow?.requestId || '').trim();
        const { evidence, source } = await resolveX402EvidenceAfterWorkflowRun(boundRequestId, result);
        if (!boundRequestId || !isRealTxHash(evidence?.txHash)) {
          throw new Error('x402 evidence missing after workflow run');
        }
        if (source === 'workflow_response_txhash') {
          warnings.push('x402 evidence store lagging; using workflow txHash fallback');
        }
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
        workflowBinding = {
          ok: true,
          traceId: String(result?.traceId || result?.workflow?.traceId || '').trim(),
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          attempts,
          evidenceSource: source
        };
      } catch (error) {
        const reason = String(error?.message || 'bind_real_x402_failed').trim();
        warnings.push(reason);
        if (strictBinding) {
          throw new Error(reason);
        }
      }
    } else if (paymentIntent.mode === 'x402' && paymentIntent.requestId) {
      const evidence = resolveX402EvidenceByRequestId(paymentIntent.requestId);
      if (evidence?.txHash) {
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
      }
    }

    if (!paymentIntent.mode) paymentIntent.mode = 'mock';
    if (!paymentIntent.requestId) paymentIntent.requestId = fallbackRequestId;
    if (paymentIntent.mode === 'x402' && !isRealTxHash(paymentIntent.txHash)) {
      warnings.push('x402 evidence unavailable, fallback to mock payment intent');
      paymentIntent.mode = 'mock';
      paymentIntent.txHash = '';
      paymentIntent.explorer = '';
      paymentIntent.verifiedAt = '';
      paymentIntent.status = 'pending';
    }
    if (!paymentIntent.txHash && paymentIntent.mode === 'mock') {
      paymentIntent.txHash = `mock_${taskIdSafeToken(traceId || fallbackRequestId || 'reader')}`;
    }

    return {
      paymentIntent,
      normalizedTask,
      workflowBinding,
      warnings
    };
  }

  function buildInternalAgentHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    const key = String(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER || '').trim();
    if (key) {
      headers['x-api-key'] = key;
    }
    return headers;
  }

  async function fetchJsonResponseWithTimeout(
    url,
    { method = 'GET', headers = {}, body = undefined, timeoutMs = 30_000, label = 'request' } = {}
  ) {
    const resolvedTimeout = Math.max(3_000, Math.min(Number(timeoutMs) || 30_000, 300_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolvedTimeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    } catch (error) {
      const text = String(error?.message || `${label} failed`).trim();
      if (String(error?.name || '').trim() === 'AbortError') {
        const timeoutError = new Error(`${label} timeout after ${resolvedTimeout}ms`);
        timeoutError.code = 'timeout';
        throw timeoutError;
      }
      throw new Error(text || `${label} failed`);
    } finally {
      clearTimeout(timer);
    }
  }

  function isTransientTransportError(reason = '') {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes('timeout') ||
      text.includes('timed out') ||
      text.includes('network') ||
      text.includes('socket') ||
      text.includes('econnreset') ||
      text.includes('econnrefused') ||
      text.includes('503') ||
      text.includes('502') ||
      text.includes('504') ||
      text.includes('tls connection') ||
      text.includes('fetch failed')
    );
  }

  function hasStrictX402Evidence(payment = null) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return false;
    const requestId = String(payment.requestId || '').trim();
    const txHash = String(payment.txHash || '').trim();
    if (!requestId || !txHash) return false;
    if (!isRealTxHash(txHash)) return false;
    return true;
  }

  return {
    buildInfoPaymentIntentForTask,
    buildInternalAgentHeaders,
    buildRiskScorePaymentIntentForTask,
    fetchJsonResponseWithTimeout,
    hasStrictX402Evidence,
    isTransientTransportError
  };
}
