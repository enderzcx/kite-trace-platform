import 'dotenv/config';
import express from 'express';
import { registerDailyNewsRoutes } from '../routes/dailyNewsRoutes.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const token = String(process.env.OPENNEWS_TOKEN || '').trim();
if (!token) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: 'daily_news_not_configured'
      },
      null,
      2
    )
  );
  process.exit(0);
}

const port = 34922;
const host = `http://127.0.0.1:${port}`;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = 'verify_daily_news_api';
  next();
});

registerDailyNewsRoutes(app, {
  requireRole: () => (_req, _res, next) => next()
});

const server = app.listen(port);

function assertCommonRecord(record = {}, label = 'record') {
  assert(typeof record === 'object' && record, `${label} missing`);
  assert(typeof record.fetchedAt === 'string' && record.fetchedAt, `${label} fetchedAt missing`);
  if (record.sourceUrl !== null && record.sourceUrl !== undefined) {
    assert(typeof record.sourceUrl === 'string' || record.sourceUrl === null, `${label} sourceUrl invalid`);
  }
  if (record.publishedAt !== null && record.publishedAt !== undefined) {
    assert(typeof record.publishedAt === 'string' || record.publishedAt === null, `${label} publishedAt invalid`);
  }
}

try {
  const categoriesResponse = await fetch(`${host}/api/news/categories`, { headers: { Accept: 'application/json' } });
  const categoriesPayload = await categoriesResponse.json();
  assert(categoriesResponse.ok && categoriesPayload?.ok === true, 'categories endpoint did not return ok');
  assert(Array.isArray(categoriesPayload?.categories), 'categories list missing');
  assert(categoriesPayload.categories.length > 0, 'categories list empty');

  const hotResponse = await fetch(`${host}/api/news/hot?limit=5`, { headers: { Accept: 'application/json' } });
  const hotPayload = await hotResponse.json();
  assert(hotResponse.ok && hotPayload?.ok === true, 'hot endpoint did not return ok');
  assert(Array.isArray(hotPayload?.items), 'hot items missing');
  if (hotPayload.items[0]) {
    assertCommonRecord(hotPayload.items[0], 'hot item');
  }

  const signalsResponse = await fetch(`${host}/api/news/signals?limit=5&lang=en`, { headers: { Accept: 'application/json' } });
  const signalsPayload = await signalsResponse.json();
  assert(signalsResponse.ok && signalsPayload?.ok === true, 'signals endpoint did not return ok');
  assert(Array.isArray(signalsPayload?.articles), 'signals articles missing');
  if (signalsPayload.articles[0]) {
    assertCommonRecord(signalsPayload.articles[0], 'signal article');
    assert(['long', 'short', 'neutral'].includes(String(signalsPayload.articles[0].signal || 'neutral')), 'signal normalization invalid');
  }

  const listingsResponse = await fetch(`${host}/api/news/listings?limit=5&exchange=all`, {
    headers: { Accept: 'application/json' }
  });
  const listingsPayload = await listingsResponse.json();
  assert(listingsResponse.ok && listingsPayload?.ok === true, 'listings endpoint did not return ok');
  assert(Array.isArray(listingsPayload?.listings), 'listings array missing');
  if (listingsPayload.listings[0]) {
    assertCommonRecord(listingsPayload.listings[0], 'listing record');
  }

  const memesResponse = await fetch(`${host}/api/news/memes?limit=5`, {
    headers: { Accept: 'application/json' }
  });
  const memesPayload = await memesResponse.json();
  assert(memesResponse.ok && memesPayload?.ok === true, 'memes endpoint did not return ok');
  assert(Array.isArray(memesPayload?.memes), 'memes array missing');
  if (memesPayload.memes[0]) {
    assertCommonRecord(memesPayload.memes[0], 'meme record');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          categories: categoriesPayload?.categories?.length || 0,
          hotItems: hotPayload?.items?.length || 0,
          signalArticles: signalsPayload?.articles?.length || 0,
          listingRows: listingsPayload?.listings?.length || 0,
          memeRows: memesPayload?.memes?.length || 0
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
