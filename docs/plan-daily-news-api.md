# Plan: Daily News API / Data Feed API Independent Surface

Updated: 2026-03-18

Status:

- backend implementation completed
- verification completed
- old capability path retained only as compatibility surface

## 1. Status Snapshot

The original idea for this work was to tighten the existing OpenNews-backed capability helpers.

The final backend delivery is broader and now matches the updated product direction:

- Daily News ships as independent REST APIs under `/api/news/*`
- weather, tech buzz, and market price ship as independent REST APIs under `/api/data/*`
- these APIs do not run through `/api/services/:id/invoke`
- these APIs do not use x402 or `service invocation` audit records
- old data capabilities remain in the repo for compatibility, but they are no longer the preferred product surface

## 2. What Was Implemented

### 2.1 New public REST APIs

Implemented routes:

- `GET /api/data/weather`
- `GET /api/data/tech-buzz`
- `GET /api/data/market-price`
- `GET /api/news/categories`
- `GET /api/news/hot`
- `GET /api/news/signals`
- `GET /api/news/listings`
- `GET /api/news/memes`

All of these routes are backend-owned viewer APIs and are mounted in the real runtime.

### 2.2 Feed-layer source of truth

The feed/provider mapping remains centralized in:

- [externalFeeds.js](/E:/CODEX/kite-trace-platform/backend/lib/externalFeeds.js)

That file now contains:

- existing weather / tech buzz / market price helpers
- new daily-news helpers
- daily-news category caching
- normalized output mapping
- structured upstream error mapping

### 2.3 Daily-news implementation shape

Live probing against `ai.6551.io` showed that the stable upstream path available in the current environment is:

- `POST /open/news_search`

The guessed dedicated endpoints for standalone categories / hot-news were not available during implementation.

Because of that, the delivered backend does this:

- builds Daily News APIs on top of the proven `news_search` path
- exposes categories from backend-owned normalized definitions
- caches category metadata in memory with a 10-minute TTL
- keeps upstream behavior hidden behind the feed layer

This means the public contract is stable even though the upstream shape is not a dedicated `daily-news` REST family.

### 2.4 Output contract now shipped

News records are normalized with:

- `sourceUrl`
- `sourceName`
- `publishedAt`
- `fetchedAt`

Data/feed APIs also expose evidence-friendly source metadata where available.

Normalization rules implemented:

- `publishedAt` is ISO when present
- `signal` is normalized to `long | short | neutral`
- `aiScore` is clamped to `0-100`
- empty or missing URLs are not fabricated

### 2.5 Explicitly unchanged

Not changed by this work:

- `cap-kol-monitor`
- Twitter-based KOL routes
- x402 payment flows
- capability deletion

The old capability surface was intentionally not removed in this pass.

## 3. Files Added Or Updated

Primary implementation files:

- [externalFeeds.js](/E:/CODEX/kite-trace-platform/backend/lib/externalFeeds.js)
- [dataFeedRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/dataFeedRoutes.js)
- [dailyNewsRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/dailyNewsRoutes.js)
- [appRuntime.impl.js](/E:/CODEX/kite-trace-platform/backend/appRuntime.impl.js)

Verification and ops files:

- [verify-data-feed-apis.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-data-feed-apis.mjs)
- [verify-daily-news-api.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-daily-news-api.mjs)
- [data-feed-api-runbook.md](/E:/CODEX/kite-trace-platform/backend/docs/data-feed-api-runbook.md)

## 4. Verification Status

### 4.1 Automated verification completed

Ran successfully:

- `npm run verify:data-feeds`
- `npm run verify:daily-news:api`

Observed summaries during implementation:

- `verify:data-feeds`
  - weather days: `3`
  - tech buzz stories: `5`
  - market rows: `2`
- `verify:daily-news:api`
  - categories: `3`
  - hot items: `5`
  - signal articles: `3`
  - listing rows: `5`
  - meme rows: `5`

### 4.2 Real runtime verification completed

The real backend was started locally and the following routes were exercised successfully:

- `/api/data/weather`
- `/api/data/tech-buzz`
- `/api/news/categories`
- `/api/news/hot`

`/api/data/market-price` also returned a structured live upstream error during one runtime check:

- `coingecko_request_aborted`

This is acceptable and was one of the desired outcomes of the refactor: upstream instability now surfaces as a stable backend error contract instead of a crash.

## 5. Product Surface Decision Now In Effect

The preferred product surface for these data features is now:

- `/api/data/*`
- `/api/news/*`

The capability equivalents remain only as compatibility paths until a later cleanup pass.

## 6. Follow-Up Items Not Included In This Delivery

Not implemented here:

- frontend consumption changes
- capability removal / catalog cleanup
- MCP wrapping for these independent data APIs
- a second upstream provider or provider-mode abstraction

## 7. One-Line Conclusion

This plan is now complete on the backend: Daily News, weather, tech buzz, and market price have been lifted into independent REST APIs with normalized output, cached metadata where needed, and verified runtime behavior.
