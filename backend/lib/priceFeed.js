export function normalizeBtcPriceParams(input = {}) {
  const rawPair = String(input.pair || 'BTCUSDT').trim().toUpperCase();
  const rawSource = String(input.source || 'hyperliquid').trim().toLowerCase();
  const compactPair = rawPair.replace(/[-_\s]/g, '');

  const symbolBase = compactPair.startsWith('ETH') ? 'ETH' : compactPair.startsWith('BTC') ? 'BTC' : '';
  if (!symbolBase) {
    throw new Error('Price task requires pair BTC/ETH (BTCUSDT/BTCUSD/ETHUSDT/ETHUSD).');
  }
  if (!['hyperliquid', 'auto', 'binance', 'okx', 'coingecko'].includes(rawSource)) {
    throw new Error('BTC price task source must be one of hyperliquid/auto/binance/okx/coingecko.');
  }

  const normalizedPair = `${symbolBase}USDT`;
  let providers = ['hyperliquid', 'binance', 'okx'];
  if (rawSource === 'binance') providers = ['binance', 'hyperliquid', 'okx'];
  else if (rawSource === 'okx') providers = ['okx', 'hyperliquid', 'binance'];
  else if (rawSource === 'coingecko') providers = ['binance', 'okx', 'hyperliquid'];

  return {
    pair: normalizedPair,
    source: 'hyperliquid',
    sourceRequested: rawSource,
    providers
  };
}

export async function fetchJsonWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = String(options?.method || 'GET').trim().toUpperCase() || 'GET';
    const headers = options?.headers || {};
    const reqInit = {
      method,
      headers,
      signal: controller.signal
    };
    if (options?.body !== undefined) {
      reqInit.body = options.body;
    }
    const resp = await fetch(url, reqInit);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBtcFromHyperliquid(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout('https://api.hyperliquid.xyz/info', 8000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' })
  });
  const normalizedPair = String(pair || 'BTCUSDT').trim().toUpperCase().replace(/[-_\s]/g, '');
  const symbolBase = normalizedPair.startsWith('ETH') ? 'ETH' : 'BTC';
  const price = Number(body?.[symbolBase]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

export async function fetchBtcFromBinance(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, 8000);
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

export async function fetchBtcFromOkx(pair = 'BTCUSDT') {
  const normalizedPair = String(pair || 'BTCUSDT').trim().toUpperCase().replace(/[-_\s]/g, '');
  const symbolBase = normalizedPair.startsWith('ETH') ? 'ETH' : 'BTC';
  const instId = `${symbolBase}-USDT`;
  const body = await fetchJsonWithTimeout(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, 8000);
  const price = Number(body?.data?.[0]?.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

export async function fetchBtcPriceQuote(params = {}) {
  const { pair, sourceRequested, providers } = normalizeBtcPriceParams(params);
  const failures = [];
  const attemptedProviders = [];

  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      let price = NaN;
      if (provider === 'hyperliquid') {
        price = await fetchBtcFromHyperliquid(pair);
      } else if (provider === 'binance') {
        price = await fetchBtcFromBinance(pair);
      } else if (provider === 'okx') {
        price = await fetchBtcFromOkx(pair);
      }

      if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
      return {
        provider,
        pair,
        priceUsd: Number(price.toFixed(6)),
        fetchedAt: new Date().toISOString(),
        sourceRequested,
        attemptedProviders
      };
    } catch (error) {
      failures.push(`${provider}:${error?.message || 'failed'}`);
    }
  }

  throw new Error(`price_source_unavailable (${failures.join(', ') || 'no provider'})`);
}

export async function fetchBinanceTicker24h(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, 8000);
  const lastPrice = Number(body?.lastPrice);
  const changePct = Number(body?.priceChangePercent);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) throw new Error('invalid lastPrice');
  return {
    provider: 'binance',
    pair,
    lastPrice,
    changePct: Number.isFinite(changePct) ? changePct : null,
    highPrice: Number(body?.highPrice),
    lowPrice: Number(body?.lowPrice),
    volume: Number(body?.volume),
    quoteVolume: Number(body?.quoteVolume)
  };
}

export async function fetchCoinGeckoBtcSnapshot() {
  const body = await fetchJsonWithTimeout(
    'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false',
    8000
  );
  const market = body?.market_data && typeof body.market_data === 'object' ? body.market_data : {};
  const currentUsd = Number(market?.current_price?.usd);
  const change24h = Number(market?.price_change_percentage_24h);
  if (!Number.isFinite(currentUsd) || currentUsd <= 0) throw new Error('invalid coingecko current_price.usd');
  return {
    provider: 'coingecko',
    currentUsd,
    change24h: Number.isFinite(change24h) ? change24h : null,
    marketCapUsd: Number(market?.market_cap?.usd),
    totalVolumeUsd: Number(market?.total_volume?.usd),
    updatedAt: String(body?.last_updated || '').trim()
  };
}
