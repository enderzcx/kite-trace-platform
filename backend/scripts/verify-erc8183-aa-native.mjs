import fs from 'node:fs';
import path from 'node:path';

const baseUrl = String(
  process.env.KTRACE_BASE_URL ||
    process.env.DEMO_BTC_JOB_BASE_URL ||
    (process.env.PORT ? `http://127.0.0.1:${String(process.env.PORT).trim()}` : '') ||
    'http://127.0.0.1:3399'
)
  .trim()
  .replace(/\/+$/, '');

const artifactPath = path.resolve(process.cwd(), 'data', 'demo_btc_job.json');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readArtifact() {
  const envJobId = normalizeText(process.env.KTRACE_JOB_ID || '');
  if (envJobId) {
    return { jobId: envJobId };
  }
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`demo artifact missing: ${artifactPath}. Run demo:btc-job:run first or set KTRACE_JOB_ID.`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { Accept: 'application/json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(normalizeText(payload?.reason || payload?.error || `HTTP ${response.status}`));
  }
  return payload;
}

const artifact = readArtifact();
const jobId = normalizeText(artifact?.jobId || '');
assert(jobId, 'Missing jobId for AA-native verification.');

const auditPayload = await fetchJson(`/api/public/jobs/${encodeURIComponent(jobId)}/audit`);
const audit = auditPayload?.audit || {};
const roleEnforcement = audit?.contractPrimitives?.roleEnforcement || {};
const roleRuntimeSummary = roleEnforcement?.roleRuntimeSummary || {};

assert(
  normalizeText(roleEnforcement.executionMode) === 'aa_account_role_enforced',
  `Expected aa_account_role_enforced, received ${normalizeText(roleEnforcement.executionMode) || 'unknown'}. Restart the backend with the AA-native code and rerun the demo artifact if you are still seeing legacy signer-mode audit output.`
);
assert(normalizeText(audit?.requester || '') === normalizeText(artifact?.payer || ''), 'Requester address did not match the AA payer.');
assert(normalizeText(audit?.executor || '') === normalizeText(artifact?.executor || ''), 'Executor address did not match the AA executor.');
assert(normalizeText(audit?.validator || '') === normalizeText(artifact?.validator || ''), 'Validator address did not match the AA validator.');
assert(normalizeText(roleRuntimeSummary.requesterRuntimeAddress || '') === normalizeText(artifact?.payer || ''), 'Requester runtime summary did not resolve to the AA payer.');
assert(normalizeText(roleRuntimeSummary.executorRuntimeAddress || '') === normalizeText(artifact?.executor || ''), 'Executor runtime summary did not resolve to the executor AA address.');
assert(normalizeText(roleRuntimeSummary.validatorRuntimeAddress || '') === normalizeText(artifact?.validator || ''), 'Validator runtime summary did not resolve to the validator AA address.');

console.log(
  JSON.stringify(
    {
      ok: true,
      jobId,
      executionMode: normalizeText(roleEnforcement.executionMode),
      requester: normalizeText(audit?.requester || ''),
      executor: normalizeText(audit?.executor || ''),
      validator: normalizeText(audit?.validator || '')
    },
    null,
    2
  )
);
