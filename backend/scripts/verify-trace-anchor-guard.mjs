import { assert, startTraceAnchorHarness } from './traceAnchorHarness.mjs';

function createAcceptedJob(jobId = 'job_trace_guard') {
  return {
    jobId,
    traceId: `trace_${jobId}`,
    state: 'accepted',
    provider: 'provider-harness',
    capability: 'btc-price-feed',
    payer: '0x1111111111111111111111111111111111111111',
    budget: '0.00015',
    escrowAmount: '0.00015',
    executor: '0x2222222222222222222222222222222222222222',
    validator: '0x3333333333333333333333333333333333333333',
    input: { pair: 'BTCUSDT' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    payload: await response.json()
  };
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });
  return {
    status: response.status,
    payload: await response.json()
  };
}

const summaries = [];

{
  const harness = await startTraceAnchorHarness({
    port: 34941,
    anchorRegistry: '',
    guardAddress: '',
    initialJobs: [createAcceptedJob('job_guard_off_submit')]
  });
  try {
    const result = await postJson(`${harness.host}/api/jobs/job_guard_off_submit/submit`, {});
    assert(result.status === 200 && result.payload?.ok === true, 'guard off submit should succeed');
    summaries.push({ scenario: 'guard_off_unanchored_submit', status: result.status });
  } finally {
    await harness.close();
  }
}

{
  const harness = await startTraceAnchorHarness({
    port: 34942,
    anchorRegistry: '',
    guardAddress: '0x4444444444444444444444444444444444444444',
    initialJobs: [createAcceptedJob('job_guard_on_unanchored')],
    submitEscrow: async () => {
      const error = new Error('trace_anchor_required');
      error.code = 'trace_anchor_required';
      throw error;
    }
  });
  try {
    const result = await postJson(`${harness.host}/api/jobs/job_guard_on_unanchored/submit`, {});
    assert(result.status === 500, 'guard on unanchored submit should fail');
    assert(
      result.payload?.error?.code === 'trace_anchor_required_before_submit',
      'guard on unanchored submit error code mismatch'
    );
    summaries.push({ scenario: 'guard_on_unanchored_submit_reverts', status: result.status });
  } finally {
    await harness.close();
  }
}

{
  const harness = await startTraceAnchorHarness({
    port: 34943,
    anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    guardAddress: '0x4444444444444444444444444444444444444444',
    initialJobs: [createAcceptedJob('job_guard_on_anchored')],
    checkAnchorExists: async (jobId = '') => ({
      configured: true,
      registryAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jobId,
      hasAnchor: jobId === 'job_guard_on_anchored',
      latestAnchorId: jobId === 'job_guard_on_anchored' ? '55' : ''
    }),
    readLatestAnchorId: async (jobId = '') => ({
      configured: true,
      registryAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jobId,
      latestAnchorId: jobId === 'job_guard_on_anchored' ? '55' : ''
    })
  });
  try {
    const result = await postJson(`${harness.host}/api/jobs/job_guard_on_anchored/submit`, {});
    assert(result.status === 200 && result.payload?.ok === true, 'guard on anchored submit should succeed');
    summaries.push({ scenario: 'guard_on_anchored_submit_succeeds', status: result.status });
  } finally {
    await harness.close();
  }
}

{
  let submitAttempt = 0;
  const harness = await startTraceAnchorHarness({
    port: 34944,
    anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    guardAddress: '0x4444444444444444444444444444444444444444',
    initialJobs: [createAcceptedJob('job_guard_retry')],
    submitEscrow: async () => {
      submitAttempt += 1;
      if (submitAttempt === 1) {
        throw new Error('escrow submit temporary failure');
      }
      return {
        configured: true,
        submitted: true,
        contractAddress: '0xescrow',
        tokenAddress: '0xtoken',
        txHash: '0xescrowsubmit',
        escrowState: 'submitted'
      };
    }
  });
  try {
    const first = await postJson(`${harness.host}/api/jobs/job_guard_retry/submit`, {});
    const second = await postJson(`${harness.host}/api/jobs/job_guard_retry/submit`, {});
    assert(first.status === 500, 'guard retry first submit should fail');
    assert(second.status === 200 && second.payload?.ok === true, 'guard retry second submit should succeed');
    assert(harness.counters.anchorCalls === 1, 'guard retry should not republish anchor');
    summaries.push({ scenario: 'guard_retry_reuses_anchor', status: second.status });
  } finally {
    await harness.close();
  }
}

{
  const harness = await startTraceAnchorHarness({
    port: 34945,
    anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    guardAddress: '0x4444444444444444444444444444444444444444',
    initialJobs: [
      {
        jobId: 'job_v1_legacy_anchor',
        traceId: 'trace_job_v1_legacy_anchor',
        state: 'accepted',
        provider: 'provider-harness',
        capability: 'btc-price-feed',
        submitAnchorId: '11',
        submitAnchorTxHash: '0xlegacyanchor',
        submitAnchorConfirmedAt: '2026-03-18T00:00:00.000Z',
        anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        updatedAt: '2026-03-18T00:00:00.000Z'
      }
    ],
    checkAnchorExists: async (jobId = '') => ({
      configured: true,
      registryAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jobId,
      hasAnchor: false,
      latestAnchorId: ''
    }),
    readLatestAnchorId: async (jobId = '') => ({
      configured: true,
      registryAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jobId,
      latestAnchorId: ''
    })
  });
  try {
    const result = await getJson(`${harness.host}/api/jobs/job_v1_legacy_anchor/trace-anchor`);
    assert(result.status === 200 && result.payload?.ok === true, 'legacy trace anchor status should succeed');
    assert(result.payload?.verificationMode === 'legacy_v1_unknown', 'legacy verification mode mismatch');
    assert(result.payload?.anchor?.verifiedOnchain === null, 'legacy verifiedOnchain should be null');
    summaries.push({ scenario: 'legacy_v1_unknown_status', status: result.status });
  } finally {
    await harness.close();
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      summary: summaries
    },
    null,
    2
  )
);
