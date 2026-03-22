import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

let _proxyDispatcher = undefined; // undefined = not yet resolved; null = no proxy available
function getProxyDispatcher() {
  if (_proxyDispatcher !== undefined) return _proxyDispatcher;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || '';
  if (!proxyUrl) { _proxyDispatcher = null; return null; }
  try {
    const { ProxyAgent } = _require('undici');
    _proxyDispatcher = new ProxyAgent(proxyUrl);
    return _proxyDispatcher;
  } catch (_) {
    _proxyDispatcher = null;
    return null;
  }
}

const API_BASE = 'https://ai.6551.io';
const DEFAULT_TIMEOUT_MS = Math.max(5_000, Number(process.env.EXTERNAL_FEED_TIMEOUT_MS || 12_000));
const ONCHAINOS_TIMEOUT_MS = 12_000;
const ONCHAINOS_RETRY_BACKOFF_MS = [300, 800];
const PUBLIC_FEED_RETRY_BACKOFF_MS = [200, 600];
const DAILY_NEWS_CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000;
const execFileAsync = promisify(execFile);

const DAILY_NEWS_CATEGORY_DEFINITIONS = [
  {
    id: 'news',
    name: 'Market News',
    engineTypes: { news: ['Bloomberg', 'Reuters', 'Coindesk'] }
  },
  {
    id: 'listing',
    name: 'Exchange Listings',
    engineTypes: { listing: ['binance', 'okx', 'coinbase', 'bybit', 'hyperliquid'] }
  },
  {
    id: 'meme',
    name: 'Meme Buzz',
    engineTypes: { meme: ['twitter'] }
  }
];

let dailyNewsCategoriesCache = {
  fetchedAt: '',
  expiresAt: 0,
  items: [],
  source: 'daily-news:categories'
};

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

function toBoundedTimeout(value, fallback, min = 1000, max = 120000) {
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

function normalizeSignalValue(value = '', fallback = 'neutral') {
  const normalized = normalizeLower(value);
  if (!normalized) return fallback;
  if (
    normalized === 'long' ||
    normalized.includes('bull') ||
    normalized.includes('buy') ||
    normalized.includes('positive')
  ) {
    return 'long';
  }
  if (
    normalized === 'short' ||
    normalized.includes('bear') ||
    normalized.includes('sell') ||
    normalized.includes('negative')
  ) {
    return 'short';
  }
  return 'neutral';
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

function classifyPublicFeedError(provider = '', error = null, fallback = 'request_failed') {
  const providerPrefix = normalizeLower(provider || '').replace(/[^a-z0-9]+/g, '_');
  const fallbackCode = normalizeLower(fallback || 'request_failed').replace(/[^a-z0-9]+/g, '_') || 'request_failed';
  const message = normalizeText(error?.message || fallbackCode) || fallbackCode;
  const lower = normalizeLower(message);

  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limited')
  ) {
    return providerPrefix ? `${providerPrefix}_rate_limited` : 'upstream_rate_limited';
  }

  if (lower.includes('aborted') || lower.includes('aborterror')) {
    return providerPrefix ? `${providerPrefix}_request_aborted` : 'request_aborted';
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return providerPrefix ? `${providerPrefix}_timeout` : 'request_timeout';
  }

  if (lower.startsWith('http ')) {
    const digits = message.match(/\b(\d{3})\b/);
    if (digits?.[1]) {
      return providerPrefix ? `${providerPrefix}_http_${digits[1]}` : `http_${digits[1]}`;
    }
  }

  return providerPrefix ? `${providerPrefix}_${fallbackCode}` : fallbackCode;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryPublicFeedReason(reason = '') {
  const text = normalizeLower(reason || '');
  if (!text) return false;
  return (
    text.includes('aborted') ||
    text.includes('aborterror') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('socket') ||
    text.includes('tls') ||
    text.includes('secure connection') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('und_err') ||
    text.includes('bad gateway') ||
    text.includes('gateway timeout') ||
    text.includes('service unavailable')
  );
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

function normalizeLanguage(value = '') {
  const normalized = normalizeLower(value);
  if (['zh', 'cn', 'zh-cn', 'zh_hans'].includes(normalized)) return 'zh';
  return 'en';
}

function pickAiSummary(aiRating = {}, lang = 'en', item = {}) {
  const normalizedLang = normalizeLanguage(lang);
  if (normalizedLang === 'zh') {
    return (
      normalizeText(aiRating?.summary) ||
      normalizeText(aiRating?.enSummary) ||
      normalizeText(item?.description || item?.text)
    );
  }
  return (
    normalizeText(aiRating?.enSummary) ||
    normalizeText(aiRating?.summary) ||
    normalizeText(item?.description || item?.text)
  );
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

const COIN_ALIASES = {
  bitcoin: ['btc', 'bitcoin', 'xbt'],
  btc: ['btc', 'bitcoin', 'xbt'],
  xbt: ['btc', 'bitcoin', 'xbt'],
  ethereum: ['eth', 'ethereum', 'ether'],
  eth: ['eth', 'ethereum', 'ether'],
  solana: ['sol', 'solana'],
  sol: ['sol', 'solana'],
  dogecoin: ['doge', 'dogecoin'],
  doge: ['doge', 'dogecoin'],
  ripple: ['xrp', 'ripple'],
  xrp: ['xrp', 'ripple'],
  cardano: ['ada', 'cardano'],
  ada: ['ada', 'cardano'],
  polkadot: ['dot', 'polkadot'],
  dot: ['dot', 'polkadot'],
  avalanche: ['avax', 'avalanche'],
  avax: ['avax', 'avalanche'],
  chainlink: ['link', 'chainlink'],
  link: ['link', 'chainlink'],
  litecoin: ['ltc', 'litecoin'],
  ltc: ['ltc', 'litecoin'],
  bnb: ['bnb', 'binancecoin'],
  binancecoin: ['bnb', 'binancecoin']
};

function filterByCoin(item, coin) {
  const normalizedCoin = normalizeLower(coin);
  if (!normalizedCoin) return true;
  const aliases = COIN_ALIASES[normalizedCoin] || [normalizedCoin];
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
  return aliases.some((alias) => haystack.includes(alias));
}

async function fetchJsonWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = options?.signal || null;
  if (parentSignal?.aborted) { clearTimeout(timer); throw new DOMException('The operation was aborted', 'AbortError'); }
  const combinedSignal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal;
  try {
    const method = normalizeText(options?.method || 'GET').toUpperCase() || 'GET';
    const headers = {
      ...(options?.headers || {})
    };
    const init = {
      method,
      headers,
      signal: combinedSignal
    };
    const dispatcher = getProxyDispatcher();
    if (dispatcher) init.dispatcher = dispatcher;
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

async function fetchJsonWithRetry(
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options = {},
  retryBackoffMs = PUBLIC_FEED_RETRY_BACKOFF_MS
) {
  const delays = Array.isArray(retryBackoffMs) ? retryBackoffMs : [];
  const maxAttempts = Math.max(1, 1 + delays.length);
  let lastError = null;
  const parentSignal = options?.signal || null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (parentSignal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    try {
      return await fetchJsonWithTimeout(url, timeoutMs, options);
    } catch (error) {
      lastError = error;
      if (parentSignal?.aborted) throw error;
      const reason =
        error?.name === 'AbortError' || error?.code === 'ETIMEDOUT'
          ? 'request_aborted'
          : error?.message || 'request_failed';
      if (!shouldRetryPublicFeedReason(reason) || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = Math.max(0, Number(delays[attempt - 1] || 0));
      if (delayMs > 0) {
        await waitMs(delayMs);
      }
    }
  }
  throw lastError || new Error('request_failed');
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

async function fetchOpenJson(pathname, { token, method = 'GET', query = {}, body, timeoutMs, signal } = {}) {
  return fetchJsonWithRetry(buildUrl(pathname, query), toBoundedTimeout(timeoutMs, DEFAULT_TIMEOUT_MS), {
    method,
    headers: buildTokenHeaders(token),
    jsonBody: body,
    signal
  });
}

function getEnvValue(names = []) {
  for (const name of names) {
    const value = normalizeText(process.env[name]);
    if (value) return value;
  }
  return '';
}

function getEnvTimeout(names = [], fallback = DEFAULT_TIMEOUT_MS, min = 1000, max = 120000) {
  return toBoundedTimeout(getEnvValue(names), fallback, min, max);
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

function shouldRetryOnchainosReason(reason = '') {
  const text = normalizeLower(reason || '');
  if (!text) return false;
  return (
    text.includes('tls handshake eof') ||
    text.includes('request failed') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('temporarily unavailable') ||
    text.includes('connection reset') ||
    text.includes('connection aborted') ||
    text.includes('econnreset') ||
    text.includes('socket') ||
    text.includes('network')
  );
}

async function runOnchainosJson(args = [], timeoutMs = ONCHAINOS_TIMEOUT_MS) {
  const binary = normalizeText(process.env.ONCHAINOS_BIN) || (process.platform === 'win32' ? 'onchainos.exe' : 'onchainos');
  const maxAttempts = 1 + ONCHAINOS_RETRY_BACKOFF_MS.length;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(binary, args, {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: buildOnchainosEnv()
      });
      const parsed = parseMaybeJson(stdout);
      if (parsed?.ok === false && shouldRetryOnchainosReason(parsed?.error) && attempt < maxAttempts) {
        await waitMs(ONCHAINOS_RETRY_BACKOFF_MS[attempt - 1] || 0);
        continue;
      }
      if (parsed) return parsed;
      return buildError('invalid_onchainos_response');
    } catch (error) {
      const parsed = parseMaybeJson(error?.stdout || error?.stderr || '');
      if (parsed?.ok === false && shouldRetryOnchainosReason(parsed?.error) && attempt < maxAttempts) {
        await waitMs(ONCHAINOS_RETRY_BACKOFF_MS[attempt - 1] || 0);
        continue;
      }
      if (parsed) return parsed;
      if (error?.code === 'ENOENT') return buildError('onchainos_missing');
      const reason = error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' ? 'timeout' : error?.message || 'onchainos_failed';
      if (shouldRetryOnchainosReason(reason) && attempt < maxAttempts) {
        await waitMs(ONCHAINOS_RETRY_BACKOFF_MS[attempt - 1] || 0);
        continue;
      }
      return buildError(reason);
    }
  }
  return buildError('onchainos_failed');
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

function resolveDailyNewsCategoryDefinition(category = '') {
  const normalizedCategory = normalizeLower(category);
  if (!normalizedCategory || normalizedCategory === 'all') return null;
  return (
    DAILY_NEWS_CATEGORY_DEFINITIONS.find((item) => {
      if (item.id === normalizedCategory) return true;
      return Object.values(item.engineTypes || {})
        .flat()
        .map((source) => normalizeLower(source))
        .includes(normalizedCategory);
    }) || null
  );
}

function buildDailyNewsEngineTypes(category = '') {
  const matchedCategory = resolveDailyNewsCategoryDefinition(category);
  if (matchedCategory) {
    return matchedCategory.engineTypes;
  }
  return DAILY_NEWS_CATEGORY_DEFINITIONS.reduce((acc, item) => {
    return {
      ...acc,
      ...item.engineTypes
    };
  }, {});
}

function filterByKeyword(item = {}, keyword = '') {
  const normalizedKeyword = normalizeLower(keyword);
  if (!normalizedKeyword) return true;
  const haystack = [
    normalizeText(item?.title),
    normalizeText(item?.headline),
    normalizeText(item?.text),
    normalizeText(item?.description),
    normalizeText(item?.source),
    normalizeText(item?.newsType),
    normalizeText(item?.aiRating?.summary),
    normalizeText(item?.aiRating?.enSummary)
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalizedKeyword);
}

function sortByPublishedDesc(left = {}, right = {}) {
  return Date.parse(right?.publishedAt || right?.ts || 0) - Date.parse(left?.publishedAt || left?.ts || 0);
}

function findDailyNewsCategoryId(item = {}) {
  const normalizedEngineType = normalizeLower(item?.engineType);
  const normalizedSource = normalizeLower(item?.newsType || item?.source || '');
  const matchedCategory = DAILY_NEWS_CATEGORY_DEFINITIONS.find((category) => {
    const engines = Object.keys(category.engineTypes || {}).map((value) => normalizeLower(value));
    const sources = Object.values(category.engineTypes || {})
      .flat()
      .map((value) => normalizeLower(value));
    return engines.includes(normalizedEngineType) || sources.includes(normalizedSource);
  });
  return matchedCategory?.id || normalizedEngineType || 'news';
}

function mapDailyNewsCategory(category = {}, previewItems = [], fetchedAt = new Date().toISOString()) {
  const engineTypes = Object.keys(category.engineTypes || {});
  const sources = Object.values(category.engineTypes || {}).flat();
  const firstPreview = previewItems[0] || {};
  return {
    id: normalizeText(category?.id),
    name: normalizeText(category?.name),
    engineTypes,
    sources,
    available: previewItems.length > 0,
    sampleSourceName: normalizeText(firstPreview?.newsType || firstPreview?.source || sources[0] || ''),
    fetchedAt
  };
}

function mapDailyNewsNewsSignalRecord(item = {}, fetchedAt = new Date().toISOString(), lang = 'en') {
  const record = mapNewsRecord(item, fetchedAt);
  return {
    ...record,
    summary: pickAiSummary(item?.aiRating || {}, lang, item),
    signal: normalizeSignalValue(record.signal),
    aiScore: clampScore(record.aiScore)
  };
}

function mapDailyNewsListingRecord(item = {}, fetchedAt = new Date().toISOString(), lang = 'en') {
  const record = mapListingRecord(item, fetchedAt);
  return {
    ...record,
    summary: pickAiSummary(item?.aiRating || {}, lang, item),
    signal: normalizeSignalValue(record.signal),
    aiScore: clampScore(record.aiScore)
  };
}

function mapDailyNewsMemeRecord(item = {}, fetchedAt = new Date().toISOString()) {
  const record = mapMemeRecord(item, fetchedAt);
  return {
    ...record,
    sentiment: normalizeSignalValue(record.sentiment),
    trendScore: clampScore(record.trendScore)
  };
}

function mapDailyNewsHotRecord(item = {}, fetchedAt = new Date().toISOString(), lang = 'en') {
  const coins = extractCoinSymbols(item);
  const aiRating = item?.aiRating || {};
  return {
    id: normalizeText(item?.id || ''),
    category: findDailyNewsCategoryId(item),
    engineType: normalizeLower(item?.engineType || 'news') || 'news',
    title: normalizeText(item?.title || item?.headline || item?.text),
    summary: pickAiSummary(aiRating, lang, item),
    source: normalizeText(item?.newsType || item?.source || item?.engineType || 'news'),
    coin: normalizeText(coins[0] || ''),
    aiScore: clampScore(aiRating?.score ?? item?.score ?? item?.aiScore),
    signal: normalizeSignalValue(aiRating?.signal || item?.signal || ''),
    ...withCommonMeta(item, `daily-news:${findDailyNewsCategoryId(item)}`, fetchedAt)
  };
}

async function fetchDailyNewsSearch({
  limit = 10,
  coin,
  category = '',
  keyword = '',
  lang = 'en'
} = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) {
    return buildError('daily_news_not_configured');
  }

  try {
    const fetchedAt = new Date().toISOString();
    const timeoutMs = getEnvTimeout(['OPENNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS);
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      timeoutMs,
      body: {
        ...buildNewsSearchBody({
          limit,
          coin,
          engineTypes: buildDailyNewsEngineTypes(category)
        }),
        lang: normalizeLanguage(lang)
      }
    });
    return buildSuccess(
      {
        items: compactList(response)
          .filter((item) => filterByKeyword(item, keyword))
          .slice(0, toBoundedInt(limit, 10, 1, 100))
      },
      'daily-news:search',
      fetchedAt
    );
  } catch (error) {
    return buildError(classifyDailyNewsError(error));
  }
}

function classifyDailyNewsError(error = null) {
  const message = normalizeLower(error?.message || '');
  if (!message) return 'daily_news_upstream_unavailable';
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return 'daily_news_rate_limited';
  }
  if (message.includes('abort') || message.includes('timeout') || message.includes('timed out')) {
    return 'daily_news_timeout';
  }
  if (message.startsWith('http 5') || message.includes('service unavailable') || message.includes('bad gateway')) {
    return 'daily_news_upstream_unavailable';
  }
  if (message.startsWith('http 4')) {
    return 'daily_news_invalid_response';
  }
  return 'daily_news_upstream_unavailable';
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

function toBoundedFloat(value, fallback, min = -90, max = 90) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(numeric, max));
}

function mapWeatherCodeToSummary(code) {
  const normalized = Number(code);
  const table = new Map([
    [0, 'clear'],
    [1, 'mainly-clear'],
    [2, 'partly-cloudy'],
    [3, 'overcast'],
    [45, 'fog'],
    [48, 'depositing-rime-fog'],
    [51, 'light-drizzle'],
    [53, 'moderate-drizzle'],
    [55, 'dense-drizzle'],
    [61, 'slight-rain'],
    [63, 'moderate-rain'],
    [65, 'heavy-rain'],
    [71, 'slight-snow'],
    [73, 'moderate-snow'],
    [75, 'heavy-snow'],
    [80, 'rain-showers'],
    [81, 'heavy-rain-showers'],
    [82, 'violent-rain-showers'],
    [95, 'thunderstorm'],
    [96, 'thunderstorm-hail'],
    [99, 'heavy-thunderstorm-hail']
  ]);
  return table.get(normalized) || `weather-code-${normalized}`;
}

function mapWeatherDailyRecord(daily = {}, index = 0, fetchedAt = new Date().toISOString()) {
  return {
    date: normalizeText(Array.isArray(daily?.time) ? daily.time[index] : ''),
    weatherCode: pickNumber(Array.isArray(daily?.weather_code) ? daily.weather_code[index] : null),
    weatherSummary: mapWeatherCodeToSummary(Array.isArray(daily?.weather_code) ? daily.weather_code[index] : null),
    temperatureMax: pickNumber(Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max[index] : null),
    temperatureMin: pickNumber(Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min[index] : null),
    precipitationSum: pickNumber(Array.isArray(daily?.precipitation_sum) ? daily.precipitation_sum[index] : null),
    precipitationProbabilityMax: pickNumber(
      Array.isArray(daily?.precipitation_probability_max) ? daily.precipitation_probability_max[index] : null
    ),
    windSpeedMax: pickNumber(Array.isArray(daily?.wind_speed_10m_max) ? daily.wind_speed_10m_max[index] : null),
    ...withCommonMeta({}, 'open-meteo', fetchedAt)
  };
}

function mapHackerNewsStory(item = {}, fetchedAt = new Date().toISOString()) {
  const sourceUrl = normalizeText(item?.url || '');
  return {
    id: pickNumber(item?.id),
    title: normalizeText(item?.title || ''),
    by: normalizeText(item?.by || ''),
    score: pickNumber(item?.score) || 0,
    descendants: pickNumber(item?.descendants) || 0,
    url: sourceUrl || null,
    hackerNewsUrl: item?.id ? `https://news.ycombinator.com/item?id=${item.id}` : null,
    publishedAt: toIsoTimestamp(item?.time),
    sourceUrl: sourceUrl || (item?.id ? `https://news.ycombinator.com/item?id=${item.id}` : null),
    sourceName: 'hackernews',
    fetchedAt
  };
}

function mapCoinGeckoMarket(item = {}, fetchedAt = new Date().toISOString()) {
  return {
    id: normalizeText(item?.id || ''),
    symbol: normalizeText(item?.symbol || '').toUpperCase(),
    name: normalizeText(item?.name || ''),
    image: normalizeText(item?.image || '') || null,
    currentPrice: pickNumber(item?.current_price),
    marketCap: pickNumber(item?.market_cap),
    marketCapRank: pickNumber(item?.market_cap_rank),
    fullyDilutedValuation: pickNumber(item?.fully_diluted_valuation),
    totalVolume: pickNumber(item?.total_volume),
    high24h: pickNumber(item?.high_24h),
    low24h: pickNumber(item?.low_24h),
    priceChange24h: pickNumber(item?.price_change_24h),
    priceChangePercentage24h: pickNumber(item?.price_change_percentage_24h),
    circulatingSupply: pickNumber(item?.circulating_supply),
    totalSupply: pickNumber(item?.total_supply),
    maxSupply: pickNumber(item?.max_supply),
    ath: pickNumber(item?.ath),
    atl: pickNumber(item?.atl),
    lastUpdated: toIsoTimestamp(item?.last_updated),
    ...withCommonMeta(
      {
        sourceUrl: normalizeText(item?.image || '') ? `https://www.coingecko.com/en/coins/${normalizeText(item?.id || '')}` : ''
      },
      'coingecko',
      fetchedAt
    )
  };
}

export async function fetchDailyNewsCategories({ includeStale = true } = {}) {
  const now = Date.now();
  if (Array.isArray(dailyNewsCategoriesCache.items) && dailyNewsCategoriesCache.items.length > 0 && dailyNewsCategoriesCache.expiresAt > now) {
    return buildSuccess(
      {
        categories: dailyNewsCategoriesCache.items,
        stale: false
      },
      dailyNewsCategoriesCache.source,
      dailyNewsCategoriesCache.fetchedAt || new Date().toISOString()
    );
  }

  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) {
    if (includeStale && Array.isArray(dailyNewsCategoriesCache.items) && dailyNewsCategoriesCache.items.length > 0) {
      return buildSuccess(
        {
          categories: dailyNewsCategoriesCache.items,
          stale: true
        },
        dailyNewsCategoriesCache.source,
        dailyNewsCategoriesCache.fetchedAt || new Date().toISOString()
      );
    }
    return buildError('daily_news_not_configured');
  }

  const fetchedAt = new Date().toISOString();
  const timeoutMs = getEnvTimeout(['OPENNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS);

  try {
    const categoryResults = await Promise.allSettled(
      DAILY_NEWS_CATEGORY_DEFINITIONS.map(async (category) => {
        const body = {
          ...buildNewsSearchBody({
            limit: 1,
            engineTypes: category.engineTypes
          }),
          lang: 'en'
        };
        const response = await fetchOpenJson('/open/news_search', {
          token,
          method: 'POST',
          timeoutMs,
          body
        });
        return mapDailyNewsCategory(category, compactList(response), fetchedAt);
      })
    );

    const categories = categoryResults
      .map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        return mapDailyNewsCategory(DAILY_NEWS_CATEGORY_DEFINITIONS[index], [], fetchedAt);
      })
      .filter(Boolean);

    if (categories.every((item) => item.available !== true)) {
      throw new Error('daily_news_invalid_response');
    }

    dailyNewsCategoriesCache = {
      fetchedAt,
      expiresAt: now + DAILY_NEWS_CATEGORY_CACHE_TTL_MS,
      items: categories,
      source: 'daily-news:categories'
    };

    return buildSuccess(
      {
        categories,
        stale: false
      },
      'daily-news:categories',
      fetchedAt
    );
  } catch (error) {
    if (includeStale && Array.isArray(dailyNewsCategoriesCache.items) && dailyNewsCategoriesCache.items.length > 0) {
      return buildSuccess(
        {
          categories: dailyNewsCategoriesCache.items,
          stale: true
        },
        dailyNewsCategoriesCache.source,
        dailyNewsCategoriesCache.fetchedAt || fetchedAt
      );
    }
    return buildError(classifyDailyNewsError(error));
  }
}

export async function fetchDailyNewsHotNews({ category = '', lang = 'en', limit = 20, keyword = '' } = {}) {
  const response = await fetchDailyNewsSearch({
    category,
    keyword,
    lang,
    limit: toBoundedInt(limit, 20, 1, 100)
  });
  if (!response?.ok) return response;

  const fetchedAt = normalizeText(response?.fetchedAt || '') || new Date().toISOString();
  const items = compactList(response?.data?.items)
    .map((item) => mapDailyNewsHotRecord(item, fetchedAt, lang))
    .sort(sortByPublishedDesc)
    .slice(0, toBoundedInt(limit, 20, 1, 100));

  return buildSuccess(
    {
      items,
      category: normalizeLower(category || '') || 'all',
      lang: normalizeLanguage(lang)
    },
    'daily-news:hot',
    fetchedAt
  );
}

export async function fetchDailyNewsSignals({ coin, signal, minScore = 50, limit = 10, lang = 'en' } = {}) {
  const response = await fetchDailyNewsSearch({
    category: 'news',
    coin,
    lang,
    limit
  });
  if (!response?.ok) return response;

  const normalizedSignal = normalizeSignalValue(signal, '');
  const minimumScore = Number.isFinite(Number(minScore)) ? Number(minScore) : 50;
  const fetchedAt = normalizeText(response?.fetchedAt || '') || new Date().toISOString();
  const articles = compactList(response?.data?.items)
    .filter((item) => normalizeLower(item?.engineType) === 'news')
    .map((item) => mapDailyNewsNewsSignalRecord(item, fetchedAt, lang))
    .filter((item) => {
      if (!filterByCoin(item, coin)) return false;
      if (normalizedSignal && item.signal !== normalizedSignal) return false;
      if (item.aiScore !== null && Number(item.aiScore) < minimumScore) return false;
      return true;
    })
    .sort(sortByPublishedDesc)
    .slice(0, toBoundedInt(limit, 10, 1, 100));

  return buildSuccess({ articles }, 'daily-news:signals', fetchedAt);
}

export async function fetchDailyNewsListings({ exchange = 'all', coin, limit = 10, lang = 'en' } = {}) {
  const normalizedExchange = normalizeLower(exchange || 'all');
  const response = await fetchDailyNewsSearch({
    category: normalizedExchange && normalizedExchange !== 'all' ? normalizedExchange : 'listing',
    coin,
    lang,
    limit
  });
  if (!response?.ok) return response;

  const fetchedAt = normalizeText(response?.fetchedAt || '') || new Date().toISOString();
  const listings = compactList(response?.data?.items)
    .filter((item) => normalizeLower(item?.engineType) === 'listing')
    .map((item) => mapDailyNewsListingRecord(item, fetchedAt, lang))
    .filter((item) => {
      if (normalizedExchange && normalizedExchange !== 'all' && normalizeLower(item.exchange) !== normalizedExchange) {
        return false;
      }
      return filterByCoin(item, coin);
    })
    .sort(sortByPublishedDesc)
    .slice(0, toBoundedInt(limit, 10, 1, 100));

  return buildSuccess({ listings }, 'daily-news:listings', fetchedAt);
}

export async function fetchDailyNewsMemes({ limit = 20, lang = 'en', keyword = '' } = {}) {
  const response = await fetchDailyNewsSearch({
    category: 'meme',
    keyword,
    lang,
    limit
  });
  if (!response?.ok) return response;

  const fetchedAt = normalizeText(response?.fetchedAt || '') || new Date().toISOString();
  const memes = compactList(response?.data?.items)
    .filter((item) => normalizeLower(item?.engineType) === 'meme')
    .map((item) => mapDailyNewsMemeRecord(item, fetchedAt))
    .sort(sortByPublishedDesc)
    .slice(0, toBoundedInt(limit, 20, 1, 100));

  return buildSuccess({ memes }, 'daily-news:memes', fetchedAt);
}

export async function fetchListingAlert({ exchange = 'all', coin, limit = 10 } = {}, { signal } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const timeoutMs = getEnvTimeout(['OPENNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS);
    const normalizedExchange = normalizeLower(exchange || 'all');
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      timeoutMs,
      signal,
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

export async function fetchNewsSignal({ coin, signal, minScore = 50, limit = 10 } = {}, { signal: abortSignal } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const timeoutMs = getEnvTimeout(['OPENNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS);
    const normalizedSignal = normalizeLower(signal);
    const minimumScore = Number.isFinite(Number(minScore)) ? Number(minScore) : 50;
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      timeoutMs,
      signal: abortSignal,
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

export async function fetchMemeSentiment({ limit = 20 } = {}, { signal } = {}) {
  const token = normalizeText(process.env.OPENNEWS_TOKEN);
  if (!token) return buildError('not_configured');

  try {
    const fetchedAt = new Date().toISOString();
    const timeoutMs = getEnvTimeout(['OPENNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS);
    const response = await fetchOpenJson('/open/news_search', {
      token,
      method: 'POST',
      timeoutMs,
      signal,
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

export async function fetchKolMonitor({ username, includeDeleted = false, limit = 20 } = {}, { signal } = {}) {
  const token = normalizeText(process.env.TWITTER_TOKEN);
  const screenName = normalizeText(username);
  if (!token) return buildError('not_configured');
  if (!screenName) return buildError('username_required');

  try {
    const fetchedAt = new Date().toISOString();
    const timeoutMs = getEnvTimeout(['TWITTER_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS);
    const tweetsResponse = await fetchOpenJson('/open/twitter_user_tweets', {
      token,
      method: 'POST',
      timeoutMs,
      signal,
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
        timeoutMs,
        signal,
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

export async function fetchWeatherContext({
  latitude,
  longitude,
  forecastDays = 3,
  timezone = 'auto'
} = {}, { signal } = {}) {
  const lat = toBoundedFloat(latitude, NaN, -90, 90);
  const lon = toBoundedFloat(longitude, NaN, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return buildError('latitude_longitude_required');
  }

  try {
    const fetchedAt = new Date().toISOString();
    const forecastLength = toBoundedInt(forecastDays, 3, 1, 7);
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('timezone', normalizeText(timezone || 'auto') || 'auto');
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m'
    );
    url.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
    );
    url.searchParams.set('forecast_days', String(forecastLength));
    const response = await fetchJsonWithRetry(
      url.toString(),
      getEnvTimeout(['OPEN_METEO_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS),
      { signal }
    );
    const daily = response?.daily || {};
    const dayCount = Array.isArray(daily?.time) ? daily.time.length : 0;
    return buildSuccess(
      {
        location: {
          latitude: pickNumber(response?.latitude),
          longitude: pickNumber(response?.longitude),
          elevation: pickNumber(response?.elevation),
          timezone: normalizeText(response?.timezone || ''),
          timezoneAbbreviation: normalizeText(response?.timezone_abbreviation || '')
        },
        current: {
          time: normalizeText(response?.current?.time || ''),
          temperature: pickNumber(response?.current?.temperature_2m),
          apparentTemperature: pickNumber(response?.current?.apparent_temperature),
          humidity: pickNumber(response?.current?.relative_humidity_2m),
          precipitation: pickNumber(response?.current?.precipitation),
          weatherCode: pickNumber(response?.current?.weather_code),
          weatherSummary: mapWeatherCodeToSummary(response?.current?.weather_code),
          windSpeed: pickNumber(response?.current?.wind_speed_10m),
          windDirection: pickNumber(response?.current?.wind_direction_10m),
          ...withCommonMeta({}, 'open-meteo', fetchedAt)
        },
        daily: Array.from({ length: dayCount }, (_, index) => mapWeatherDailyRecord(daily, index, fetchedAt))
      },
      'open-meteo:forecast',
      fetchedAt
    );
  } catch (error) {
    return buildError(classifyPublicFeedError('open-meteo', error, 'weather_context_failed'));
  }
}

export async function fetchTechBuzzSignal({ limit = 10 } = {}, { signal } = {}) {
  try {
    const fetchedAt = new Date().toISOString();
    const maxRows = toBoundedInt(limit, 10, 1, 30);
    const topStoryIds = await fetchJsonWithRetry(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      getEnvTimeout(['HACKERNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS),
      { signal }
    );
    const ids = Array.isArray(topStoryIds) ? topStoryIds.slice(0, maxRows) : [];
    const itemResponses = await Promise.all(
      ids.map((id) =>
        fetchJsonWithRetry(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          getEnvTimeout(['HACKERNEWS_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS),
          { signal }
        ).catch(() => null)
      )
    );
    const stories = itemResponses
      .filter((item) => item && item.type === 'story' && item.deleted !== true && item.dead !== true)
      .map((item) => mapHackerNewsStory(item, fetchedAt));
    return buildSuccess({ stories }, 'hackernews:topstories', fetchedAt);
  } catch (error) {
    return buildError(classifyPublicFeedError('hackernews', error, 'tech_buzz_signal_failed'));
  }
}

export async function fetchMarketPriceFeed({
  vsCurrency = 'usd',
  ids = 'bitcoin,ethereum',
  symbols = '',
  category = '',
  order = 'market_cap_desc',
  limit = 10,
  page = 1
} = {}, { signal } = {}) {
  try {
    const fetchedAt = new Date().toISOString();
    const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
    url.searchParams.set('vs_currency', normalizeLower(vsCurrency || 'usd') || 'usd');
    if (normalizeText(ids)) {
      url.searchParams.set('ids', normalizeText(ids));
    } else if (normalizeText(symbols)) {
      url.searchParams.set('symbols', normalizeText(symbols));
    }
    if (normalizeText(category)) {
      url.searchParams.set('category', normalizeText(category));
    }
    url.searchParams.set('order', normalizeText(order || 'market_cap_desc') || 'market_cap_desc');
    url.searchParams.set('per_page', String(toBoundedInt(limit, 10, 1, 50)));
    url.searchParams.set('page', String(toBoundedInt(page, 1, 1, 100)));
    url.searchParams.set('sparkline', 'false');
    url.searchParams.set('price_change_percentage', '24h');
    const response = await fetchJsonWithRetry(
      url.toString(),
      getEnvTimeout(['COINGECKO_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS),
      { signal }
    );
    const markets = compactList(response).map((item) => mapCoinGeckoMarket(item, fetchedAt));
    return buildSuccess(
      {
        vsCurrency: normalizeLower(vsCurrency || 'usd') || 'usd',
        markets
      },
      'coingecko:coins-markets',
      fetchedAt
    );
  } catch (error) {
    return buildError(classifyPublicFeedError('coingecko', error, 'market_price_feed_failed'));
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
  const [marketPriceResponse, klineResponse, priceInfoResponse] = await Promise.all([
    runOnchainosJson(['market', 'price', '--address', target.address, '--chain', target.chain]),
    runOnchainosJson(['market', 'kline', '--address', target.address, '--chain', target.chain, '--bar', normalizeBar(interval), '--limit', String(boundedLimit)]),
    runOnchainosJson(['token', 'price-info', '--address', target.address, '--chain', target.chain], Math.min(8_000, ONCHAINOS_TIMEOUT_MS))
  ]);
  if (!marketPriceResponse?.ok && !priceInfoResponse?.ok) {
    return buildError(marketPriceResponse?.error || priceInfoResponse?.error || 'dex_market_failed');
  }
  if (!klineResponse?.ok) return buildError(klineResponse?.error || 'dex_market_failed');

  const fetchedAt = new Date().toISOString();
  const marketPrice = compactList(marketPriceResponse)[0] || {};
  const priceInfo = compactList(priceInfoResponse)[0] || {};
  const klines = compactList(klineResponse).map((row) => mapKlineRecord(row, target.explorerUrl, fetchedAt));

  return buildSuccess(
    {
      price: pickNumber(marketPrice?.price, priceInfo?.price),
      change24h: pickNumber(priceInfo?.priceChange24H),
      volume24h: pickNumber(priceInfo?.volume24H),
      klines,
      ...buildTopLevelOnchainMeta(target, fetchedAt, 'okx-dex-market'),
      raw: {
        marketPrice,
        priceInfo
      }
    },
    'okx:onchainos:market',
    fetchedAt
  );
}
