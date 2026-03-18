import {
  fetchMarketPriceFeed as defaultFetchMarketPriceFeed,
  fetchTechBuzzSignal as defaultFetchTechBuzzSignal,
  fetchWeatherContext as defaultFetchWeatherContext
} from '../lib/externalFeeds.js';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function parseInteger(value, fallback, min = 1, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
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

export function registerDataFeedRoutes(app, deps = {}) {
  const { requireRole } = deps;
  const fetchWeatherContext = deps.fetchWeatherContext || defaultFetchWeatherContext;
  const fetchTechBuzzSignal = deps.fetchTechBuzzSignal || defaultFetchTechBuzzSignal;
  const fetchMarketPriceFeed = deps.fetchMarketPriceFeed || defaultFetchMarketPriceFeed;

  app.get('/api/data/weather', requireRole('viewer'), async (req, res) => {
    const result = await fetchWeatherContext({
      latitude: req.query.latitude,
      longitude: req.query.longitude,
      forecastDays: req.query.forecastDays,
      timezone: req.query.timezone
    });
    return sendFeedResult(req, res, result);
  });

  app.get('/api/data/tech-buzz', requireRole('viewer'), async (req, res) => {
    const result = await fetchTechBuzzSignal({
      limit: req.query.limit
    });
    return sendFeedResult(req, res, result);
  });

  app.get('/api/data/market-price', requireRole('viewer'), async (req, res) => {
    const result = await fetchMarketPriceFeed({
      vsCurrency: req.query.vsCurrency,
      ids: req.query.ids,
      symbols: req.query.symbols,
      category: req.query.category,
      order: req.query.order,
      limit: parseInteger(req.query.limit, 10, 1, 50),
      page: parseInteger(req.query.page, 1, 1, 100)
    });
    return sendFeedResult(req, res, result);
  });
}
