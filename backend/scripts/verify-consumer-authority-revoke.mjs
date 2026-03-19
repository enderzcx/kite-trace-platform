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
      consumerAgentLabel: 'revoke-smoke',
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: [],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25
    })
  });
  assert(configure.response.ok, 'revoke setup policy did not return 200');

  const activeJob = await harness.requestJson('/api/jobs', {
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
  const activeJobId = activeJob.payload?.job?.jobId || '';
  assert(activeJob.response.ok && activeJobId, 'active job create did not return jobId');

  const activeFund = await harness.requestJson(`/api/jobs/${encodeURIComponent(activeJobId)}/fund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: 'intent-revoke-active-fund'
    })
  });
  assert(activeFund.response.ok, 'active job fund did not return 200');

  const activeAccept = await harness.requestJson(`/api/jobs/${encodeURIComponent(activeJobId)}/accept`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert(activeAccept.response.ok, 'active job accept did not return 200');

  const countsBeforeRevoke = {
    purchases: harness.state.purchases.length,
    invocations: harness.state.serviceInvocations.length,
    fundedJobs: harness.state.jobs.filter((item) => item.state === 'funded').length,
    submittedJobs: harness.state.jobs.filter((item) => item.state === 'submitted').length
  };

  const revoke = await harness.requestJson('/api/session/policy/revoke', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      revocationReason: 'operator_revoke'
    })
  });
  assert(revoke.response.ok, 'policy revoke did not return 200');
  assert(revoke.payload?.authority?.status === 'revoked', 'policy revoke did not produce revoked status');

  const deniedBuy = await harness.requestJson('/api/templates/tpl_svc-price/buy', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: 'intent-revoke-direct-buy',
      payer: '0x1111111111111111111111111111111111111111',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(deniedBuy.response.status === 403, 'revoked direct buy did not return 403');
  assert(deniedBuy.payload?.error === 'authority_revoked', 'revoked direct buy did not return authority_revoked');

  const deniedInvoke = await harness.requestJson('/api/services/svc-price/invoke', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: 'intent-revoke-invoke',
      payer: '0x1111111111111111111111111111111111111111',
      pair: 'BTCUSDT'
    })
  });
  assert(deniedInvoke.response.status === 403, 'revoked service invoke did not return 403');
  assert(deniedInvoke.payload?.error === 'authority_revoked', 'revoked service invoke did not return authority_revoked');

  const blockedJob = await harness.requestJson('/api/jobs', {
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
  const blockedJobId = blockedJob.payload?.job?.jobId || '';
  assert(blockedJob.response.ok && blockedJobId, 'blocked job create did not return jobId');

  const deniedFund = await harness.requestJson(`/api/jobs/${encodeURIComponent(blockedJobId)}/fund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: 'intent-revoke-job-fund'
    })
  });
  assert(deniedFund.response.status === 403, 'revoked job fund did not return 403');
  assert(
    deniedFund.payload?.error?.code === 'authority_revoked',
    'revoked job fund did not return authority_revoked'
  );

  const deniedSubmit = await harness.requestJson(`/api/jobs/${encodeURIComponent(activeJobId)}/submit`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId: 'intent-revoke-job-submit',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(deniedSubmit.response.status === 403, 'revoked job submit did not return 403');
  assert(
    deniedSubmit.payload?.error?.code === 'authority_revoked',
    'revoked job submit did not return authority_revoked'
  );

  assert(harness.state.purchases.length === countsBeforeRevoke.purchases, 'revoked direct buy still created purchase records');
  assert(
    harness.state.serviceInvocations.length === countsBeforeRevoke.invocations,
    'revoked service invoke still created invocation records'
  );
  assert(
    harness.state.jobs.find((item) => item.jobId === blockedJobId)?.state === 'created',
    'revoked job fund still changed blocked job state'
  );
  assert(
    harness.state.jobs.find((item) => item.jobId === activeJobId)?.state === 'accepted',
    'revoked job submit still changed accepted job state'
  );
  assert(
    harness.state.jobs.filter((item) => item.state === 'submitted').length === countsBeforeRevoke.submittedJobs,
    'revoked execution produced submitted jobs'
  );

  console.log(
    JSON.stringify({
      ok: true,
      summary: {
        authorityId: revoke.payload?.authority?.authorityId || '',
        blockedJobId,
        activeJobId,
        purchases: harness.state.purchases.length,
        invocations: harness.state.serviceInvocations.length
      }
    })
  );
} finally {
  await harness.close();
}
