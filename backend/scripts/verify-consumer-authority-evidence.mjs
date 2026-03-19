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
      consumerAgentLabel: 'evidence-smoke',
      allowedCapabilities: ['btc-price-feed', 'svc-price'],
      allowedProviders: ['price-agent'],
      allowedRecipients: ['0x3333333333333333333333333333333333333333'],
      singleLimit: 5,
      dailyLimit: 25
    })
  });
  assert(configure.response.ok, 'evidence setup policy did not return 200');

  const intentId = 'intent-evidence-1';
  const buy = await harness.requestJson('/api/templates/tpl_svc-price/buy', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intentId,
      payer: '0x1111111111111111111111111111111111111111',
      input: {
        pair: 'BTCUSDT'
      }
    })
  });
  assert(buy.response.ok, 'evidence direct buy did not return 200');
  const purchase = buy.payload?.purchase || null;
  const traceId = purchase?.traceId || '';
  const requestId = purchase?.paymentId || '';
  assert(traceId, 'evidence direct buy did not produce traceId');
  assert(requestId, 'evidence direct buy did not produce requestId');

  const receiptResult = await harness.requestJson(`/api/receipt/${encodeURIComponent(requestId)}`);
  assert(receiptResult.response.ok, 'receipt endpoint did not return 200');
  const receipt = receiptResult.payload?.receipt || null;
  assert(receipt?.authorityId, 'receipt did not include authorityId');
  assert(receipt?.intentId === intentId, 'receipt did not include intentId');
  assert(String(receipt?.policySnapshotHash || '').startsWith('sha256:'), 'receipt did not include policySnapshotHash');
  assert(receipt?.authorization?.policySnapshot, 'receipt did not include internal authorization policySnapshot');
  assert(receipt?.authorization?.authoritySummary, 'receipt did not include authoritySummary');

  const evidenceResult = await harness.requestJson(
    `/api/evidence/export?traceId=${encodeURIComponent(traceId)}`
  );
  assert(evidenceResult.response.ok, 'internal evidence endpoint did not return 200');
  const internalEvidence = evidenceResult.payload?.evidence || null;
  assert(internalEvidence?.authorization?.authorityId === receipt.authorityId, 'internal evidence authorityId mismatch');
  assert(internalEvidence?.authorization?.intentId === intentId, 'internal evidence intentId mismatch');
  assert(
    String(internalEvidence?.authorization?.policySnapshotHash || '').startsWith('sha256:'),
    'internal evidence did not include policySnapshotHash'
  );
  assert(internalEvidence?.authorization?.policySnapshot, 'internal evidence did not include policySnapshot');
  assert(
    internalEvidence?.authorization?.validationDecision === 'allowed',
    'internal evidence did not include validationDecision'
  );

  const publicEvidenceResult = await harness.requestJson(
    `/api/public/evidence/${encodeURIComponent(traceId)}`
  );
  assert(publicEvidenceResult.response.ok, 'public evidence endpoint did not return 200');
  const publicEvidence = publicEvidenceResult.payload?.evidence || null;
  assert(publicEvidence?.authorityId === receipt.authorityId, 'public evidence authorityId mismatch');
  assert(publicEvidence?.authoritySummary, 'public evidence did not include authoritySummary');
  assert(
    String(publicEvidence?.policySnapshotHash || '').startsWith('sha256:'),
    'public evidence did not include policySnapshotHash'
  );
  assert(publicEvidence?.intentId === intentId, 'public evidence did not include intentId');
  assert(publicEvidence?.authorizedBy, 'public evidence lost legacy authorizedBy field');
  assert(publicEvidence?.authorizationMode, 'public evidence lost legacy authorizationMode field');

  console.log(
    JSON.stringify({
      ok: true,
      summary: {
        authorityId: receipt.authorityId,
        intentId,
        traceId,
        requestId,
        policySnapshotHash: receipt.policySnapshotHash
      }
    })
  );
} finally {
  await harness.close();
}
