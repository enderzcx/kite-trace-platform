import { createAutoJobExpiryLoop } from '../lib/loops/jobExpiryLoop.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const expiredCalls = [];
const jobs = [
  {
    jobId: 'job_overdue_1',
    traceId: 'trace_overdue_1',
    state: 'accepted',
    escrowAmount: '1',
    executor: '0xexecutor',
    validator: '0xvalidator',
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  },
  {
    jobId: 'job_future_1',
    traceId: 'trace_future_1',
    state: 'accepted',
    escrowAmount: '1',
    executor: '0xexecutor',
    validator: '0xvalidator',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  },
  {
    jobId: 'job_no_escrow',
    traceId: 'trace_no_escrow',
    state: 'accepted',
    escrowAmount: '',
    executor: '',
    validator: '',
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  }
];

const loop = createAutoJobExpiryLoop({
  intervalMs: 10_000,
  port: 3999,
  getInternalAgentApiKey: () => 'agent-local-dev-key',
  readJobs: () => jobs.slice(),
  fetchImpl: async (url, options = {}) => {
    expiredCalls.push({
      url: String(url || ''),
      method: String(options?.method || '').trim(),
      apiKey: String(options?.headers?.['x-api-key'] || '').trim()
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          job: {
            jobId: 'job_overdue_1',
            state: 'expired'
          }
        };
      }
    };
  }
});

await loop.runAutoJobExpiryTick('manual');

const status = loop.getAutoJobExpiryStatus();
assert(expiredCalls.length === 1, 'auto expiry loop did not trigger exactly one overdue escrow job');
assert(expiredCalls[0].url.includes('/api/jobs/job_overdue_1/expire'), 'auto expiry loop called the wrong job');
assert(expiredCalls[0].method === 'POST', 'auto expiry loop did not use POST');
assert(expiredCalls[0].apiKey === 'agent-local-dev-key', 'auto expiry loop did not use internal api key');
assert(status.lastStatus === 'expired', 'auto expiry loop did not record expired status');
assert(status.expiredCount === 1, 'auto expiry loop did not increment expired count');
assert(status.lastExpiredJobId === 'job_overdue_1', 'auto expiry loop did not record expired job id');

console.log(
  JSON.stringify(
    {
      ok: true,
      summary: {
        expiredCount: status.expiredCount,
        scannedCount: status.scannedCount,
        lastExpiredJobId: status.lastExpiredJobId
      }
    },
    null,
    2
  )
);
