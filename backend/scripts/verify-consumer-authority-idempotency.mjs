import { assert, createConsumerAuthorityHarness } from './consumerAuthorityHarness.mjs';

const harness = await createConsumerAuthorityHarness();

try {
  const configure = await harness.requestJson('/api/session/policy', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      consumerAgentLabel: 'idempotency-smoke',
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: [],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25
    })
  });
  assert(configure.response.ok, 'idempotency setup policy did not return 200');

  const directIntentId = 'intent-direct-1';
  const directBuy = await harness.requestJson('/api/templates/tpl_svc-price/buy', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: directIntentId,
      payer: '0x1111111111111111111111111111111111111111',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(directBuy.response.ok, 'direct buy initial call did not return 200');
  assert(directBuy.payload?.purchase?.state === 'completed', 'direct buy initial call did not complete');

  const directBuyReplay = await harness.requestJson('/api/templates/tpl_svc-price/buy', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: directIntentId,
      payer: '0x1111111111111111111111111111111111111111',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(directBuyReplay.response.status === 409, 'direct buy replay did not return 409');
  assert(directBuyReplay.payload?.error === 'intent_replayed', 'direct buy replay did not return intent_replayed');
  assert(harness.state.purchases.length === 1, 'direct buy replay created duplicate purchase records');

  const invokeIntentId = 'intent-invoke-1';
  const invokeAllowed = await harness.requestJson('/api/services/svc-price/invoke', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: invokeIntentId,
      payer: '0x1111111111111111111111111111111111111111',
      pair: 'BTCUSDT'
    })
  });
  assert(invokeAllowed.response.ok, 'service invoke initial call did not return 200');
  assert(invokeAllowed.payload?.requestId, 'service invoke initial call did not return requestId');
  const invocationCountAfterFirstInvoke = harness.state.serviceInvocations.length;

  const invokeReplay = await harness.requestJson('/api/services/svc-price/invoke', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: invokeIntentId,
      payer: '0x1111111111111111111111111111111111111111',
      pair: 'BTCUSDT'
    })
  });
  assert(invokeReplay.response.status === 409, 'service invoke replay did not return 409');
  assert(invokeReplay.payload?.error === 'intent_conflict', 'service invoke replay did not return intent_conflict');
  assert(
    harness.state.serviceInvocations.length === invocationCountAfterFirstInvoke,
    'service invoke replay created duplicate invocation records'
  );

  const jobCreateA = await harness.requestJson('/api/jobs', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'price-agent',
      capability: 'btc-price-feed',
      budget: '0.001',
      payer: '0x1111111111111111111111111111111111111111',
      executor: '0x7777777777777777777777777777777777777777',
      validator: '0x8888888888888888888888888888888888888888',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  const jobAId = jobCreateA.payload?.job?.jobId || '';
  assert(jobCreateA.response.ok && jobAId, 'job create A did not return jobId');

  const fundIntentId = 'intent-job-fund-1';
  const jobFundA = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobAId)}/fund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: fundIntentId
    })
  });
  assert(jobFundA.response.ok, 'job fund A did not return 200');
  assert(jobFundA.payload?.job?.state === 'funded', 'job fund A did not fund the job');

  const jobCreateB = await harness.requestJson('/api/jobs', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'price-agent',
      capability: 'btc-price-feed',
      budget: '0.001',
      payer: '0x1111111111111111111111111111111111111111',
      executor: '0x7777777777777777777777777777777777777777',
      validator: '0x8888888888888888888888888888888888888888',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  const jobBId = jobCreateB.payload?.job?.jobId || '';
  assert(jobCreateB.response.ok && jobBId, 'job create B did not return jobId');

  const jobFundConflict = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobBId)}/fund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: fundIntentId
    })
  });
  assert(jobFundConflict.response.status === 409, 'job fund conflict did not return 409');
  assert(
    jobFundConflict.payload?.error?.code === 'intent_conflict',
    'job fund conflict did not return intent_conflict'
  );
  assert(
    harness.state.jobs.find((item) => item.jobId === jobBId)?.state === 'created',
    'job fund conflict still changed second job state'
  );

  const jobAcceptA = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobAId)}/accept`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert(jobAcceptA.response.ok, 'job accept A did not return 200');

  const submitIntentId = 'intent-job-submit-1';
  const jobSubmitA = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobAId)}/submit`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: submitIntentId,
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(jobSubmitA.response.ok, 'job submit A did not return 200');
  assert(jobSubmitA.payload?.job?.state === 'submitted', 'job submit A did not submit the job');

  const jobFundB = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobBId)}/fund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: 'intent-job-fund-2'
    })
  });
  assert(jobFundB.response.ok, 'job fund B did not return 200');

  const jobAcceptB = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobBId)}/accept`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert(jobAcceptB.response.ok, 'job accept B did not return 200');

  const jobSubmitConflict = await harness.requestJson(`/api/jobs/${encodeURIComponent(jobBId)}/submit`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: submitIntentId,
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(jobSubmitConflict.response.status === 409, 'job submit conflict did not return 409');
  assert(
    jobSubmitConflict.payload?.error?.code === 'intent_conflict',
    'job submit conflict did not return intent_conflict'
  );
  assert(
    harness.state.jobs.find((item) => item.jobId === jobBId)?.state === 'accepted',
    'job submit conflict still changed second job state'
  );

  console.log(
    JSON.stringify({
      ok: true,
      summary: {
        directPurchases: harness.state.purchases.length,
        serviceInvocations: harness.state.serviceInvocations.length,
        consumerIntents: harness.state.consumerIntents.length,
        fundedJobState: harness.state.jobs.find((item) => item.jobId === jobAId)?.state || '',
        conflictedJobState: harness.state.jobs.find((item) => item.jobId === jobBId)?.state || ''
      }
    })
  );
} finally {
  await harness.close();
}
