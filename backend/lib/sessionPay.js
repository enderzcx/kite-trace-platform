export function createSessionPayHelpers({
  KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
  KITE_SESSION_PAY_RETRIES,
  SESSION_PAY_TRANSPORT_BACKOFF_POLICY,
  SESSION_PAY_REPLACEMENT_BACKOFF_POLICY,
  KITE_BUNDLER_RPC_TIMEOUT_MS,
  KITE_BUNDLER_RPC_RETRIES,
  BUNDLER_RPC_BACKOFF_POLICY,
  KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
  KITE_ALLOW_EOA_RELAY_FALLBACK,
  KITE_ALLOW_BACKEND_USEROP_SIGN,
  getInternalAgentApiKey,
  PORT,
  waitMs
} = {}) {
  function buildSessionPayCategoryCounters() {
    return {
      transport: 0,
      replacement_fee: 0,
      session_validation: 0,
      funding: 0,
      policy: 0,
      aa_version: 0,
      config: 0,
      unknown: 0
    };
  }

  const sessionPayMetrics = {
    startedAt: new Date().toISOString(),
    totalRequests: 0,
    totalSuccess: 0,
    totalFailed: 0,
    totalRetryAttempts: 0,
    totalRetryDelayMs: 0,
    totalRetriesUsed: 0,
    totalFallbackAttempted: 0,
    totalFallbackSucceeded: 0,
    failuresByCategory: buildSessionPayCategoryCounters(),
    retriesByCategory: buildSessionPayCategoryCounters(),
    retryDelayMsByCategory: buildSessionPayCategoryCounters(),
    recentFailures: []
  };

  function shouldRetrySessionPayReason(reason = '') {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes('timeout') ||
      text.includes('fetch failed') ||
      text.includes('econnreset') ||
      text.includes('econnrefused') ||
      text.includes('etimedout') ||
      text.includes('und_err_socket') ||
      text.includes('und_err_connect_timeout') ||
      text.includes('socket hang up') ||
      text.includes('network') ||
      text.includes('tls') ||
      text.includes('secure connection') ||
      text.includes('client network socket disconnected') ||
      text.includes('bad gateway') ||
      text.includes('gateway timeout') ||
      text.includes('service unavailable') ||
      text.includes('http 502') ||
      text.includes('http 503') ||
      text.includes('http 504')
    );
  }

  function classifySessionPayFailure({ reason = '', errorCode = '' } = {}) {
    const code = String(errorCode || '').trim().toLowerCase();
    const text = String(reason || '').trim().toLowerCase();
    if (code === 'aa_version_mismatch' || text.includes('aa must be upgraded to v2')) return 'aa_version';
    if (
      [
        'session_not_configured',
        'invalid_session_id',
        'session_not_found',
        'session_agent_mismatch',
        'session_rule_failed'
      ].includes(code)
    ) {
      return 'session_validation';
    }
    if (['insufficient_funds', 'insufficient_kite_gas'].includes(code)) return 'funding';
    if (
      [
        'unsupported_settlement_token',
        'invalid_token_contract',
        'invalid_tokenaddress',
        'invalid_recipient',
        'invalid_amount',
        'aa_wallet_not_deployed_or_incompatible'
      ].includes(code)
    ) {
      return 'config';
    }
    if (
      code.includes('backend_signer') ||
      text.includes('eoa_relay_disabled') ||
      text.includes('backend userop signing is disabled') ||
      [
        'authority_not_found',
        'authority_expired',
        'authority_revoked',
        'authority_migration_required',
        'capability_not_allowed',
        'provider_not_allowed',
        'recipient_not_allowed',
        'amount_exceeds_single_limit',
        'amount_exceeds_daily_limit',
        'intent_replayed',
        'intent_conflict'
      ].includes(code)
    ) {
      return 'policy';
    }
    if (
      text.includes('replacement fee too low') ||
      text.includes('replacement underpriced') ||
      text.includes('cannot be replaced') ||
      text.includes('replacement transaction underpriced') ||
      text.includes('invalid account nonce') ||
      text.includes('aa25 invalid account nonce')
    ) {
      return 'replacement_fee';
    }
    if (shouldRetrySessionPayReason(text)) return 'transport';
    return 'unknown';
  }

  function shouldRetrySessionPayCategory(category = '') {
    const kind = String(category || '').trim().toLowerCase();
    return kind === 'transport' || kind === 'replacement_fee';
  }

  function pushRecentSessionPayFailure(entry = {}) {
    sessionPayMetrics.recentFailures.unshift(entry);
    if (sessionPayMetrics.recentFailures.length > KITE_SESSION_PAY_METRICS_RECENT_LIMIT) {
      sessionPayMetrics.recentFailures = sessionPayMetrics.recentFailures.slice(0, KITE_SESSION_PAY_METRICS_RECENT_LIMIT);
    }
  }

  function markSessionPayFailure({ errorCode = '', reason = '', traceId = '', requestId = '', attempts = 0 } = {}) {
    sessionPayMetrics.totalFailed += 1;
    const category = classifySessionPayFailure({ errorCode, reason });
    if (sessionPayMetrics.failuresByCategory[category] === undefined) {
      sessionPayMetrics.failuresByCategory[category] = 0;
    }
    sessionPayMetrics.failuresByCategory[category] += 1;
    pushRecentSessionPayFailure({
      time: new Date().toISOString(),
      category,
      errorCode: String(errorCode || '').trim(),
      reason: String(reason || '').trim(),
      traceId: String(traceId || '').trim(),
      requestId: String(requestId || '').trim(),
      attempts: Number.isFinite(Number(attempts)) ? Number(attempts) : 0
    });
    return category;
  }

  function markSessionPayRetry({ reason = '', errorCode = '' } = {}) {
    sessionPayMetrics.totalRetryAttempts += 1;
    const category = classifySessionPayFailure({ reason, errorCode });
    if (sessionPayMetrics.retriesByCategory[category] === undefined) {
      sessionPayMetrics.retriesByCategory[category] = 0;
    }
    sessionPayMetrics.retriesByCategory[category] += 1;
    return category;
  }

  function markSessionPayRetryDelay({ category = 'unknown', delayMs = 0 } = {}) {
    const kind = String(category || '').trim().toLowerCase() || 'unknown';
    const normalizedDelayMs = Math.max(0, Math.round(Number(delayMs) || 0));
    if (sessionPayMetrics.retryDelayMsByCategory[kind] === undefined) {
      sessionPayMetrics.retryDelayMsByCategory[kind] = 0;
    }
    sessionPayMetrics.retryDelayMsByCategory[kind] += normalizedDelayMs;
    sessionPayMetrics.totalRetryDelayMs += normalizedDelayMs;
    return normalizedDelayMs;
  }

  function buildRetryBackoffMs({ attempt = 1, baseMs = 0, maxMs = 0, jitterMs = 0, factor = 2 } = {}) {
    const index = Math.max(1, Number(attempt) || 1);
    const base = Math.max(0, Number(baseMs) || 0);
    const max = Math.max(base, Number(maxMs) || 0);
    if (base === 0 || max === 0) return 0;
    const retryFactor = Math.max(1, Number(factor) || 1);
    const exponential = Math.min(max, Math.round(base * Math.pow(retryFactor, index - 1)));
    const jitterCap = Math.max(0, Number(jitterMs) || 0);
    const jitter = jitterCap > 0 ? Math.floor(Math.random() * (jitterCap + 1)) : 0;
    return Math.min(max, exponential + jitter);
  }

  function getSessionPayRetryBackoffMs({ attempt = 1, category = 'unknown' } = {}) {
    const kind = String(category || '').trim().toLowerCase();
    if (kind === 'replacement_fee') {
      return buildRetryBackoffMs({
        attempt,
        baseMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.baseMs,
        maxMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.maxMs,
        jitterMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.jitterMs,
        factor: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.factor
      });
    }
    if (kind === 'transport') {
      return buildRetryBackoffMs({
        attempt,
        baseMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.baseMs,
        maxMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.maxMs,
        jitterMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.jitterMs,
        factor: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.factor
      });
    }
    return 0;
  }

  function sessionPayConfigSnapshot() {
    return {
      sessionPayRetries: KITE_SESSION_PAY_RETRIES,
      sessionPayTransportBackoffBaseMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.baseMs,
      sessionPayTransportBackoffMaxMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.maxMs,
      sessionPayTransportBackoffJitterMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.jitterMs,
      sessionPayTransportBackoffFactor: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.factor,
      sessionPayReplacementBackoffBaseMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.baseMs,
      sessionPayReplacementBackoffMaxMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.maxMs,
      sessionPayReplacementBackoffJitterMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.jitterMs,
      sessionPayReplacementBackoffFactor: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.factor,
      bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
      bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
      bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
      bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
      bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
      bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
      bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
      recentFailureLimit: KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
      eoaRelayFallbackEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
      backendUserOpSignEnabled: KITE_ALLOW_BACKEND_USEROP_SIGN
    };
  }

  async function postSessionPayWithRetry(payload = {}, options = {}) {
    const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts || KITE_SESSION_PAY_RETRIES), 8));
    // `/api/session/pay` already performs its own AA/bundler retry loop and receipt wait.
    // Keep the outer loopback HTTP timeout comfortably above that internal window so we
    // don't abort a valid payment attempt mid-flight and surface a false "This operation was aborted".
    const timeoutMs = Math.max(30_000, Math.min(Number(options.timeoutMs || 90_000), 180_000));
    const internalApiKey = getInternalAgentApiKey();
    const headers = { 'Content-Type': 'application/json' };
    if (internalApiKey) headers['x-api-key'] = internalApiKey;

    let lastError = null;
    for (let i = 0; i < maxAttempts; i += 1) {
      const attempt = i + 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(`http://127.0.0.1:${PORT}/api/session/pay`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const body = await resp.json().catch(() => ({}));
        if (resp.ok && body?.ok) {
          return { resp, body, attempts: attempt };
        }
        const reason = String(body?.reason || body?.error || `HTTP ${resp.status}`).trim();
        const err = new Error(reason || 'session pay failed');
        err.payBody = body;
        err.status = resp.status;
        err.attempts = attempt;
        const reasonCategory = classifySessionPayFailure({ reason, errorCode: String(body?.error || '').trim() });
        err.reasonCategory = reasonCategory;
        err.retryable = shouldRetrySessionPayCategory(reasonCategory);
        lastError = err;
        if (!err.retryable || i >= maxAttempts - 1) throw err;
        const retryCategory = markSessionPayRetry({ reason, errorCode: String(body?.error || '').trim() });
        const retryDelayMs = getSessionPayRetryBackoffMs({ attempt, category: retryCategory });
        markSessionPayRetryDelay({ category: retryCategory, delayMs: retryDelayMs });
        if (retryDelayMs > 0) await waitMs(retryDelayMs);
        continue;
      } catch (error) {
        const reason = String(error?.message || '').trim();
        const reasonCategory = classifySessionPayFailure({ reason });
        const retryable = shouldRetrySessionPayCategory(reasonCategory) || error?.name === 'AbortError';
        const wrapped = error instanceof Error ? error : new Error(reason || 'session pay failed');
        wrapped.attempts = attempt;
        wrapped.retryable = retryable;
        wrapped.reasonCategory = reasonCategory;
        lastError = wrapped;
        if (!retryable || i >= maxAttempts - 1) throw wrapped;
        const retryCategory = markSessionPayRetry({ reason });
        const retryDelayMs = getSessionPayRetryBackoffMs({ attempt, category: retryCategory });
        markSessionPayRetryDelay({ category: retryCategory, delayMs: retryDelayMs });
        if (retryDelayMs > 0) await waitMs(retryDelayMs);
        continue;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('session pay failed');
  }

  return {
    buildSessionPayCategoryCounters,
    sessionPayMetrics,
    shouldRetrySessionPayReason,
    classifySessionPayFailure,
    shouldRetrySessionPayCategory,
    pushRecentSessionPayFailure,
    markSessionPayFailure,
    markSessionPayRetry,
    markSessionPayRetryDelay,
    buildRetryBackoffMs,
    getSessionPayRetryBackoffMs,
    sessionPayConfigSnapshot,
    postSessionPayWithRetry
  };
}
