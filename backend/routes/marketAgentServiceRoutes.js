import {
  fetchDexMarket,
  fetchKolMonitor,
  fetchListingAlert,
  fetchMarketPriceFeed,
  fetchMemeSentiment,
  fetchNewsSignal,
  fetchSmartMoneySignal,
  fetchTechBuzzSignal,
  fetchTokenAnalysis,
  fetchTrenchesScan,
  fetchWalletPnl,
  fetchWeatherContext
} from '../lib/externalFeeds.js';
import { createTrustLayerHelpers } from '../lib/trustLayerHelpers.js';
import { traceServiceInvoke, recordInvocation, recordSuccess, recordFailure, recordStageDuration, recordPaymentVolume, spanToTraceparent } from '../lib/paytrace/instrument.js';
import crypto from 'crypto';

export function registerMarketAgentServiceRoutes(app, deps) {
  const {
    ANALYSIS_PROVIDER,
    appendReputationSignal,
    appendTrustPublication,
    appendWorkflowStep,
    beginConsumerIntent,
    buildResponseHash,
    buildServiceStatus,
    buildAuthorityPublicSummary,
    buildAuthoritySnapshot,
    buildPolicySnapshotHash,
    broadcastEvent,
    computeServiceReputation,
    createX402Request,
    createTraceId,
    ensureNetworkAgents,
    ensureServiceCatalog,
    evaluateServiceInvokeGuard,
    finalizeConsumerIntent,
    findConsumerIntent,
    getInternalAgentApiKey,
    hasStrictX402Evidence,
    handleRouterRuntimeTextMessage,
    hyperliquidAdapter,
    KITE_AGENT1_ID,
    KITE_AGENT2_AA_ADDRESS,
    KITE_AGENT2_ID,
    mapServiceReceipt,
    normalizeAddress,
    normalizeRiskScoreParams,
    normalizeXReaderParams,
    PORT,
    postSessionPayWithRetry,
    publishTrustPublicationOnChain,
    readRecords,
    readServiceInvocations,
    readSessionRuntime,
    resolveSessionRuntime,
    readWorkflows,
    readX402Requests,
    requireRole,
    resolveAnalysisErrorStatus,
    resolveWorkflowTraceId,
    runAgent001HyperliquidOrderWorkflow,
    runRiskScoreAnalysis,
    sanitizeServiceRecord,
    SETTLEMENT_TOKEN,
    upsertWorkflow,
    upsertAgent001ResultRecord,
    upsertServiceInvocation,
    validateConsumerAuthority,
    validatePaymentProof,
    verifyProofOnChain,
    writeX402Requests,
    writeRecords,
    writePublishedServices,
    X_READER_MAX_CHARS_DEFAULT,
    X402_BTC_PRICE,
    buildPaymentRequiredResponse
  } = deps;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function normalizePerpCoin(symbol = 'BTCUSDT') {
    const upper = normalizeText(symbol).toUpperCase().replace(/[-_\s/]/g, '');
    if (!upper) return 'BTC';
    if (upper.endsWith('USDT')) return upper.slice(0, -4) || 'BTC';
    if (upper.endsWith('USDC')) return upper.slice(0, -4) || 'BTC';
    if (upper.endsWith('USD')) return upper.slice(0, -3) || 'BTC';
    return upper;
  }

  function normalizeCandleInterval(value = '1m') {
    const raw = normalizeText(value).toLowerCase();
    const supported = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w']);
    if (supported.has(raw)) return raw;
    return '1m';
  }

  function normalizeBool(value, fallback = false) {
    const raw = normalizeText(value).toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
  }

  const { appendInvokeTrustArtifacts } = createTrustLayerHelpers({
    appendReputationSignal,
    appendTrustPublication,
    createTraceId,
    ensureNetworkAgents,
    publishTrustPublicationOnChain
  });

  function resolveConsumerTrustSubject(body = {}, invocation = {}, requestRecord = {}) {
    const agentId = normalizeText(
      body.connectorAgentId ||
      requestRecord?.identity?.agentId ||
      invocation?.consumerAgentId ||
      ''
    );
    const identityRegistry = normalizeText(
      body.connectorIdentityRegistry ||
      requestRecord?.identity?.registry ||
      invocation?.consumerIdentityRegistry ||
      ''
    );
    if (!agentId || !identityRegistry) return null;
    return {
      agentId,
      identityRegistry
    };
  }

  function resolveInvokeRuntime(body = {}) {
    const requestedOwner = normalizeAddress(body.ownerEoa || body.owner || '');
    const requestedAaWallet = normalizeAddress(body.aaWallet || '');
    const requestedSessionId = normalizeText(body.sessionId || '');
    if (!requestedOwner && !requestedAaWallet && !requestedSessionId) {
      return {
        requestedOwner: '',
        runtime: readSessionRuntime()
      };
    }
    const scopedRuntime = resolveSessionRuntime?.({
      owner: requestedOwner,
      aaWallet: requestedAaWallet,
      sessionId: requestedSessionId
    }) || {};
    const normalizedRuntimeOwner = normalizeAddress(scopedRuntime?.owner || '');
    if (requestedOwner && normalizedRuntimeOwner !== requestedOwner) {
      return {
        requestedOwner,
        runtime: {}
      };
    }
    return {
      requestedOwner,
      runtime: scopedRuntime
    };
  }

  function buildExternalFeedSummary(service = {}, result = null) {
    const serviceName = normalizeText(service?.name || service?.id || 'external feed');
    const source = normalizeText(result?.source || '');
    const data = result?.data;
    let count = 0;
    if (Array.isArray(data)) {
      count = data.length;
    } else if (data && typeof data === 'object') {
      const firstArray = Object.values(data).find((value) => Array.isArray(value));
      count = Array.isArray(firstArray) ? firstArray.length : 0;
    }
    const countText = count > 0 ? ` (${count} items)` : '';
    const sourceText = source ? ` via ${source}` : '';
    return `${serviceName} completed${countText}${sourceText}`.trim();
  }

  function getExternalFeedItemCount(result = null) {
    const data = result?.data;
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') {
      let arrayCount = 0;
      for (const value of Object.values(data)) {
        if (Array.isArray(value)) {
          arrayCount += value.length;
        }
      }
      if (arrayCount > 0) return arrayCount;
      const metadataKeys = new Set([
        'sourceUrl',
        'sourceName',
        'publishedAt',
        'fetchedAt',
        'txHash',
        'explorerUrl',
        'raw'
      ]);
      const hasMeaningfulScalar = Object.entries(data).some(([key, value]) => {
        if (metadataKeys.has(String(key || '').trim())) return false;
        if (Array.isArray(value)) return false;
        if (value === null || value === undefined) return false;
        if (typeof value === 'boolean' || typeof value === 'number') return true;
        if (typeof value === 'string') return value.trim().length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return false;
      });
      if (hasMeaningfulScalar) return 1;
    }
    return 0;
  }

  const appendServiceWorkflowStep =
    typeof appendWorkflowStep === 'function'
      ? appendWorkflowStep
      : (workflow, name, status, details = {}) => {
          if (!workflow.steps) workflow.steps = [];
          workflow.steps.push({
            name,
            status,
            at: new Date().toISOString(),
            details
          });
        };

  function upsertX402RequestRecord(record = {}) {
    const requestId = normalizeText(record?.requestId || '');
    if (!requestId) return null;
    const rows = Array.isArray(readX402Requests()) ? readX402Requests() : [];
    const nextRecord = {
      ...record,
      requestId,
      updatedAt: Number(record?.updatedAt || Date.now())
    };
    const idx = rows.findIndex((item) => normalizeText(item?.requestId || '') === requestId);
    if (idx >= 0) rows[idx] = nextRecord;
    else rows.unshift(nextRecord);
    writeX402Requests(rows);
    return nextRecord;
  }

  function appendValidationRecord({
    requestId = '',
    txHash = '',
    userOpHash = '',
    tokenAddress = '',
    recipient = '',
    amount = '',
    action = '',
    payer = '',
    signerMode = 'aa-session'
  } = {}) {
    if (typeof readRecords !== 'function' || typeof writeRecords !== 'function') return null;
    const normalizedTxHash = normalizeText(txHash);
    if (!normalizedTxHash) return null;
    const rows = Array.isArray(readRecords()) ? readRecords() : [];
    rows.unshift({
      time: new Date().toISOString(),
      type: 'aa-session-payment',
      amount: String(amount || ''),
      token: String(tokenAddress || ''),
      recipient: String(recipient || ''),
      txHash: normalizedTxHash,
      userOpHash: String(userOpHash || ''),
      status: 'success',
      requestId: String(requestId || ''),
      signerMode,
      relaySender: '',
      agentId: '',
      identityRegistry: '',
      aaWallet: String(payer || ''),
      sessionAddress: '',
      sessionId: '',
      action: String(action || '')
    });
    writeRecords(rows);
    return rows[0];
  }

  function buildExternalFeedRequest({ service = {}, invocation = {}, traceId = '', input = {} } = {}) {
    return createX402Request(
      `${normalizeText(service?.name || service?.id)} ${normalizeText(service?.action || invocation?.action)}`.trim(),
      invocation?.payer || '',
      normalizeText(service?.id || invocation?.action || 'external-feed'),
      {
        amount: invocation?.amount || service?.price || X402_BTC_PRICE || '',
        tokenAddress: invocation?.tokenAddress || service?.tokenAddress || SETTLEMENT_TOKEN || '',
        recipient: invocation?.recipient || service?.recipient || '',
        a2a: {
          sourceAgentId: invocation?.sourceAgentId || '',
          targetAgentId: invocation?.targetAgentId || '',
          capability: normalizeText(service?.id || invocation?.action || ''),
          taskType: normalizeText(service?.action || invocation?.action || ''),
          traceId
        },
        identity:
          invocation?.consumerAgentId && invocation?.consumerIdentityRegistry
            ? {
                agentId: normalizeText(invocation.consumerAgentId),
                registry: normalizeText(invocation.consumerIdentityRegistry)
              }
            : undefined,
        actionParams: input && typeof input === 'object' && !Array.isArray(input) ? input : {}
      }
    );
  }

  function buildExternalFeedWorkflow({ service = {}, invocation = {}, traceId = '', input = {}, request = {} } = {}) {
    return {
      traceId,
      type: normalizeText(service?.action || invocation?.action || 'external-feed'),
      state: 'running',
      sourceAgentId: invocation?.sourceAgentId || '',
      targetAgentId: invocation?.targetAgentId || '',
      payer: invocation?.payer || '',
      input: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
      requestId: normalizeText(request?.requestId || ''),
      txHash: '',
      userOpHash: '',
      steps: [],
      createdAt: invocation?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function buildExternalFeedPaymentRequiredResponse(request = {}, reason = '') {
    if (typeof buildPaymentRequiredResponse === 'function') {
      return {
        ...buildPaymentRequiredResponse(request, reason),
        ok: false,
        requestId: normalizeText(request?.requestId || '')
      };
    }
    return {
      ok: false,
      error: 'payment_required',
      reason,
      requestId: normalizeText(request?.requestId || ''),
      x402: {
        version: '0.1-demo',
        requestId: normalizeText(request?.requestId || ''),
        expiresAt: request?.expiresAt || 0,
        accepts: [
          {
            scheme: 'kite-aa-erc20',
            network: 'kite_testnet',
            tokenAddress: normalizeText(request?.tokenAddress || ''),
            amount: String(request?.amount || ''),
            recipient: normalizeText(request?.recipient || ''),
            decimals: 18
          }
        ]
      }
    };
  }

  function buildFailedServiceWorkflow({ service = {}, invocation = {}, traceId = '', input = {}, reason = '' } = {}) {
    return {
      traceId,
      type: normalizeText(service?.action || invocation?.action || 'service-invoke'),
      state: 'failed',
      sourceAgentId: invocation?.sourceAgentId || '',
      targetAgentId: invocation?.targetAgentId || '',
      payer: invocation?.payer || '',
      input: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
      requestId: normalizeText(invocation?.requestId || ''),
      txHash: normalizeText(invocation?.txHash || ''),
      userOpHash: normalizeText(invocation?.userOpHash || ''),
      steps: [
        {
          name: 'failed',
          status: 'error',
          at: new Date().toISOString(),
          details: {
            reason: normalizeText(reason || 'service invoke failed')
          }
        }
      ],
      createdAt: invocation?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: normalizeText(reason || 'service invoke failed')
    };
  }

  function resolveAgentManagedTaskPath(action = '') {
    const normalizedAction = normalizeText(action).toLowerCase();
    if (normalizedAction === 'btc-price-feed') return '/api/a2a/tasks/btc-price';
    if (normalizedAction === 'risk-score-feed' || normalizedAction === 'technical-analysis-feed') {
      return '/api/a2a/tasks/risk-score';
    }
    if (normalizedAction === 'info-analysis-feed') return '/api/a2a/tasks/info';
    return '';
  }

  function buildAgentManagedTaskPayload({
    action = '',
    traceId = '',
    payer = '',
    sourceAgentId = '',
    targetAgentId = '',
    input = {},
    requestId = '',
    paymentProof = null
  } = {}) {
    const payload = {
      traceId,
      payer,
      sourceAgentId,
      targetAgentId,
      task: input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    };
    if (requestId) payload.requestId = requestId;
    if (paymentProof && typeof paymentProof === 'object' && !Array.isArray(paymentProof)) {
      payload.paymentProof = paymentProof;
    }
    if (normalizeText(action).toLowerCase() === 'technical-analysis-feed') {
      payload.action = 'technical-analysis-feed';
    }
    return payload;
  }

  function workflowHasStep(workflow = {}, stepName = '') {
    const normalizedStepName = normalizeText(stepName).toLowerCase();
    return Array.isArray(workflow?.steps)
      ? workflow.steps.some((step) => normalizeText(step?.name || '').toLowerCase() === normalizedStepName)
      : false;
  }

  function buildAuthorityErrorResponse(result = {}) {
    return {
      ok: false,
      error: normalizeText(result?.code || 'authority_validation_failed'),
      reason: normalizeText(result?.reason || 'authority validation failed'),
      authority: result?.authorityPublic || null,
      policySnapshotHash: normalizeText(result?.policySnapshotHash || ''),
      detail: result?.detail && typeof result.detail === 'object' ? result.detail : undefined
    };
  }

  function buildIntentConflictPayload(result = {}) {
    const existing = result?.existing && typeof result.existing === 'object' ? result.existing : null;
    const existingInvocation = existing?.resultRef
      ? readServiceInvocations().find((item) => normalizeText(item?.invocationId) === normalizeText(existing.resultRef)) || null
      : null;
    return {
      ok: false,
      error: normalizeText(result?.code || 'intent_conflict'),
      reason: normalizeText(result?.reason || 'intent conflict'),
      intent: existing,
      invocation:
        existingInvocation && typeof existingInvocation === 'object'
          ? {
              invocationId: normalizeText(existingInvocation?.invocationId),
              traceId: normalizeText(existingInvocation?.traceId),
              requestId: normalizeText(existingInvocation?.requestId),
              state: normalizeText(existingInvocation?.state),
              serviceId: normalizeText(existingInvocation?.serviceId),
              summary: normalizeText(existingInvocation?.summary),
              error: normalizeText(existingInvocation?.error)
            }
          : null
    };
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function isRetryableInternalFetchError(error = null) {
    const message = normalizeText(error?.message || error || '').toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('fetch failed') ||
      message.includes('socket hang up') ||
      message.includes('und_err_socket') ||
      message.includes('etimedout')
    );
  }

  async function postInternalWorkflowWithRetry(pathname = '', headers = {}, body = {}) {
    const targetPath = normalizeText(pathname);
    const maxAttempts = 3;
    const timeoutMs = Math.max(30_000, Number(process.env.INTERNAL_WORKFLOW_TIMEOUT_MS || 70_000));
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(`http://127.0.0.1:${PORT}${targetPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);
        const payload = await resp.json().catch(() => ({}));
        return { resp, payload };
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableInternalFetchError(error)) {
          throw error;
        }
        await sleep(250 * attempt);
      }
    }

    throw lastError || new Error('internal workflow invoke failed');
  }

  async function fetchBinanceKlines(symbol = 'BTCUSDT', interval = '1m', limit = 200) {
    const coin = normalizePerpCoin(symbol);
    const pair = `${coin}USDT`;
    const safeLimit = Math.max(20, Math.min(Number(limit || 200), 1000));
    const binanceTimeoutMs = Math.max(5_000, Number(process.env.BINANCE_TIMEOUT_MS || 15_000));
    const binanceController = new AbortController();
    const binanceTimer = setTimeout(() => binanceController.abort(), binanceTimeoutMs);
    let resp;
    try {
      resp = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: binanceController.signal
        }
      );
    } finally {
      clearTimeout(binanceTimer);
    }
    const body = await resp.json().catch(() => []);
    if (!resp.ok) {
      const reason = body?.msg || body?.message || `binance_http_${resp.status}`;
      throw new Error(String(reason || 'binance_klines_failed'));
    }
    if (!Array.isArray(body) || body.length === 0) {
      throw new Error('binance_klines_empty');
    }
    const items = body
      .map((row) => {
        const t = Number(row?.[0] ?? NaN);
        const open = Number(row?.[1] ?? NaN);
        const high = Number(row?.[2] ?? NaN);
        const low = Number(row?.[3] ?? NaN);
        const close = Number(row?.[4] ?? NaN);
        const volume = Number(row?.[5] ?? NaN);
        return {
          time: Number.isFinite(t) ? Math.floor(t / 1000) : 0,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0
        };
      })
      .filter(
        (row) =>
          row.time > 0 &&
          Number.isFinite(row.open) &&
          Number.isFinite(row.high) &&
          Number.isFinite(row.low) &&
          Number.isFinite(row.close)
      );
    return {
      symbol: pair,
      interval,
      total: items.length,
      items
    };
  }

  app.get('/api/hyperliquid/testnet/health', requireRole('viewer'), async (req, res) => {
    const adapterInfo = hyperliquidAdapter.info();
    const health = await hyperliquidAdapter.health();
    return res.status(health?.ok ? 200 : 503).json({
      ok: Boolean(health?.ok),
      traceId: req.traceId || '',
      adapter: adapterInfo,
      health
    });
  });
  
  app.get('/api/hyperliquid/testnet/mids', requireRole('viewer'), async (req, res) => {
    try {
      const mids = await hyperliquidAdapter.allMids();
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        total: mids && typeof mids === 'object' ? Object.keys(mids).length : 0,
        mids
      });
    } catch (error) {
      const detail = hyperliquidAdapter.buildAdapterError(error);
      return res.status(503).json({
        ok: false,
        traceId: req.traceId || '',
        error: detail.error || 'hyperliquid_mids_failed',
        reason: detail.reason || 'hyperliquid mids failed',
        response: detail.response || null
      });
    }
  });

  app.get('/api/hyperliquid/testnet/candles', requireRole('viewer'), async (req, res) => {
    const symbol = normalizeText(req.query.symbol || req.query.coin || 'BTCUSDT').toUpperCase() || 'BTCUSDT';
    const interval = normalizeCandleInterval(req.query.interval || '1m');
    const limit = Math.max(20, Math.min(Number(req.query.limit || 200), 1000));
    const sourceRaw = normalizeText(req.query.source || 'auto').toLowerCase();
    const source = ['auto', 'hyperliquid', 'binance'].includes(sourceRaw) ? sourceRaw : 'auto';
    let hyperliquidReason = '';
    let binanceReason = '';

    if (source !== 'binance') {
      try {
        const rows = await hyperliquidAdapter.candleSnapshot({
          symbol,
          interval,
          limit,
          startTime: req.query.startTime,
          endTime: req.query.endTime
        });
        return res.json({
          ok: true,
          traceId: req.traceId || '',
          mode: 'testnet',
          symbol,
          interval,
          source: 'hyperliquid',
          total: rows.total || 0,
          candles: rows.items || [],
          fallbackReason: ''
        });
      } catch (error) {
        const detail = hyperliquidAdapter.buildAdapterError(error);
        hyperliquidReason = detail.reason || detail.error || 'hyperliquid_candles_failed';
        if (source === 'hyperliquid') {
          return res.status(503).json({
            ok: false,
            traceId: req.traceId || '',
            error: detail.error || 'hyperliquid_candles_failed',
            reason: hyperliquidReason,
            response: detail.response || null
          });
        }
      }
    }

    try {
      const rows = await fetchBinanceKlines(symbol, interval, limit);
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        symbol,
        interval,
        source: 'binance',
        total: rows.total || 0,
        candles: rows.items || [],
        fallbackReason: hyperliquidReason || ''
      });
    } catch (error) {
      binanceReason = String(error?.message || 'binance_candles_failed').trim();
      return res.status(503).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'candles_unavailable',
        reason: `hyperliquid:${hyperliquidReason || 'not_attempted'} | binance:${binanceReason || 'unknown'}`,
      });
    }
  });

  app.get('/api/hyperliquid/testnet/positions', requireRole('viewer'), async (req, res) => {
    const scopeRaw = normalizeText(req.query.scope || 'btc').toLowerCase();
    const scope = scopeRaw === 'all' ? 'all' : 'btc';
    const symbol = normalizeText(req.query.symbol || 'BTCUSDT').toUpperCase() || 'BTCUSDT';
    const includeOpenOrders = normalizeBool(req.query.includeOpenOrders, true);
    try {
      const base = await hyperliquidAdapter.positions({
        user: req.query.user || '',
        symbol,
        scope
      });
      const mids = await hyperliquidAdapter.allMids().catch(() => ({}));
      const normalizedItems = (Array.isArray(base?.items) ? base.items : []).map((row) => {
        const coin = normalizePerpCoin(row?.coin || row?.symbol || '');
        const mark = Number(mids?.[coin] ?? NaN);
        const markPrice = Number.isFinite(mark) ? mark : null;
        return {
          ...row,
          markPrice,
          markValue:
            markPrice && Number.isFinite(Number(row?.signedSize))
              ? Number((markPrice * Number(row.signedSize)).toFixed(8))
              : null
        };
      });

      let openOrders = { total: 0, items: [] };
      let openOrdersError = '';
      if (includeOpenOrders) {
        try {
          const fetched = await hyperliquidAdapter.openOrders({
            user: req.query.user || '',
            symbol: scope === 'all' ? '' : symbol
          });
          openOrders = {
            total: Number(fetched?.total || 0),
            items: Array.isArray(fetched?.items) ? fetched.items : []
          };
        } catch (error) {
          const detail = hyperliquidAdapter.buildAdapterError(error);
          openOrdersError = detail.reason || detail.error || 'open_orders_failed';
        }
      }

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        user: base?.user || '',
        scope,
        symbol: scope === 'all' ? '' : symbol,
        account: base?.account || {},
        total: normalizedItems.length,
        positions: normalizedItems,
        openOrders,
        openOrdersError
      });
    } catch (error) {
      const detail = hyperliquidAdapter.buildAdapterError(error);
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: detail.error || 'hyperliquid_positions_failed',
        reason: detail.reason || 'hyperliquid positions failed',
        response: detail.response || null
      });
    }
  });
  
  app.get('/api/hyperliquid/testnet/open-orders', requireRole('viewer'), async (req, res) => {
    try {
      const result = await hyperliquidAdapter.openOrders({
        user: req.query.user || '',
        symbol: req.query.symbol || ''
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        ...result
      });
    } catch (error) {
      const detail = hyperliquidAdapter.buildAdapterError(error);
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: detail.error || 'hyperliquid_open_orders_failed',
        reason: detail.reason || 'hyperliquid open-orders failed',
        response: detail.response || null
      });
    }
  });
  
  app.get('/api/hyperliquid/testnet/order-status', requireRole('viewer'), async (req, res) => {
    try {
      const oid = req.query.oid || req.query.orderId || req.query.cloid || '';
      const result = await hyperliquidAdapter.orderStatus({
        user: req.query.user || '',
        oid
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        ...result
      });
    } catch (error) {
      const detail = hyperliquidAdapter.buildAdapterError(error);
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: detail.error || 'hyperliquid_order_status_failed',
        reason: detail.reason || 'hyperliquid order-status failed',
        response: detail.response || null
      });
    }
  });
  
  app.post('/api/hyperliquid/testnet/order', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const result = await hyperliquidAdapter.placePerpOrder({
        symbol: body.symbol || body.coin || 'BTCUSDT',
        side: body.side || '',
        orderType: body.orderType || body.type || 'limit',
        size: body.size ?? body.sz ?? '',
        price: body.price ?? '',
        tif: body.tif || '',
        reduceOnly: body.reduceOnly === true || String(body.reduceOnly || '').trim().toLowerCase() === 'true',
        slippageBps: body.slippageBps ?? body.marketSlippageBps,
        cloid: body.cloid || body.clientOrderId || '',
        simulate: body.simulate === true || body.dryRun === true,
        reloadMeta: body.reloadMeta === true
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        result
      });
    } catch (error) {
      const detail = hyperliquidAdapter.buildAdapterError(error);
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: detail.error || 'hyperliquid_order_failed',
        reason: detail.reason || 'hyperliquid order failed',
        response: detail.response || null
      });
    }
  });
  
  app.post('/api/hyperliquid/testnet/cancel', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const result = await hyperliquidAdapter.cancelPerpOrders({
        symbol: body.symbol || body.coin || 'BTCUSDT',
        oid: body.oid ?? body.orderId,
        oids: body.oids,
        simulate: body.simulate === true || body.dryRun === true,
        reloadMeta: body.reloadMeta === true
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode: 'testnet',
        result
      });
    } catch (error) {
      const detail = hyperliquidAdapter.buildAdapterError(error);
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: detail.error || 'hyperliquid_cancel_failed',
        reason: detail.reason || 'hyperliquid cancel failed',
        response: detail.response || null
      });
    }
  });
  
  app.get('/api/agent001/hyperliquid/status', requireRole('viewer'), async (req, res) => {
    const runtime = readSessionRuntime();
    const adapter = hyperliquidAdapter.info();
    const health = await hyperliquidAdapter.health();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      adapter,
      health,
      agent001: {
        payer: normalizeAddress(runtime?.aaWallet || ''),
        sessionAddress: normalizeAddress(runtime?.sessionAddress || ''),
        sessionId: String(runtime?.sessionId || '').trim()
      }
    });
  });
  
  app.post('/api/agent001/hyperliquid/order', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const input = body?.plan && typeof body.plan === 'object' && !Array.isArray(body.plan) ? body.plan : body;
    const symbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
    const side = String(input.side || '').trim().toLowerCase();
    const orderType = String(input.orderType || input.type || 'limit').trim().toLowerCase() || 'limit';
    const tif = String(input.tif || (orderType === 'market' ? 'Ioc' : 'Gtc')).trim() || (orderType === 'market' ? 'Ioc' : 'Gtc');
    const size = Number(input.size ?? input.sz ?? NaN);
    const entryPrice = Number(input.entryPrice ?? input.price ?? NaN);
    const reduceOnly = input.reduceOnly === true || String(input.reduceOnly || '').trim().toLowerCase() === 'true';
    const simulate = input.simulate === true || input.dryRun === true;
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(body.payer || runtime?.aaWallet || '');
    const traceId = resolveWorkflowTraceId(body.traceId || createTraceId('agent001_api_hl_order'));
  
    if (!payer) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'payer_missing',
        reason: 'AA payer is required. Configure session runtime first.'
      });
    }
    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_side',
        reason: 'side must be buy/sell'
      });
    }
    if (!['limit', 'market'].includes(orderType)) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_order_type',
        reason: 'orderType must be limit/market'
      });
    }
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_size',
        reason: 'size must be a positive number'
      });
    }
    if (orderType === 'limit' && (!Number.isFinite(entryPrice) || entryPrice <= 0)) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_price',
        reason: 'limit order requires positive price'
      });
    }
  
    const plan = {
      canPlaceOrder: true,
      symbol,
      side,
      orderType,
      tif,
      size,
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
      reduceOnly,
      simulate
    };
  
    try {
      const result = await runAgent001HyperliquidOrderWorkflow({
        plan,
        payer,
        sourceAgentId: 'router-agent',
        targetAgentId: 'executor-agent',
        traceId
      });
      const payment = result?.payment || null;
      const receiptRef = result?.receiptRef || null;
      if (!hasStrictX402Evidence(payment)) {
        return res.status(502).json({
          ok: false,
          traceId: req.traceId || '',
          error: 'x402_evidence_missing',
          reason: 'hyperliquid workflow finished without strict x402 evidence',
          payment,
          workflow: result?.workflow || null
        });
      }
      const requestId = String(payment?.requestId || result?.requestId || '').trim();
      const txHash = String(payment?.txHash || result?.txHash || '').trim();
      const saved = upsertAgent001ResultRecord({
        requestId,
        capability: 'hyperliquid-order-testnet',
        stage: 'dispatch',
        status: 'done',
        toAgentId: 'executor-agent',
        payer,
        input: {
          symbol,
          side,
          orderType,
          tif,
          size,
          price: Number.isFinite(entryPrice) ? entryPrice : null,
          reduceOnly,
          simulate
        },
        payment,
        receiptRef,
        result: {
          summary: `Hyperliquid ${orderType} ${side} ${symbol} executed via agent001 api.`,
          workflowTraceId: String(result?.traceId || traceId).trim(),
          workflowState: String(result?.state || result?.workflow?.state || '').trim(),
          orderResult: result?.orderResult || null
        },
        source: 'agent001_api_order'
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        requestId,
        txHash,
        payment,
        receiptRef,
        workflow: result?.workflow || null,
        orderResult: result?.orderResult || null,
        agent001Result: saved
      });
    } catch (error) {
      const workflow = error?.workflow && typeof error.workflow === 'object' ? error.workflow : null;
      const requestId = String(error?.requestId || workflow?.requestId || '').trim();
      const workflowTraceId = String(error?.workflowTraceId || workflow?.traceId || '').trim();
      const failedStep = String(error?.failedStep || '').trim();
      const httpStatus = Number(error?.httpStatus || 0);
      const reason = String(error?.message || 'agent001 hyperliquid order failed').trim();
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'agent001_hyperliquid_order_failed',
        reason,
        statusCode: Number.isFinite(httpStatus) && httpStatus > 0 ? httpStatus : undefined,
        requestId: requestId || undefined,
        workflowTraceId: workflowTraceId || undefined,
        failedStep: failedStep || undefined,
        workflow
      });
    }
  });
  
  app.post('/api/agent001/chat/run', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const text = String(body.text || body.message || '').trim();
    if (!text) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'text_required',
        reason: 'text is required'
      });
    }
    try {
      const reply = await handleRouterRuntimeTextMessage({ text });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        agentId: 'router-agent',
        reply
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'agent001_chat_failed',
        reason: error?.message || 'agent001 chat failed'
      });
    }
  });
  
  app.get('/api/agent001/results/:requestId', requireRole('viewer'), async (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    try {
      const resolved = await resolveAgent001ResultByRequestId(requestId);
      if (!resolved?.ok) {
        return res.status(Number(resolved?.statusCode || 400)).json({
          ok: false,
          traceId: req.traceId || '',
          requestId,
          error: resolved?.error || 'agent001_result_failed',
          reason: resolved?.reason || 'agent001 result query failed',
          payment: resolved?.payment || null
        });
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        requestId: resolved.requestId,
        capability: resolved.capability,
        status: resolved.status || 'done',
        source: resolved.source || 'stored',
        payment: resolved.payment || null,
        receiptRef: resolved.receiptRef || null,
        result: resolved.result || null,
        dm: resolved.dm || null,
        error: resolved.error || '',
        reason: resolved.reason || ''
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        requestId,
        error: 'agent001_result_failed',
        reason: error?.message || 'agent001 result query failed'
      });
    }
  });
  
  app.post('/api/analysis/info/run', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const task = normalizeXReaderParams({
        url: body.url || body.resourceUrl || body.targetUrl,
        topic: body.topic || body.query || body.keyword,
        mode: body.mode || body.source || 'auto',
        maxChars: body.maxChars ?? X_READER_MAX_CHARS_DEFAULT
      });
      const result = await runInfoAnalysis({
        ...task,
        traceId: req.traceId || ''
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        provider: String(result?.provider || ANALYSIS_PROVIDER).trim() || ANALYSIS_PROVIDER,
        task,
        result
      });
    } catch (error) {
      return res.status(resolveAnalysisErrorStatus(error, 400)).json({
        ok: false,
        traceId: req.traceId || '',
        error: String(error?.code || 'info_analysis_failed').trim() || 'info_analysis_failed',
        reason: error?.message || 'info analysis failed'
      });
    }
  });
  
  app.post('/api/analysis/technical/run', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const task = normalizeRiskScoreParams({
        symbol: body.symbol || body.pair || 'BTCUSDT',
        source: body.source || 'hyperliquid',
        horizonMin: body.horizonMin ?? 60
      });
      const result = await runRiskScoreAnalysis({
        ...task,
        traceId: req.traceId || ''
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        provider: ANALYSIS_PROVIDER,
        task,
        result: result?.technical || result
      });
    } catch (error) {
      return res.status(resolveAnalysisErrorStatus(error, 400)).json({
        ok: false,
        traceId: req.traceId || '',
        error: String(error?.code || 'technical_analysis_failed').trim() || 'technical_analysis_failed',
        reason: error?.message || 'technical analysis failed'
      });
    }
  });
  
  app.get('/api/services', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
    const activeOnly = String(req.query.active || '').trim().toLowerCase();
    const rows = ensureServiceCatalog()
      .filter((item) => {
        if (activeOnly === '1' || activeOnly === 'true') return item?.active !== false;
        if (activeOnly === '0' || activeOnly === 'false') return item?.active === false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
      .slice(0, limit);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });
  
  app.get('/api/services/:serviceId', requireRole('viewer'), (req, res) => {
    const serviceId = String(req.params.serviceId || '').trim();
    if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
    const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
    if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
    const recentInvocations = readServiceInvocations()
      .filter((item) => String(item?.serviceId || '').trim() === serviceId)
      .slice(0, 12);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      service,
      recentInvocations
    });
  });
  
  app.post('/api/services/publish', requireRole('admin'), (req, res) => {
    try {
      const body = req.body || {};
      const rows = ensureServiceCatalog();
      const requestedId = String(body.id || '').trim();
      const existingIdx = requestedId ? rows.findIndex((item) => String(item?.id || '').trim() === requestedId) : -1;
      const existing = existingIdx >= 0 ? rows[existingIdx] : null;
      const record = sanitizeServiceRecord(
        {
          ...body,
          publishedBy: req.authRole || 'admin'
        },
        existing
      );
      if (existingIdx >= 0) rows[existingIdx] = record;
      else rows.unshift(record);
      writePublishedServices(rows);
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        service: record,
        mode: existing ? 'updated' : 'created'
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_service',
        reason: error?.message || 'invalid service payload'
      });
    }
  });
  
  app.post('/api/services/:serviceId/invoke', requireRole('agent'), async (req, res) => {
    const serviceId = String(req.params.serviceId || '').trim();
    if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
    const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
    if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
    if (service.active === false) {
      return res.status(409).json({ ok: false, error: 'service_inactive', reason: 'Service is not active.' });
    }
    const action = String(service.action || '').trim().toLowerCase();
    const effectiveAction = action === 'x-reader-feed' ? 'info-analysis-feed' : action;
    const effectiveProvider = normalizeText(service?.providerKey || service?.providerAgentId || '').toLowerCase();
    const capabilityId = normalizeText(service?.id || '').toLowerCase();
    const isFundamentalExternalCapability =
      effectiveProvider === 'fundamental-agent-real' &&
      ['cap-listing-alert', 'cap-news-signal', 'cap-meme-sentiment', 'cap-kol-monitor'].includes(capabilityId);
    const isTechnicalExternalCapability =
      effectiveProvider === 'technical-agent-real' &&
      ['cap-smart-money-signal', 'cap-trenches-scan', 'cap-token-analysis', 'cap-wallet-pnl', 'cap-dex-market'].includes(capabilityId);
    const isDataNodeExternalCapability =
      effectiveProvider === 'data-node-real' &&
      ['cap-weather-context', 'cap-tech-buzz-signal', 'cap-market-price-feed'].includes(capabilityId);
    const isExternalFeedCapability =
      isFundamentalExternalCapability || isTechnicalExternalCapability || isDataNodeExternalCapability;
    const supportedServiceActions = [
      'btc-price-feed',
      'risk-score-feed',
      'technical-analysis-feed',
      'x-reader-feed',
      'info-analysis-feed',
      'hyperliquid-order-testnet',
      'weather-context',
      'tech-buzz-signal',
      'market-price-feed'
    ];
    if (!supportedServiceActions.includes(action) && !isExternalFeedCapability) {
      return res.status(400).json({
        ok: false,
        error: 'unsupported_service_action',
        reason:
          'Supported action: btc-price-feed, risk-score-feed, technical-analysis-feed, x-reader-feed, info-analysis-feed, hyperliquid-order-testnet, weather-context, tech-buzz-signal, market-price-feed.'
      });
    }
  
    const body = req.body || {};
    const runtimeLookup = resolveInvokeRuntime(body);
    const runtime = runtimeLookup.runtime || {};
    const input =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : body;
    // Generate a W3C-compliant 32-char hex traceId that doubles as the OTel traceId.
    // This eliminates the dual-ID problem — one ID for Jaeger AND evidence/receipts.
    const traceId = resolveWorkflowTraceId(body.traceId || crypto.randomBytes(16).toString('hex'));
    const authSource = normalizeText(body.authSource || '').toLowerCase();
    const requestedOwner = runtimeLookup.requestedOwner || '';
    if (
      requestedOwner &&
      (
        !normalizeText(runtime?.owner || '') ||
        normalizeAddress(runtime.owner || '') !== requestedOwner ||
        !normalizeText(runtime?.aaWallet || '') ||
        !normalizeText(runtime?.sessionAddress || '') ||
        !normalizeText(runtime?.sessionId || '')
      )
    ) {
      return res.status(409).json({
        ok: false,
        error: authSource === 'connector-grant' ? 'connector_runtime_not_ready' : 'session_runtime_not_ready',
        reason: 'The owner-scoped session runtime is not ready for this MCP invocation.',
        traceId,
        ownerEoa: requestedOwner
      });
    }
    const payer = normalizeAddress(body.payer || runtime.aaWallet || '');
    const intentId = normalizeText(body.intentId || body.idempotencyKey || '');
    const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(body.targetAgentId || service.providerAgentId || KITE_AGENT2_ID).trim();
    const invocationId = createTraceId('svc_call');
    const now = new Date().toISOString();
    const serviceInvocations = readServiceInvocations().filter((item) => String(item?.serviceId || '').trim() === serviceId);
    const guard = evaluateServiceInvokeGuard(service, {
      payer,
      nowMs: Date.now(),
      invocations: serviceInvocations
    });
    if (!guard.ok) {
      return res.status(403).json({
        ok: false,
        error: guard.code || 'service_guard_blocked',
        reason: guard.reason || 'service guard blocked invoke',
        checks: guard.checks || []
      });
    }
    const authorityResult = validateConsumerAuthority?.({
      owner: requestedOwner || normalizeAddress(runtime?.owner || ''),
      aaWallet: normalizeAddress(body.aaWallet || runtime?.aaWallet || ''),
      sessionId: normalizeText(body.sessionId || runtime?.sessionId || ''),
      payer,
      provider: normalizeText(service?.providerAgentId || ''),
      capability: normalizeText(service?.id || service?.action || ''),
      recipient: String(service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
      amount: String(service.price || X402_BTC_PRICE || ''),
      intentId,
      actionKind: 'service_invoke',
      referenceId: serviceId,
      traceId
    });
    if (authorityResult && authorityResult.ok === false) {
      return res.status(Number(authorityResult.statusCode || 403)).json(buildAuthorityErrorResponse(authorityResult));
    }
    const authoritySnapshot =
      authorityResult?.authority && typeof authorityResult.authority === 'object'
        ? buildAuthoritySnapshot(authorityResult.authority)
        : null;
    const authorityPublic =
      authorityResult?.authorityPublic && typeof authorityResult.authorityPublic === 'object'
        ? buildAuthorityPublicSummary(authorityResult.authorityPublic)
        : authoritySnapshot
          ? buildAuthorityPublicSummary(authoritySnapshot)
          : null;
    const policySnapshotHash = normalizeText(
      authorityResult?.policySnapshotHash || (authoritySnapshot ? buildPolicySnapshotHash(authoritySnapshot) : '')
    );
    let intentStarted = false;
    const startIntent = (referenceId = '') => {
      if (!intentId || intentStarted) {
        return { ok: true, active: intentStarted };
      }
      const result = beginConsumerIntent?.({
        intentId,
        payer,
        provider: normalizeText(service?.providerAgentId || ''),
        capability: normalizeText(service?.id || service?.action || ''),
        recipient: String(service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
        amount: String(service.price || X402_BTC_PRICE || ''),
        actionKind: 'service_invoke',
        referenceId: normalizeText(referenceId || serviceId),
        traceId
      });
      if (result?.ok) intentStarted = Boolean(result.active);
      return result;
    };
  
    const invocation = {
      invocationId,
      serviceId,
      action: effectiveAction,
      traceId,
      intentId,
      requestId: '',
      state: 'running',
      payer,
      sourceAgentId,
      targetAgentId,
      amount: String(service.price || X402_BTC_PRICE || ''),
      tokenAddress: String(service.tokenAddress || SETTLEMENT_TOKEN || '').trim(),
      recipient: String(service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
      ownerEoa: normalizeText(body.ownerEoa || ''),
      aaWallet: normalizeText(body.aaWallet || ''),
      connectorGrantId: normalizeText(body.connectorGrantId || ''),
      consumerAgentId: normalizeText(body.connectorAgentId || ''),
      consumerIdentityRegistry: normalizeText(body.connectorIdentityRegistry || ''),
      authorityId: normalizeText(authoritySnapshot?.authorityId || ''),
      authority: authoritySnapshot,
      authorityPublic,
      policySnapshotHash,
      summary: '',
      error: '',
      txHash: '',
      userOpHash: '',
      createdAt: now,
      updatedAt: now
    };
    // ── PayTrace: create traced wrapper (moved inside try to prevent span leak) ──
    const _traced = traceServiceInvoke({
      traceId,
      payer,
      providerId: effectiveProvider,
      providerKind: isExternalFeedCapability ? 'external_feed' : 'internal',
      capabilityId,
    });
    const _metricLabels = { providerId: effectiveProvider, capabilityId };
    recordInvocation(_metricLabels);
    const _invokeStartMs = Date.now();
    // ─────────────────────────────────────────────────────────────

    let invocationPersisted = false;
    function persistInvocation(record = invocation) {
      upsertServiceInvocation(record);
      invocationPersisted = true;
      return record;
    }
    let evidenceWorkflow = null;
    let evidenceRequest = null;
    let externalResult = null;
    const markClientDisconnected = () => {
      if (invocationPersisted) {
        const aborted = {
          ...invocation,
          state: 'failed',
          error: 'client_disconnected',
          updatedAt: new Date().toISOString()
        };
        upsertServiceInvocation(aborted);
      }
      if (evidenceWorkflow && evidenceWorkflow.state === 'running') {
        evidenceWorkflow.state = 'failed';
        evidenceWorkflow.error = 'client_disconnected';
        evidenceWorkflow.updatedAt = new Date().toISOString();
        upsertWorkflow(evidenceWorkflow);
      }
    };
    req.on('aborted', markClientDisconnected);
    req.on('close', () => {
      if (req.aborted && !res.writableEnded) {
        markClientDisconnected();
      }
    });

    try {
      // ── PayTrace: discover span (inside try to ensure ensureEnded catches failures) ──
      _traced.discover({
        candidateCount: 1,
        selectedProvider: effectiveProvider,
        selectionMode: 'direct',
      });

      const internalApiKey = getInternalAgentApiKey();
      const headers = { 'Content-Type': 'application/json' };
      if (internalApiKey) headers['x-api-key'] = internalApiKey;
      const isTechnicalServiceAction = effectiveAction === 'risk-score-feed' || effectiveAction === 'technical-analysis-feed';
      const isInfoServiceAction = effectiveAction === 'info-analysis-feed';
      const agentManagedPayment =
        normalizeText(body.x402Mode || body.paymentMode || '').toLowerCase() === 'agent' ||
        Boolean(body?.paymentProof && body?.requestId);
      const suppliedRequestId = normalizeText(body.requestId || '');
      const suppliedPaymentProof =
        body?.paymentProof && typeof body.paymentProof === 'object' && !Array.isArray(body.paymentProof)
          ? body.paymentProof
          : null;
      if (isExternalFeedCapability) {
        const INVOKE_TOTAL_TIMEOUT_MS = Math.max(30_000, Number(process.env.INVOKE_TOTAL_TIMEOUT_MS || 90_000));
        const invokeAbortController = new AbortController();
        const invokeTimer = setTimeout(() => invokeAbortController.abort(), INVOKE_TOTAL_TIMEOUT_MS);
        const invokeSignal = invokeAbortController.signal;
        try {
        persistInvocation(invocation);
        evidenceRequest =
          (suppliedRequestId
            ? readX402Requests().find((item) => normalizeText(item?.requestId || '') === suppliedRequestId) || null
            : null) ||
          buildExternalFeedRequest({
            service,
            invocation,
            traceId,
            input
          });
        evidenceRequest = upsertX402RequestRecord({
          ...evidenceRequest,
          status: normalizeText(evidenceRequest?.status || '') === 'paid' ? 'paid' : 'pending',
          intentId,
          identity:
            invocation.consumerAgentId && invocation.consumerIdentityRegistry
              ? {
                  agentId: normalizeText(invocation.consumerAgentId),
                  registry: normalizeText(invocation.consumerIdentityRegistry)
                }
              : evidenceRequest?.identity || null,
          authority: authoritySnapshot,
          authorityPublic,
          policySnapshotHash,
          actionParams: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
          a2a: {
            sourceAgentId,
            targetAgentId,
            capability: capabilityId,
            taskType: effectiveAction,
            traceId
          }
        });
        evidenceWorkflow =
          readWorkflows().find((item) => normalizeText(item?.traceId || '') === traceId) ||
          buildExternalFeedWorkflow({
            service,
            invocation,
            traceId,
            input,
            request: evidenceRequest
          });
        evidenceWorkflow.authority = authoritySnapshot;
        evidenceWorkflow.authorityPublic = authorityPublic;
        evidenceWorkflow.policySnapshotHash = policySnapshotHash;
        evidenceWorkflow.intentId = intentId;
        // ── PayTrace: negotiate span ────────────────────────────
        _traced.negotiate({
          requestId: evidenceRequest?.requestId || '',
          amount: evidenceRequest?.amount || '',
          tokenAddress: evidenceRequest?.tokenAddress || invocation.tokenAddress || '',
          recipient: evidenceRequest?.recipient || invocation.recipient || '',
        });
        // ─────────────────────────────────────────────────────────
        if (!Array.isArray(evidenceWorkflow?.steps) || evidenceWorkflow.steps.length === 0) {
          appendServiceWorkflowStep(evidenceWorkflow, 'challenge_issued', 'ok', {
            requestId: evidenceRequest?.requestId || '',
            amount: evidenceRequest?.amount || '',
            recipient: evidenceRequest?.recipient || ''
          });
          evidenceWorkflow.updatedAt = new Date().toISOString();
          upsertWorkflow(evidenceWorkflow);
          if (typeof broadcastEvent === 'function') {
            broadcastEvent('challenge_issued', {
              traceId,
              requestId: evidenceRequest?.requestId || '',
              amount: evidenceRequest?.amount || '',
              recipient: evidenceRequest?.recipient || '',
              serviceId,
              capabilityId
            });
          }
        }

        const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
        const cachedPreview = evidenceRequest?.previewResult?.external || null;
        const cachedFetchedAt = cachedPreview?.fetchedAt ? new Date(cachedPreview.fetchedAt).getTime() : 0;
        externalResult = (cachedPreview && cachedFetchedAt > 0 && Date.now() - cachedFetchedAt < PREVIEW_CACHE_TTL_MS)
          ? cachedPreview
          : null;
        if (!externalResult) {
          const _fulfillSpan = _traced.fulfillStart();
          const _fulfillStart = Date.now();
          try {
          const signalOpts = { signal: invokeSignal };
          if (isFundamentalExternalCapability) {
            if (capabilityId === 'cap-listing-alert') externalResult = await fetchListingAlert(input, signalOpts);
            else if (capabilityId === 'cap-news-signal') externalResult = await fetchNewsSignal(input, signalOpts);
            else if (capabilityId === 'cap-meme-sentiment') externalResult = await fetchMemeSentiment(input, signalOpts);
            else if (capabilityId === 'cap-kol-monitor') externalResult = await fetchKolMonitor(input, signalOpts);
          } else if (isTechnicalExternalCapability) {
            if (capabilityId === 'cap-smart-money-signal') externalResult = await fetchSmartMoneySignal(input);
            else if (capabilityId === 'cap-trenches-scan') externalResult = await fetchTrenchesScan(input);
            else if (capabilityId === 'cap-token-analysis') externalResult = await fetchTokenAnalysis(input);
            else if (capabilityId === 'cap-wallet-pnl') externalResult = await fetchWalletPnl(input);
            else if (capabilityId === 'cap-dex-market') externalResult = await fetchDexMarket(input);
          } else if (isDataNodeExternalCapability) {
            if (capabilityId === 'cap-weather-context') externalResult = await fetchWeatherContext(input, signalOpts);
            else if (capabilityId === 'cap-tech-buzz-signal') externalResult = await fetchTechBuzzSignal(input, signalOpts);
            else if (capabilityId === 'cap-market-price-feed') externalResult = await fetchMarketPriceFeed(input, signalOpts);
          }
          // ── PayTrace: end fulfill span ──────────────────────────
          if (externalResult) {
            _traced.fulfillEnd(_fulfillSpan, {
              httpStatus: externalResult.ok ? 200 : 500,
              providerLatencyMs: Date.now() - _fulfillStart,
              resultState: externalResult.ok ? 'ok' : (externalResult.error || 'failed'),
              error: externalResult.ok ? undefined : (externalResult.error || 'external_feed_failed'),
            });
          } else {
            _traced.fulfillEnd(_fulfillSpan, {
              httpStatus: 0,
              providerLatencyMs: Date.now() - _fulfillStart,
              resultState: 'no_match',
              error: 'no_matching_capability',
            });
          }
          recordStageDuration(Date.now() - _fulfillStart, { stage: 'fulfill', providerId: effectiveProvider });
          // ─────────────────────────────────────────────────────────
          } catch (_fetchErr) {
            _traced.fulfillEnd(_fulfillSpan, {
              httpStatus: 500,
              providerLatencyMs: Date.now() - _fulfillStart,
              resultState: 'error',
              error: _fetchErr?.message || 'fetch_failed',
            });
            throw _fetchErr;
          }
        }
        if (externalResult) {
          if (!externalResult.ok) {
            throw new Error(normalizeText(externalResult.error || 'external_feed_failed') || 'external_feed_failed');
          }
          const externalItemCount = getExternalFeedItemCount(externalResult);
          if (externalItemCount === 0) {
            const noDataReason = 'no_data';
            evidenceRequest = upsertX402RequestRecord({
              ...evidenceRequest,
              status: 'failed',
              failure: {
                reason: noDataReason,
                at: new Date().toISOString()
              },
              result: {
                summary: buildExternalFeedSummary(service, externalResult)
              }
            });
            appendServiceWorkflowStep(evidenceWorkflow, 'failed', 'error', {
              reason: noDataReason
            });
            evidenceWorkflow.state = 'failed';
            evidenceWorkflow.error = noDataReason;
            evidenceWorkflow.result = {
              summary: buildExternalFeedSummary(service, externalResult),
              external: externalResult
            };
            evidenceWorkflow.updatedAt = new Date().toISOString();
            upsertWorkflow(evidenceWorkflow);
            if (typeof broadcastEvent === 'function') {
              broadcastEvent('failed', {
                traceId,
                state: 'failed',
                reason: noDataReason,
                serviceId,
                capabilityId
              });
            }
            const failed = {
              ...invocation,
              state: 'failed',
              requestId: normalizeText(evidenceRequest?.requestId || invocation?.requestId || ''),
              error: noDataReason,
              summary: buildExternalFeedSummary(service, externalResult),
              updatedAt: new Date().toISOString()
            };
            upsertServiceInvocation(failed);
            return res.status(422).json({
              ok: false,
              error: 'invoke_failed',
              reason: noDataReason,
              serviceId,
              invocationId,
              traceId,
              workflow: evidenceWorkflow,
              result: externalResult
            });
          }
          let txHash = '';
          let userOpHash = '';
          if (agentManagedPayment) {
            const storedPaymentProof =
              evidenceRequest?.paymentProof &&
              typeof evidenceRequest.paymentProof === 'object' &&
              !Array.isArray(evidenceRequest.paymentProof)
                ? evidenceRequest.paymentProof
                : null;
            evidenceRequest = upsertX402RequestRecord({
              ...evidenceRequest,
              previewResult: {
                external: externalResult,
                summary: buildExternalFeedSummary(service, externalResult)
              },
              authority: authoritySnapshot,
              authorityPublic,
              policySnapshotHash,
              actionParams: input && typeof input === 'object' && !Array.isArray(input) ? input : {}
            });
            if (
              !suppliedRequestId ||
              (!suppliedPaymentProof && normalizeText(evidenceRequest?.status || '') !== 'paid')
            ) {
              const pending = {
                ...invocation,
                requestId: normalizeText(evidenceRequest?.requestId || ''),
                state: 'payment_pending',
                summary: 'Waiting for agent-first x402 payment.',
                updatedAt: new Date().toISOString()
              };
              upsertServiceInvocation(pending);
              return res.status(402).json({
                ...buildExternalFeedPaymentRequiredResponse(evidenceRequest, 'x402 payment required'),
                traceId,
                serviceId,
                invocationId,
                result: externalResult || evidenceRequest?.previewResult?.external || null,
                receipt: {
                  result: {
                    summary: buildExternalFeedSummary(service, externalResult || evidenceRequest?.previewResult?.external)
                  }
                }
              });
            }
            const intentState = startIntent(evidenceRequest?.requestId || invocationId);
            if (intentState && intentState.ok === false) {
              return res.status(409).json(buildIntentConflictPayload(intentState));
            }
            if (normalizeText(evidenceRequest?.requestId || '') !== suppliedRequestId) {
              return res.status(409).json({
                ok: false,
                error: 'payment_request_mismatch',
                reason: 'Supplied requestId does not match the active x402 request for this invocation.',
                traceId,
                serviceId,
                invocationId,
                requestId: normalizeText(evidenceRequest?.requestId || '')
              });
            }
            if (normalizeText(evidenceRequest?.status || '') !== 'paid') {
              const effectivePaymentProof = suppliedPaymentProof || storedPaymentProof;
              const paymentValidationError = validatePaymentProof(evidenceRequest, effectivePaymentProof);
              if (paymentValidationError) {
                return res.status(402).json({
                  ...buildExternalFeedPaymentRequiredResponse(evidenceRequest, paymentValidationError),
                  traceId,
                  serviceId,
                  invocationId
                });
              }
              const verification = await verifyProofOnChain(evidenceRequest, effectivePaymentProof);
              if (!verification?.ok) {
                return res.status(402).json({
                  ...buildExternalFeedPaymentRequiredResponse(
                    evidenceRequest,
                    `on-chain proof verification failed: ${normalizeText(verification?.reason || 'unknown')}`
                  ),
                  traceId,
                  serviceId,
                  invocationId
                });
              }
              txHash = normalizeText(effectivePaymentProof?.txHash || '');
              userOpHash = normalizeText(body?.paymentUserOpHash || '');
              evidenceWorkflow.txHash = txHash;
              evidenceWorkflow.userOpHash = userOpHash;
              appendServiceWorkflowStep(evidenceWorkflow, 'payment_sent', 'ok', {
                txHash,
                userOpHash
              });
              evidenceWorkflow.updatedAt = new Date().toISOString();
              upsertWorkflow(evidenceWorkflow);
              if (typeof broadcastEvent === 'function') {
                broadcastEvent('payment_sent', {
                  traceId,
                  requestId: evidenceRequest?.requestId || '',
                  txHash,
                  userOpHash,
                  serviceId,
                  capabilityId
                });
              }
              evidenceRequest = upsertX402RequestRecord({
                ...evidenceRequest,
                status: 'paid',
                paidAt: Date.now(),
                intentId,
                authority: authoritySnapshot,
                authorityPublic,
                policySnapshotHash,
                paymentTxHash: txHash,
                paymentProof: {
                  requestId: effectivePaymentProof?.requestId,
                  txHash,
                  payer: effectivePaymentProof?.payer || payer,
                  tokenAddress: effectivePaymentProof?.tokenAddress,
                  recipient: effectivePaymentProof?.recipient,
                  amount: effectivePaymentProof?.amount
                },
                proofVerification: {
                  mode: 'on-chain',
                  verifiedAt: Date.now(),
                  details: verification?.details || {}
                },
                actionParams: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
                a2a: {
                  sourceAgentId,
                  targetAgentId,
                  capability: capabilityId,
                  taskType: effectiveAction,
                  traceId
                },
                result: {
                  summary: buildExternalFeedSummary(service, externalResult)
                }
              });
              appendValidationRecord({
                requestId: evidenceRequest?.requestId || '',
                txHash,
                userOpHash,
                tokenAddress: evidenceRequest?.tokenAddress || '',
                recipient: evidenceRequest?.recipient || '',
                amount: evidenceRequest?.amount || '',
                action: capabilityId || effectiveAction,
                payer
              });
            } else {
              txHash = normalizeText(evidenceRequest?.paymentTxHash || evidenceRequest?.paymentProof?.txHash || '');
              userOpHash = normalizeText(evidenceWorkflow?.userOpHash || '');
            }
          } else {
            const intentState = startIntent(evidenceRequest?.requestId || invocationId);
            if (intentState && intentState.ok === false) {
              return res.status(409).json(buildIntentConflictPayload(intentState));
            }
            const pay = await postSessionPayWithRetry(
              {
                tokenAddress: evidenceRequest?.tokenAddress || invocation.tokenAddress || '',
                recipient: evidenceRequest?.recipient || invocation.recipient || '',
                amount: evidenceRequest?.amount || invocation.amount || '',
                payer,
                owner: normalizeText(body.ownerEoa || ''),
                requestId: evidenceRequest?.requestId || '',
                action: capabilityId || effectiveAction,
                query: normalizeText(evidenceRequest?.query || `${service?.name || serviceId} ${effectiveAction}`)
              },
              { maxAttempts: 2, timeoutMs: 45_000, signal: invokeSignal, traceparent: spanToTraceparent(_traced.rootSpan) }
            );
            const payBody = pay?.body || {};
            txHash = normalizeText(payBody?.payment?.txHash || '');
            userOpHash = normalizeText(payBody?.payment?.userOpHash || '');
            if (!txHash) {
              throw new Error('session pay returned empty txHash.');
            }
            const paymentProof = {
              requestId: evidenceRequest?.requestId || '',
              txHash,
              payer,
              tokenAddress: evidenceRequest?.tokenAddress || '',
              recipient: evidenceRequest?.recipient || '',
              amount: evidenceRequest?.amount || ''
            };
            const paymentValidationError = validatePaymentProof(evidenceRequest, paymentProof);
            if (paymentValidationError) {
              throw new Error(paymentValidationError);
            }
            evidenceWorkflow.txHash = txHash;
            evidenceWorkflow.userOpHash = userOpHash;
            appendServiceWorkflowStep(evidenceWorkflow, 'payment_sent', 'ok', {
              txHash,
              userOpHash
            });
            evidenceWorkflow.updatedAt = new Date().toISOString();
            upsertWorkflow(evidenceWorkflow);
            if (typeof broadcastEvent === 'function') {
              broadcastEvent('payment_sent', {
                traceId,
                requestId: evidenceRequest?.requestId || '',
                txHash,
                userOpHash,
                serviceId,
                capabilityId
              });
            }

            const verification = await verifyProofOnChain(evidenceRequest, paymentProof);
            if (!verification?.ok) {
              throw new Error(`on-chain proof verification failed: ${normalizeText(verification?.reason || 'unknown')}`);
            }
            evidenceRequest = upsertX402RequestRecord({
              ...evidenceRequest,
              status: 'paid',
              paidAt: Date.now(),
              intentId,
              authority: authoritySnapshot,
              authorityPublic,
              policySnapshotHash,
              paymentTxHash: txHash,
              paymentProof,
              proofVerification: {
                mode: 'on-chain',
                verifiedAt: Date.now(),
                details: verification?.details || {}
              },
              actionParams: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
              a2a: {
                sourceAgentId,
                targetAgentId,
                capability: capabilityId,
                taskType: effectiveAction,
                traceId
              },
              result: {
                summary: buildExternalFeedSummary(service, externalResult)
              }
            });
            appendValidationRecord({
              requestId: evidenceRequest?.requestId || '',
              txHash,
              userOpHash,
              tokenAddress: evidenceRequest?.tokenAddress || '',
              recipient: evidenceRequest?.recipient || '',
              amount: evidenceRequest?.amount || '',
              action: capabilityId || effectiveAction,
              payer
            });
          }
          appendServiceWorkflowStep(evidenceWorkflow, 'proof_submitted', 'ok', {
            verified: true,
            mode: 'on-chain'
          });
          appendServiceWorkflowStep(evidenceWorkflow, 'unlocked', 'ok', {
            result: buildExternalFeedSummary(service, externalResult)
          });
          evidenceWorkflow.state = 'unlocked';
          evidenceWorkflow.result = {
            summary: buildExternalFeedSummary(service, externalResult),
            external: externalResult
          };
          evidenceWorkflow.updatedAt = new Date().toISOString();
          upsertWorkflow(evidenceWorkflow);
          if (typeof broadcastEvent === 'function') {
            broadcastEvent('proof_submitted', {
              traceId,
              requestId: evidenceRequest?.requestId || '',
              verified: true
            });
            broadcastEvent('unlocked', {
              traceId,
              requestId: evidenceRequest?.requestId || '',
              txHash,
              summary: buildExternalFeedSummary(service, externalResult)
            });
          }
          const next = {
            ...invocation,
            traceId,
            requestId: normalizeText(evidenceRequest?.requestId || ''),
            state: 'success',
            summary: buildExternalFeedSummary(service, externalResult),
            error: '',
            txHash,
            userOpHash,
            updatedAt: new Date().toISOString()
          };
          upsertServiceInvocation(next);
          const trustResultPayload =
            externalResult && typeof externalResult === 'object' ? externalResult : {};
          const responseHash =
            typeof buildResponseHash === 'function'
              ? normalizeText(buildResponseHash(next.requestId, capabilityId || effectiveAction, trustResultPayload)?.responseHash || '')
              : '';
          const trust = await appendInvokeTrustArtifacts({
            consumerSubject: resolveConsumerTrustSubject(body, next, evidenceRequest),
            service,
            sourceLane: 'buy',
            sourceKind: normalizeText(body.authSource || '') === 'connector-grant' ? 'x402-mcp' : 'x402-invoke',
            referenceId: next.requestId || next.invocationId,
            traceId: next.traceId,
            paymentRequestId: next.requestId,
            summary: normalizeText(next.summary || `${capabilityId || effectiveAction} settled by x402 payment.`),
            evaluator: normalizeText(sourceAgentId || payer || ''),
            responseHash
          });
          finalizeConsumerIntent?.(intentId, {
            status: 'completed',
            resultRef: normalizeText(next.invocationId),
            requestId: normalizeText(next.requestId),
            traceId: normalizeText(next.traceId)
          });

          // ── PayTrace: payment + receipt_bind + end ────────────
          _traced.payment({
            status: 'confirmed',
            txHash: txHash || '',
            userOpHash: userOpHash || '',
            protocol: 'x402',
            asset: invocation.tokenAddress || '',
          });
          _traced.receiptBind({
            receiptRef: `/api/receipts/${evidenceRequest?.requestId || ''}`,
            evidenceRef: `/api/evidence/export?traceId=${traceId}`,
            anchorStatus: trust?.publicationTxHash ? 'anchored' : 'pending',
          });
          _traced.end(true);
          recordSuccess(_metricLabels);
          recordStageDuration(Date.now() - _invokeStartMs, { stage: 'total', providerId: effectiveProvider });
          const _payAmount = Number(evidenceRequest?.amount || 0);
          if (_payAmount > 0) recordPaymentVolume(_payAmount, { asset: invocation.tokenAddress || '', ..._metricLabels });
          // ─────────────────────────────────────────────────────────

          return res.json({
            ok: true,
            traceId,
            requestId: evidenceRequest?.requestId || '',
            state: 'unlocked',
            txHash,
            userOpHash,
            workflow: evidenceWorkflow || null,
            receipt: {
              result: {
                summary: buildExternalFeedSummary(service, externalResult)
              }
            },
            result: externalResult,
            serviceId,
            invocationId,
            trust
          });
        }
      } finally { clearTimeout(invokeTimer); }
      }
      const agentManagedTaskPath = agentManagedPayment ? resolveAgentManagedTaskPath(effectiveAction) : '';
      if (agentManagedTaskPath) {
        persistInvocation(invocation);
        evidenceRequest =
          (suppliedRequestId
            ? readX402Requests().find((item) => normalizeText(item?.requestId || '') === suppliedRequestId) || null
            : null) || null;
        evidenceWorkflow =
          readWorkflows().find((item) => normalizeText(item?.traceId || '') === traceId) ||
          buildExternalFeedWorkflow({
            service,
            invocation,
            traceId,
            input,
            request: evidenceRequest || {}
          });
        evidenceWorkflow.authority = authoritySnapshot;
        evidenceWorkflow.authorityPublic = authorityPublic;
        evidenceWorkflow.policySnapshotHash = policySnapshotHash;
        evidenceWorkflow.intentId = intentId;

        const taskPayload = buildAgentManagedTaskPayload({
          action: effectiveAction,
          traceId,
          payer,
          sourceAgentId,
          targetAgentId,
          input,
          requestId: suppliedRequestId,
          paymentProof: suppliedPaymentProof
        });
        const { resp, payload } = await postInternalWorkflowWithRetry(agentManagedTaskPath, headers, taskPayload);
        const payloadRequestId = normalizeText(payload?.requestId || payload?.x402?.requestId || '');
        const storedRequest =
          (payloadRequestId
            ? readX402Requests().find((item) => normalizeText(item?.requestId || '') === payloadRequestId) || null
            : null) ||
          evidenceRequest;
        if (storedRequest) {
          evidenceRequest = upsertX402RequestRecord({
            ...storedRequest,
            intentId,
            identity:
              invocation.consumerAgentId && invocation.consumerIdentityRegistry
                ? {
                    agentId: normalizeText(invocation.consumerAgentId),
                    registry: normalizeText(invocation.consumerIdentityRegistry)
                  }
                : storedRequest?.identity || null,
            authority: authoritySnapshot,
            authorityPublic,
            policySnapshotHash,
            actionParams: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
            a2a: {
              sourceAgentId,
              targetAgentId,
              capability: capabilityId,
              taskType: effectiveAction,
              traceId
            }
          });
          evidenceWorkflow.requestId = normalizeText(evidenceRequest?.requestId || evidenceWorkflow.requestId || '');
        }

        if (resp.status === 402) {
          if (!workflowHasStep(evidenceWorkflow, 'challenge_issued')) {
            appendServiceWorkflowStep(evidenceWorkflow, 'challenge_issued', 'ok', {
              requestId: evidenceRequest?.requestId || payloadRequestId || '',
              amount: evidenceRequest?.amount || payload?.x402?.accepts?.[0]?.amount || '',
              recipient: evidenceRequest?.recipient || payload?.x402?.accepts?.[0]?.recipient || ''
            });
          }
          evidenceWorkflow.state = 'running';
          evidenceWorkflow.updatedAt = new Date().toISOString();
          upsertWorkflow(evidenceWorkflow);
          upsertServiceInvocation({
            ...invocation,
            requestId: normalizeText(evidenceRequest?.requestId || payloadRequestId || ''),
            state: 'payment_pending',
            summary: 'Waiting for agent-first x402 payment.',
            updatedAt: new Date().toISOString()
          });
          return res.status(402).json({
            ...payload,
            traceId,
            serviceId,
            invocationId,
            workflow: evidenceWorkflow
          });
        }

        if (resp.ok && payload?.ok !== false) {
          const txHash = normalizeText(
            payload?.payment?.txHash ||
            suppliedPaymentProof?.txHash ||
            evidenceRequest?.paymentTxHash ||
            evidenceRequest?.paymentProof?.txHash ||
            ''
          );
          const userOpHash = normalizeText(payload?.payment?.userOpHash || body?.paymentUserOpHash || '');
          if (txHash && !workflowHasStep(evidenceWorkflow, 'payment_sent')) {
            appendServiceWorkflowStep(evidenceWorkflow, 'payment_sent', 'ok', { txHash, userOpHash });
          }
          if (!workflowHasStep(evidenceWorkflow, 'proof_submitted')) {
            appendServiceWorkflowStep(evidenceWorkflow, 'proof_submitted', 'ok', { verified: true });
          }
          if (!workflowHasStep(evidenceWorkflow, 'unlocked')) {
            appendServiceWorkflowStep(evidenceWorkflow, 'unlocked', 'ok', {
              result: normalizeText(payload?.receipt?.result?.summary || payload?.result?.summary || '')
            });
          }
          evidenceWorkflow.state = 'unlocked';
          evidenceWorkflow.txHash = txHash;
          evidenceWorkflow.userOpHash = userOpHash;
          evidenceWorkflow.result =
            payload?.receipt?.result && typeof payload.receipt.result === 'object'
              ? payload.receipt.result
              : payload?.result && typeof payload.result === 'object'
                ? payload.result
                : null;
          evidenceWorkflow.updatedAt = new Date().toISOString();
          upsertWorkflow(evidenceWorkflow);

          const next = {
            ...invocation,
            traceId: normalizeText(payload?.traceId || traceId),
            requestId: normalizeText(payloadRequestId || evidenceRequest?.requestId || ''),
            state: 'success',
            summary: normalizeText(payload?.receipt?.result?.summary || payload?.result?.summary || ''),
            error: '',
            txHash,
            userOpHash,
            updatedAt: new Date().toISOString()
          };
          upsertServiceInvocation(next);

          const trustResultPayload =
            payload?.receipt?.result && typeof payload.receipt.result === 'object'
              ? payload.receipt.result
              : payload?.result && typeof payload.result === 'object'
                ? payload.result
                : {};
          const responseHash =
            typeof buildResponseHash === 'function'
              ? normalizeText(buildResponseHash(next.requestId, effectiveAction, trustResultPayload)?.responseHash || '')
              : '';
          const trust = await appendInvokeTrustArtifacts({
            consumerSubject: resolveConsumerTrustSubject(body, next, evidenceRequest),
            service,
            sourceLane: 'buy',
            sourceKind: normalizeText(body.authSource || '') === 'connector-grant' ? 'x402-mcp' : 'x402-invoke',
            referenceId: next.requestId || next.invocationId,
            traceId: next.traceId,
            paymentRequestId: next.requestId,
            summary: normalizeText(next.summary || `${effectiveAction} settled by x402 payment.`),
            evaluator: normalizeText(sourceAgentId || payer || ''),
            responseHash
          });
          finalizeConsumerIntent?.(intentId, {
            status: 'completed',
            resultRef: normalizeText(next.invocationId),
            requestId: normalizeText(next.requestId),
            traceId: normalizeText(next.traceId),
            failureReason: ''
          });
          _traced.end(true);
          recordSuccess(_metricLabels);
          recordStageDuration(Date.now() - _invokeStartMs, { stage: 'total', providerId: effectiveProvider });
          return res.status(resp.status).json({
            ...payload,
            traceId: next.traceId,
            serviceId,
            invocationId,
            workflow: evidenceWorkflow,
            trust
          });
        }
      }
      const invokePayload =
        isTechnicalServiceAction
          ? {
              traceId,
              sourceAgentId,
              targetAgentId,
              symbol: body.symbol || body.pair || service.pair || 'BTCUSDT',
              horizonMin: Number(body.horizonMin ?? service.horizonMin ?? 60),
              source: body.source || service.source || 'hyperliquid',
              action: effectiveAction,
              payer
            }
          : isInfoServiceAction
            ? {
                traceId,
                sourceAgentId,
                targetAgentId,
                url: service.resourceUrl || service.exampleInput?.url || body.url || '',
                topic: body.topic || service.exampleInput?.topic || '',
                mode: body.mode || body.source || service.source || service.mode || 'auto',
                maxChars: Number(body.maxChars ?? service.maxChars ?? service.exampleInput?.maxChars ?? X_READER_MAX_CHARS_DEFAULT),
                action: effectiveAction,
                payer
              }
          : effectiveAction === 'hyperliquid-order-testnet'
            ? {
                traceId,
                sourceAgentId,
                targetAgentId,
                symbol: body.symbol || body.pair || service.pair || service.exampleInput?.symbol || 'BTCUSDT',
                side: body.side || service.exampleInput?.side || 'buy',
                orderType: body.orderType || body.type || service.exampleInput?.orderType || 'limit',
                price: body.price ?? service.exampleInput?.price ?? '',
                size: body.size ?? body.sz ?? service.exampleInput?.size ?? '',
                tif: body.tif || service.exampleInput?.tif || 'Gtc',
                reduceOnly:
                  body.reduceOnly === true || String(body.reduceOnly || '').trim().toLowerCase() === 'true',
                slippageBps: body.slippageBps ?? body.marketSlippageBps,
                payer,
                bindRealX402: body.bindRealX402 !== false,
                strictBinding: body.strictBinding !== false,
                simulate: body.simulate === true || body.dryRun === true
              }
          : {
              traceId,
              sourceAgentId,
              targetAgentId,
              pair: body.pair || body.symbol || service.pair || 'BTCUSDT',
              source: body.source || service.source || 'hyperliquid',
              payer
            };
      const workflowPath =
        isTechnicalServiceAction
          ? '/api/workflow/risk-score/run'
          : isInfoServiceAction
            ? '/api/workflow/info/run'
            : effectiveAction === 'hyperliquid-order-testnet'
              ? '/api/workflow/hyperliquid-order/run'
              : '/api/workflow/btc-price/run';
  
      const intentState = startIntent(invocationId);
      if (intentState && intentState.ok === false) {
        return res.status(409).json(buildIntentConflictPayload(intentState));
      }
      persistInvocation(invocation);
      if (process.env.SVC_DEBUG === 'true') {
        console.log('[svc-invoke] routing to workflow', {
          serviceId, action: effectiveAction, workflowPath,
          isExternalFeedCapability, isTechnicalServiceAction, isInfoServiceAction,
          invocationId, traceId
        });
      }
      const { resp, payload } = await postInternalWorkflowWithRetry(workflowPath, headers, invokePayload);
      if (process.env.SVC_DEBUG === 'true') {
        console.log('[svc-invoke] workflow response', {
          status: resp?.status,
          ok: payload?.ok,
          error: payload?.error,
          reason: payload?.reason,
          state: payload?.state,
          requestId: payload?.requestId || payload?.paymentRequestId || '',
          traceId: payload?.traceId || ''
        });
      }
      const workflow = payload?.workflow || null;
      if (workflow && typeof workflow === 'object') {
        workflow.authority = authoritySnapshot;
        workflow.authorityPublic = authorityPublic;
        workflow.policySnapshotHash = policySnapshotHash;
        workflow.intentId = intentId;
        upsertWorkflow(workflow);
      }
      const next = {
        ...invocation,
        traceId: String(payload?.traceId || traceId).trim(),
        requestId: String(payload?.requestId || workflow?.requestId || '').trim(),
        state: String(payload?.state || workflow?.state || (resp.ok ? 'success' : 'failed')).trim().toLowerCase(),
        summary: String(workflow?.result?.summary || payload?.receipt?.result?.summary || '').trim(),
        error: String(payload?.reason || payload?.error || '').trim(),
        txHash: String(payload?.txHash || workflow?.txHash || '').trim(),
        userOpHash: String(payload?.userOpHash || workflow?.userOpHash || '').trim(),
        updatedAt: new Date().toISOString()
      };
      upsertServiceInvocation(next);
      let trust = null;
      if (resp.ok && payload?.ok !== false && ['success', 'completed'].includes(next.state)) {
        const trustResultPayload =
          workflow?.result && typeof workflow.result === 'object'
            ? workflow.result
            : payload?.receipt?.result && typeof payload.receipt.result === 'object'
              ? payload.receipt.result
              : payload?.result && typeof payload.result === 'object'
                ? payload.result
                : {};
        const responseHash =
          typeof buildResponseHash === 'function'
            ? normalizeText(buildResponseHash(next.requestId, effectiveAction, trustResultPayload)?.responseHash || '')
            : '';
        trust = await appendInvokeTrustArtifacts({
          consumerSubject: resolveConsumerTrustSubject(body, next, evidenceRequest),
          service,
          sourceLane: 'buy',
          sourceKind: normalizeText(body.authSource || '') === 'connector-grant' ? 'x402-mcp' : 'x402-invoke',
          referenceId: next.requestId || next.invocationId,
          traceId: next.traceId,
          paymentRequestId: next.requestId,
          summary: normalizeText(next.summary || `${effectiveAction} settled by x402 payment.`),
          evaluator: normalizeText(sourceAgentId || payer || ''),
          responseHash
        });
      }
      finalizeConsumerIntent?.(intentId, {
        status: resp.ok && payload?.ok !== false ? 'completed' : 'failed',
        resultRef: normalizeText(next.invocationId),
        requestId: normalizeText(next.requestId),
        traceId: normalizeText(next.traceId),
        failureReason: normalizeText(next.error)
      });
  
      const _internalOk = resp.ok && payload?.ok !== false;
      _traced.end(_internalOk);
      recordStageDuration(Date.now() - _invokeStartMs, { stage: 'total', providerId: effectiveProvider });
      if (_internalOk) recordSuccess(_metricLabels);
      else recordFailure({ ..._metricLabels, errorType: 'internal_workflow_failed' });
      return res.status(resp.status).json({
        ...payload,
        serviceId,
        invocationId,
        trust
      });
    } catch (error) {
      const isInvokeAbort = error?.name === 'AbortError';
      const rawMessage = String(error?.message || 'service invoke failed').trim();
      const failureReason = isInvokeAbort ? 'invoke_timeout' : rawMessage;
      if (evidenceRequest) {
        evidenceRequest = upsertX402RequestRecord({
          ...evidenceRequest,
          status: 'failed',
          paymentTxHash: normalizeText(evidenceWorkflow?.txHash || evidenceRequest?.paymentTxHash || ''),
          paymentProof: evidenceRequest?.paymentProof || null,
          proofVerification: evidenceRequest?.proofVerification || null,
          failure: {
            reason: failureReason,
            at: new Date().toISOString()
          }
        });
      }
      if (!evidenceWorkflow) {
        evidenceWorkflow = buildFailedServiceWorkflow({
          service,
          invocation,
          traceId,
          input,
          reason: failureReason
        });
      } else {
        appendServiceWorkflowStep(evidenceWorkflow, 'failed', 'error', { reason: failureReason });
        evidenceWorkflow.state = 'failed';
        evidenceWorkflow.error = failureReason;
        if (externalResult) {
          evidenceWorkflow.result = {
            summary: buildExternalFeedSummary(service, externalResult),
            external: externalResult
          };
        }
        evidenceWorkflow.updatedAt = new Date().toISOString();
      }
      upsertWorkflow(evidenceWorkflow);
      if (typeof broadcastEvent === 'function') {
        broadcastEvent('failed', {
          traceId,
          state: 'failed',
          reason: failureReason,
          serviceId,
          capabilityId
        });
      }
      const failed = {
        ...invocation,
        state: 'failed',
        requestId: normalizeText(evidenceRequest?.requestId || invocation?.requestId || ''),
        error: failureReason,
        txHash: normalizeText(evidenceWorkflow?.txHash || invocation?.txHash || ''),
        userOpHash: normalizeText(evidenceWorkflow?.userOpHash || invocation?.userOpHash || ''),
        updatedAt: new Date().toISOString()
      };
      if (invocationPersisted) upsertServiceInvocation(failed);
      if (intentStarted) {
        finalizeConsumerIntent?.(intentId, {
          status: 'failed',
          resultRef: normalizeText(failed.invocationId),
          requestId: normalizeText(failed.requestId),
          traceId: normalizeText(failed.traceId),
          failureReason
        });
      }
      // ── PayTrace: trace failure ───────────────────────────────
      _traced.fail(failureReason, `invoke failed: ${failureReason}`);
      // Normalize errorType to classified layer to prevent high-cardinality labels
      const _errorType = failureReason === 'invoke_timeout' ? 'invoke_timeout'
        : (failureReason.length <= 40 ? failureReason : 'unknown_error');
      recordFailure({ ..._metricLabels, errorType: _errorType });
      // ─────────────────────────────────────────────────────────

      return res.status(500).json({
        ok: false,
        error: 'invoke_failed',
        reason: failed.error,
        serviceId,
        invocationId,
        traceId,
        workflow: evidenceWorkflow
      });
    } finally {
      // ── PayTrace: safety net — end root span if not already ended ──
      _traced.ensureEnded();
      // ──────────────────────────────────────────────────────────────
    }
  });
  
  app.get('/api/services/:serviceId/status', requireRole('viewer'), (req, res) => {
    const serviceId = String(req.params.serviceId || '').trim();
    if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
    const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
    if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
  
    const workflows = readWorkflows();
    const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
    const requests = readX402Requests();
    const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
    const invocations = readServiceInvocations().filter((item) => String(item?.serviceId || '').trim() === serviceId);
    const receipts = invocations.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
    const status = buildServiceStatus(service, invocations, receipts);
    const reputation = computeServiceReputation(service, receipts);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      service,
      status,
      reputation
    });
  });
  
  app.get('/api/reputation/agents', requireRole('viewer'), (req, res) => {
    const services = ensureServiceCatalog();
    const workflows = readWorkflows();
    const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
    const requests = readX402Requests();
    const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
    const invocations = readServiceInvocations();
  
    const rows = services.map((service) => {
      const perServiceInv = invocations.filter((item) => String(item?.serviceId || '').trim() === String(service.id || '').trim());
      const receipts = perServiceInv.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
      const reputation = computeServiceReputation(service, receipts);
      return {
        agentId: String(service.providerAgentId || '').trim() || 'unknown',
        serviceId: String(service.id || '').trim(),
        action: String(service.action || '').trim(),
        reputation
      };
    });
  
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });
  
  app.post('/api/services/:serviceId/revoke', requireRole('admin'), (req, res) => {
    const serviceId = String(req.params.serviceId || '').trim();
    if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
    const rows = ensureServiceCatalog();
    const idx = rows.findIndex((item) => String(item?.id || '').trim() === serviceId);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
    rows[idx] = {
      ...rows[idx],
      active: false,
      updatedAt: new Date().toISOString()
    };
    writePublishedServices(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      service: rows[idx]
    });
  });
  
  app.post('/api/services/:serviceId/unrevoke', requireRole('admin'), (req, res) => {
    const serviceId = String(req.params.serviceId || '').trim();
    if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
    const rows = ensureServiceCatalog();
    const idx = rows.findIndex((item) => String(item?.id || '').trim() === serviceId);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
    rows[idx] = {
      ...rows[idx],
      active: true,
      updatedAt: new Date().toISOString()
    };
    writePublishedServices(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      service: rows[idx]
    });
  });
  
  app.get('/api/services/:serviceId/receipts', requireRole('viewer'), (req, res) => {
    const serviceId = String(req.params.serviceId || '').trim();
    if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
    const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
    if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
  
    const limit = Math.max(1, Math.min(Number(req.query.limit || 40), 200));
    const workflows = readWorkflows();
    const workflowByTraceId = new Map(
      workflows.map((item) => [String(item?.traceId || '').trim(), item])
    );
    const requests = readX402Requests();
    const requestById = new Map(
      requests.map((item) => [String(item?.requestId || '').trim(), item])
    );
  
    const rows = readServiceInvocations()
      .filter((item) => String(item?.serviceId || '').trim() === serviceId)
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
  
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      service,
      total: rows.length,
      items: rows
    });
  });

  app.get('/api/service-invocations', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));
    const traceId = String(req.query.traceId || '').trim();
    const requestId = String(req.query.requestId || '').trim();
    const serviceId = String(req.query.serviceId || '').trim();
    const provider = String(req.query.provider || '').trim().toLowerCase();
    const capability = String(req.query.capability || '').trim().toLowerCase();
    const state = String(req.query.state || '').trim().toLowerCase();

    const services = ensureServiceCatalog();
    const serviceById = new Map(services.map((item) => [String(item?.id || '').trim(), item]));
    const workflows = readWorkflows();
    const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
    const requests = readX402Requests();
    const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));

    const items = readServiceInvocations()
      .filter((item) => {
        const rowServiceId = String(item?.serviceId || '').trim();
        const rowTraceId = String(item?.traceId || '').trim();
        const rowRequestId = String(item?.requestId || '').trim();
        const service = serviceById.get(rowServiceId) || null;
        const rowProvider = String(service?.providerAgentId || '').trim().toLowerCase();
        const rowCapability = String(service?.action || item?.action || '').trim().toLowerCase();
        const rowState = String(item?.state || '').trim().toLowerCase();
        if (serviceId && rowServiceId !== serviceId) return false;
        if (traceId && rowTraceId !== traceId) return false;
        if (requestId && rowRequestId !== requestId) return false;
        if (provider && rowProvider !== provider) return false;
        if (capability && rowCapability !== capability) return false;
        if (state && rowState !== state) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => {
        const rowServiceId = String(item?.serviceId || '').trim();
        const service = serviceById.get(rowServiceId) || null;
        const receipt = mapServiceReceipt(item, workflowByTraceId, requestById);
        return {
          invocationId: String(item?.invocationId || '').trim(),
          serviceId: rowServiceId,
          serviceName: String(service?.name || '').trim(),
          providerAgentId: String(service?.providerAgentId || '').trim(),
          capability: String(service?.action || item?.action || '').trim().toLowerCase(),
          traceId: String(item?.traceId || '').trim(),
          intentId: String(item?.intentId || '').trim(),
          requestId: String(item?.requestId || '').trim(),
          state: String(item?.state || '').trim().toLowerCase(),
          sourceAgentId: String(item?.sourceAgentId || '').trim(),
          targetAgentId: String(item?.targetAgentId || '').trim(),
          payer: String(item?.payer || '').trim(),
          amount: String(item?.amount || '').trim(),
          tokenAddress: String(item?.tokenAddress || '').trim(),
          recipient: String(item?.recipient || '').trim(),
          authorityId: String(item?.authorityId || '').trim(),
          policySnapshotHash: String(item?.policySnapshotHash || '').trim(),
          authority:
            item?.authorityPublic && typeof item.authorityPublic === 'object' ? item.authorityPublic : null,
          summary: String(item?.summary || '').trim(),
          error: String(item?.error || '').trim(),
          txHash: String(item?.txHash || '').trim(),
          userOpHash: String(item?.userOpHash || '').trim(),
          createdAt: String(item?.createdAt || '').trim(),
          updatedAt: String(item?.updatedAt || '').trim(),
          receipt
        };
      });

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: items.length,
      items
    });
  });
  
}
