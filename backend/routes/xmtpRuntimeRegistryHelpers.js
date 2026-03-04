export function createXmtpRuntimeRegistryHelpers(deps = {}) {
  const {
    createXmtpAgentRuntime,
    EXECUTOR_WALLET_KEY_NORMALIZED,
    findNetworkAgentById,
    handleExecutorRuntimeTaskEnvelope,
    handlePriceRuntimeTaskEnvelope,
    handleReaderRuntimeTaskEnvelope,
    handleRiskRuntimeTaskEnvelope,
    handleRouterRuntimeTextMessage,
    PRICE_WALLET_KEY_NORMALIZED,
    READER_WALLET_KEY_NORMALIZED,
    readXmtpEvents,
    RISK_WALLET_KEY_NORMALIZED,
    ROUTER_WALLET_KEY_NORMALIZED,
    writeXmtpEvents,
    XMTP_API_URL,
    XMTP_DB_ENCRYPTION_KEY,
    XMTP_ENV,
    XMTP_EVENT_RETENTION,
    XMTP_EXECUTOR_DB_DIRECTORY,
    XMTP_EXECUTOR_RUNTIME_ENABLED,
    XMTP_GATEWAY_HOST,
    XMTP_HISTORY_SYNC_URL,
    XMTP_PRICE_DB_DIRECTORY,
    XMTP_PRICE_RUNTIME_ENABLED,
    XMTP_READER_DB_DIRECTORY,
    XMTP_READER_RUNTIME_ENABLED,
    XMTP_RISK_DB_DIRECTORY,
    XMTP_RISK_RUNTIME_ENABLED,
    XMTP_ROUTER_DB_DIRECTORY,
    XMTP_ROUTER_RUNTIME_ENABLED
  } = deps;

  const xmtpRuntime = createXmtpAgentRuntime({
    enabled: XMTP_ROUTER_RUNTIME_ENABLED,
    runtimeName: 'router-runtime',
    agentId: 'router-agent',
    walletKey: ROUTER_WALLET_KEY_NORMALIZED,
    env: XMTP_ENV,
    apiUrl: XMTP_API_URL,
    historySyncUrl: XMTP_HISTORY_SYNC_URL,
    gatewayHost: XMTP_GATEWAY_HOST,
    dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
    dbDirectory: XMTP_ROUTER_DB_DIRECTORY,
    autoAck: true,
    eventRetention: XMTP_EVENT_RETENTION,
    readEvents: readXmtpEvents,
    writeEvents: writeXmtpEvents,
    resolveAgentById: findNetworkAgentById,
    handleTextMessage: handleRouterRuntimeTextMessage
  });

  const xmtpRiskRuntime = createXmtpAgentRuntime({
    enabled: XMTP_RISK_RUNTIME_ENABLED,
    runtimeName: 'risk-runtime',
    agentId: 'risk-agent',
    walletKey: RISK_WALLET_KEY_NORMALIZED,
    env: XMTP_ENV,
    apiUrl: XMTP_API_URL,
    historySyncUrl: XMTP_HISTORY_SYNC_URL,
    gatewayHost: XMTP_GATEWAY_HOST,
    dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
    dbDirectory: XMTP_RISK_DB_DIRECTORY,
    autoAck: true,
    eventRetention: XMTP_EVENT_RETENTION,
    readEvents: readXmtpEvents,
    writeEvents: writeXmtpEvents,
    resolveAgentById: findNetworkAgentById,
    handleTaskEnvelope: handleRiskRuntimeTaskEnvelope
  });

  const xmtpReaderRuntime = createXmtpAgentRuntime({
    enabled: XMTP_READER_RUNTIME_ENABLED,
    runtimeName: 'reader-runtime',
    agentId: 'reader-agent',
    walletKey: READER_WALLET_KEY_NORMALIZED,
    env: XMTP_ENV,
    apiUrl: XMTP_API_URL,
    historySyncUrl: XMTP_HISTORY_SYNC_URL,
    gatewayHost: XMTP_GATEWAY_HOST,
    dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
    dbDirectory: XMTP_READER_DB_DIRECTORY,
    autoAck: true,
    eventRetention: XMTP_EVENT_RETENTION,
    readEvents: readXmtpEvents,
    writeEvents: writeXmtpEvents,
    resolveAgentById: findNetworkAgentById,
    handleTaskEnvelope: handleReaderRuntimeTaskEnvelope
  });

  const xmtpPriceRuntime = createXmtpAgentRuntime({
    enabled: XMTP_PRICE_RUNTIME_ENABLED,
    runtimeName: 'price-runtime',
    agentId: 'price-agent',
    walletKey: PRICE_WALLET_KEY_NORMALIZED,
    env: XMTP_ENV,
    apiUrl: XMTP_API_URL,
    historySyncUrl: XMTP_HISTORY_SYNC_URL,
    gatewayHost: XMTP_GATEWAY_HOST,
    dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
    dbDirectory: XMTP_PRICE_DB_DIRECTORY,
    autoAck: true,
    eventRetention: XMTP_EVENT_RETENTION,
    readEvents: readXmtpEvents,
    writeEvents: writeXmtpEvents,
    resolveAgentById: findNetworkAgentById,
    handleTaskEnvelope: handlePriceRuntimeTaskEnvelope
  });

  const xmtpExecutorRuntime = createXmtpAgentRuntime({
    enabled: XMTP_EXECUTOR_RUNTIME_ENABLED,
    runtimeName: 'executor-runtime',
    agentId: 'executor-agent',
    walletKey: EXECUTOR_WALLET_KEY_NORMALIZED,
    env: XMTP_ENV,
    apiUrl: XMTP_API_URL,
    historySyncUrl: XMTP_HISTORY_SYNC_URL,
    gatewayHost: XMTP_GATEWAY_HOST,
    dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
    dbDirectory: XMTP_EXECUTOR_DB_DIRECTORY,
    autoAck: true,
    eventRetention: XMTP_EVENT_RETENTION,
    readEvents: readXmtpEvents,
    writeEvents: writeXmtpEvents,
    resolveAgentById: findNetworkAgentById,
    handleTaskEnvelope: handleExecutorRuntimeTaskEnvelope
  });

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function isRateLimitedRuntimeError(reason = '') {
    const text = normalizeText(reason).toLowerCase();
    if (!text) return false;
    return (
      text.includes('resource has been exhausted') ||
      text.includes('exceeds rate limit') ||
      text.includes('rate limit') ||
      text.includes('too many requests') ||
      text.includes('grpc status: 8') ||
      text.includes('status: 8')
    );
  }

  function compactRuntimeReason(reason = '', fallback = 'xmtp_runtime_error') {
    const text = normalizeText(reason || fallback);
    if (!text) return fallback;
    if (isRateLimitedRuntimeError(text)) return 'xmtp_identity_rate_limited';
    const line = text
      .split(/\r?\n/)
      .map((item) => normalizeText(item))
      .find(Boolean);
    return normalizeText(line || text).slice(0, 260);
  }

  function isTransientRuntimeError(reason = '') {
    const text = normalizeText(reason).toLowerCase();
    if (!text) return false;
    return (
      isRateLimitedRuntimeError(text) ||
      text.includes('transport') ||
      text.includes('stream') ||
      text.includes('incoming_handler') ||
      text.includes('unhandled') ||
      text.includes('timeout') ||
      text.includes('econn') ||
      text.includes('fetch failed') ||
      text.includes('tls')
    );
  }

  const runtimeStartRateLimitState = new Map();

  function getRuntimeStateKey(runtime, explicitLabel = '') {
    const runtimeName = normalizeText(runtime?.getStatus?.()?.runtimeName || '');
    if (runtimeName) return runtimeName;
    const fallback = normalizeText(explicitLabel);
    return fallback || 'runtime';
  }

  function getRateLimitCooldownMs(previousHits = 0) {
    const hits = Math.max(0, Number(previousHits) || 0);
    const base = 12_000;
    const next = Math.round(base * Math.pow(1.6, Math.min(hits, 6)));
    return Math.max(8_000, Math.min(next, 180_000));
  }

  function readRateLimitState(key = '') {
    const normalized = normalizeText(key);
    if (!normalized) return null;
    const entry = runtimeStartRateLimitState.get(normalized);
    if (!entry) return null;
    if (Date.now() >= Number(entry.cooldownUntil || 0)) {
      runtimeStartRateLimitState.delete(normalized);
      return null;
    }
    return entry;
  }

  function markRateLimitedStart(key = '', reason = '') {
    const normalized = normalizeText(key);
    if (!normalized) return null;
    const previous = runtimeStartRateLimitState.get(normalized);
    const hits = Math.max(1, Number(previous?.hits || 0) + 1);
    const cooldownMs = getRateLimitCooldownMs(hits - 1);
    const entry = {
      hits,
      reason: compactRuntimeReason(reason, 'xmtp_identity_rate_limited'),
      cooldownMs,
      cooldownUntil: Date.now() + cooldownMs
    };
    runtimeStartRateLimitState.set(normalized, entry);
    return entry;
  }

  function clearRateLimitState(key = '') {
    const normalized = normalizeText(key);
    if (!normalized) return;
    runtimeStartRateLimitState.delete(normalized);
  }

  async function waitMs(ms = 0) {
    const duration = Math.max(0, Number(ms) || 0);
    await new Promise((resolve) => setTimeout(resolve, duration));
  }

  async function startRuntimeWithRetry(runtime, { enabled = true, maxAttempts = 3, label = '' } = {}) {
    if (!enabled) return runtime.getStatus();
    const stateKey = getRuntimeStateKey(runtime, label);
    const throttled = readRateLimitState(stateKey);
    if (throttled) {
      const current = runtime.getStatus();
      return {
        ...current,
        lastError: compactRuntimeReason(current?.lastError || throttled.reason, 'xmtp_identity_rate_limited'),
        cooldownUntil: new Date(Number(throttled.cooldownUntil || 0)).toISOString()
      };
    }
    let attempt = 0;
    let last = runtime.getStatus();
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        last = await runtime.start();
      } catch {
        last = runtime.getStatus();
      }
      if (last?.running) {
        clearRateLimitState(stateKey);
        return {
          ...last,
          lastError: compactRuntimeReason(last?.lastError || '', '')
        };
      }
      const reason = normalizeText(last?.lastError || '');
      if (isRateLimitedRuntimeError(reason)) {
        const cooldown = markRateLimitedStart(stateKey, reason);
        return {
          ...last,
          lastError: compactRuntimeReason(reason, 'xmtp_identity_rate_limited'),
          cooldownUntil: cooldown ? new Date(Number(cooldown.cooldownUntil || 0)).toISOString() : ''
        };
      }
      if (!isTransientRuntimeError(reason)) return last;
      try {
        await runtime.stop();
      } catch {
        // noop
      }
      await waitMs(500 * attempt);
    }
    return {
      ...last,
      lastError: compactRuntimeReason(last?.lastError || '', '')
    };
  }

  function getAllXmtpRuntimeStatuses() {
    return {
      router: xmtpRuntime.getStatus(),
      risk: xmtpRiskRuntime.getStatus(),
      reader: xmtpReaderRuntime.getStatus(),
      price: xmtpPriceRuntime.getStatus(),
      executor: xmtpExecutorRuntime.getStatus()
    };
  }

  async function startXmtpRuntimes() {
    const router = await startRuntimeWithRetry(xmtpRuntime, {
      enabled: XMTP_ROUTER_RUNTIME_ENABLED,
      maxAttempts: 3,
      label: 'router-runtime'
    });
    let risk = xmtpRiskRuntime.getStatus();
    if (XMTP_RISK_RUNTIME_ENABLED) {
      risk = await startRuntimeWithRetry(xmtpRiskRuntime, {
        enabled: true,
        maxAttempts: 3,
        label: 'risk-runtime'
      });
    }
    let reader = xmtpReaderRuntime.getStatus();
    if (XMTP_READER_RUNTIME_ENABLED) {
      reader = await startRuntimeWithRetry(xmtpReaderRuntime, {
        enabled: true,
        maxAttempts: 3,
        label: 'reader-runtime'
      });
    }
    let price = xmtpPriceRuntime.getStatus();
    if (XMTP_PRICE_RUNTIME_ENABLED) {
      price = await startRuntimeWithRetry(xmtpPriceRuntime, {
        enabled: true,
        maxAttempts: 3,
        label: 'price-runtime'
      });
    }
    let executor = xmtpExecutorRuntime.getStatus();
    if (XMTP_EXECUTOR_RUNTIME_ENABLED) {
      executor = await startRuntimeWithRetry(xmtpExecutorRuntime, {
        enabled: true,
        maxAttempts: 3,
        label: 'executor-runtime'
      });
    }
    return { router, risk, reader, price, executor };
  }

  async function stopXmtpRuntimes() {
    const router = await xmtpRuntime.stop();
    const risk = await xmtpRiskRuntime.stop();
    const reader = await xmtpReaderRuntime.stop();
    const price = await xmtpPriceRuntime.stop();
    const executor = await xmtpExecutorRuntime.stop();
    return { router, risk, reader, price, executor };
  }

  return {
    getAllXmtpRuntimeStatuses,
    startXmtpRuntimes,
    stopXmtpRuntimes,
    xmtpExecutorRuntime,
    xmtpPriceRuntime,
    xmtpReaderRuntime,
    xmtpRiskRuntime,
    xmtpRuntime
  };
}
