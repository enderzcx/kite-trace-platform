import {
  fetchDailyNewsCategories as defaultFetchDailyNewsCategories,
  fetchDailyNewsHotNews as defaultFetchDailyNewsHotNews,
  fetchDailyNewsListings as defaultFetchDailyNewsListings,
  fetchDailyNewsMemes as defaultFetchDailyNewsMemes,
  fetchDailyNewsSignals as defaultFetchDailyNewsSignals
} from '../lib/externalFeeds.js';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function parseInteger(value, fallback, min = 1, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
}

function parseBoolean(value, fallback = false) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function classifyFeedStatus(error = '') {
  const normalized = normalizeText(error).toLowerCase();
  if (!normalized) return 502;
  if (normalized.endsWith('_required') || normalized.includes('required') || normalized.includes('invalid')) return 400;
  if (normalized.includes('rate_limited') || normalized.includes('429')) return 429;
  if (normalized.includes('not_configured')) return 503;
  if (
    normalized.includes('timeout') ||
    normalized.includes('aborted') ||
    normalized.includes('unavailable') ||
    normalized.includes('econnreset') ||
    normalized.includes('fetch failed')
  ) {
    return 503;
  }
  return 502;
}

function sendFeedResult(req, res, result = {}) {
  if (result?.ok) {
    return res.json({
      ok: true,
      traceId: normalizeText(req.traceId || ''),
      ...(result?.data && typeof result.data === 'object' ? result.data : {}),
      source: normalizeText(result?.source || ''),
      fetchedAt: normalizeText(result?.fetchedAt || '')
    });
  }
  return res.status(classifyFeedStatus(result?.error)).json({
    ok: false,
    traceId: normalizeText(req.traceId || ''),
    error: normalizeText(result?.error || 'request_failed') || 'request_failed'
  });
}

export function registerDailyNewsRoutes(app, deps = {}) {
  const { requireRole } = deps;
  const fetchDailyNewsCategories = deps.fetchDailyNewsCategories || defaultFetchDailyNewsCategories;
  const fetchDailyNewsHotNews = deps.fetchDailyNewsHotNews || defaultFetchDailyNewsHotNews;
  const fetchDailyNewsSignals = deps.fetchDailyNewsSignals || defaultFetchDailyNewsSignals;
  const fetchDailyNewsListings = deps.fetchDailyNewsListings || defaultFetchDailyNewsListings;
  const fetchDailyNewsMemes = deps.fetchDailyNewsMemes || defaultFetchDailyNewsMemes;

  app.get('/api/news/categories', requireRole('viewer'), async (req, res) => {
    const result = await fetchDailyNewsCategories({
      includeStale: parseBoolean(req.query.includeStale, true),
      lang: req.query.lang
    });
    return sendFeedResult(req, res, result);
  });

  app.get('/api/news/hot', requireRole('viewer'), async (req, res) => {
    const result = await fetchDailyNewsHotNews({
      category: req.query.category,
      lang: req.query.lang,
      limit: parseInteger(req.query.limit, 20, 1, 100),
      keyword: req.query.keyword
    });
    return sendFeedResult(req, res, result);
  });

  app.get('/api/news/signals', requireRole('viewer'), async (req, res) => {
    const result = await fetchDailyNewsSignals({
      coin: req.query.coin,
      signal: req.query.signal,
      minScore: req.query.minScore,
      limit: parseInteger(req.query.limit, 10, 1, 100),
      lang: req.query.lang
    });
    return sendFeedResult(req, res, result);
  });

  app.get('/api/news/listings', requireRole('viewer'), async (req, res) => {
    const result = await fetchDailyNewsListings({
      exchange: req.query.exchange,
      coin: req.query.coin,
      limit: parseInteger(req.query.limit, 10, 1, 100),
      lang: req.query.lang
    });
    return sendFeedResult(req, res, result);
  });

  app.get('/api/news/memes', requireRole('viewer'), async (req, res) => {
    const result = await fetchDailyNewsMemes({
      limit: parseInteger(req.query.limit, 20, 1, 100),
      lang: req.query.lang,
      keyword: req.query.keyword
    });
    return sendFeedResult(req, res, result);
  });
}
