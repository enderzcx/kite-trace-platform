export function createServiceNetworkHelpers(deps = {}) {
  const {
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    ethers,
    HYPERLIQUID_ORDER_RECIPIENT,
    KITE_AGENT2_AA_ADDRESS,
    KITE_AGENT2_ID,
    MERCHANT_ADDRESS,
    SETTLEMENT_TOKEN,
    X402_BTC_PRICE,
    X402_HYPERLIQUID_ORDER_PRICE,
    X402_INFO_PRICE,
    X402_RISK_SCORE_PRICE,
    X402_TECHNICAL_PRICE,
    X402_UNIFIED_SERVICE_PRICE,
    X_READER_MAX_CHARS_DEFAULT,
    XMTP_EXECUTOR_AGENT_AA_ADDRESS,
    XMTP_EXECUTOR_RESOLVED_ADDRESS,
    XMTP_PRICE_AGENT_AA_ADDRESS,
    XMTP_PRICE_RESOLVED_ADDRESS,
    XMTP_READER_AGENT_AA_ADDRESS,
    XMTP_READER_RESOLVED_ADDRESS,
    XMTP_ROUTER_AGENT_AA_ADDRESS,
    XMTP_ROUTER_RESOLVED_ADDRESS,
    XMTP_RISK_AGENT_AA_ADDRESS,
    XMTP_RISK_RESOLVED_ADDRESS,
    getUtcDateKey,
    isInfoAnalysisAction,
    isTechnicalAnalysisAction,
    normalizeAddress,
    normalizeAddresses,
    normalizeBtcPriceParams,
    normalizeRiskScoreParams,
    normalizeXReaderParams,
    parseAgentIdList,
    readNetworkAgents,
    readPublishedServices,
    resolveInfoSettlementRecipient,
    resolveTechnicalSettlementRecipient,
    writeNetworkAgents,
    writePublishedServices
  } = deps;

  function resolveAnalysisErrorStatus(error = null, fallback = 500) {
    const code = String(error?.code || '').trim().toLowerCase();
    if (code.startsWith('service_unavailable') || code.startsWith('provider_unavailable')) return 502;
    if (code.startsWith('provider_timeout')) return 504;
    if (code.startsWith('provider_auth_failed')) return 401;
    if (code.startsWith('provider_rate_limited')) return 429;
    if (code.startsWith('invalid_')) return 400;
    const message = String(error?.message || '').trim().toLowerCase();
    if (message.includes('invalid_') || message.includes('invalid ')) return 400;
    return Number.isFinite(Number(fallback)) ? Number(fallback) : 500;
  }

  function normalizeServiceAction(actionRaw = '') {
    const normalized = String(actionRaw || 'btc-price-feed').trim().toLowerCase();
    const action = normalized === 'x-reader-feed' ? 'info-analysis-feed' : normalized;
    if (
      ![
        'btc-price-feed',
        'risk-score-feed',
        'technical-analysis-feed',
        'info-analysis-feed',
        'hyperliquid-order-testnet',
        'weather-context',
        'tech-buzz-signal',
        'market-price-feed'
      ].includes(action)
    ) {
      throw new Error(
        'Supported service actions: btc-price-feed, risk-score-feed, technical-analysis-feed, info-analysis-feed, hyperliquid-order-testnet, weather-context, tech-buzz-signal, market-price-feed.'
      );
    }
    return action;
  }

  function normalizeStringList(input, { lower = false, dedup = true } = {}) {
    const values = Array.isArray(input)
      ? input
      : String(input || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
    const normalized = values
      .map((value) => (lower ? String(value || '').trim().toLowerCase() : String(value || '').trim()))
      .filter(Boolean);
    if (!dedup) return normalized;
    return normalized.filter((value, index, arr) => arr.indexOf(value) === index);
  }

  function sanitizeServiceRecord(input = {}, existing = null) {
    const now = new Date().toISOString();
    const action = normalizeServiceAction(input.action || existing?.action || 'btc-price-feed');
    const isTechnical = isTechnicalAnalysisAction(action);
    const isInfo = isInfoAnalysisAction(action);
    const isHyperliquidOrder = action === 'hyperliquid-order-testnet';
    const isDataNode = ['weather-context', 'tech-buzz-signal', 'market-price-feed'].includes(action);
    const normalizedTask =
      isTechnical
        ? normalizeRiskScoreParams({
            symbol: input.pair || input.symbol || existing?.pair || 'BTCUSDT',
            source: input.source || existing?.source || 'hyperliquid',
            horizonMin: input.horizonMin ?? existing?.horizonMin ?? 60
          })
        : isInfo
          ? normalizeXReaderParams({
              url:
                input.resourceUrl ||
                input.url ||
                existing?.resourceUrl ||
                existing?.url ||
                existing?.exampleInput?.url ||
                '',
              mode: input.mode || input.source || existing?.mode || existing?.source || 'auto',
              maxChars: input.maxChars ?? existing?.maxChars ?? existing?.exampleInput?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
            })
        : isHyperliquidOrder
          ? {
              pair: String(input.pair || input.symbol || existing?.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
              source: 'hyperliquid-testnet',
              sourceRequested: 'hyperliquid-testnet',
              orderType: String(input.orderType || existing?.orderType || 'limit').trim().toLowerCase() || 'limit',
              tif: String(input.tif || existing?.tif || 'Gtc').trim() || 'Gtc'
            }
          : isDataNode
            ? {
                pair: String(input.pair || input.symbol || existing?.pair || '').trim().toUpperCase(),
                source:
                  String(
                    input.source ||
                      existing?.source ||
                      (action === 'weather-context'
                        ? 'open-meteo'
                        : action === 'tech-buzz-signal'
                          ? 'hackernews'
                          : 'coingecko')
                  )
                    .trim()
                    .toLowerCase() || 'auto',
                sourceRequested:
                  String(
                    input.sourceRequested ||
                      existing?.sourceRequested ||
                      (action === 'weather-context'
                        ? 'open-meteo'
                        : action === 'tech-buzz-signal'
                          ? 'hackernews'
                          : 'coingecko')
                  )
                    .trim()
                    .toLowerCase() || 'auto'
              }
          : normalizeBtcPriceParams({
              pair: input.pair || existing?.pair || 'BTCUSDT',
              source: input.source || existing?.source || 'hyperliquid'
            });
    const fallbackRecipient = isTechnical
      ? resolveTechnicalSettlementRecipient()
      : isInfo
        ? resolveInfoSettlementRecipient()
        : isHyperliquidOrder
          ? normalizeAddress(HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS)
          : isDataNode
            ? normalizeAddress(KITE_AGENT2_AA_ADDRESS)
          : normalizeAddress(KITE_AGENT2_AA_ADDRESS);
    const recipient = normalizeAddress(input.recipient || existing?.recipient || fallbackRecipient);
    if (!recipient || !ethers.isAddress(recipient)) {
      throw new Error('service recipient must be a valid address');
    }
    const tokenAddress = normalizeAddress(input.tokenAddress || existing?.tokenAddress || SETTLEMENT_TOKEN);
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      throw new Error('service tokenAddress must be a valid address');
    }
    const priceRaw = Number(input.price ?? existing?.price ?? X402_BTC_PRICE ?? '0.00001');
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
      throw new Error('service price must be a valid positive number');
    }
    const name =
      String(input.name || existing?.name || '').trim() ||
      (isInfo
        ? action === 'info-analysis-feed'
          ? 'Message Info Analysis Service'
          : 'X Reader Digest Service'
        : isTechnical
          ? action === 'technical-analysis-feed'
            ? 'Technical Analysis Service'
            : 'BTC Risk Score Service'
        : isHyperliquidOrder
          ? 'Hyperliquid Testnet Order Service'
          : isDataNode
            ? action === 'weather-context'
              ? 'Weather Context Data Node'
              : action === 'tech-buzz-signal'
                ? 'Tech Buzz Signal Data Node'
                : 'Market Price Feed Data Node'
          : 'BTCUSD Quote Service');
    const description =
      String(input.description || existing?.description || '').trim() ||
      (isInfo
        ? action === 'info-analysis-feed'
          ? 'Pay-per-call message-side info analysis via market-data + x402.'
          : 'Pay-per-call URL digest powered by x-reader + x402.'
        : isTechnical
          ? action === 'technical-analysis-feed'
            ? 'Pay-per-call technical analysis via risk agent + x402.'
            : 'Pay-per-call risk score analysis via x402.'
        : isHyperliquidOrder
          ? 'Pay-per-call Hyperliquid testnet order execution via x402.'
          : isDataNode
            ? action === 'weather-context'
              ? 'Low-cost weather context primitive via Open-Meteo + x402.'
              : action === 'tech-buzz-signal'
                ? 'Low-cost Hacker News top-story primitive via x402.'
                : 'Low-cost CoinGecko market price primitive via x402.'
          : 'Pay-per-call BTCUSD quote service.');
    const providerAgentId = String(
      input.providerAgentId || existing?.providerAgentId || (isDataNode ? 'data-node-real' : KITE_AGENT2_ID)
    ).trim();
    const providerKey = String(input.providerKey || existing?.providerKey || (isDataNode ? 'data-node-real' : '')).trim();
    const tags = normalizeStringList(
      input.tags ||
        existing?.tags ||
        (isInfo
          ? action === 'info-analysis-feed'
            ? ['a2a', 'x402', 'message', 'info-analysis']
            : ['atapi', 'x402', 'x-reader']
          : isTechnical
            ? action === 'technical-analysis-feed'
              ? ['a2a', 'x402', 'technical-analysis']
              : ['a2a', 'x402', 'risk']
          : isHyperliquidOrder
            ? ['atapi', 'x402', 'hyperliquid', 'order']
            : isDataNode
              ? action === 'weather-context'
                ? ['atapi', 'x402', 'data-primitive', 'weather', 'open-meteo']
                : action === 'tech-buzz-signal'
                  ? ['atapi', 'x402', 'data-primitive', 'news', 'hackernews']
                  : ['atapi', 'x402', 'data-primitive', 'market', 'coingecko']
            : ['atapi', 'x402', action]),
      { lower: true, dedup: true }
    );
    const allowlistPayers = normalizeAddresses(input.allowlistPayers || existing?.allowlistPayers || []);
    const slaMsRaw = Number(input.slaMs ?? existing?.slaMs ?? 12000);
    const rateLimitPerMinuteRaw = Number(input.rateLimitPerMinute ?? existing?.rateLimitPerMinute ?? 12);
    const budgetPerDayRaw = Number(input.budgetPerDay ?? existing?.budgetPerDay ?? 0);
    const exampleInput =
      input.exampleInput && typeof input.exampleInput === 'object'
        ? input.exampleInput
          : existing?.exampleInput && typeof existing.exampleInput === 'object'
          ? existing.exampleInput
          : isTechnical
            ? action === 'technical-analysis-feed'
              ? { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid', perspective: 'technical' }
              : { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid' }
            : isInfo
              ? action === 'info-analysis-feed'
                ? { topic: 'BTC market sentiment today', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT }
                : { url: 'https://newshacker.me/', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT }
              : isHyperliquidOrder
                ? { symbol: 'BTCUSDT', side: 'buy', orderType: 'limit', tif: 'Gtc', size: 0.001 }
                : isDataNode
                  ? action === 'weather-context'
                    ? { latitude: 40.7128, longitude: -74.006, forecastDays: 3, timezone: 'auto' }
                    : action === 'tech-buzz-signal'
                      ? { limit: 10 }
                      : { vsCurrency: 'usd', ids: 'bitcoin,ethereum', limit: 10 }
                : { pair: 'BTCUSDT', source: 'hyperliquid' };
    const activeInput = input.active;
    const audience = String(input.audience || existing?.audience || 'public_product').trim().toLowerCase() || 'public_product';
    const scopeMode = String(input.scopeMode || existing?.scopeMode || 'scoped').trim().toLowerCase() || 'scoped';
    const riskLevel = String(input.riskLevel || existing?.riskLevel || 'standard').trim().toLowerCase() || 'standard';
    const active =
      typeof activeInput === 'boolean'
        ? activeInput
        : existing
          ? existing.active !== false
          : true;

    return {
      id: String(existing?.id || input.id || createServiceId()).trim(),
      name,
      description,
      action,
      pair: normalizedTask.pair || '',
      source: normalizedTask.source || normalizedTask.mode || 'auto',
      sourceRequested: normalizedTask.sourceRequested || normalizedTask.mode || 'auto',
      horizonMin: normalizedTask.horizonMin || null,
      resourceUrl: normalizedTask.url || '',
      maxChars: normalizedTask.maxChars || null,
      providerAgentId,
      providerKey,
      audience: ['public_product', 'trusted_integration', 'internal_ops'].includes(audience) ? audience : 'public_product',
      scopeMode: ['scoped', 'global'].includes(scopeMode) ? scopeMode : 'scoped',
      riskLevel: ['low', 'standard', 'high', 'critical'].includes(riskLevel) ? riskLevel : 'standard',
      recipient,
      tokenAddress,
      price: String(Number(priceRaw.toFixed(6))),
      tags,
      slaMs: Number.isFinite(slaMsRaw) && slaMsRaw > 0 ? Math.round(slaMsRaw) : 12000,
      rateLimitPerMinute:
        Number.isFinite(rateLimitPerMinuteRaw) && rateLimitPerMinuteRaw > 0
          ? Math.min(120, Math.max(1, Math.round(rateLimitPerMinuteRaw)))
          : 12,
      budgetPerDay: Number.isFinite(budgetPerDayRaw) && budgetPerDayRaw > 0 ? Number(budgetPerDayRaw.toFixed(6)) : 0,
      allowlistPayers,
      exampleInput,
      active,
      createdAt: String(existing?.createdAt || now).trim(),
      updatedAt: now,
      publishedBy: String(input.publishedBy || existing?.publishedBy || 'admin').trim()
    };
  }

  function createDefaultServiceCatalog() {
    const now = new Date().toISOString();
    return [
      {
        id: 'svc_btcusd_minute',
        name: 'BTC Price Quote (Primary)',
        description:
          'Primary tool for the latest BTC/BTCUSDT price quote via Hyperliquid. Use this for a single BTC price request instead of the generic market-price-feed tool.',
        action: 'btc-price-feed',
        pair: 'BTCUSDT',
        source: 'hyperliquid',
        sourceRequested: 'hyperliquid',
        providerAgentId: String(KITE_AGENT2_ID).trim(),
        recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: String(Number(Number(X402_BTC_PRICE || '0.00001').toFixed(6))),
        tags: ['atapi', 'x402', 'btc', 'price-feed'],
        slaMs: 12000,
        rateLimitPerMinute: 12,
        budgetPerDay: 0.06,
        allowlistPayers: [],
        exampleInput: { pair: 'BTCUSDT', source: 'hyperliquid' },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'svc_btc_risk_score',
        name: 'BTC Risk Score (A2A)',
        description: 'Agent-to-agent risk score derived from paid BTC quote and recent volatility.',
        action: 'risk-score-feed',
        pair: 'BTCUSDT',
        source: 'hyperliquid',
        sourceRequested: 'hyperliquid',
        horizonMin: 60,
        providerAgentId: '3',
        recipient: resolveTechnicalSettlementRecipient(),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: String(Number(Number(X402_RISK_SCORE_PRICE || '0.00002').toFixed(6))),
        tags: ['a2a', 'x402', 'risk'],
        slaMs: 15000,
        rateLimitPerMinute: 10,
        budgetPerDay: 0.08,
        allowlistPayers: [],
        exampleInput: { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid' },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'svc_technical_analysis',
        name: 'Technical Analysis (A2A)',
        description: 'Agent-to-agent technical analysis feed with strict x402 settlement evidence.',
        action: 'technical-analysis-feed',
        pair: 'BTCUSDT',
        source: 'hyperliquid',
        sourceRequested: 'hyperliquid',
        horizonMin: 60,
        providerAgentId: 'technical-agent',
        recipient: resolveTechnicalSettlementRecipient(),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: String(Number(Number(X402_TECHNICAL_PRICE || X402_RISK_SCORE_PRICE || '0.00002').toFixed(6))),
        tags: ['a2a', 'x402', 'technical-analysis'],
        slaMs: 15000,
        rateLimitPerMinute: 10,
        budgetPerDay: 0.08,
        allowlistPayers: [],
        exampleInput: { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid' },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'svc_info_analysis',
        name: 'Message Info Analysis (A2A)',
        description: 'Agent-to-agent message-side info analysis via market-data + x402 payment.',
        action: 'info-analysis-feed',
        pair: '',
        source: 'auto',
        sourceRequested: 'auto',
        resourceUrl: '',
        maxChars: X_READER_MAX_CHARS_DEFAULT,
        providerAgentId: 'message-agent',
        recipient: resolveInfoSettlementRecipient(),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: String(Number(Number(X402_INFO_PRICE || X402_X_READER_PRICE || '0.00001').toFixed(6))),
        tags: ['a2a', 'x402', 'message', 'info-analysis'],
        slaMs: 15000,
        rateLimitPerMinute: 8,
        budgetPerDay: 0.05,
        allowlistPayers: [],
        exampleInput: { topic: 'BTC market sentiment today', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'svc_hyperliquid_order_testnet',
        name: 'Hyperliquid Order (Testnet)',
        description: 'Agent-to-API Hyperliquid testnet order execution via x402 payment.',
        action: 'hyperliquid-order-testnet',
        pair: 'BTCUSDT',
        source: 'hyperliquid-testnet',
        sourceRequested: 'hyperliquid-testnet',
        providerAgentId: 'executor-agent',
        recipient: normalizeAddress(HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: String(Number(Number(X402_HYPERLIQUID_ORDER_PRICE || '0.00002').toFixed(6))),
        tags: ['atapi', 'x402', 'hyperliquid', 'order'],
        slaMs: 15000,
        rateLimitPerMinute: 8,
        budgetPerDay: 0.08,
        allowlistPayers: [],
        exampleInput: { symbol: 'BTCUSDT', side: 'buy', orderType: 'limit', tif: 'Gtc', size: 0.001 },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'cap-weather-context',
        name: 'Weather Context Data Node',
        description: 'Low-cost weather context primitive via Open-Meteo + x402 payment.',
        action: 'weather-context',
        pair: '',
        source: 'open-meteo',
        sourceRequested: 'open-meteo',
        providerAgentId: 'data-node-real',
        providerKey: 'data-node-real',
        recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: '0.00005',
        tags: ['atapi', 'x402', 'data-primitive', 'weather', 'open-meteo'],
        slaMs: 12000,
        rateLimitPerMinute: 20,
        budgetPerDay: 0.03,
        allowlistPayers: [],
        exampleInput: { latitude: 40.7128, longitude: -74.006, forecastDays: 3, timezone: 'auto' },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'cap-tech-buzz-signal',
        name: 'Tech Buzz Signal Data Node',
        description: 'Low-cost Hacker News top-story primitive via x402 payment.',
        action: 'tech-buzz-signal',
        pair: '',
        source: 'hackernews',
        sourceRequested: 'hackernews',
        providerAgentId: 'data-node-real',
        providerKey: 'data-node-real',
        recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: '0.00005',
        tags: ['atapi', 'x402', 'data-primitive', 'news', 'hackernews'],
        slaMs: 12000,
        rateLimitPerMinute: 20,
        budgetPerDay: 0.03,
        allowlistPayers: [],
        exampleInput: { limit: 10 },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      },
      {
        id: 'cap-market-price-feed',
        name: 'Market Snapshot Data Node',
        description:
          'Generic CoinGecko market snapshot for baskets and ranked watchlists. Not the primary tool for a single BTC price quote; prefer the dedicated BTC price tool instead.',
        action: 'market-price-feed',
        pair: '',
        source: 'coingecko',
        sourceRequested: 'coingecko',
        providerAgentId: 'data-node-real',
        providerKey: 'data-node-real',
        recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
        tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
        price: '0.00005',
        tags: ['atapi', 'x402', 'data-primitive', 'market', 'coingecko'],
        slaMs: 12000,
        rateLimitPerMinute: 20,
        budgetPerDay: 0.03,
        allowlistPayers: [],
        exampleInput: { vsCurrency: 'usd', ids: 'bitcoin,ethereum', limit: 10 },
        active: true,
        createdAt: now,
        updatedAt: now,
        publishedBy: 'system'
      }
    ];
  }

  function normalizedUnifiedServicePrice() {
    const parsed = Number(X402_UNIFIED_SERVICE_PRICE);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0.00015';
    return String(Number(parsed.toFixed(6)));
  }

  function isDataPrimitiveService(item = {}) {
    const id = String(item?.id || '').trim().toLowerCase();
    const action = String(item?.action || '').trim().toLowerCase();
    const providerKey = String(item?.providerKey || item?.providerAgentId || '').trim().toLowerCase();
    return (
      providerKey === 'data-node-real' ||
      ['cap-weather-context', 'cap-tech-buzz-signal', 'cap-market-price-feed'].includes(id) ||
      ['weather-context', 'tech-buzz-signal', 'market-price-feed'].includes(action)
    );
  }

  function resolveCatalogPrice(item = {}, fallbackPrice = '') {
    if (isDataPrimitiveService(item)) {
      const parsed = Number(item?.price);
      if (Number.isFinite(parsed) && parsed > 0) return String(Number(parsed.toFixed(6)));
      return '0.00005';
    }
    return fallbackPrice || normalizedUnifiedServicePrice();
  }

  function mergeBuiltinServices(rows = []) {
    const rawList = Array.isArray(rows) ? [...rows] : [];
    let changed = false;
    const unifiedPrice = normalizedUnifiedServicePrice();
    const defaults = createDefaultServiceCatalog().map((service) => ({
      ...service,
      price: resolveCatalogPrice(service, unifiedPrice)
    }));
    const defaultIds = new Set(defaults.map((item) => String(item?.id || '').trim().toLowerCase()).filter(Boolean));
    const defaultActions = new Set(defaults.map((item) => String(item?.action || '').trim().toLowerCase()).filter(Boolean));
    const defaultProviderIds = new Set(
      defaults
        .flatMap((item) => [String(item?.providerAgentId || '').trim().toLowerCase(), String(item?.providerKey || '').trim().toLowerCase()])
        .filter(Boolean)
    );
    const list = rawList
      .filter((item) => {
        const id = String(item?.id || '').trim();
        const action = String(item?.action || '').trim().toLowerCase();
        const providerId = String(item?.providerKey || item?.providerAgentId || '').trim().toLowerCase();
        const publishedBy = String(item?.publishedBy || '').trim().toLowerCase();
        const isStaleSystemCapability =
          publishedBy === 'system' &&
          defaultProviderIds.has(providerId) &&
          id.toLowerCase().startsWith('cap-') &&
          !defaultIds.has(id.toLowerCase()) &&
          !defaultActions.has(action);
        if (id === 'svc_x_reader_digest' || isStaleSystemCapability) {
          changed = true;
          return false;
        }
        return true;
      })
      .map((item) => {
        const action = String(item?.action || '').trim().toLowerCase();
        let next = item;
        if (action === 'x-reader-feed') {
          changed = true;
          next = {
            ...next,
            action: 'info-analysis-feed',
            updatedAt: new Date().toISOString()
          };
        }
        const expectedPrice = resolveCatalogPrice(next, unifiedPrice);
        if (String(next?.price || '').trim() !== expectedPrice) {
          changed = true;
          next = {
            ...next,
            price: expectedPrice,
            updatedAt: new Date().toISOString()
          };
        }
        return next;
      });
    for (const service of defaults) {
      const id = String(service?.id || '').trim();
      if (!id) continue;
      const index = list.findIndex((item) => String(item?.id || '').trim() === id);
      if (index < 0) {
        list.push(service);
        changed = true;
        continue;
      }
      const current = list[index] || {};
      const expectedPrice = isDataPrimitiveService(service)
        ? resolveCatalogPrice(current, service.price || '0.00005')
        : resolveCatalogPrice(service, unifiedPrice);
      const shouldReconcileBuiltinMetadata = String(current?.publishedBy || '').trim().toLowerCase() === 'system';
      const reconciled = shouldReconcileBuiltinMetadata
        ? {
            ...current,
            name: service.name,
            description: service.description,
            action: service.action,
            pair: service.pair,
            source: service.source,
            sourceRequested: service.sourceRequested,
            providerAgentId: service.providerAgentId,
            providerKey: service.providerKey,
            recipient: service.recipient,
            tokenAddress: service.tokenAddress,
            tags: Array.isArray(service.tags) ? [...service.tags] : [],
            exampleInput: service.exampleInput
          }
        : current;
      const metadataChanged =
        JSON.stringify({
          name: current?.name,
          description: current?.description,
          action: current?.action,
          pair: current?.pair,
          source: current?.source,
          sourceRequested: current?.sourceRequested,
          providerAgentId: current?.providerAgentId,
          providerKey: current?.providerKey,
          recipient: current?.recipient,
          tokenAddress: current?.tokenAddress,
          tags: current?.tags,
          exampleInput: current?.exampleInput
        }) !==
        JSON.stringify({
          name: reconciled?.name,
          description: reconciled?.description,
          action: reconciled?.action,
          pair: reconciled?.pair,
          source: reconciled?.source,
          sourceRequested: reconciled?.sourceRequested,
          providerAgentId: reconciled?.providerAgentId,
          providerKey: reconciled?.providerKey,
          recipient: reconciled?.recipient,
          tokenAddress: reconciled?.tokenAddress,
          tags: reconciled?.tags,
          exampleInput: reconciled?.exampleInput
        });
      if (String(reconciled?.price || '').trim() !== expectedPrice || metadataChanged) {
        changed = true;
        list[index] = {
          ...reconciled,
          price: expectedPrice,
          updatedAt: new Date().toISOString()
        };
      }
    }
    return { rows: list, changed };
  }

  function ensureServiceCatalog() {
    const rows = readPublishedServices();
    if (Array.isArray(rows) && rows.length > 0) {
      const merged = mergeBuiltinServices(rows);
      if (merged.changed) {
        writePublishedServices(merged.rows);
      }
      return merged.rows;
    }
    const seed = createDefaultServiceCatalog().map((item) => ({
      ...item,
      price: resolveCatalogPrice(item, normalizedUnifiedServicePrice())
    }));
    writePublishedServices(seed);
    return seed;
  }

  function mapCapabilityToServiceActions(capability = '') {
    const normalized = String(capability || '').trim().toLowerCase();
    if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
      return ['technical-analysis-feed', 'risk-score-feed'];
    }
    if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
      return ['info-analysis-feed'];
    }
    if (['btc-price-feed', 'market-quote'].includes(normalized)) {
      return ['btc-price-feed'];
    }
    if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
      return ['hyperliquid-order-testnet'];
    }
    if (['weather-context', 'cap-weather-context'].includes(normalized)) {
      return ['weather-context'];
    }
    if (['tech-buzz-signal', 'cap-tech-buzz-signal'].includes(normalized)) {
      return ['tech-buzz-signal'];
    }
    if (['market-price-feed', 'cap-market-price-feed'].includes(normalized)) {
      return ['market-price-feed'];
    }
    return [];
  }

  function defaultAgentIdByCapability(capability = '') {
    const normalized = String(capability || '').trim().toLowerCase();
    if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
      return 'technical-agent';
    }
    if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
      return 'message-agent';
    }
    if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
      return 'executor-agent';
    }
    if (['btc-price-feed', 'market-quote'].includes(normalized)) {
      return 'price-agent';
    }
    if (
      ['weather-context', 'cap-weather-context', 'tech-buzz-signal', 'cap-tech-buzz-signal', 'market-price-feed', 'cap-market-price-feed'].includes(
        normalized
      )
    ) {
      return 'data-node-real';
    }
    return 'router-agent';
  }

  function toPriceNumber(value, fallback = NaN) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function selectServiceCandidatesByCapability(capability = '') {
    const actions = mapCapabilityToServiceActions(capability);
    if (actions.length === 0) return [];
    return ensureServiceCatalog().filter((item) => {
      if (item?.active === false) return false;
      const action = String(item?.action || '').trim().toLowerCase();
      return actions.includes(action);
    });
  }

  function sanitizeNetworkAgentRecord(input = {}, existing = null) {
    const source = input && typeof input === 'object' ? input : {};
    const fallback = existing && typeof existing === 'object' ? existing : {};
    const now = new Date().toISOString();
    const id = String(source.id || fallback.id || '').trim().toLowerCase();
    const name = String(source.name || fallback.name || '').trim();
    const role = String(source.role || fallback.role || '').trim().toLowerCase();
    const mode = String(source.mode || fallback.mode || '').trim().toLowerCase();
    const xmtpAddress = normalizeAddress(source.xmtpAddress || fallback.xmtpAddress || '');
    const aaAddress = normalizeAddress(source.aaAddress || fallback.aaAddress || '');
    const inboxId = String(source.inboxId || fallback.inboxId || '').trim();
    const ownerWallet = normalizeAddress(source.ownerWallet || fallback.ownerWallet || '');
    const identityRegistry = normalizeAddress(source.identityRegistry || fallback.identityRegistry || '');
    const identityAgentIdRaw = source.identityAgentId ?? fallback.identityAgentId ?? '';
    const identityAgentId =
      identityAgentIdRaw === '' || identityAgentIdRaw === null || identityAgentIdRaw === undefined
        ? ''
        : String(identityAgentIdRaw).trim();
    const identityVerifyMode = String(source.identityVerifyMode || fallback.identityVerifyMode || '').trim().toLowerCase();
    const identityVerifiedAt = String(source.identityVerifiedAt || fallback.identityVerifiedAt || '').trim();
    const identitySignerType = String(source.identitySignerType || fallback.identitySignerType || '').trim().toLowerCase();
    const importedFromIdentityAt = String(source.importedFromIdentityAt || fallback.importedFromIdentityAt || '').trim();
    const onboardingSource = String(source.onboardingSource || fallback.onboardingSource || '').trim().toLowerCase();
    const approvalStatus = String(source.approvalStatus || fallback.approvalStatus || '').trim().toLowerCase();
    const approvedAt = String(source.approvedAt || fallback.approvedAt || '').trim();
    const suspendedAt = String(source.suspendedAt || fallback.suspendedAt || '').trim();
    const description = String(source.description || fallback.description || '').trim();
    const capabilitiesRaw = Array.isArray(source.capabilities)
      ? source.capabilities
      : Array.isArray(fallback.capabilities)
        ? fallback.capabilities
        : [];
    const active =
      typeof source.active === 'boolean'
        ? source.active
        : typeof fallback.active === 'boolean'
          ? fallback.active
          : true;
    const capabilities = capabilitiesRaw.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 24);
    return {
      id,
      name: name || id,
      role,
      mode,
      xmtpAddress,
      aaAddress,
      inboxId,
      ownerWallet,
      identityRegistry,
      identityAgentId,
      identityVerifyMode,
      identityVerifiedAt,
      identitySignerType,
      importedFromIdentityAt,
      onboardingSource,
      approvalStatus,
      approvedAt,
      suspendedAt,
      description,
      capabilities,
      active,
      createdAt: String(fallback.createdAt || source.createdAt || now).trim() || now,
      updatedAt: String(source.updatedAt || fallback.updatedAt || now).trim() || now
    };
  }

  function createDefaultNetworkAgents() {
    const seeds = [
      {
        id: 'router-agent',
        name: 'AGENT001',
        role: 'router',
        mode: 'a2a',
        xmtpAddress: XMTP_ROUTER_RESOLVED_ADDRESS,
        aaAddress: XMTP_ROUTER_AGENT_AA_ADDRESS,
        identityRegistry: ERC8004_IDENTITY_REGISTRY || '',
        identityAgentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID || '') : '',
        description: 'AGENT001 orchestrator: direct DM entry for task routing and A2A coordination.',
        capabilities: ['route-task', 'dispatch-a2a']
      },
      {
        id: 'risk-agent',
        name: 'Risk Agent',
        role: 'provider',
        mode: 'a2a',
        xmtpAddress: XMTP_RISK_RESOLVED_ADDRESS,
        aaAddress: XMTP_RISK_AGENT_AA_ADDRESS,
        identityRegistry: String(process.env.XMTP_RISK_IDENTITY_REGISTRY || '').trim(),
        identityAgentId: String(process.env.XMTP_RISK_IDENTITY_AGENT_ID || '').trim(),
        description: 'Computes risk-score feed through agent capability.',
        capabilities: ['risk-score-feed', 'volatility-snapshot', 'technical-analysis-feed']
      },
      {
        id: 'technical-agent',
        name: 'Technical Agent',
        role: 'provider',
        mode: 'a2a',
        xmtpAddress: XMTP_RISK_RESOLVED_ADDRESS,
        aaAddress: XMTP_RISK_AGENT_AA_ADDRESS,
        identityRegistry: String(process.env.XMTP_TECHNICAL_IDENTITY_REGISTRY || process.env.XMTP_RISK_IDENTITY_REGISTRY || '').trim(),
        identityAgentId: String(process.env.XMTP_TECHNICAL_IDENTITY_AGENT_ID || process.env.XMTP_RISK_IDENTITY_AGENT_ID || '').trim(),
        description: 'Single technical facade over risk/price sub-analysis outputs.',
        capabilities: ['technical-analysis-feed', 'risk-score-feed', 'market-quote']
      },
      {
        id: 'reader-agent',
        name: 'Reader Agent',
        role: 'provider',
        mode: 'a2api',
        xmtpAddress: XMTP_READER_RESOLVED_ADDRESS,
        aaAddress: XMTP_READER_AGENT_AA_ADDRESS,
        identityRegistry: String(process.env.XMTP_READER_IDENTITY_REGISTRY || '').trim(),
        identityAgentId: String(process.env.XMTP_READER_IDENTITY_AGENT_ID || '').trim(),
        description: 'Runs x-reader digest for URLs via ATAPI adapter.',
        capabilities: ['url-digest', 'info-analysis-feed']
      },
      {
        id: 'message-agent',
        name: 'Message Agent',
        role: 'provider',
        mode: 'a2api',
        xmtpAddress: XMTP_READER_RESOLVED_ADDRESS,
        aaAddress: XMTP_READER_AGENT_AA_ADDRESS,
        identityRegistry: String(process.env.XMTP_MESSAGE_IDENTITY_REGISTRY || process.env.XMTP_READER_IDENTITY_REGISTRY || '').trim(),
        identityAgentId: String(process.env.XMTP_MESSAGE_IDENTITY_AGENT_ID || process.env.XMTP_READER_IDENTITY_AGENT_ID || '').trim(),
        description: 'Message/news sentiment facade over reader runtime.',
        capabilities: ['info-analysis-feed', 'url-digest']
      },
      {
        id: 'price-agent',
        name: 'Price Agent',
        role: 'provider',
        mode: 'a2api',
        xmtpAddress: XMTP_PRICE_RESOLVED_ADDRESS,
        aaAddress: XMTP_PRICE_AGENT_AA_ADDRESS,
        description: 'Fetches BTC/market quote feeds.',
        capabilities: ['btc-price-feed', 'market-quote']
      },
      {
        id: 'executor-agent',
        name: 'Executor Agent',
        role: 'executor',
        mode: 'a2a',
        xmtpAddress: XMTP_EXECUTOR_RESOLVED_ADDRESS,
        aaAddress: XMTP_EXECUTOR_AGENT_AA_ADDRESS,
        description: 'Executes final orchestration and result aggregation.',
        capabilities: ['execute-plan', 'result-aggregation']
      },
      {
        id: 'data-node-real',
        name: 'Data Node Real',
        role: 'provider',
        mode: 'a2api',
        xmtpAddress: XMTP_PRICE_RESOLVED_ADDRESS,
        aaAddress: XMTP_PRICE_AGENT_AA_ADDRESS,
        description: 'Public data primitive provider for weather, tech buzz, and market snapshots.',
        capabilities: [
          'weather-context',
          'cap-weather-context',
          'tech-buzz-signal',
          'cap-tech-buzz-signal',
          'market-price-feed',
          'cap-market-price-feed'
        ]
      }
    ];
    return seeds.map((item) => sanitizeNetworkAgentRecord(item)).filter((item) => item.id);
  }

  function mergeBuiltinNetworkAgents(rows = []) {
    const list = Array.isArray(rows) ? [...rows] : [];
    const defaults = createDefaultNetworkAgents();
    let changed = false;
    for (const agent of defaults) {
      const id = String(agent?.id || '').trim().toLowerCase();
      if (!id) continue;
      const idx = list.findIndex((item) => String(item?.id || '').trim().toLowerCase() === id);
      if (idx < 0) {
        list.push(agent);
        changed = true;
        continue;
      }
      const current = sanitizeNetworkAgentRecord(list[idx], list[idx]);
      const mergedCapabilities = Array.from(new Set([...(current.capabilities || []), ...(agent.capabilities || [])]));
      const nextName = id === 'router-agent' ? String(agent.name || current.name || '').trim() : String(current.name || agent.name || '').trim();
      const nextDescription =
        id === 'router-agent'
          ? String(agent.description || current.description || '').trim()
          : String(current.description || agent.description || '').trim();
      const merged = sanitizeNetworkAgentRecord(
        {
          ...current,
          name: nextName,
          description: nextDescription,
          capabilities: mergedCapabilities
        },
        current
      );
      if (JSON.stringify(current) !== JSON.stringify(merged)) {
        list[idx] = merged;
        changed = true;
      }
    }
    return { rows: list, changed };
  }

  function normalizeDuplicateNetworkAgentIdentities(rows = []) {
    const list = Array.isArray(rows) ? [...rows] : [];
    const groups = new Map();
    let changed = false;

    function toTimestamp(value = '') {
      const normalized = String(value || '').trim();
      if (!normalized) return 0;
      const parsed = Date.parse(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function rankRecord(item = {}) {
      return [
        toTimestamp(item.identityVerifiedAt),
        toTimestamp(item.importedFromIdentityAt),
        toTimestamp(item.updatedAt),
        toTimestamp(item.createdAt)
      ];
    }

    function compareRank(a = {}, b = {}) {
      const left = rankRecord(a);
      const right = rankRecord(b);
      for (let idx = 0; idx < left.length; idx += 1) {
        if (left[idx] === right[idx]) continue;
        return right[idx] - left[idx];
      }
      return String(a.id || '').localeCompare(String(b.id || ''));
    }

    for (const item of list) {
      const identityRegistry = normalizeAddress(item?.identityRegistry || '');
      const identityAgentId = String(item?.identityAgentId || '').trim();
      if (!identityRegistry || !identityAgentId) continue;
      const key = `${identityRegistry}:${identityAgentId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    for (const items of groups.values()) {
      if (!Array.isArray(items) || items.length < 2) continue;
      const ranked = [...items].sort(compareRank);
      const winnerId = String(ranked[0]?.id || '').trim().toLowerCase();
      for (const item of ranked.slice(1)) {
        const itemId = String(item?.id || '').trim().toLowerCase();
        const idx = list.findIndex((row) => String(row?.id || '').trim().toLowerCase() === itemId);
        if (idx < 0 || itemId === winnerId) continue;
        const current = sanitizeNetworkAgentRecord(list[idx], list[idx]);
        const normalized = sanitizeNetworkAgentRecord(
          {
            ...current,
            identityRegistry: '',
            identityAgentId: '',
            identityVerifyMode: '',
            identityVerifiedAt: '',
            identitySignerType: '',
            importedFromIdentityAt: ''
          },
          current
        );
        if (JSON.stringify(current) !== JSON.stringify(normalized)) {
          list[idx] = normalized;
          changed = true;
        }
      }
    }

    return { rows: list, changed };
  }

  function ensureNetworkAgents() {
    const rows = readNetworkAgents();
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((item) => sanitizeNetworkAgentRecord(item))
      .filter((item) => item.id);
    if (normalized.length > 0) {
      const deduped = normalizeDuplicateNetworkAgentIdentities(normalized);
      const merged = mergeBuiltinNetworkAgents(deduped.rows);
      const before = JSON.stringify(Array.isArray(rows) ? rows : []);
      const after = JSON.stringify(merged.rows);
      if (before !== after || deduped.changed || merged.changed) writeNetworkAgents(merged.rows);
      return merged.rows;
    }
    const seeded = createDefaultNetworkAgents();
    writeNetworkAgents(seeded);
    return seeded;
  }

  function findNetworkAgentById(agentId = '') {
    const id = String(agentId || '').trim().toLowerCase();
    if (!id) return null;
    return ensureNetworkAgents().find((item) => String(item?.id || '').trim().toLowerCase() === id) || null;
  }

  function resolveAgentAddressesByIds(agentIds = []) {
    const normalizedIds = parseAgentIdList(agentIds);
    const resolved = [];
    for (const id of normalizedIds) {
      const row = findNetworkAgentById(id);
      const address = normalizeAddress(row?.xmtpAddress || '');
      if (!address) continue;
      resolved.push({
        agentId: id,
        address
      });
    }
    const uniqueByAddress = [];
    for (const item of resolved) {
      if (uniqueByAddress.some((row) => row.address === item.address)) continue;
      uniqueByAddress.push(item);
    }
    return uniqueByAddress;
  }

  function mapServiceReceipt(invocation = {}, workflowByTraceId = new Map(), requestById = new Map()) {
    const traceId = String(invocation.traceId || '').trim();
    const workflow = traceId ? workflowByTraceId.get(traceId) || null : null;
    const requestId =
      String(invocation.requestId || '').trim() ||
      String(workflow?.requestId || '').trim();
    const requestItem = requestId ? requestById.get(requestId) || null : null;
    const txHash = String(
      invocation.txHash || requestItem?.paymentTxHash || requestItem?.paymentProof?.txHash || workflow?.txHash || ''
    ).trim();
    const block = requestItem?.proofVerification?.details?.blockNumber || '-';
    const onchainStatus =
      requestItem?.proofVerification
        ? 'success'
        : String(invocation.state || '').trim().toLowerCase() === 'failed'
          ? 'failed'
          : 'pending';

    return {
      invocationId: String(invocation.invocationId || '').trim(),
      serviceId: String(invocation.serviceId || '').trim(),
      traceId,
      requestId,
      state: String(invocation.state || '').trim().toLowerCase() || 'running',
      createdAt: String(invocation.createdAt || '').trim(),
      updatedAt: String(invocation.updatedAt || '').trim(),
      payer: String(invocation.payer || '').trim(),
      sourceAgentId: String(invocation.sourceAgentId || '').trim(),
      targetAgentId: String(invocation.targetAgentId || '').trim(),
      summary: String(invocation.summary || workflow?.result?.summary || '').trim(),
      error: String(invocation.error || workflow?.error || '').trim(),
      x402: {
        amount: String(requestItem?.amount || invocation.amount || '').trim(),
        tokenAddress: String(requestItem?.tokenAddress || invocation.tokenAddress || '').trim(),
        recipient: String(requestItem?.recipient || invocation.recipient || '').trim(),
        status: String(requestItem?.status || '').trim().toLowerCase() || (onchainStatus === 'success' ? 'paid' : 'pending'),
        txHash
      },
      onchain: {
        txHash,
        block,
        status: onchainStatus,
        explorer: txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : ''
      }
    };
  }

  function computeServiceReputation(service = null, receipts = []) {
    const rows = Array.isArray(receipts) ? receipts : [];
    const total = rows.length;
    const successCount = rows.filter((item) => String(item?.state || '').toLowerCase() === 'success' || String(item?.state || '').toLowerCase() === 'unlocked').length;
    const failedCount = rows.filter((item) => String(item?.state || '').toLowerCase() === 'failed').length;
    const successRate = total > 0 ? successCount / total : 0;
    const onchainSuccessCount = rows.filter((item) => String(item?.onchain?.status || '').toLowerCase() === 'success').length;
    const onchainRatio = total > 0 ? onchainSuccessCount / total : 0;

    const latencies = rows
      .map((item) => {
        const created = Date.parse(String(item?.createdAt || '').trim());
        const updated = Date.parse(String(item?.updatedAt || '').trim());
        if (!Number.isFinite(created) || !Number.isFinite(updated) || updated <= created) return NaN;
        return (updated - created) / 1000;
      })
      .filter((value) => Number.isFinite(value) && value >= 0);
    const avgConfirmSec = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
    const latencyScore = avgConfirmSec <= 0 ? 1 : Math.max(0, Math.min(1, 1 - avgConfirmSec / 120));

    const reputationScore = Number(
      Math.max(
        0,
        Math.min(100, (successRate * 70 + onchainRatio * 20 + latencyScore * 10) * 100)
      ).toFixed(2)
    );

    return {
      serviceId: String(service?.id || '').trim(),
      providerAgentId: String(service?.providerAgentId || '').trim(),
      score: reputationScore,
      grade: reputationScore >= 85 ? 'A' : reputationScore >= 70 ? 'B' : reputationScore >= 55 ? 'C' : 'D',
      factors: {
        successRate: Number((successRate * 100).toFixed(2)),
        onchainMatchRate: Number((onchainRatio * 100).toFixed(2)),
        avgConfirmSec: Number(avgConfirmSec.toFixed(2))
      },
      sampleSize: total,
      failedCount
    };
  }

  function evaluateServiceInvokeGuard(service = {}, input = {}) {
    const payer = normalizeAddress(input.payer || '');
    const nowMs = Number(input.nowMs || Date.now());
    const invocations = Array.isArray(input.invocations) ? input.invocations : [];
    const checks = [];

    const allowlist = normalizeAddresses(service.allowlistPayers || []);
    if (allowlist.length > 0 && (!payer || !allowlist.includes(payer))) {
      return {
        ok: false,
        code: 'service_payer_not_allowed',
        reason: 'Payer is not in service allowlist.',
        checks: [{ rule: 'allowlistPayers', ok: false, expected: allowlist, got: payer }]
      };
    }
    checks.push({ rule: 'allowlistPayers', ok: true });

    const rpm = Number(service.rateLimitPerMinute || 0);
    if (Number.isFinite(rpm) && rpm > 0) {
      const windowStart = nowMs - 60 * 1000;
      const recentCount = invocations.filter((item) => {
        const at = Date.parse(String(item?.createdAt || item?.updatedAt || '').trim());
        return Number.isFinite(at) && at >= windowStart;
      }).length;
      if (recentCount >= rpm) {
        return {
          ok: false,
          code: 'service_rate_limited',
          reason: `Service per-minute limit exceeded (${recentCount}/${rpm}).`,
          checks: [{ rule: 'rateLimitPerMinute', ok: false, recentCount, limit: rpm }]
        };
      }
      checks.push({ rule: 'rateLimitPerMinute', ok: true, recentCount, limit: rpm });
    }

    const budget = Number(service.budgetPerDay || 0);
    const price = Number(service.price || 0);
    if (Number.isFinite(budget) && budget > 0 && Number.isFinite(price) && price > 0) {
      const dayKey = getUtcDateKey(nowMs);
      const spent = invocations
        .filter((item) => {
          const at = Date.parse(String(item?.updatedAt || item?.createdAt || '').trim());
          if (!Number.isFinite(at)) return false;
          if (getUtcDateKey(at) !== dayKey) return false;
          const state = String(item?.state || '').trim().toLowerCase();
          return state === 'success' || state === 'unlocked';
        })
        .reduce((sum, item) => {
          const amount = Number(item?.amount || price || 0);
          return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
        }, 0);
      const projected = spent + price;
      if (projected > budget) {
        return {
          ok: false,
          code: 'service_budget_exceeded',
          reason: `Service daily budget exceeded (${projected.toFixed(6)} > ${budget}).`,
          checks: [{ rule: 'budgetPerDay', ok: false, spent: Number(spent.toFixed(6)), projected: Number(projected.toFixed(6)), budget }]
        };
      }
      checks.push({ rule: 'budgetPerDay', ok: true, spent: Number(spent.toFixed(6)), projected: Number(projected.toFixed(6)), budget });
    }

    return {
      ok: true,
      checks
    };
  }

  function buildServiceStatus(service, allInvocations = [], receipts = []) {
    const rows = allInvocations
      .filter((item) => String(item?.serviceId || '').trim() === String(service?.id || '').trim())
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0));

    const total = rows.length;
    const success = rows.filter((item) => ['success', 'unlocked'].includes(String(item?.state || '').trim().toLowerCase())).length;
    const failed = rows.filter((item) => String(item?.state || '').trim().toLowerCase() === 'failed').length;
    const running = rows.filter((item) => String(item?.state || '').trim().toLowerCase() === 'running').length;
    const successRate = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0;
    const latency = receipts
      .map((item) => {
        const c = Date.parse(String(item?.createdAt || '').trim());
        const u = Date.parse(String(item?.updatedAt || '').trim());
        if (!Number.isFinite(c) || !Number.isFinite(u) || u <= c) return NaN;
        return (u - c) / 1000;
      })
      .filter((v) => Number.isFinite(v) && v >= 0);
    const avgConfirmSec = latency.length > 0 ? Number((latency.reduce((s, v) => s + v, 0) / latency.length).toFixed(2)) : 0;

    return {
      serviceId: String(service?.id || '').trim(),
      state: running > 0 ? 'running' : failed > 0 && success === 0 ? 'degraded' : 'healthy',
      totals: {
        total,
        success,
        failed,
        running
      },
      successRate,
      avgConfirmSec,
      lastUpdatedAt: String(rows[0]?.updatedAt || rows[0]?.createdAt || service?.updatedAt || '').trim(),
      lastError:
        String(
          rows.find((item) => String(item?.error || '').trim())?.error || ''
        ).trim()
    };
  }

  return {
    buildServiceStatus,
    computeServiceReputation,
    defaultAgentIdByCapability,
    ensureNetworkAgents,
    ensureServiceCatalog,
    evaluateServiceInvokeGuard,
    findNetworkAgentById,
    mapServiceReceipt,
    resolveAgentAddressesByIds,
    resolveAnalysisErrorStatus,
    sanitizeNetworkAgentRecord,
    sanitizeServiceRecord,
    selectServiceCandidatesByCapability,
    toPriceNumber
  };
}
