import { assert, createConsumerAuthorityHarness } from './consumerAuthorityHarness.mjs';

const harness = await createConsumerAuthorityHarness();

try {
  harness.resetAuthorityRuntime();

  const initialPolicy = await harness.requestJson('/api/session/policy');
  assert(initialPolicy.response.ok, 'GET /api/session/policy did not return 200');
  assert(
    String(initialPolicy.payload?.authority?.authorityId || '').trim().length > 0,
    'session policy did not materialize authorityId'
  );
  assert(
    String(initialPolicy.payload?.runtime?.authorityId || '').trim().length > 0,
    'session runtime did not persist materialized authorityId'
  );

  const updatePolicy = await harness.requestJson('/api/session/policy', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      consumerAgentLabel: 'smoke-consumer',
      allowedCapabilities: ['btc-price-feed'],
      allowedProviders: ['price-agent'],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 12,
      totalLimit: 40,
      expiresAt: Date.now() + 60_000
    })
  });
  assert(updatePolicy.response.ok, 'POST /api/session/policy did not return 200');
  assert(
    updatePolicy.payload?.authority?.consumerAgentLabel === 'smoke-consumer',
    'session policy update did not persist consumerAgentLabel'
  );
  assert(
    Array.isArray(updatePolicy.payload?.authority?.allowedProviders) &&
      updatePolicy.payload.authority.allowedProviders[0] === 'price-agent',
    'session policy update did not persist allowedProviders'
  );

  const validateAllowed = await harness.requestJson('/api/session/validate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      payer: '0x1111111111111111111111111111111111111111',
      provider: 'price-agent',
      capability: 'btc-price-feed',
      recipient: '0x3333333333333333333333333333333333333333',
      amount: '1',
      actionKind: 'buy_direct',
      referenceId: 'tpl_svc-price'
    })
  });
  assert(validateAllowed.response.ok, 'POST /api/session/validate allow path did not return 200');
  assert(validateAllowed.payload?.allowed === true, 'session validate allow path did not allow action');
  assert(
    String(validateAllowed.payload?.policySnapshotHash || '').startsWith('sha256:'),
    'session validate allow path did not return policySnapshotHash'
  );

  const validateProviderDenied = await harness.requestJson('/api/session/validate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      payer: '0x1111111111111111111111111111111111111111',
      provider: 'other-agent',
      capability: 'btc-price-feed',
      recipient: '0x3333333333333333333333333333333333333333',
      amount: '1',
      actionKind: 'buy_direct',
      referenceId: 'tpl_svc-price'
    })
  });
  assert(validateProviderDenied.response.status === 403, 'provider deny path did not return 403');
  assert(
    validateProviderDenied.payload?.error === 'provider_not_allowed',
    'provider deny path did not return provider_not_allowed'
  );

  const validateRecipientDenied = await harness.requestJson('/api/session/validate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      payer: '0x1111111111111111111111111111111111111111',
      provider: 'price-agent',
      capability: 'btc-price-feed',
      recipient: '0x9999999999999999999999999999999999999999',
      amount: '1',
      actionKind: 'buy_direct',
      referenceId: 'tpl_svc-price'
    })
  });
  assert(validateRecipientDenied.response.status === 403, 'recipient deny path did not return 403');
  assert(
    validateRecipientDenied.payload?.error === 'recipient_not_allowed',
    'recipient deny path did not return recipient_not_allowed'
  );

  const validateAmountDenied = await harness.requestJson('/api/session/validate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      payer: '0x1111111111111111111111111111111111111111',
      provider: 'price-agent',
      capability: 'btc-price-feed',
      recipient: '0x3333333333333333333333333333333333333333',
      amount: '6',
      actionKind: 'buy_direct',
      referenceId: 'tpl_svc-price'
    })
  });
  assert(validateAmountDenied.response.status === 403, 'singleLimit deny path did not return 403');
  assert(
    validateAmountDenied.payload?.error === 'amount_exceeds_single_limit',
    'singleLimit deny path did not return amount_exceeds_single_limit'
  );

  const revokePolicy = await harness.requestJson('/api/session/policy/revoke', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      revocationReason: 'operator_revoke'
    })
  });
  assert(revokePolicy.response.ok, 'POST /api/session/policy/revoke did not return 200');
  assert(revokePolicy.payload?.authority?.status === 'revoked', 'policy revoke did not mark authority revoked');

  const validateRevoked = await harness.requestJson('/api/session/validate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      payer: '0x1111111111111111111111111111111111111111',
      provider: 'price-agent',
      capability: 'btc-price-feed',
      recipient: '0x3333333333333333333333333333333333333333',
      amount: '1',
      actionKind: 'buy_direct',
      referenceId: 'tpl_svc-price'
    })
  });
  assert(validateRevoked.response.status === 403, 'revoked validate path did not return 403');
  assert(validateRevoked.payload?.error === 'authority_revoked', 'revoked validate path did not return authority_revoked');

  console.log(
    JSON.stringify({
      ok: true,
      summary: {
        authorityId: updatePolicy.payload?.authority?.authorityId || '',
        allowedProvider: updatePolicy.payload?.authority?.allowedProviders?.[0] || '',
        allowHash: validateAllowed.payload?.policySnapshotHash || '',
        revokedAt: revokePolicy.payload?.authority?.revokedAt || 0
      }
    })
  );
} finally {
  await harness.close();
}
