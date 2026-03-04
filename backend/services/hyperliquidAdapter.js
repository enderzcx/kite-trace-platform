import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import { SymbolConverter, formatPrice, formatSize } from '@nktkas/hyperliquid/utils';
import { ethers } from 'ethers';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeAddress(address = '') {
  const raw = normalizeText(address);
  if (!raw) return '';
  try {
    return ethers.getAddress(raw);
  } catch {
    return '';
  }
}

function normalizePrivateKey(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  const prefixed = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(prefixed) ? prefixed : '';
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePerpCoin(symbol = 'BTCUSDT') {
  const upper = normalizeText(symbol).toUpperCase().replace(/[-_\s/]/g, '');
  if (!upper) return 'BTC';
  if (upper.endsWith('USDT')) return upper.slice(0, -4) || 'BTC';
  if (upper.endsWith('USDC')) return upper.slice(0, -4) || 'BTC';
  if (upper.endsWith('USD')) return upper.slice(0, -3) || 'BTC';
  return upper;
}

function normalizeOrderSide(value = '') {
  const raw = normalizeText(value).toLowerCase();
  if (['buy', 'long', 'b', 'bid'].includes(raw)) return 'buy';
  if (['sell', 'short', 's', 'ask'].includes(raw)) return 'sell';
  return '';
}

function normalizeOrderType(value = '') {
  const raw = normalizeText(value).toLowerCase();
  if (['market', 'mkt'].includes(raw)) return 'market';
  return 'limit';
}

function normalizeCandleInterval(value = '') {
  const raw = normalizeText(value).toLowerCase();
  const supported = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1m']);
  if (supported.has(raw)) return raw;
  return '1m';
}

function intervalToMs(interval = '1m') {
  const map = {
    '1m': 60_000,
    '3m': 3 * 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '30m': 30 * 60_000,
    '1h': 60 * 60_000,
    '2h': 2 * 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '8h': 8 * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
    '3d': 3 * 24 * 60 * 60_000,
    '1w': 7 * 24 * 60 * 60_000
  };
  return map[interval] || 60_000;
}

function normalizeTif(value = '', orderType = 'limit') {
  const raw = normalizeText(value).toLowerCase();
  if (raw === 'ioc') return 'Ioc';
  if (raw === 'alo') return 'Alo';
  if (raw === 'frontmarket' || raw === 'frontendmarket') return 'FrontendMarket';
  if (raw === 'liqmarket' || raw === 'liquidationmarket') return 'LiquidationMarket';
  if (orderType === 'market') return 'Ioc';
  return 'Gtc';
}

function buildAdapterError(error) {
  const reason = normalizeText(error?.message || 'hyperliquid request failed');
  const response = error?.response && typeof error.response === 'object' && !Array.isArray(error.response)
    ? error.response
    : null;
  return {
    error: normalizeText(error?.name || 'hyperliquid_error').toLowerCase() || 'hyperliquid_error',
    reason,
    response
  };
}

export function createHyperliquidAdapter(config = {}) {
  const enabled = Boolean(config.enabled);
  const isTestnet = config.isTestnet !== false;
  const apiUrl = normalizeText(config.apiUrl);
  const timeoutMs = Math.max(2000, Math.min(Number(config.timeoutMs || 12_000), 120_000));
  const slippageBpsDefault = clampNumber(config.defaultMarketSlippageBps, 1, 1000, 30);
  const privateKey = normalizePrivateKey(config.privateKey);
  const configuredAccountAddress = normalizeAddress(config.accountAddress);
  const converterTtlMs = Math.max(10_000, Math.min(Number(config.converterTtlMs || 120_000), 900_000));

  let symbolConverter = null;
  let symbolConverterAt = 0;

  function buildTransport() {
    const options = {
      isTestnet,
      timeout: timeoutMs
    };
    if (apiUrl) options.apiUrl = apiUrl;
    return new HttpTransport(options);
  }

  async function getSymbolConverter(transport, forceReload = false) {
    const stale = Date.now() - symbolConverterAt > converterTtlMs;
    if (!symbolConverter || forceReload || stale) {
      symbolConverter = await SymbolConverter.create({ transport });
      symbolConverterAt = Date.now();
    }
    return symbolConverter;
  }

  async function getContext({ requireTrading = false, forceReloadMeta = false } = {}) {
    if (!enabled) {
      return { ok: false, error: 'hyperliquid_disabled', reason: 'Hyperliquid adapter disabled by config.' };
    }
    const transport = buildTransport();
    const info = new InfoClient({ transport });
    const wallet = privateKey ? new ethers.Wallet(privateKey) : null;
    const walletAddress = wallet ? normalizeAddress(wallet.address) : '';
    const accountAddress = configuredAccountAddress || walletAddress;
    if (requireTrading && !wallet) {
      return { ok: false, error: 'hyperliquid_private_key_missing', reason: 'Missing testnet private key for trading.' };
    }
    if (requireTrading && !accountAddress) {
      return { ok: false, error: 'hyperliquid_account_missing', reason: 'Missing account address for testnet trading.' };
    }
    const exchange = wallet ? new ExchangeClient({ transport, wallet }) : null;
    const converter = await getSymbolConverter(transport, forceReloadMeta);
    return {
      ok: true,
      transport,
      info,
      exchange,
      converter,
      walletAddress,
      accountAddress
    };
  }

  async function health() {
    try {
      const ctx = await getContext({ requireTrading: false });
      if (!ctx.ok) return { ok: false, connected: false, ...ctx };
      const mids = await ctx.info.allMids();
      const btcMid = Number(mids?.BTC ?? NaN);
      return {
        ok: true,
        connected: Number.isFinite(btcMid) && btcMid > 0,
        mode: isTestnet ? 'testnet' : 'mainnet',
        walletAddress: ctx.walletAddress,
        accountAddress: ctx.accountAddress,
        btcMid: Number.isFinite(btcMid) ? btcMid : null,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      const fail = buildAdapterError(error);
      return {
        ok: false,
        connected: false,
        ...fail,
        checkedAt: new Date().toISOString()
      };
    }
  }

  async function allMids() {
    const ctx = await getContext({ requireTrading: false });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    return ctx.info.allMids();
  }

  async function candleSnapshot(params = {}) {
    const ctx = await getContext({ requireTrading: false });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    const coin = normalizePerpCoin(params.symbol || params.coin || 'BTCUSDT');
    const interval = normalizeCandleInterval(params.interval || '1m');
    const limit = Math.max(20, Math.min(Number(params.limit || 200), 1000));
    const intervalMs = intervalToMs(interval);
    const endTime = Number.isFinite(Number(params.endTime))
      ? Math.max(0, Math.round(Number(params.endTime)))
      : Date.now();
    const startTime = Number.isFinite(Number(params.startTime))
      ? Math.max(0, Math.round(Number(params.startTime)))
      : Math.max(0, endTime - intervalMs * (limit + 2));

    const rows = await ctx.info.candleSnapshot({
      coin,
      interval,
      startTime,
      endTime
    });
    const items = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        time: Math.max(0, Math.floor(Number(row?.t || 0) / 1000)),
        open: Number(row?.o),
        high: Number(row?.h),
        low: Number(row?.l),
        close: Number(row?.c),
        volume: Number(row?.v)
      }))
      .filter(
        (row) =>
          Number.isFinite(row.time) &&
          row.time > 0 &&
          Number.isFinite(row.open) &&
          Number.isFinite(row.high) &&
          Number.isFinite(row.low) &&
          Number.isFinite(row.close)
      )
      .sort((a, b) => a.time - b.time)
      .slice(-limit);

    return {
      coin,
      interval,
      startTime,
      endTime,
      total: items.length,
      items
    };
  }

  async function clearinghouseState(params = {}) {
    const ctx = await getContext({ requireTrading: false });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    const user = normalizeAddress(params.user || ctx.accountAddress || '');
    if (!user) throw new Error('clearinghouse-state requires a valid user address.');
    const dex = normalizeText(params.dex || '');
    const snapshot = await ctx.info.clearinghouseState({
      user,
      ...(dex ? { dex } : {})
    });
    return {
      user,
      dex,
      snapshot
    };
  }

  async function positions(params = {}) {
    const symbolFilter = normalizePerpCoin(params.symbol || 'BTCUSDT');
    const scope = normalizeText(params.scope || 'btc').toLowerCase();
    const includeAll = scope === 'all';
    const state = await clearinghouseState(params);
    const snapshot = state?.snapshot && typeof state.snapshot === 'object' ? state.snapshot : {};
    const rawItems = Array.isArray(snapshot?.assetPositions) ? snapshot.assetPositions : [];
    const items = rawItems
      .map((row) => {
        const position = row?.position && typeof row.position === 'object' ? row.position : {};
        const coin = normalizePerpCoin(position?.coin || '');
        const szi = Number(position?.szi ?? NaN);
        const side = Number.isFinite(szi) ? (szi > 0 ? 'long' : szi < 0 ? 'short' : 'flat') : 'flat';
        const size = Number.isFinite(szi) ? Math.abs(Number(szi)) : 0;
        const leverageRaw =
          position?.leverage && typeof position.leverage === 'object'
            ? Number(position.leverage.value ?? NaN)
            : Number.NaN;
        return {
          symbol: `${coin}USDT`,
          coin,
          side,
          size,
          signedSize: Number.isFinite(szi) ? Number(szi) : 0,
          entryPrice: toNumberOrNull(position?.entryPx),
          markPrice: null,
          positionValue: toNumberOrNull(position?.positionValue),
          unrealizedPnl: toNumberOrNull(position?.unrealizedPnl),
          returnOnEquity: toNumberOrNull(position?.returnOnEquity),
          marginUsed: toNumberOrNull(position?.marginUsed),
          liquidationPrice: toNumberOrNull(position?.liquidationPx),
          leverage: Number.isFinite(leverageRaw) ? leverageRaw : null,
          leverageType:
            position?.leverage && typeof position.leverage === 'object'
              ? normalizeText(position.leverage.type || '')
              : '',
          raw: row
        };
      })
      .filter((row) => {
        if (includeAll) return true;
        return row.coin === symbolFilter;
      })
      .sort((a, b) => Math.abs(b.signedSize) - Math.abs(a.signedSize));

    return {
      user: state.user,
      dex: state.dex,
      scope: includeAll ? 'all' : 'btc',
      account: {
        accountValue: toNumberOrNull(snapshot?.marginSummary?.accountValue),
        totalNtlPos: toNumberOrNull(snapshot?.marginSummary?.totalNtlPos),
        totalMarginUsed: toNumberOrNull(snapshot?.marginSummary?.totalMarginUsed),
        withdrawable: toNumberOrNull(snapshot?.withdrawable),
        crossMaintenanceMarginUsed: toNumberOrNull(snapshot?.crossMaintenanceMarginUsed),
        time: Number.isFinite(Number(snapshot?.time)) ? Number(snapshot.time) : null
      },
      total: items.length,
      items
    };
  }

  async function openOrders(params = {}) {
    const ctx = await getContext({ requireTrading: false });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    const user = normalizeAddress(params.user || ctx.accountAddress || '');
    if (!user) throw new Error('open-orders requires a valid user address.');
    const symbolFilter = normalizePerpCoin(params.symbol || '');
    const rows = await ctx.info.openOrders({ user });
    const items = Array.isArray(rows) ? rows : [];
    const filtered = symbolFilter
      ? items.filter((item) => normalizePerpCoin(item?.coin || '') === symbolFilter)
      : items;
    return {
      user,
      total: filtered.length,
      items: filtered
    };
  }

  async function orderStatus(params = {}) {
    const ctx = await getContext({ requireTrading: false });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    const user = normalizeAddress(params.user || ctx.accountAddress || '');
    if (!user) throw new Error('order-status requires a valid user address.');
    const oidRaw = params.oid ?? params.orderId ?? params.cloid ?? '';
    const oidText = normalizeText(oidRaw);
    if (!oidText) throw new Error('order-status requires oid/orderId/cloid.');
    const oid = /^0x/i.test(oidText) ? oidText : Number(oidText);
    if (typeof oid === 'number' && !Number.isFinite(oid)) {
      throw new Error('order-status oid must be a positive integer or cloid.');
    }
    const status = await ctx.info.orderStatus({ user, oid });
    return { user, oid, status };
  }

  async function placePerpOrder(params = {}) {
    const ctx = await getContext({ requireTrading: true, forceReloadMeta: Boolean(params.reloadMeta) });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    if (!ctx.exchange) throw new Error('hyperliquid exchange client unavailable.');

    const symbol = normalizePerpCoin(params.symbol || params.coin || 'BTCUSDT');
    const assetId = ctx.converter.getAssetId(symbol);
    if (!Number.isInteger(assetId)) {
      throw new Error(`unsupported_symbol: ${symbol}`);
    }
    const szDecimals = ctx.converter.getSzDecimals(symbol);
    if (!Number.isInteger(szDecimals)) {
      throw new Error(`symbol_sz_decimals_missing: ${symbol}`);
    }

    const side = normalizeOrderSide(params.side);
    if (!side) throw new Error('side must be buy/sell.');
    const isBuy = side === 'buy';
    const orderType = normalizeOrderType(params.orderType || params.type || 'limit');
    const tif = normalizeTif(params.tif || '', orderType);

    const sizeNumeric = Number(params.size ?? params.sz ?? NaN);
    if (!Number.isFinite(sizeNumeric) || sizeNumeric <= 0) {
      throw new Error('size must be a positive number.');
    }
    const size = formatSize(sizeNumeric.toString(), szDecimals);

    let referenceMid = null;
    let priceValue = Number(params.price ?? NaN);
    if (orderType === 'market') {
      const mids = await ctx.info.allMids();
      const mid = Number(mids?.[symbol] ?? NaN);
      if (!Number.isFinite(mid) || mid <= 0) {
        throw new Error(`market_mid_unavailable: ${symbol}`);
      }
      referenceMid = Number(mid.toFixed(8));
      const slippageBps = clampNumber(
        params.slippageBps ?? params.marketSlippageBps,
        1,
        1500,
        slippageBpsDefault
      );
      const adjust = isBuy ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
      priceValue = mid * adjust;
    }
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      throw new Error('price must be a positive number for limit orders.');
    }
    const price = formatPrice(priceValue.toString(), szDecimals, 'perp');
    const reduceOnly = Boolean(params.reduceOnly === true || params.reduceOnly === 'true');

    const payload = {
      a: assetId,
      b: isBuy,
      p: price,
      s: size,
      r: reduceOnly,
      t: { limit: { tif } }
    };

    const cloid = normalizeText(params.cloid || params.clientOrderId || '');
    if (/^0x[0-9a-fA-F]{32}$/.test(cloid)) {
      payload.c = cloid.toLowerCase();
    }

    const simulate = Boolean(params.simulate === true || params.dryRun === true);
    if (simulate) {
      return {
        ok: true,
        simulated: true,
        mode: isTestnet ? 'testnet' : 'mainnet',
        accountAddress: ctx.accountAddress,
        walletAddress: ctx.walletAddress,
        symbol,
        side,
        orderType,
        tif,
        referenceMid,
        payload
      };
    }

    const result = await ctx.exchange.order({
      orders: [payload],
      grouping: 'na'
    });

    return {
      ok: true,
      simulated: false,
      mode: isTestnet ? 'testnet' : 'mainnet',
      accountAddress: ctx.accountAddress,
      walletAddress: ctx.walletAddress,
      symbol,
      side,
      orderType,
      tif,
      referenceMid,
      payload,
      response: result
    };
  }

  async function cancelPerpOrders(params = {}) {
    const ctx = await getContext({ requireTrading: true, forceReloadMeta: Boolean(params.reloadMeta) });
    if (!ctx.ok) throw new Error(ctx.reason || ctx.error || 'hyperliquid not ready');
    if (!ctx.exchange) throw new Error('hyperliquid exchange client unavailable.');

    const symbol = normalizePerpCoin(params.symbol || params.coin || 'BTCUSDT');
    const assetId = ctx.converter.getAssetId(symbol);
    if (!Number.isInteger(assetId)) {
      throw new Error(`unsupported_symbol: ${symbol}`);
    }
    const oidsRaw = Array.isArray(params.oids)
      ? params.oids
      : params.oid !== undefined
        ? [params.oid]
        : params.orderId !== undefined
          ? [params.orderId]
          : [];
    const oids = oidsRaw
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => Math.round(item));
    if (oids.length === 0) {
      throw new Error('cancel requires oid/orderId/oids.');
    }

    const cancels = oids.map((oid) => ({ a: assetId, o: oid }));
    const simulate = Boolean(params.simulate === true || params.dryRun === true);
    if (simulate) {
      return {
        ok: true,
        simulated: true,
        mode: isTestnet ? 'testnet' : 'mainnet',
        symbol,
        accountAddress: ctx.accountAddress,
        cancels
      };
    }
    const result = await ctx.exchange.cancel({ cancels });
    return {
      ok: true,
      simulated: false,
      mode: isTestnet ? 'testnet' : 'mainnet',
      symbol,
      accountAddress: ctx.accountAddress,
      cancels,
      response: result
    };
  }

  function info() {
    const walletAddress = privateKey ? normalizeAddress(new ethers.Wallet(privateKey).address) : '';
    return {
      enabled,
      isTestnet,
      apiUrl: apiUrl || 'https://api.hyperliquid-testnet.xyz',
      timeoutMs,
      configured: Boolean(privateKey),
      walletAddress,
      accountAddress: configuredAccountAddress || walletAddress,
      slippageBpsDefault
    };
  }

  return {
    info,
    health,
    allMids,
    candleSnapshot,
    clearinghouseState,
    positions,
    openOrders,
    orderStatus,
    placePerpOrder,
    cancelPerpOrders,
    buildAdapterError
  };
}
