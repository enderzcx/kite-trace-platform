import { createSynthesisRequestLoop } from '../lib/loops/synthesisRequestLoop.js';
import {
  NEWS_BRIEF_V1_SCHEMA_ID,
  validateNewsBriefJobDelivery
} from '../lib/deliverySchemas/index.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hoursBetween(startIso, endIso) {
  return (Date.parse(endIso) - Date.parse(startIso)) / (60 * 60 * 1000);
}

function jsonResponse(payload = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return clone(payload);
    }
  };
}

const jobs = [];
const serviceInvocations = [];
const workflows = [];
const x402Requests = [];
const trustPublications = [];
const validateCalls = [];
let createCalls = 0;
let fundCalls = 0;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = String(options?.method || 'GET').trim().toUpperCase();
  const parsedUrl = new URL(String(url));
  const pathname = parsedUrl.pathname;
  const body = options?.body ? JSON.parse(String(options.body)) : {};

  if (method === 'POST' && pathname === '/api/jobs') {
    createCalls += 1;
    const now = new Date().toISOString();
    const job = {
      jobId: `job_hourly_news_${createCalls}`,
      traceId: String(body.traceId || '').trim(),
      state: 'created',
      provider: String(body.provider || '').trim(),
      capability: String(body.capability || '').trim(),
      budget: String(body.budget || '').trim(),
      payer: String(body.payer || body.requester || '0xrequester').trim(),
      executor: String(body.executor || '').trim(),
      validator: '0xvalidator',
      escrowAmount: String(body.escrowAmount || body.budget || '').trim(),
      escrowState: '',
      templateId: String(body.templateId || '').trim(),
      summary: String(body.summary || '').trim(),
      input: clone(body.input || {}),
      expiresAt: String(body.expiresAt || '').trim(),
      createdAt: now,
      updatedAt: now,
      createAnchorTxHash: `0xcreate${createCalls}`
    };
    jobs.unshift(job);
    return jsonResponse({ ok: true, job });
  }

  if (method === 'POST' && /\/api\/jobs\/[^/]+\/prepare-funding$/.test(pathname)) {
    return jsonResponse({ ok: true });
  }

  if (method === 'POST' && /\/api\/jobs\/[^/]+\/fund$/.test(pathname)) {
    fundCalls += 1;
    const jobId = pathname.split('/')[3];
    const job = jobs.find((item) => item.jobId === jobId);
    assert(job, `fund target job not found: ${jobId}`);
    const now = new Date().toISOString();
    job.state = 'funded';
    job.escrowState = 'funded';
    job.updatedAt = now;
    job.fundedAt = now;
    job.fundingTxHash = `0xfund${fundCalls}`;
    return jsonResponse({ ok: true, fundingTxHash: job.fundingTxHash });
  }

  if (method === 'POST' && /\/api\/jobs\/[^/]+\/validate$/.test(pathname)) {
    const jobId = pathname.split('/')[3];
    const job = jobs.find((item) => item.jobId === jobId);
    assert(job, `validate target job not found: ${jobId}`);
    const approved = Boolean(body.approved);
    const now = new Date().toISOString();
    job.state = approved ? 'completed' : 'rejected';
    job.summary = String(body.summary || body.reason || '').trim();
    job.updatedAt = now;
    job.validatedAt = now;
    if (approved) job.completedAt = now;
    else job.rejectedAt = now;
    validateCalls.push({ jobId, approved, summary: job.summary });
    return jsonResponse({ ok: true, job });
  }

  throw new Error(`Unexpected fetch: ${method} ${pathname}`);
};

try {
  const loop = createSynthesisRequestLoop({
    intervalMs: 3600_000,
    readJobs: () => jobs.map((item) => clone(item)),
    readServiceInvocations: () => serviceInvocations.map((item) => clone(item)),
    readTrustPublications: () => trustPublications.map((item) => clone(item)),
    readWorkflows: () => workflows.map((item) => clone(item)),
    readX402Requests: () => x402Requests.map((item) => clone(item)),
    broadcastEvent: null,
    PORT: 3399
  });

  await loop.triggerNow();
  assert(createCalls === 1, 'initial tick should create one hourly news job');
  assert(fundCalls === 1, 'initial tick should fund the created job');
  const firstJob = jobs.find((item) => item.jobId === 'job_hourly_news_1');
  assert(firstJob, 'initial tick did not persist the created job');
  assert(firstJob.templateId === 'erc8183-hourly-news-brief', 'hourly news job templateId mismatch');
  assert(firstJob.capability === 'cap-news-signal', 'hourly news job capability mismatch');
  assert(firstJob.state === 'funded', 'hourly news job should be funded after the first tick');
  assert(hoursBetween(firstJob.createdAt, firstJob.expiresAt) >= 5.9, 'hourly news job should default to a 6 hour expiry');

  await loop.triggerNow();
  assert(createCalls === 1, 'active funded hourly news job should block duplicate creation');
  assert(loop.getStatus().lastStatus === 'skipped_active_job', 'active funded hourly news job should set skipped_active_job');

  firstJob.state = 'submitted';
  firstJob.delivery = {
    schema: NEWS_BRIEF_V1_SCHEMA_ID,
    summary: 'BTC macro pressure eased and liquidity remains stable.',
    items: [
      {
        headline: 'Macro pressure cools while BTC liquidity trend holds',
        sourceUrl: 'https://www.coindesk.com/markets/2026/03/20/gold-falters-as-macro-pressures-build-bitcoin-holds-liquidity-trend'
      }
    ],
    newsTraceId: 'service_news_trace_1',
    paymentTxHash: '0xpaymentnews1',
    trustTxHash: '0xtrustnews1'
  };
  firstJob.resultRef = `/api/jobs/${encodeURIComponent(firstJob.jobId)}/audit`;
  firstJob.resultHash = '0xresulthashnews1';
  firstJob.paymentTxHash = '0xpaymentnews1';
  firstJob.submittedAt = new Date().toISOString();

  serviceInvocations.unshift({
    traceId: 'service_news_trace_1',
    serviceId: 'cap-news-signal',
    action: 'news-signal',
    requestId: 'x402_news_request_1',
    state: 'success',
    txHash: '0xpaymentnews1'
  });
  workflows.unshift({
    traceId: 'service_news_trace_1',
    type: 'news-signal',
    requestId: 'x402_news_request_1',
    txHash: '0xpaymentnews1'
  });
  x402Requests.unshift({
    requestId: 'x402_news_request_1',
    action: 'cap-news-signal',
    a2a: {
      capability: 'cap-news-signal',
      taskType: 'news-signal',
      traceId: 'service_news_trace_1'
    },
    previewResult: {
      external: {
        data: {
          articles: [
            {
              title: 'Macro pressure cools while BTC liquidity trend holds',
              sourceUrl: 'https://www.coindesk.com/markets/2026/03/20/gold-falters-as-macro-pressures-build-bitcoin-holds-liquidity-trend'
            }
          ]
        }
      }
    }
  });
  trustPublications.unshift({
    publicationId: 'pub_news_1',
    referenceId: 'x402_news_request_1',
    traceId: 'service_news_trace_1',
    anchorTxHash: '0xtrustnews1'
  });

  await loop.triggerNow();
  assert(validateCalls.length === 1, 'submitted hourly news job should have been validated');
  assert(validateCalls[0].approved === true, 'valid hourly news brief should be approved');
  assert(firstJob.state === 'completed', 'validated hourly news brief should be completed');
  assert(createCalls === 2, 'once the submitted job settles, the next tick should create a new hourly news job');

  const failingValidation = validateNewsBriefJobDelivery({
    job: {
      delivery: {
        schema: NEWS_BRIEF_V1_SCHEMA_ID,
        summary: 'Invalid source url mismatch case.',
        items: [
          {
            headline: 'Mismatched source',
            sourceUrl: 'https://example.com/not-in-preview'
          }
        ],
        newsTraceId: 'service_news_trace_1',
        paymentTxHash: '0xpaymentnews1',
        trustTxHash: '0xtrustnews1'
      },
      capability: 'cap-news-signal'
    },
    readServiceInvocations: () => serviceInvocations.map((item) => clone(item)),
    readTrustPublications: () => trustPublications.map((item) => clone(item)),
    readWorkflows: () => workflows.map((item) => clone(item)),
    readX402Requests: () => x402Requests.map((item) => clone(item))
  });
  assert(failingValidation.ok === false, 'mismatched sourceUrl should fail hard validation');
  assert(failingValidation.code === 'source_url_mismatch', 'mismatched sourceUrl should report source_url_mismatch');

  console.log(JSON.stringify({
    ok: true,
    summary: {
      createdJobs: createCalls,
      fundedJobs: fundCalls,
      validatedJobs: validateCalls.length,
      finalStatuses: jobs.map((item) => ({ jobId: item.jobId, state: item.state }))
    }
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
