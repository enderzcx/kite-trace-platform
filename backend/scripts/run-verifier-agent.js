import { validateBtcTradingPlanV1 } from '../lib/deliverySchemas/btcTradingPlanV1.js';
import { readDemoArtifact, requestJson } from './demoBtcJobHelpers.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

const artifact = readDemoArtifact();
assert(artifact?.jobId, 'Demo artifact missing jobId.');
assert(artifact?.validator, 'Demo artifact missing validator address.');

const auditPayload = await requestJson(`/api/public/jobs/${encodeURIComponent(artifact.jobId)}/audit`);
const audit = auditPayload?.audit || {};
const delivery = audit?.delivery || null;
const evidence = audit?.evidence || {};

assert(delivery && typeof delivery === 'object', 'Public audit did not expose delivery payload.');
assert(normalizeText(evidence?.primaryTraceId), 'Public audit did not expose evidence.primaryTraceId.');
assert(normalizeText(evidence?.paymentRequestId), 'Public audit did not expose evidence.paymentRequestId.');
assert(Array.isArray(evidence?.receiptRefs) && evidence.receiptRefs.length > 0, 'Public audit did not expose evidence.receiptRefs.');

const validation = validateBtcTradingPlanV1(delivery);
assert(validation.ok, `Delivery schema validation failed: ${JSON.stringify(validation.errors || [])}`);

const result = await requestJson(`/api/jobs/${encodeURIComponent(artifact.jobId)}/validate`, {
  method: 'POST',
  body: {
    approved: true,
    validator: normalizeText(artifact.validator),
    summary: 'BTC trading plan delivery validated against ktrace-btc-trading-plan-v1.',
    evaluator: 'btc-demo-verifier'
  }
});

assert(String(result?.job?.state || '').trim() === 'completed', `Expected completed state, received ${String(result?.job?.state || '').trim() || 'unknown'}.`);

console.log(
  JSON.stringify(
    {
      ok: true,
      jobId: normalizeText(result?.job?.jobId),
      traceId: normalizeText(result?.job?.traceId),
      deliverySchema: normalizeText(delivery?.schema),
      receiptRefs: evidence.receiptRefs
    },
    null,
    2
  )
);
