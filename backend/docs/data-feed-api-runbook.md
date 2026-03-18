# Data Feed API Runbook

Last updated: 2026-03-18 (Asia/Shanghai)

## Public API Surface

- `GET /api/data/weather`
- `GET /api/data/tech-buzz`
- `GET /api/data/market-price`
- `GET /api/news/categories`
- `GET /api/news/hot`
- `GET /api/news/signals`
- `GET /api/news/listings`
- `GET /api/news/memes`

These routes are now the primary backend surface for feed-style data reads.

## Auth

- all routes require `viewer` or higher
- routes do not use `/api/services/:id/invoke`
- routes do not write x402 / service-invocation audit records

## Runtime Dependencies

- weather:
  - upstream `api.open-meteo.com`
- tech buzz:
  - upstream Hacker News API
- market price:
  - upstream CoinGecko
- daily news:
  - `OPENNEWS_API_BASE`
  - `OPENNEWS_TOKEN`
  - `OPENNEWS_TIMEOUT_MS`

## Verification

- `npm run verify:data-feeds`
- `npm run verify:daily-news:api`

## Common Failure Signals

- `latitude_longitude_required`
  - weather request is missing coordinates
- `coingecko_rate_limited`
  - CoinGecko upstream limit hit
- `daily_news_not_configured`
  - `OPENNEWS_TOKEN` is missing
- `daily_news_timeout`
  - daily-news upstream timed out
- `daily_news_upstream_unavailable`
  - daily-news upstream returned transport/server failure
