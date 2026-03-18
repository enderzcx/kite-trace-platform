import express from 'express';
import { registerDataFeedRoutes } from '../routes/dataFeedRoutes.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const port = 34921;
const host = `http://127.0.0.1:${port}`;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = 'verify_data_feeds';
  next();
});

registerDataFeedRoutes(app, {
  requireRole: () => (_req, _res, next) => next(),
  fetchWeatherContext: async ({ latitude, longitude, forecastDays, timezone }) => {
    if (latitude === undefined || longitude === undefined) {
      return { ok: false, error: 'latitude_longitude_required' };
    }
    return {
      ok: true,
      data: {
        location: { latitude: Number(latitude), longitude: Number(longitude), timezone: String(timezone || 'auto') },
        current: { temperature: 21, fetchedAt: '2026-03-18T00:00:00.000Z' },
        daily: Array.from({ length: Number(forecastDays || 3) }, (_, index) => ({
          date: `2026-03-${18 + index}`,
          weatherSummary: 'clear',
          fetchedAt: '2026-03-18T00:00:00.000Z'
        }))
      },
      source: 'open-meteo:forecast',
      fetchedAt: '2026-03-18T00:00:00.000Z'
    };
  },
  fetchTechBuzzSignal: async ({ limit }) => ({
    ok: true,
    data: {
      stories: Array.from({ length: Number(limit || 5) }, (_, index) => ({
        id: `story_${index + 1}`,
        title: `Story ${index + 1}`,
        fetchedAt: '2026-03-18T00:00:00.000Z'
      }))
    },
    source: 'hackernews:topstories',
    fetchedAt: '2026-03-18T00:00:00.000Z'
  }),
  fetchMarketPriceFeed: async ({ ids, vsCurrency, limit }) => ({
    ok: true,
    data: {
      vsCurrency: String(vsCurrency || 'usd'),
      markets: String(ids || 'bitcoin,ethereum')
        .split(',')
        .slice(0, Number(limit || 5))
        .map((id, index) => ({
          id: id.trim(),
          currentPrice: 1000 + index,
          fetchedAt: '2026-03-18T00:00:00.000Z'
        }))
    },
    source: 'coingecko:coins-markets',
    fetchedAt: '2026-03-18T00:00:00.000Z'
  })
});

const server = app.listen(port);

try {
  const weatherResponse = await fetch(
    `${host}/api/data/weather?latitude=40.7128&longitude=-74.006&forecastDays=3&timezone=auto`,
    { headers: { Accept: 'application/json' } }
  );
  const weatherPayload = await weatherResponse.json();
  assert(weatherResponse.ok && weatherPayload?.ok === true, 'weather endpoint did not return ok');
  assert(Array.isArray(weatherPayload?.daily), 'weather daily forecast missing');
  assert(typeof weatherPayload?.location === 'object', 'weather location missing');
  assert(typeof weatherPayload?.current === 'object', 'weather current missing');
  assert(typeof weatherPayload?.fetchedAt === 'string' && weatherPayload.fetchedAt, 'weather fetchedAt missing');

  const weatherErrorResponse = await fetch(`${host}/api/data/weather`, {
    headers: { Accept: 'application/json' }
  });
  const weatherErrorPayload = await weatherErrorResponse.json();
  assert(weatherErrorResponse.status === 400, 'weather validation error did not return 400');
  assert(weatherErrorPayload?.error === 'latitude_longitude_required', 'weather validation error code mismatch');

  const techBuzzResponse = await fetch(`${host}/api/data/tech-buzz?limit=5`, {
    headers: { Accept: 'application/json' }
  });
  const techBuzzPayload = await techBuzzResponse.json();
  assert(techBuzzResponse.ok && techBuzzPayload?.ok === true, 'tech buzz endpoint did not return ok');
  assert(Array.isArray(techBuzzPayload?.stories), 'tech buzz stories missing');
  assert(typeof techBuzzPayload?.fetchedAt === 'string' && techBuzzPayload.fetchedAt, 'tech buzz fetchedAt missing');

  const marketPriceResponse = await fetch(`${host}/api/data/market-price?ids=bitcoin,ethereum&vsCurrency=usd&limit=5`, {
    headers: { Accept: 'application/json' }
  });
  const marketPricePayload = await marketPriceResponse.json();
  assert(marketPriceResponse.ok && marketPricePayload?.ok === true, 'market price endpoint did not return ok');
  assert(Array.isArray(marketPricePayload?.markets), 'market price markets missing');
  assert(typeof marketPricePayload?.vsCurrency === 'string' && marketPricePayload.vsCurrency, 'market price currency missing');
  assert(typeof marketPricePayload?.fetchedAt === 'string' && marketPricePayload.fetchedAt, 'market price fetchedAt missing');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          weatherDays: weatherPayload?.daily?.length || 0,
          techBuzzStories: techBuzzPayload?.stories?.length || 0,
          marketRows: marketPricePayload?.markets?.length || 0,
          marketSource: marketPricePayload?.source || ''
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
