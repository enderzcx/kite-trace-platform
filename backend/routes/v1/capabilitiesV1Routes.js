import { createPlatformV1Shared } from './platformV1Shared.js';

export const REAL_AGENT_CAPABILITY_SEEDS = [
  {
    capabilityId: 'cap-listing-alert',
    action: 'listing-alert',
    providerAgentId: 'fundamental-agent-real',
    providerKey: 'fundamental-agent-real',
    name: 'Exchange Listing Alert',
    description:
      'Real-time listing announcements from Binance, OKX, Coinbase, Bybit, Hyperliquid and others. AI-scored with impact (0-100) and long/short signal.',
    inputSchema: {
      exchange: 'string? binance|okx|coinbase|bybit|all',
      coin: 'string?',
      limit: 'number? default 10'
    },
    outputSchema: {
      listings: [{ exchange: 'string', coin: 'string', listingType: 'string', aiScore: 'number', signal: 'string', summary: 'string', ts: 'string' }]
    },
    pricing: { model: 'per_call', amount: '0.002', currency: 'USDC' },
    tags: ['fundamental', 'listing', 'exchange', 'alpha'],
    exampleInput: { exchange: 'all', coin: 'BTC', limit: 10 }
  },
  {
    capabilityId: 'cap-news-signal',
    action: 'news-signal',
    providerAgentId: 'fundamental-agent-real',
    providerKey: 'fundamental-agent-real',
    name: 'AI News Signal',
    description: 'AI-analyzed news signal (long/short/neutral) from Bloomberg, Reuters, CoinDesk and 50+ sources.',
    inputSchema: {
      coin: 'string?',
      signal: 'string? long|short|neutral',
      minScore: 'number? default 50',
      limit: 'number? default 10'
    },
    outputSchema: {
      articles: [{ title: 'string', summary: 'string', source: 'string', aiScore: 'number', signal: 'string', coin: 'string', ts: 'string' }]
    },
    pricing: { model: 'per_call', amount: '0.0005', currency: 'USDC' },
    tags: ['fundamental', 'news', 'signal'],
    exampleInput: { coin: 'BTC', signal: 'long', minScore: 50, limit: 10 }
  },
  {
    capabilityId: 'cap-meme-sentiment',
    action: 'meme-sentiment',
    providerAgentId: 'fundamental-agent-real',
    providerKey: 'fundamental-agent-real',
    name: 'Meme Coin Sentiment',
    description: 'Twitter meme coin social sentiment and trending detection.',
    inputSchema: { limit: 'number? default 20' },
    outputSchema: { memes: [{ coin: 'string', sentiment: 'string', trendScore: 'number', ts: 'string' }] },
    pricing: { model: 'per_call', amount: '0.0001', currency: 'USDC' },
    tags: ['fundamental', 'meme', 'sentiment'],
    exampleInput: { limit: 20 }
  },
  {
    capabilityId: 'cap-kol-monitor',
    action: 'kol-monitor',
    providerAgentId: 'fundamental-agent-real',
    providerKey: 'fundamental-agent-real',
    name: 'KOL Tweet Monitor',
    description: 'Track KOL tweets, deleted tweets, and follower events.',
    inputSchema: { username: 'string', includeDeleted: 'boolean? default false', limit: 'number? default 20' },
    outputSchema: {
      tweets: [{ id: 'string', text: 'string', createdAt: 'string', retweetCount: 'number', favoriteCount: 'number' }],
      deletedTweets: []
    },
    pricing: { model: 'per_call', amount: '0.0003', currency: 'USDC' },
    tags: ['fundamental', 'kol', 'twitter'],
    exampleInput: { username: 'elonmusk', includeDeleted: false, limit: 20 }
  },
  {
    capabilityId: 'cap-smart-money-signal',
    action: 'smart-money-signal',
    providerAgentId: 'technical-agent-real',
    providerKey: 'technical-agent-real',
    name: 'Smart Money Signal',
    description: 'Track smart money, whale, and KOL on-chain DEX activity via OKX onchainos.',
    inputSchema: { symbol: 'string? default BTC', signalType: 'string smart-money|whale|kol default smart-money' },
    outputSchema: {
      signals: [{ walletAddress: 'string', action: 'string', amount: 'number', token: 'string', ts: 'string', signalType: 'string' }]
    },
    pricing: { model: 'per_call', amount: '0.001', currency: 'USDC' },
    tags: ['technical', 'onchain', 'smart-money'],
    exampleInput: { symbol: 'BTC', signalType: 'smart-money' }
  },
  {
    capabilityId: 'cap-trenches-scan',
    action: 'trenches-scan',
    providerAgentId: 'technical-agent-real',
    providerKey: 'technical-agent-real',
    name: 'Trenches Token Scan',
    description: 'Meme token early detection: dev reputation, bundle detection, aped wallets via OKX DEX Trenches.',
    inputSchema: { token_address: 'string' },
    outputSchema: { devReputation: 'string', bundleDetected: 'boolean', apedWallets: [], riskScore: '0-100' },
    pricing: { model: 'per_call', amount: '0.0015', currency: 'USDC' },
    tags: ['technical', 'meme', 'trenches', 'alpha'],
    exampleInput: { token_address: '0x0000000000000000000000000000000000000000' }
  },
  {
    capabilityId: 'cap-token-analysis',
    action: 'token-analysis',
    providerAgentId: 'technical-agent-real',
    providerKey: 'technical-agent-real',
    name: 'Token Deep Analysis',
    description: 'Full token analysis: holders, top traders, liquidity pools, market cap via OKX DEX.',
    inputSchema: { symbol: 'string? or token_address: string?' },
    outputSchema: { marketCap: 'number', holders: 'number', topTraders: [], liquidityPools: [], priceChange24h: 'number' },
    pricing: { model: 'per_call', amount: '0.0005', currency: 'USDC' },
    tags: ['technical', 'token', 'analysis'],
    exampleInput: { symbol: 'BTC' }
  },
  {
    capabilityId: 'cap-wallet-pnl',
    action: 'wallet-pnl',
    providerAgentId: 'technical-agent-real',
    providerKey: 'technical-agent-real',
    name: 'Wallet PnL Analysis',
    description: 'Wallet portfolio holdings and PnL analysis across 20+ chains.',
    inputSchema: { wallet_address: 'string', chain: 'string? default eth' },
    outputSchema: {
      totalValue: 'number',
      pnl24h: 'number',
      pnlPercent: 'number',
      holdings: [{ token: 'string', amount: 'number', value: 'number' }]
    },
    pricing: { model: 'per_call', amount: '0.0003', currency: 'USDC' },
    tags: ['technical', 'wallet', 'pnl'],
    exampleInput: { wallet_address: '0x0000000000000000000000000000000000000000', chain: 'eth' }
  },
  {
    capabilityId: 'cap-dex-market',
    action: 'dex-market',
    providerAgentId: 'technical-agent-real',
    providerKey: 'technical-agent-real',
    name: 'DEX Market Data',
    description: 'Real-time price, K-line charts and index prices via OKX DEX.',
    inputSchema: { symbol: 'string default BTCUSDT', interval: 'string? 1m|5m|1h|1d default 1h', limit: 'number? default 20' },
    outputSchema: {
      price: 'number',
      change24h: 'number',
      volume24h: 'number',
      klines: [{ open: 'number', high: 'number', low: 'number', close: 'number', volume: 'number', ts: 'string' }]
    },
    pricing: { model: 'per_call', amount: '0.0001', currency: 'USDC' },
    tags: ['technical', 'market', 'kline'],
    exampleInput: { symbol: 'BTCUSDT', interval: '1h', limit: 20 }
  }
];

export function seedRealAgentCapabilities({
  ensureServiceCatalog,
  ensureNetworkAgents,
  writePublishedServices,
  writeNetworkAgents,
  normalizeText = (value = '') => String(value || '').trim(),
  normalizeLower = (value = '') => String(value || '').trim().toLowerCase()
} = {}) {
  const rows = ensureServiceCatalog().map((item) => ({ ...item }));
  const now = new Date().toISOString();

  // Resolve agent-specific recipient wallets from env or network_agents
  const agentWalletOverrides = new Map();
  const envWalletMap = {
    'fundamental-agent-real': process.env.KITE_FUNDAMENTAL_AGENT_WALLET || '',
    'technical-agent-real': process.env.KITE_TECHNICAL_AGENT_WALLET || '',
    'data-node-real': process.env.KITE_DATA_NODE_WALLET || ''
  };
  for (const [providerId, wallet] of Object.entries(envWalletMap)) {
    const normalized = normalizeText(wallet).toLowerCase();
    if (normalized && normalized !== '0x') agentWalletOverrides.set(providerId, normalized);
  }
  if (agentWalletOverrides.size < 3) {
    const agents = ensureNetworkAgents();
    for (const agent of agents) {
      const id = normalizeLower(agent?.id);
      if (id && !agentWalletOverrides.has(id)) {
        const wallet = normalizeText(agent?.wallet || agent?.aaWallet || agent?.aaAddress || '').toLowerCase();
        if (wallet && wallet !== '0x') agentWalletOverrides.set(id, wallet);
      }
    }
  }

  const providerDefaults = new Map();
  const seededCapabilityIds = new Set(REAL_AGENT_CAPABILITY_SEEDS.map((seed) => normalizeLower(seed.capabilityId)));
  const seededProviderIds = new Set(
    REAL_AGENT_CAPABILITY_SEEDS.flatMap((seed) => [normalizeLower(seed.providerAgentId), normalizeLower(seed.providerKey)]).filter(Boolean)
  );
  rows.forEach((item) => {
    const providerIds = [normalizeText(item?.providerAgentId), normalizeText(item?.providerKey)].filter(Boolean);
    if (providerIds.length === 0) return;
    const defaults = {
      recipient: normalizeText(item?.recipient),
      tokenAddress: normalizeText(item?.tokenAddress),
      source: normalizeText(item?.source || ''),
      sourceRequested: normalizeText(item?.sourceRequested || item?.source || ''),
      pair: normalizeText(item?.pair || '')
    };
    providerIds.forEach((providerId) => {
      if (!providerDefaults.has(providerId)) {
        providerDefaults.set(providerId, defaults);
      }
    });
  });

  let rowsChanged = false;
  const filteredRows = rows.filter((item) => {
    const id = normalizeLower(item?.id);
    const providerId = normalizeLower(item?.providerAgentId || item?.providerKey);
    const publishedBy = normalizeLower(item?.publishedBy || '');
    if (!id || !seededProviderIds.has(providerId)) return true;
    if (publishedBy !== 'system') return true;
    if (!id.startsWith('cap-')) return true;
    return seededCapabilityIds.has(id);
  });
  if (filteredRows.length !== rows.length) {
    rows.length = 0;
    rows.push(...filteredRows);
    rowsChanged = true;
  }
  for (const seed of REAL_AGENT_CAPABILITY_SEEDS) {
    const existingIndex = rows.findIndex((item) => normalizeText(item?.id) === seed.capabilityId);
    const existing = existingIndex >= 0 ? rows[existingIndex] : null;
    const defaults = providerDefaults.get(seed.providerAgentId) || providerDefaults.get(seed.providerKey) || {};
    const nextRecord = {
      id: seed.capabilityId,
      name: seed.name,
      description: seed.description,
      action: seed.action,
      pair: normalizeText(defaults.pair || ''),
      source: normalizeText(defaults.source || 'auto'),
      sourceRequested: normalizeText(defaults.sourceRequested || defaults.source || 'auto'),
      horizonMin: null,
      resourceUrl: '',
      maxChars: null,
      providerAgentId: seed.providerAgentId,
      providerKey: seed.providerKey,
      recipient: normalizeText(
        agentWalletOverrides.get(normalizeLower(seed.providerAgentId)) ||
        agentWalletOverrides.get(normalizeLower(seed.providerKey)) ||
        defaults.recipient || ''
      ),
      tokenAddress: normalizeText(defaults.tokenAddress || ''),
      price: normalizeText(seed.pricing?.amount),
      pricing: seed.pricing,
      tags: Array.isArray(seed.tags) ? seed.tags : [],
      slaMs: 15000,
      rateLimitPerMinute: 12,
      budgetPerDay: 0,
      allowlistPayers: [],
      exampleInput: seed.exampleInput,
      inputSchema: seed.inputSchema,
      outputSchema: seed.outputSchema,
      active: true,
      createdAt: normalizeText(existing?.createdAt || now),
      updatedAt: now,
      publishedBy: 'system'
    };
    if (existing) {
      const reconciled = {
        ...existing,
        ...nextRecord,
        createdAt: normalizeText(existing?.createdAt || now)
      };
      const changed =
        normalizeLower(existing?.providerAgentId) !== normalizeLower(reconciled?.providerAgentId) ||
        normalizeLower(existing?.providerKey) !== normalizeLower(reconciled?.providerKey) ||
        normalizeLower(existing?.action) !== normalizeLower(reconciled?.action) ||
        normalizeText(existing?.price) !== normalizeText(reconciled?.price) ||
        JSON.stringify(existing?.pricing || null) !== JSON.stringify(reconciled?.pricing || null) ||
        JSON.stringify(existing?.tags || []) !== JSON.stringify(reconciled?.tags || []) ||
        JSON.stringify(existing?.inputSchema || {}) !== JSON.stringify(reconciled?.inputSchema || {}) ||
        JSON.stringify(existing?.outputSchema || {}) !== JSON.stringify(reconciled?.outputSchema || {});
      rows[existingIndex] = reconciled;
      if (changed) rowsChanged = true;
    } else {
      rows.unshift(nextRecord);
      rowsChanged = true;
    }
  }

  if (rowsChanged) {
    writePublishedServices(rows);
  }

  const providers = ensureNetworkAgents().map((item) => ({ ...item }));
  let providersChanged = false;
  const providerCapabilityMap = new Map();
  const publishedActionsByProvider = new Map();
  rows.forEach((item) => {
    const providerIds = [normalizeLower(item?.providerAgentId), normalizeLower(item?.providerKey)].filter(Boolean);
    const action = normalizeLower(item?.action);
    if (!action) return;
    providerIds.forEach((providerId) => {
      if (!publishedActionsByProvider.has(providerId)) publishedActionsByProvider.set(providerId, new Set());
      publishedActionsByProvider.get(providerId).add(action);
    });
  });
  for (const seed of REAL_AGENT_CAPABILITY_SEEDS) {
    const providerId = normalizeLower(seed.providerAgentId);
    if (!providerId) continue;
    if (!providerCapabilityMap.has(providerId)) providerCapabilityMap.set(providerId, new Set());
    providerCapabilityMap.get(providerId).add(normalizeLower(seed.action));
  }
  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex];
    const providerId = normalizeLower(provider?.id);
    const seededActions = providerCapabilityMap.get(providerId);
    const publishedActions = publishedActionsByProvider.get(providerId);
    const existingCapabilities = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
    const nextCapabilities = existingCapabilities.filter((item) => {
      const action = normalizeLower(item);
      if (!action) return false;
      if (!publishedActions) return true;
      return publishedActions.has(action);
    });
    const nextCapabilitySet = new Set(nextCapabilities.map((item) => normalizeLower(item)));
    if (seededActions) {
      for (const action of seededActions) {
        if (!nextCapabilitySet.has(action)) {
          nextCapabilities.push(action);
          nextCapabilitySet.add(action);
        }
      }
    }
    const changed = JSON.stringify(existingCapabilities) !== JSON.stringify(nextCapabilities);
    if (!changed) continue;
    providers[providerIndex] = {
      ...provider,
      capabilities: nextCapabilities,
      updatedAt: new Date().toISOString()
    };
    providersChanged = true;
  }
  if (providersChanged) {
    writeNetworkAgents(providers);
  }

  return rows;
}

export function registerCapabilitiesV1Routes(app, deps) {
  const {
    ensureNetworkAgents,
    ensureServiceCatalog,
    requireRole,
    sanitizeServiceRecord,
    writeNetworkAgents,
    writePublishedServices,
    normalizeText,
    normalizeLower,
    normalizeBool,
    clampLimit,
    sendV1Success,
    sendV1Error,
    providerIsIdentityVerified,
    providerIsDiscoverable,
    buildProviderDiscoveryScore,
    ensureCapabilityPublishPolicy,
    buildCapabilityView
  } = createPlatformV1Shared(deps);

  function buildCapabilityResponse(service = {}, provider = null) {
    const capability = buildCapabilityView(service, provider);
    return {
      ...capability,
      pricing: {
        ...capability.pricing,
        model: normalizeText(service?.pricing?.model || 'per_call'),
        currency: normalizeText(service?.pricing?.currency || 'USDC')
      },
      tags: Array.isArray(service?.tags) ? service.tags : [],
      inputSchema:
        service?.inputSchema && typeof service.inputSchema === 'object' && !Array.isArray(service.inputSchema)
          ? service.inputSchema
          : {},
      outputSchema:
        service?.outputSchema && typeof service.outputSchema === 'object' && !Array.isArray(service.outputSchema)
          ? service.outputSchema
          : {},
      providerKey: normalizeText(service?.providerKey || '')
    };
  }

  function ensureSeededRealAgentCapabilities() {
    return seedRealAgentCapabilities({
      ensureServiceCatalog,
      ensureNetworkAgents,
      writePublishedServices,
      writeNetworkAgents,
      normalizeText,
      normalizeLower
    });
  }

  app.get('/api/v1/capabilities', requireRole('viewer'), (req, res) => {
    const catalog = ensureSeededRealAgentCapabilities();
    const providerId = normalizeLower(req.query.provider);
    const action = normalizeLower(req.query.action);
    const lane = normalizeLower(req.query.lane);
    const providerVerifiedFilter = normalizeText(req.query.providerVerified);
    const providerDiscoverableFilter = normalizeText(req.query.providerDiscoverable);
    const activeFilter = normalizeText(req.query.active);
    const query = normalizeText(req.query.q);
    const limit = clampLimit(req.query.limit, 100);
    const providers = ensureNetworkAgents().map((item) => ({ ...item }));
    const items = catalog
      .filter((service) => {
        if (providerId && normalizeLower(service?.providerAgentId) !== providerId) return false;
        if (action && normalizeLower(service?.action) !== action) return false;
        if (lane) {
          const laneType = normalizeLower(service?.action) === 'hyperliquid-order-testnet' ? 'job-or-buy' : 'buy';
          if (laneType !== lane) return false;
        }
        if (activeFilter) {
          const expected = normalizeBool(activeFilter, true);
          if ((service?.active !== false) !== expected) return false;
        }
        const linkedProvider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId));
        if (providerVerifiedFilter) {
          const expected = normalizeBool(providerVerifiedFilter, true);
          if (providerIsIdentityVerified(linkedProvider) !== expected) return false;
        }
        if (providerDiscoverableFilter) {
          const expected = normalizeBool(providerDiscoverableFilter, true);
          if (providerIsDiscoverable(linkedProvider) !== expected) return false;
        }
        if (query) {
          const haystack = [
            service?.id,
            service?.action,
            service?.name,
            service?.description,
            service?.providerAgentId,
            ...(Array.isArray(service?.tags) ? service.tags : [])
          ]
            .map((item) => normalizeLower(item))
            .filter(Boolean)
            .join(' ');
          if (!haystack.includes(normalizeLower(query))) return false;
        }
        return true;
      })
      .sort((left, right) => {
        const rightProvider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(right?.providerAgentId));
        const leftProvider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(left?.providerAgentId));
        const discoveryDelta = buildProviderDiscoveryScore(rightProvider) - buildProviderDiscoveryScore(leftProvider);
        if (discoveryDelta !== 0) return discoveryDelta;
        return Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0);
      })
      .slice(0, limit)
      .map((service) => {
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        return buildCapabilityResponse(service, provider);
      });
    return sendV1Success(res, req, {
      total: items.length,
      items
    });
  });

  app.post('/api/v1/capabilities', requireRole('admin'), (req, res) => {
    try {
      const body = req.body || {};
      const rows = ensureServiceCatalog().map((item) => ({ ...item }));
      const capabilityId = normalizeText(body.capabilityId || body.id || '');
      const existingIndex = capabilityId ? rows.findIndex((item) => normalizeText(item?.id) === capabilityId) : -1;
      const existing = existingIndex >= 0 ? rows[existingIndex] : null;
      const providerId = normalizeLower(body.providerId || body.providerAgentId || existing?.providerAgentId || '');
      const providers = ensureNetworkAgents().map((item) => ({ ...item }));
      ensureCapabilityPublishPolicy(
        {
          ...body,
          capabilityId,
          providerId
        },
        existing,
        providers
      );
      const record = sanitizeServiceRecord(
        {
          ...body,
          id: capabilityId || body.id || body.capabilityId || '',
          providerAgentId: providerId || body.providerAgentId || '',
          publishedBy: req.authRole || 'admin'
        },
        existing
      );
      if (existingIndex >= 0) rows[existingIndex] = record;
      else rows.unshift(record);
      writePublishedServices(rows);

      if (providerId) {
        const providerIndex = providers.findIndex((item) => normalizeLower(item?.id) === providerId);
        if (providerIndex >= 0) {
          const provider = providers[providerIndex];
          const capabilities = Array.isArray(provider?.capabilities) ? [...provider.capabilities] : [];
          const actionName = normalizeLower(record?.action);
          if (actionName && !capabilities.map((item) => normalizeLower(item)).includes(actionName)) {
            providers[providerIndex] = {
              ...provider,
              capabilities: [...capabilities, actionName],
              updatedAt: new Date().toISOString()
            };
            writeNetworkAgents(providers);
          }
        }
      }

      return sendV1Success(res, req, {
        mode: existing ? 'updated' : 'created',
        capability: buildCapabilityView(record)
      });
    } catch (error) {
      return sendV1Error(res, req, 400, 'invalid_capability', error?.message || 'invalid capability payload');
    }
  });

  app.get('/api/v1/capabilities/:capabilityId', requireRole('viewer'), (req, res) => {
    const catalog = ensureSeededRealAgentCapabilities();
    const capabilityId = normalizeText(req.params.capabilityId);
    const capability = catalog.find((item) => normalizeText(item?.id) === capabilityId) || null;
    if (!capability) {
      return sendV1Error(res, req, 404, 'capability_not_found', `Capability ${capabilityId} was not found.`, {
        capabilityId
      });
    }
    const provider = ensureNetworkAgents().find((item) => normalizeLower(item?.id) === normalizeLower(capability?.providerAgentId)) || null;
    return sendV1Success(res, req, {
      capability: buildCapabilityResponse(capability, provider)
    });
  });
}
