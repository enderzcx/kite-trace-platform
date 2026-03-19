import {
  loadCapabilities,
  loadSessionRuntime,
  pickMarketCapability,
  pollJobUntilSettled,
  requestJson,
  resolveExecutorAddress,
  resolveValidatorAddress,
  writeDemoArtifact
} from './demoBtcJobHelpers.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const TASK_TEXT = `Provide a BTC/USDT trading plan for today.

Required deliverables:
- current market snapshot (price, 24h volume)
- directional bias (long / short / neutral)
- entry price and entry zone
- at least two take-profit targets, each with a rationale
- stop-loss level with rationale
- risk/reward ratio
- short analysis summary (key levels, sentiment)

All market data must be sourced through registered ktrace capabilities.
At least one capability call must be a paid call that produces a payment receipt.
The final delivery must include the primary traceId and payment receipt references.`;

const DEFAULT_BUDGET = '0.00015';

const capabilities = await loadCapabilities();
const chosen = pickMarketCapability(capabilities);
assert(chosen, 'No capability was available for the BTC demo job.');

const runtime = await loadSessionRuntime();
const payer = String(
  process.env.DEMO_BTC_JOB_PAYER || runtime?.aaWallet || ''
).trim();
const executor = resolveExecutorAddress();
const validator = resolveValidatorAddress();

assert(payer, 'Session runtime did not expose a requester AA wallet.');
assert(executor, 'Missing executor AA address. Set DEMO_BTC_JOB_EXECUTOR or ERC8183_EXECUTOR_AA_ADDRESS.');
assert(validator, 'Missing validator AA address. Set DEMO_BTC_JOB_VALIDATOR or ERC8183_VALIDATOR_AA_ADDRESS.');

const budget = String(process.env.DEMO_BTC_JOB_BUDGET || '').trim() || DEFAULT_BUDGET;
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const created = await requestJson('/api/jobs', {
  method: 'POST',
  body: {
    provider: String(chosen.providerId || chosen.providerAgentId || '').trim(),
    capability: String(chosen.action || chosen.capabilityId || chosen.id || '').trim(),
    budget,
    escrowAmount: budget,
    payer,
    executor,
    validator,
    expiresAt,
    input: {
      task: TASK_TEXT,
      schema: 'ktrace-btc-trading-plan-v1',
      asset: 'BTC/USDT'
    }
  }
});
const job = created?.job || {};
assert(job?.jobId, 'Job creation did not return jobId.');

console.log(`Job created: ${job.jobId}. Submitting async fund...`);

await requestJson(`/api/jobs/${encodeURIComponent(job.jobId)}/fund`, {
  method: 'POST',
  body: {
    escrowAmount: budget,
    async: true
  }
});

console.log('Fund submitted. Polling for chain confirmation...');

const pollTimeoutMs = Math.max(10000, Number(process.env.DEMO_BTC_JOB_POLL_TIMEOUT_MS || 300000));
const funded = await pollJobUntilSettled(job.jobId, { maxWaitMs: pollTimeoutMs });

const finalState = String(funded?.job?.state || '').trim();
if (finalState !== 'funded') {
  throw new Error(`Expected funded state, received ${finalState || 'unknown'}.`);
}

const artifact = {
  jobId: String(funded.job.jobId || '').trim(),
  traceId: String(funded.job.traceId || '').trim(),
  provider: String(funded.job.provider || '').trim(),
  capability: String(funded.job.capability || '').trim(),
  budget,
  payer,
  executor,
  validator,
  seededAt: new Date().toISOString()
};

writeDemoArtifact(artifact);

console.log(JSON.stringify({ ok: true, artifact }, null, 2));
