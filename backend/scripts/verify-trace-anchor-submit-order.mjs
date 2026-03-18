import { assert, startTraceAnchorHarness } from './traceAnchorHarness.mjs';

function createAcceptedJob(jobId = 'job_trace_submit') {
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

const summaries = [];

{
  const harness = await startTraceAnchorHarness({
    port: 34931,
    anchorRegistry: '',
    initialJobs: [createAcceptedJob('job_legacy_submit')]
  });
  try {
    const result = await postJson(`${harness.host}/api/jobs/job_legacy_submit/submit`, {});
    assert(result.status === 200 && result.payload?.ok === true, 'legacy submit path did not succeed');
    assert(harness.counters.anchorCalls === 0, 'legacy submit unexpectedly published anchor');
    assert(harness.counters.escrowSubmitCalls === 1, 'legacy submit did not reach escrow submit');
    summaries.push({ scenario: 'legacy_submit', status: result.status });
  } finally {
    await harness.close();
  }
}

{
  const harness = await startTraceAnchorHarness({
    port: 34932,
    anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    initialJobs: [createAcceptedJob('job_anchor_fail')],
    publishAnchor: async () => {
      throw new Error('trace anchor required before submit');
    }
  });
  try {
    const result = await postJson(`${harness.host}/api/jobs/job_anchor_fail/submit`, {});
    assert(result.status === 500, 'anchor failure did not return 500');
    assert(result.payload?.error === 'trace_anchor_publish_failed', 'anchor failure error code mismatch');
    assert(harness.counters.anchorCalls === 1, 'anchor failure did not attempt anchor publish');
    assert(harness.counters.escrowSubmitCalls === 0, 'anchor failure still called escrow submit');
    summaries.push({ scenario: 'anchor_failure_blocks_submit', status: result.status });
  } finally {
    await harness.close();
  }
}

{
  const harness = await startTraceAnchorHarness({
    port: 34933,
    anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    initialJobs: [createAcceptedJob('job_anchor_success')]
  });
  try {
    const result = await postJson(`${harness.host}/api/jobs/job_anchor_success/submit`, {});
    const job = result.payload?.job || {};
    assert(result.status === 200 && result.payload?.ok === true, 'anchored submit path did not succeed');
    assert(harness.counters.anchorCalls === 1, 'anchored submit did not publish anchor');
    assert(harness.counters.escrowSubmitCalls === 1, 'anchored submit did not reach escrow submit');
    assert(typeof job.submitAnchorId === 'string' && job.submitAnchorId, 'submitAnchorId missing');
    assert(typeof job.submitAnchorTxHash === 'string' && job.submitAnchorTxHash, 'submitAnchorTxHash missing');
    assert(typeof job.submitAnchorConfirmedAt === 'string' && job.submitAnchorConfirmedAt, 'submitAnchorConfirmedAt missing');
    summaries.push({ scenario: 'anchor_success_then_submit', status: result.status });
  } finally {
    await harness.close();
  }
}

{
  let submitAttempt = 0;
  const harness = await startTraceAnchorHarness({
    port: 34934,
    anchorRegistry: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    initialJobs: [createAcceptedJob('job_retry_submit')],
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
    const first = await postJson(`${harness.host}/api/jobs/job_retry_submit/submit`, {});
    assert(first.status === 500, 'first retry scenario call should fail');
    const second = await postJson(`${harness.host}/api/jobs/job_retry_submit/submit`, {});
    const job = second.payload?.job || {};
    assert(second.status === 200 && second.payload?.ok === true, 'second retry scenario call should succeed');
    assert(harness.counters.anchorCalls === 1, 'retry submit re-published anchor');
    assert(harness.counters.escrowSubmitCalls === 2, 'retry submit did not re-attempt escrow submit');
    assert(typeof job.submitAnchorTxHash === 'string' && job.submitAnchorTxHash, 'retry submit lost anchor tx hash');
    summaries.push({ scenario: 'retry_reuses_existing_anchor', status: second.status });
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
