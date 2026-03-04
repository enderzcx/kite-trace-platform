export function registerMarketAgentServiceRoutes(app, deps) {
  const {
    ANALYSIS_PROVIDER,
    buildServiceStatus,
    computeServiceReputation,
    createTraceId,
    ensureServiceCatalog,
    evaluateServiceInvokeGuard,
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
    readServiceInvocations,
    readSessionRuntime,
    readWorkflows,
    readX402Requests,
    requireRole,
    resolveAnalysisErrorStatus,
    resolveWorkflowTraceId,
    runAgent001HyperliquidOrderWorkflow,
    runRiskScoreAnalysis,
    sanitizeServiceRecord,
    SETTLEMENT_TOKEN,
    startXmtpRuntimes,
    upsertAgent001ResultRecord,
    upsertServiceInvocation,
    workflowPath,
    writePublishedServices,
    X_READER_MAX_CHARS_DEFAULT,
    X402_BTC_PRICE,
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

  async function fetchBinanceKlines(symbol = 'BTCUSDT', interval = '1m', limit = 200) {
    const coin = normalizePerpCoin(symbol);
    const pair = `${coin}USDT`;
    const safeLimit = Math.max(20, Math.min(Number(limit || 200), 1000));
    const resp = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' }
      }
    );
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
    if (body.autoStart !== false) {
      await startXmtpRuntimes();
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
    const supportedServiceActions = [
      'btc-price-feed',
      'risk-score-feed',
      'technical-analysis-feed',
      'x-reader-feed',
      'info-analysis-feed',
      'hyperliquid-order-testnet'
    ];
    if (!supportedServiceActions.includes(action)) {
      return res.status(400).json({
        ok: false,
        error: 'unsupported_service_action',
        reason: 'Supported action: btc-price-feed, risk-score-feed, technical-analysis-feed, x-reader-feed, info-analysis-feed, hyperliquid-order-testnet.'
      });
    }
  
    const runtime = readSessionRuntime();
    const body = req.body || {};
    const traceId = resolveWorkflowTraceId(body.traceId || createTraceId('service'));
    const payer = normalizeAddress(body.payer || runtime.aaWallet || '');
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
  
    const invocation = {
      invocationId,
      serviceId,
      action: effectiveAction,
      traceId,
      requestId: '',
      state: 'running',
      payer,
      sourceAgentId,
      targetAgentId,
      amount: String(service.price || X402_BTC_PRICE || ''),
      tokenAddress: String(service.tokenAddress || SETTLEMENT_TOKEN || '').trim(),
      recipient: String(service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
      summary: '',
      error: '',
      txHash: '',
      userOpHash: '',
      createdAt: now,
      updatedAt: now
    };
    upsertServiceInvocation(invocation);
  
    try {
      const internalApiKey = getInternalAgentApiKey();
      const headers = { 'Content-Type': 'application/json' };
      if (internalApiKey) headers['x-api-key'] = internalApiKey;
      const isTechnicalServiceAction = effectiveAction === 'risk-score-feed' || effectiveAction === 'technical-analysis-feed';
      const isInfoServiceAction = effectiveAction === 'info-analysis-feed';
      const invokePayload =
        isTechnicalServiceAction
          ? {
              traceId,
              sourceAgentId,
              targetAgentId,
              symbol: service.pair || 'BTCUSDT',
              horizonMin: Number(service.horizonMin || 60),
              source: service.source || 'hyperliquid',
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
                mode: service.source || service.mode || 'auto',
                maxChars: Number(service.maxChars || service.exampleInput?.maxChars || X_READER_MAX_CHARS_DEFAULT),
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
              pair: service.pair || 'BTCUSDT',
              source: service.source || 'hyperliquid',
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
  
      const resp = await fetch(`http://127.0.0.1:${PORT}${workflowPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(invokePayload)
      });
      const payload = await resp.json().catch(() => ({}));
      const workflow = payload?.workflow || null;
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
  
      return res.status(resp.status).json({
        ...payload,
        serviceId,
        invocationId
      });
    } catch (error) {
      const failed = {
        ...invocation,
        state: 'failed',
        error: String(error?.message || 'service invoke failed').trim(),
        updatedAt: new Date().toISOString()
      };
      upsertServiceInvocation(failed);
      return res.status(500).json({
        ok: false,
        error: 'invoke_failed',
        reason: failed.error,
        serviceId,
        invocationId,
        traceId
      });
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
  
}
