import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const API_BASE = 'https://ai.6551.io';
const DEFAULT_TIMEOUT_MS = 8000;
const ONCHAINOS_TIMEOUT_MS = 20000;
const execFileAsync = promisify(execFile);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function toBoundedInt(value, fallback, min = 1, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
}

function pickNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function clampScore(value, fallback = null) {
  const numeric = pickNumber(value);
  if (numeric === null) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function buildSuccess(data, source, fetchedAt = new Date().toISOString()) {
  return {
    ok: true,
    data,
    source,
    fetchedAt
  };
}

function buildError(error) {
  return {
    ok: false,
    error: normalizeText(error || 'request_failed') || 'request_failed'
  };
}

function compactList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.rows)) return body.rows;
  return [];
}

function parseMaybeJson(value = '') {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toIsoTimestamp(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return null;
    const ms = normalized.length >= 13 ? numeric : numeric * 1000;
    const iso = new Date(ms).toISOString();
    return iso === 'Invalid Date' ? null : iso;
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function pickTimestamp(item = {}) {
  return normalizeText(
    item?.ts ||
      item?.timestamp ||
      item?.time ||
      item?.createdAt ||
      item?.created_at ||
      item?.updatedAt ||
      item?.publishedAt ||
      item?.published_at
  );
}

function pickSourceUrl(item = {}) {
  const value =
    item?.sourceUrl ||
    item?.sourceURL ||
    item?.url ||
    item?.link ||
    item?.explorerUrl ||
    item?.explorerURL ||
    item?.source_link ||
    item?.sourceLink ||
    item?.articleUrl ||
    item?.articleURL ||
    item?.newsUrl ||
    item?.announcementUrl ||
    item?.announcementURL ||
    item?.tweetUrl ||
    item?.txUrl;
  const normalized = normalizeText(value);
  return normalized || null;
}

function pickSourceName(item = {}, fallback = '') {
  const value = normalizeText(
    item?.sourceName ||
      item?.source ||
      item?.publisher ||
      item?.exchange ||
      item?.platform ||
      item?.origin ||
      item?.newsType ||
      item?.userScreenName
  );
  return value || fallback || 'unknown-source';
}

function buildExplorerUrl(txHash = '', fallbackUrl = '') {
  const normalizedFallback = normalizeText(fallbackUrl);
  if (normalizedFallback) return normalizedFallback;
  const normalizedTxHash = normalizeText(txHash);
  if (!normalizedTxHash) return null;
  const baseUrl = normalizeText(process.env.KITE_EXPLORER_URL);
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/+$/, '')}/${normalizedTxHash}`;
}

function withCommonMeta(item = {}, fallbackSourceName = '', fetchedAt = new Date().toISOString()) {
  return {
    sourceUrl: pickSourceUrl(item),
    sourceName: pickSourceName(item, fallbackSourceName),
    publishedAt: toIsoTimestamp(pickTimestamp(item)),
    fetchedAt
  };
}

function withOnchainMeta(item = {}, fallbackSourceName = '', fetchedAt = new Date().toISOString()) {
  const txHash = normalizeText(item?.txHash || item?.hash || item?.transactionHash || item?.transaction_hash);
  const explorerUrl = buildExplorerUrl(txHash, item?.explorerUrl || item?.explorerURL || item?.sourceUrl || item?.link);
  return {
    ...withCommonMeta(
      {
        ...item,
        sourceUrl: pickSourceUrl(item) || explorerUrl
      },
      fallbackSourceName,
      fetchedAt
    ),
    txHash: txHash || null,
    explorerUrl
  };
}

function withTwitterMeta(item = {}, username = '', fallbackSourceName = '', fetchedAt = new Date().toISOString()) {
  const tweetId = normalizeText(item?.tweetId || item?.id || item?.id_str);
  const screenName = normalizeText(username || item?.screen_name || item?.username || item?.userScreenName || item?.userName);
  return {
    ...withCommonMeta(item, fallbackSourceName, fetchedAt),
    tweetId: tweetId || null,
    tweetUrl: tweetId && screenName ? `https://twitter.com/${screenName}/status/${tweetId}` : null,
    profileUrl: screenName ? `https://twitter.com/${screenName}` : null
  };
}

function extractCoinSymbols(item = {}) {
  const directSymbols = [item?.coin, item?.symbol, item?.token, item?.baseCoin].map((value) => normalizeText(value)).filter(Boolean);
  const nestedSymbols = Array.isArray(item?.coins)
    ? item.coins.map((coin) => normalizeText(coin?.symbol || coin?.coin)).filter(Boolean)
    : [];
  return [...new Set([...directSymbols, ...nestedSymbols])];
}

function filterByCoin(item, coin) {
  const normalizedCoin = normalizeLower(coin);
  if (!normalizedCoin) return true;
  const haystack = [
    ...extractCoinSymbols(item),
    normalizeText(item?.title),
    normalizeText(item?.summary),
    normalizeText(item?.description),
    normalizeText(item?.content),
    normalizeText(item?.text)
  ]
    .map((value) => normalizeLower(value))
    .filter(Boolean)
    .join(' ');
  return haystack.includes(normalizedCoin);
}

async function fetchJsonWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = normalizeText(options?.method || 'GET').toUpperCase() || 'GET';
    const headers = {
      ...(options?.headers || {})
    };
    const init = {
      method,
      headers,
      signal: controller.signal
    };
    if (options?.jsonBody !== undefined) {
      init.body = JSON.stringify(options.jsonBody);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else if (options?.body !== undefined) {
      init.body = options.body;
    }
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildTokenHeaders(token) {
  const normalizedToken = normalizeText(token);
  return normalizedToken
    ? {
        Authorization: `Bearer ${normalizedToken}`,
        'x-api-key': normalizedToken
      }
    : {};
}

function buildUrl(pathname, query = {}) {
  const url = new URL(pathname, API_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const normalized = typeof value === 'string' ? normalizeText(value) : value;
    if (normalized === '') continue;
    url.searchParams.set(key, String(normalized));
  }
  return url.toString();
}

async function fetchOpenJson(pathname, { token, method = 'GET', query = {}, body } = {}) {
  return fetchJsonWithTimeout(buildUrl(pathname, query), DEFAULT_TIMEOUT_MS, {
    method,
    headers: buildTokenHeaders(token),
    jsonBody: body
  });
}

function getEnvValue(names = []) {
  for (const name of names) {
    const value = normalizeText(process.env[name]);
    if (value) return value;
  }
  return '';
}

function getOnchainosConfig() {
  const apiKey = getEnvValue(['OKX_API_KEY', 'ONCHAINOS_API_KEY', 'ONCHAINOS_API_Key']);
  const secretKey = getEnvValue(['OKX_SECRET_KEY', 'ONCHAINOS_SECRET_KEY', 'ONCHAINOS_Secret_Key']);
  const passphrase = getEnvValue([
    'OKX_PASSPHRASE',
    'ONCHAINOS_PASSPHRASE',
    'ONCHAINOS_PASSPHRASE_Key',
    'ONCHAINOS_PASSHASE_Key'
  ]);
  return {
    apiKey,
    secretKey,
    passphrase
  };
}

function hasOnchainosConfig() {
  const { apiKey, secretKey, passphrase } = getOnchainosConfig();
  return Boolean(apiKey && secretKey && passphrase);
}

function buildOnchainosEnv() {
  const { apiKey, secretKey, passphrase } = getOnchainosConfig();
  return {
    ...process.env,
    OKX_API_KEY: apiKey,
    OKX_SECRET_KEY: secretKey,
    OKX_PASSPHRASE: passphrase,
    ONCHAINOS_API_KEY: apiKey,
    ONCHAINOS_API_Key: apiKey,
    ONCHAINOS_SECRET_KEY: secretKey,
    ONCHAINOS_Secret_Key: secretKey,
    ONCHAINOS_PASSPHRASE: passphrase,
    ONCHAINOS_PASSPHRASE_Key: passphrase,
    ONCHAINOS_PASSHASE_Key: passphrase
  };
}

async function runOnchainosJson(args = [], timeoutMs = ONCHAINOS_TIMEOUT_MS) {
  const binary = normalizeText(process.env.ONCHAINOS_BIN) || (process.platform === 'win32' ? 'onchainos.exe' : 'onchainos');
  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: buildOnchainosEnv()
    });
    const parsed = parseMaybeJson(stdout);
    if (parsed) return parsed;
    return buildError('invalid_onchainos_response');
  } catch (error) {
    const parsed = parseMaybeJson(error?.stdout || error?.stderr || '');
    if (parsed) return parsed;
    if (error?.code === 'ENOENT') return buildError('onchainos_missing');
    if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT') return buildError('timeout');
    return buildError(error?.message || 'onchainos_failed');
  }
}

function normalizeChain(value = '', fallback = 'ethereum') {
  const normalized = normalizeLower(value);
  if (!normalized) return fallback;
  const chainMap = {
    eth: 'ethereum',
    ethereum: 'ethereum',
    sol: 'solana',
    solana: 'solana',
    bnb: 'bsc',
    bsc: 'bsc',
    arb: 'arbitrum',
    arbitrum: 'arbitrum',
    poly: 'polygon',
    polygon: 'polygon',
    base: 'base',
    xlayer: 'xlayer',
    'x-layer': 'xlayer',
    sui: 'sui'
  };
  return chainMap[normalized] || normalized;
}

function inferDexChain(address = '', fallback = 'ethereum') {
  const normalized = normalizeText(address);
  if (!normalized) return fallback;
  return normalized.startsWith('0x') ? 'ethereum' : 'solana';
}

function inferMemepumpChain(address = '', fallback = 'solana') {
  const normalized = normalizeText(address);
  if (!normalized) return fallback;
  return normalized.startsWith('0x') ? 'bsc' : 'solana';
}

function normalizeBar(interval = '1h') {
  const normalized = normalizeLower(interval);
  const barMap = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1H',
    '4h': '4H',
    '1d': '1D',
    '1w': '1W'
  };
  return barMap[normalized] || '1H';
}

function extractBaseSymbol(value = '') {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) return '';
  const head = normalized.split(/[\\/:_-]/)[0];
  const suffixes = ['USDT', 'USDC', 'USD', 'PERP'];
  for (const suffix of suffixes) {
    if (head.endsWith(suffix) && head.length > suffix.length) {
      return head.slice(0, -suffix.length);
    }
  }
  return head;
}

function buildNewsSearchBody({ limit = 10, coin, engineTypes = {} } = {}) {
  const body = {
    limit: toBoundedInt(limit, 10, 1, 100),
    page: 1
  };
  if (coin) {
    body.coins = [normalizeText(coin).toUpperCase()];
  }
  if (engineTypes && Object.keys(engineTypes).length > 0) {
    body.engineTypes = engineTypes;
  }
  return body;
}

function mapListingRecord(item = {}, fetchedAt = new Date().toISOString()) {
  const coins = extractCoinSymbols(item);
  return {
    exchange: normalizeText(item?.newsType || item?.source || item?.exchange),
    coin: normalizeText(coins[0] || ''),
    listingType: normalizeText(item?.listingType || item?.newsType || 'listing'),
    aiScore: clampScore(item?.aiRating?.score ?? item?.score ?? item?.aiScore),
    signal: normalizeText(item?.aiRating?.signal || item?.signal || ''),
    summary: normalizeText(item?.aiRating?.summary || item?.aiRating?.enSummary || item?.text || item?.description),
    ts: pickTimestamp(item),
    ...withCommonMeta(item, `listing:${normalizeText(item?.newsType || item?.source || 'listing')}`, fetchedAt)
  };
}

function mapWhaleRecord(item = {}, fetchedAt = new Date().toISOString()) {
  const coins = extractCoinSymbols(item);
  return {
    walletAddress: normalizeText(item?.walletAddress || item?.address || item?.wallet),
    action: normalizeText(item?.action || item?.side || item?.direction || item?.newsType || 'whale'),
    amount: pickNumber(item?.amount, item?.size, item?.qty, item?.value),
    coin: normalizeText(coins[0] || ''),
    ts: pickTimestamp(item),
    ...withOnchainMeta(item, `onchain:${normalizeText(item?.newsType || item?.source || 'whale')}`, fetchedAt)
  };
}

function mapNewsRecord(item = {}, fetchedAt = new Date().toISOString()) {
  const coins = extractCoinSymbols(item);
  const aiRating = item?.aiRating || {};
  return {
    title: normalizeText(item?.title || item?.headline || item?.text),
    summary: normalizeText(aiRating?.summary || aiRating?.enSummary || item?.description || item?.text),
    source: normalizeText(item?.newsType || item?.source || 'news'),
    aiScore: clampScore(aiRating?.score ?? item?.score ?? item?.aiScore),
    signal: normalizeText(aiRating?.signal || item?.signal || ''),
    coin: normalizeText(coins[0] || ''),
    ts: pickTimestamp(item),
    ...withCommonMeta(item, `news:${normalizeText(item?.newsType || item?.source || 'news')}`, fetchedAt)
  };
}

function mapMemeRecord(item = {}, fetchedAt = new Date().toISOString()) {
  const coins = extractCoinSymbols(item);
  const aiRating = item?.aiRating || {};
  return {
    coin: normalizeText(coins[0] || ''),
    sentiment: normalizeText(aiRating?.signal || item?.signal || item?.sentiment || 'neutral'),
    trendScore: clampScore(aiRating?.score ?? item?.score ?? item?.trendScore),
    ts: pickTimestamp(item),
    ...withCommonMeta(item, `meme:${normalizeText(item?.newsType || item?.source || 'twitter')}`, fetchedAt)
  };
}

function mapTwitterRecord(item = {}, username = '', fetchedAt = new Date().toISOString(), fallbackSourceName = 'twitter') {
  return {
    id: normalizeText(item?.id || item?.tweetId),
    text: normalizeText(item?.text || item?.full_text),
    createdAt: normalizeText(item?.createdAt || item?.created_at),
    retweetCount: pickNumber(item?.retweetCount, item?.retweet_count) || 0,
    favoriteCount: pickNumber(item?.favoriteCount, item?.favorite_count, item?.likeCount, item?.like_count) || 0,
    ...withTwitterMeta(item, username, fallbackSourceName, fetchedAt)
  };
}

export async function fetchListingAlert({ exchange = 'all', coin, limit = 10 } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const normalizedExchange = normalizeLower(exchange || 'all');
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      body: buildNewsSearchBody({
        limit,
        coin,
        engineTypes:
          normalizedExchange && normalizedExchange !== 'all'
            ? { listing: [normalizedExchange] }
            : { listing: ['binance', 'okx', 'coinbase', 'bybit', 'hyperliquid'] }
      })
    });
    const listings = compactList(response)
      .filter((item) => normalizeLower(item?.engineType) === 'listing')
      .filter((item) => {
        if (normalizedExchange && normalizedExchange !== 'all' && normalizeLower(item?.newsType || item?.source) !== normalizedExchange) {
          return false;
        }
        return filterByCoin(item, coin);
      })
      .slice(0, toBoundedInt(limit, 10, 1, 100))
      .map((item) => mapListingRecord(item, fetchedAt));
    return buildSuccess({ listings }, 'opennews:listing', fetchedAt);
  } catch (error) {
    return buildError(error?.message || 'listing_alert_failed');
  }
}

export async function fetchWhaleAlert({ coin = 'BTC', limit = 10 } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      body: buildNewsSearchBody({
        limit,
        coin,
        engineTypes: { onchain: ['hyperliquid_whale_trade', 'hyperliquid_whale_position'] }
      })
    });
    const events = compactList(response)
      .filter((item) => normalizeLower(item?.engineType) === 'onchain')
      .filter((item) => filterByCoin(item, coin))
      .slice(0, toBoundedInt(limit, 10, 1, 100))
      .map((item) => mapWhaleRecord(item, fetchedAt));
    return buildSuccess({ events }, 'opennews:onchain', fetchedAt);
  } catch (error) {
    return buildError(error?.message || 'whale_alert_failed');
  }
}

export async function fetchNewsSignal({ coin, signal, minScore = 70, limit = 10 } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const normalizedSignal = normalizeLower(signal);
    const minimumScore = Number.isFinite(Number(minScore)) ? Number(minScore) : 70;
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      body: buildNewsSearchBody({
        limit,
        coin,
        engineTypes: { news: ['Bloomberg', 'Reuters', 'Coindesk'] }
      })
    });
    const articles = compactList(response)
      .filter((item) => normalizeLower(item?.engineType) === 'news')
      .filter((item) => {
        if (!filterByCoin(item, coin)) return false;
        const itemSignal = normalizeLower(item?.aiRating?.signal || item?.signal);
        if (normalizedSignal && itemSignal !== normalizedSignal) return false;
        const score = clampScore(item?.aiRating?.score ?? item?.score ?? item?.aiScore);
        if (score !== null && score < minimumScore) return false;
        return true;
      })
      .slice(0, toBoundedInt(limit, 10, 1, 100))
      .map((item) => mapNewsRecord(item, fetchedAt));
    return buildSuccess({ articles }, 'opennews:news', fetchedAt);
  } catch (error) {
    return buildError(error?.message || 'news_signal_failed');
  }
}

export async function fetchMemeSentiment({ limit = 20 } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      body: buildNewsSearchBody({
        limit,
        engineTypes: { meme: ['twitter'] }
      })
    });
    const memes = compactList(response)
      .filter((item) => normalizeLower(item?.engineType) === 'meme')
      .slice(0, toBoundedInt(limit, 20, 1, 100))
      .map((item) => mapMemeRecord(item, fetchedAt));
    return buildSuccess({ memes }, 'opennews:meme', fetchedAt);
  } catch (error) {
    return buildError(error?.message || 'meme_sentiment_failed');
  }
}

export async function fetchKolMonitor({ username, includeDeleted = false, limit = 20 } = {}) {
  const token = normalizeText(process.env.TWITTER_TOKEN);
  const screenName = normalizeText(username);
  if (!token) return buildError('not_configured');
  if (!screenName) return buildError('username_required');

  try {
    const fetchedAt = new Date().toISOString();
    const tweetsResponse = await fetchOpenJson('/open/twitter_user_tweets', {
      token,
      method: 'POST',
      body: {
        username: screenName,
        maxResults: toBoundedInt(limit, 20, 1, 100),
        product: 'Latest',
        includeReplies: false,
        includeRetweets: false
      }
    });
    const tweets = compactList(tweetsResponse)
      .slice(0, toBoundedInt(limit, 20, 1, 100))
      .map((item) => mapTwitterRecord(item, screenName, fetchedAt, 'twitter-tweet'));

    let deletedTweets = [];
    if (includeDeleted) {
      const deletedResponse = await fetchOpenJson('/open/twitter_deleted_tweets', {
        token,
        method: 'POST',
        body: {
          username: screenName,
          maxResults: toBoundedInt(limit, 20, 1, 100)
        }
      });
      deletedTweets = compactList(deletedResponse)
        .slice(0, toBoundedInt(limit, 20, 1, 100))
        .map((item) => mapTwitterRecord(item, screenName, fetchedAt, 'twitter-deleted-tweet'));
    }

    return buildSuccess(
      {
        tweets,
        deletedTweets
      },
      'opentwitter:kol-monitor',
      fetchedAt
    );
  } catch (error) {
    return buildError(error?.message || 'kol_monitor_failed');
  }
}

function scoreTokenCandidate(item = {}, query = '', preferredChain = '') {
  const normalizedQuery = normalizeText(query).toUpperCase();
  const tokenSymbol = normalizeText(item?.tokenSymbol).toUpperCase();
  const tokenName = normalizeText(item?.tokenName).toUpperCase();
  const chainIndex = normalizeText(item?.chainIndex);
  const isCommunityRecognized = Boolean(item?.tagList?.communityRecognized);
  const liquidity = Math.max(0, pickNumber(item?.liquidity) || 0);
  const marketCap = Math.max(0, pickNumber(item?.marketCap) || 0);
  let score = 0;
  if (tokenSymbol === normalizedQuery) score += 80;
  else if (tokenSymbol.includes(normalizedQuery)) score += 60;
  if (tokenName.includes(normalizedQuery)) score += 20;
  if (preferredChain === 'ethereum' && chainIndex === '1') score += 20;
  if (preferredChain === 'solana' && chainIndex === '501') score += 20;
  if (preferredChain === 'bsc' && chainIndex === '56') score += 20;
  if (preferredChain === 'base' && chainIndex === '8453') score += 20;
  if (isCommunityRecognized) score += 80;
  score += Math.min(120, Math.round(Math.log10(liquidity + 1) * 15));
  score += Math.min(80, Math.round(Math.log10(marketCap + 1) * 10));
  return score;
}

async function resolveTokenTarget({ symbol, tokenAddress, chain = 'ethereum' } = {}) {
  const normalizedTokenAddress = normalizeText(tokenAddress);
  const normalizedChain = normalizeChain(chain, inferDexChain(normalizedTokenAddress, 'ethereum'));
  if (normalizedTokenAddress) {
    return {
      ok: true,
      target: {
        address: normalizedTokenAddress,
        chain: normalizedChain,
        symbol: extractBaseSymbol(symbol || ''),
        explorerUrl: null
      }
    };
  }

  const query = extractBaseSymbol(symbol);
  if (!query) return buildError('symbol_or_token_address_required');
  const response = await runOnchainosJson(['token', 'search', '--query', query, '--chain', normalizedChain]);
  if (!response?.ok) return buildError(response?.error || 'token_search_failed');
  const candidates = compactList(response).slice().sort((left, right) => {
    return scoreTokenCandidate(right, query, normalizedChain) - scoreTokenCandidate(left, query, normalizedChain);
  });
  const best = candidates[0];
  if (!best?.tokenContractAddress) return buildError('token_not_found');
  return {
    ok: true,
    target: {
      address: normalizeText(best?.tokenContractAddress),
      chain: normalizedChain,
      symbol: normalizeText(best?.tokenSymbol || query),
      explorerUrl: normalizeText(best?.explorerUrl) || null
    }
  };
}

function buildTopLevelOnchainMeta(target = {}, fetchedAt = new Date().toISOString(), fallbackSourceName = 'okx-onchainos') {
  return {
    sourceUrl: normalizeText(target?.explorerUrl) || null,
    sourceName: fallbackSourceName,
    publishedAt: null,
    fetchedAt,
    txHash: null,
    explorerUrl: normalizeText(target?.explorerUrl) || null
  };
}

function mapSignalRecord(item = {}, signalType = 'smart-money', fetchedAt = new Date().toISOString()) {
  const walletAddresses = normalizeText(item?.triggerWalletAddress).split(',').map((value) => normalizeText(value)).filter(Boolean);
  const soldRatio = pickNumber(item?.soldRatioPercent);
  return {
    walletAddress: normalizeText(walletAddresses[0] || ''),
    action: soldRatio === null ? '' : soldRatio >= 50 ? 'sell' : 'buy',
    amount: pickNumber(item?.amountUsd, item?.amount),
    token: normalizeText(item?.token?.symbol || item?.token?.name),
    ts: pickTimestamp(item),
    signalType,
    ...withOnchainMeta(
      {
        ...item,
        explorerUrl: item?.token?.explorerUrl || item?.explorerUrl || item?.token?.tokenExplorerUrl
      },
      `okx-signal:${signalType}`,
      fetchedAt
    )
  };
}

function mapLiquidityPool(item = {}, fetchedAt = new Date().toISOString()) {
  return {
    pool: normalizeText(item?.pool),
    poolAddress: normalizeText(item?.poolAddress),
    protocolName: normalizeText(item?.protocolName),
    liquidityUsd: pickNumber(item?.liquidityUsd),
    ...withOnchainMeta(item, 'okx-liquidity-pool', fetchedAt)
  };
}

function mapTrader(item = {}, fetchedAt = new Date().toISOString()) {
  return {
    walletAddress: normalizeText(item?.walletAddress || item?.address),
    pnlUsd: pickNumber(item?.pnlUsd, item?.realizedPnlUsd),
    buyVolumeUsd: pickNumber(item?.buyVolumeUsd),
    sellVolumeUsd: pickNumber(item?.sellVolumeUsd),
    ...withOnchainMeta(item, 'okx-top-trader', fetchedAt)
  };
}

function mapHoldingRecord(item = {}, fetchedAt = new Date().toISOString()) {
  return {
    token: normalizeText(item?.tokenSymbol || item?.symbol || item?.token || item?.tokenName),
    amount: pickNumber(item?.tokenAmount, item?.amount, item?.holdingAmount),
    value: pickNumber(item?.valueUsd, item?.currentValueUsd, item?.positionValueUsd, item?.pnlUsd),
    ...withOnchainMeta(item, 'okx-wallet-holding', fetchedAt)
  };
}

function mapKlineRecord(row = [], explorerUrl = '', fetchedAt = new Date().toISOString()) {
  return {
    open: pickNumber(row?.[1]),
    high: pickNumber(row?.[2]),
    low: pickNumber(row?.[3]),
    close: pickNumber(row?.[4]),
    volume: pickNumber(row?.[5]),
    ts: normalizeText(row?.[0]),
    ...withOnchainMeta(
      {
        timestamp: row?.[0],
        explorerUrl
      },
      'okx-kline',
      fetchedAt
    )
  };
}

export async function fetchSmartMoneySignal({ symbol = 'BTC', signalType = 'smart-money' } = {}) {
  if (!hasOnchainosConfig()) return buildError('not_configured');

  const normalizedSignalType = normalizeLower(signalType || 'smart-money') || 'smart-money';
  const walletTypeMap = {
    'smart-money': '1',
    kol: '2',
    whale: '3'
  };
  const walletType = walletTypeMap[normalizedSignalType] || '1';
  const normalizedSymbol = extractBaseSymbol(symbol || 'BTC');
  const response = await runOnchainosJson(['signal', 'list', '--chain', 'ethereum', '--wallet-type', walletType]);
  if (!response?.ok) return buildError(response?.error || 'smart_money_signal_failed');

  const fetchedAt = new Date().toISOString();
  const signals = compactList(response)
    .filter((item) => !normalizedSymbol || normalizeText(item?.token?.symbol).toUpperCase().includes(normalizedSymbol))
    .map((item) => mapSignalRecord(item, normalizedSignalType, fetchedAt));
  return buildSuccess({ signals }, 'okx:onchainos:signal-list', fetchedAt);
}

export async function fetchTrenchesScan({ token_address } = {}) {
  if (!hasOnchainosConfig()) return buildError('not_configured');

  const normalizedTokenAddress = normalizeText(token_address);
  if (!normalizedTokenAddress) return buildError('token_address_required');

  const chain = inferMemepumpChain(normalizedTokenAddress, 'solana');
  const [devInfoResponse, bundleInfoResponse, apedWalletResponse] = await Promise.all([
    runOnchainosJson(['memepump', 'token-dev-info', '--address', normalizedTokenAddress, '--chain', chain]),
    runOnchainosJson(['memepump', 'token-bundle-info', '--address', normalizedTokenAddress, '--chain', chain]),
    runOnchainosJson(['memepump', 'aped-wallet', '--address', normalizedTokenAddress, '--chain', chain])
  ]);

  if (!devInfoResponse?.ok && !bundleInfoResponse?.ok && !apedWalletResponse?.ok) {
    return buildError(devInfoResponse?.error || bundleInfoResponse?.error || apedWalletResponse?.error || 'trenches_scan_failed');
  }

  const fetchedAt = new Date().toISOString();
  const devInfo = devInfoResponse?.ok ? devInfoResponse?.data || {} : {};
  const bundleInfo = bundleInfoResponse?.ok ? bundleInfoResponse?.data || {} : {};
  const apedWalletsRaw = apedWalletResponse?.ok ? compactList(apedWalletResponse?.data || apedWalletResponse) : [];
  const bundleDetected = Boolean(pickNumber(bundleInfo?.totalBundlers, bundleInfo?.bundledTokenAmount) > 0);
  const rugPullCount = pickNumber(devInfo?.devRugPullTokenCount) || 0;
  const launchedCount = pickNumber(devInfo?.devLaunchedTokenCount, devInfo?.devCreateTokenCount) || 0;
  const riskScore = Math.max(
    0,
    Math.min(
      100,
      (pickNumber(devInfo?.riskControlLevel) || 0) * 25 +
        (bundleDetected ? 20 : 0) +
        Math.min(30, rugPullCount * 10)
    )
  );
  const devReputation =
    rugPullCount > 0 ? 'high-risk' : launchedCount >= 10 ? 'experienced' : launchedCount > 0 ? 'active' : 'unknown';

  return buildSuccess(
    {
      devReputation,
      bundleDetected,
      apedWallets: apedWalletsRaw.map((item) => ({
        ...item,
        ...withOnchainMeta(item, 'okx-aped-wallet', fetchedAt)
      })),
      riskScore,
      ...buildTopLevelOnchainMeta({ explorerUrl: null }, fetchedAt, 'okx-trenches-scan'),
      raw: {
        devInfo,
        bundleInfo
      }
    },
    'okx:onchainos:memepump',
    fetchedAt
  );
}

export async function fetchTokenAnalysis({ symbol, token_address } = {}) {
  if (!hasOnchainosConfig()) return buildError('not_configured');

  const targetResult = await resolveTokenTarget({
    symbol,
    tokenAddress: token_address,
    chain: inferDexChain(token_address, 'ethereum')
  });
  if (!targetResult?.ok) return buildError(targetResult?.error || 'token_not_found');

  const target = targetResult.target;
  const [priceInfoResponse, liquidityResponse, topTraderResponse] = await Promise.all([
    runOnchainosJson(['token', 'price-info', '--address', target.address, '--chain', target.chain]),
    runOnchainosJson(['token', 'liquidity', '--address', target.address, '--chain', target.chain]),
    runOnchainosJson(['token', 'top-trader', '--address', target.address, '--chain', target.chain])
  ]);
  if (!priceInfoResponse?.ok) return buildError(priceInfoResponse?.error || 'token_analysis_failed');

  const fetchedAt = new Date().toISOString();
  const priceInfo = compactList(priceInfoResponse)[0] || {};
  const liquidityPools = liquidityResponse?.ok ? compactList(liquidityResponse).map((item) => mapLiquidityPool(item, fetchedAt)) : [];
  const topTraders = topTraderResponse?.ok ? compactList(topTraderResponse).map((item) => mapTrader(item, fetchedAt)) : [];

  return buildSuccess(
    {
      marketCap: pickNumber(priceInfo?.marketCap),
      holders: pickNumber(priceInfo?.holders),
      topTraders,
      liquidityPools,
      priceChange24h: pickNumber(priceInfo?.priceChange24H),
      ...buildTopLevelOnchainMeta(target, fetchedAt, 'okx-token-analysis'),
      raw: {
        priceInfo
      }
    },
    'okx:onchainos:token',
    fetchedAt
  );
}

export async function fetchWalletPnl({ wallet_address, chain = 'eth' } = {}) {
  if (!hasOnchainosConfig()) return buildError('not_configured');

  const normalizedWalletAddress = normalizeText(wallet_address);
  if (!normalizedWalletAddress) return buildError('wallet_address_required');

  const normalizedChain = normalizeChain(chain, 'ethereum');
  const [overviewResponse, recentPnlResponse] = await Promise.all([
    runOnchainosJson(['market', 'portfolio-overview', '--address', normalizedWalletAddress, '--chain', normalizedChain, '--time-frame', '1']),
    runOnchainosJson(['market', 'portfolio-recent-pnl', '--address', normalizedWalletAddress, '--chain', normalizedChain, '--limit', '20'])
  ]);
  if (!overviewResponse?.ok) return buildError(overviewResponse?.error || 'wallet_pnl_failed');

  const fetchedAt = new Date().toISOString();
  const overview = overviewResponse?.data || {};
  const recentPnl = recentPnlResponse?.ok ? recentPnlResponse?.data || {} : {};
  const holdingsSource = Array.isArray(recentPnl?.pnlList)
    ? recentPnl.pnlList
    : Array.isArray(overview?.topPnlTokenList)
      ? overview.topPnlTokenList
      : [];
  const holdings = holdingsSource.map((item) => mapHoldingRecord(item, fetchedAt));
  const totalValue =
    holdings.reduce((sum, item) => sum + (pickNumber(item?.value) || 0), 0) || pickNumber(overview?.top3PnlTokenSumUsd) || 0;

  return buildSuccess(
    {
      totalValue,
      pnl24h: pickNumber(overview?.realizedPnlUsd),
      pnlPercent: pickNumber(overview?.top3PnlTokenPercent),
      holdings,
      ...buildTopLevelOnchainMeta({ explorerUrl: null }, fetchedAt, 'okx-wallet-portfolio'),
      raw: overview
    },
    'okx:onchainos:wallet',
    fetchedAt
  );
}

export async function fetchDexMarket({ symbol = 'BTCUSDT', interval = '1h', limit = 20 } = {}) {
  if (!hasOnchainosConfig()) return buildError('not_configured');

  const targetResult = await resolveTokenTarget({
    symbol,
    chain: 'ethereum'
  });
  if (!targetResult?.ok) return buildError(targetResult?.error || 'token_not_found');

  const target = targetResult.target;
  const boundedLimit = toBoundedInt(limit, 20, 1, 299);
  const [priceInfoResponse, klineResponse] = await Promise.all([
    runOnchainosJson(['token', 'price-info', '--address', target.address, '--chain', target.chain]),
    runOnchainosJson(['market', 'kline', '--address', target.address, '--chain', target.chain, '--bar', normalizeBar(interval), '--limit', String(boundedLimit)])
  ]);
  if (!priceInfoResponse?.ok) return buildError(priceInfoResponse?.error || 'dex_market_failed');
  if (!klineResponse?.ok) return buildError(klineResponse?.error || 'dex_market_failed');

  const fetchedAt = new Date().toISOString();
  const priceInfo = compactList(priceInfoResponse)[0] || {};
  const klines = compactList(klineResponse).map((row) => mapKlineRecord(row, target.explorerUrl, fetchedAt));

  return buildSuccess(
    {
      price: pickNumber(priceInfo?.price),
      change24h: pickNumber(priceInfo?.priceChange24H),
      volume24h: pickNumber(priceInfo?.volume24H),
      klines,
      ...buildTopLevelOnchainMeta(target, fetchedAt, 'okx-dex-market'),
      raw: priceInfo
    },
    'okx:onchainos:market',
    fetchedAt
  );
}
