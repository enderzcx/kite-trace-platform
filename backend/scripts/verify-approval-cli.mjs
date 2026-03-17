import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { unlink } from 'node:fs/promises';
import { runKtraceCli } from '../cli/runKtraceCli.js';
import { registerJobLaneRoutes } from '../routes/jobLaneRoutes.js';
import { registerCoreIdentityChatRoutes } from '../routes/coreIdentityChatRoutes.js';
import { ethers } from 'ethers';

const port = 34613;
const host = `http://127.0.0.1:${port}`;
const requester = '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4';
const ownerEoa = '0xf02fe12689e5026707d1be150b268e0fa5a37320';
const executor = '0x3333333333333333333333333333333333333333';
const validator = '0x4444444444444444444444444444444444444444';
const configPath = path.join(os.tmpdir(), `ktrace-approval-cli-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
const adminKey = 'admin-key';
const previousAdminKey = process.env.KTRACE_ADMIN_KEY;

process.env.KTRACE_ADMIN_KEY = adminKey;

const jobs = [];
const approvalRequests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function digestStableObject(input = {}) {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return {
    algorithm: 'sha256',
    canonicalization: 'sorted-top-level-json',
    value: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

function normalizeAddress(value = '') {
  return String(value || '').trim().toLowerCase();
}

async function runSilentCli(args = []) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await runKtraceCli(args);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = createTraceId('verify');
  next();
});

registerJobLaneRoutes(app, {
  crypto,
  createTraceId,
  digestStableObject,
  ensureServiceCatalog: () => [
    {
      id: 'svc-price',
      active: true,
      providerAgentId: 'fundamental-agent-real',
      action: 'btc-price-feed',
      name: 'BTC Price Feed'
    }
  ],
  ERC8183_EXECUTOR_AA_ADDRESS: executor,
  ERC8183_REQUESTER_AA_ADDRESS: requester,
  ERC8183_VALIDATOR_AA_ADDRESS: validator,
  getInternalAgentApiKey: () => '',
  KTRACE_JOB_APPROVAL_THRESHOLD: 0.00001,
  KTRACE_JOB_APPROVAL_TTL_MS: 24 * 60 * 60 * 1000,
  lockEscrowFunds: async () => ({
    configured: true,
    escrowState: 'funded',
    contractAddress: '0x5555555555555555555555555555555555555555',
    tokenAddress: '0x6666666666666666666666666666666666666666',
    txHash: '0xfundtx'
  }),
  normalizeAddress,
  PORT: String(port),
  publishJobLifecycleAnchorOnChain: async (input = {}) => ({
    configured: true,
    published: true,
    registryAddress: '0x4444444444444444444444444444444444444444',
    anchorId: `${input.anchorType || 'anchor'}_1`,
    anchorTxHash: `0x${String(input.anchorType || 'anchor').padEnd(8, '0')}`
  }),
  readJobs: () => jobs.slice(),
  readSessionApprovalRequests: () => approvalRequests.slice(),
  readSessionRuntime: () => ({
    aaWallet: requester,
    owner: ownerEoa,
    authorizedBy: ownerEoa,
    authorizationId: 'sga_cli_verify',
    authorizationMode: 'user_grant_self_custodial',
    authorizationPayloadHash: '0x' + '1'.repeat(64),
    authorizationAudience: host,
    authorizationExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
    allowedCapabilities: ['btc-price-feed']
  }),
  resolveSessionOwnerByAaWallet: () => ownerEoa,
  requireRole: () => (_req, _res, next) => next(),
  resolveWorkflowTraceId: (value = '') => String(value || '').trim() || createTraceId('job'),
  submitEscrowResult: async () => ({ configured: false }),
  upsertJobRecord: (job = {}) => {
    const index = jobs.findIndex((item) => String(item?.jobId || '').trim() === String(job?.jobId || '').trim());
    if (index >= 0) jobs[index] = job;
    else jobs.unshift(job);
  },
  validateEscrowJob: async () => ({ configured: false }),
  writeSessionApprovalRequests: (rows = []) => {
    approvalRequests.splice(0, approvalRequests.length, ...(Array.isArray(rows) ? rows : []));
  }
});

registerCoreIdentityChatRoutes(app, {
  BACKEND_RPC_URL: '',
  MERCHANT_ADDRESS: '',
  POLICY_DAILY_LIMIT_DEFAULT: '',
  POLICY_MAX_PER_TX_DEFAULT: '',
  ROUTER_WALLET_KEY_NORMALIZED: '',
  SETTLEMENT_TOKEN: '',
  backendSigner: null,
  createTraceId,
  crypto,
  ensureAAAccountDeployment: async () => ({ ok: true }),
  ERC8004_AGENT_ID: '',
  ERC8004_IDENTITY_REGISTRY: '',
  ethers,
  getInternalAgentApiKey: () => '',
  IDENTITY_CHALLENGE_MAX_ROWS: 50,
  IDENTITY_CHALLENGE_TTL_MS: 60_000,
  IDENTITY_VERIFY_MODE: 'owner',
  KTRACE_JOB_APPROVAL_THRESHOLD: 0.00001,
  KTRACE_JOB_APPROVAL_TTL_MS: 24 * 60 * 60 * 1000,
  KTRACE_ADMIN_KEY: adminKey,
  KITE_AGENT1_ID: '',
  KITE_AGENT2_ID: '',
  KITE_REQUIRE_AA_V2: false,
  AA_V2_VERSION_TAG: '',
  maskSecret: () => '',
  normalizeAddress,
  normalizeReactiveParams: (value = {}) => value,
  llmAdapter: null,
  PORT: String(port),
  readJobs: () => jobs.slice(),
  readSessionAuthorizations: () => [],
  readSessionApprovalRequests: () => approvalRequests.slice(),
  XMTP_ROUTER_DERIVED_ADDRESS: '',
  readIdentityChallenges: () => [],
  readRecords: () => [],
  readSessionRuntime: () => ({
    aaWallet: requester,
    owner: ownerEoa,
    authorizedBy: ownerEoa,
    authorizationId: 'sga_cli_verify',
    authorizationMode: 'user_grant_self_custodial',
    authorizationPayloadHash: '0x' + '1'.repeat(64),
    authorizationAudience: host,
    authorizationExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
    allowedCapabilities: ['btc-price-feed']
  }),
  resolveSessionOwnerPrivateKey: () => '',
  resolveSessionRuntime: () => ({}),
  readWorkflows: () => [],
  readX402Requests: () => [],
  requireRole: () => (_req, _res, next) => next(),
  resolveRoleByApiKey: () => 'admin',
  sessionPayConfigSnapshot: () => ({}),
  sessionPayMetrics: () => ({}),
  sessionRuntimePath: '',
  writeIdentityChallenges: () => {},
  writeJsonObject: () => {},
  writeRecords: () => {},
  writeSessionApprovalRequests: (rows = []) => {
    approvalRequests.splice(0, approvalRequests.length, ...(Array.isArray(rows) ? rows : []));
  },
  writeSessionAuthorizations: () => {},
  writeSessionRuntime: () => {},
  upsertJobRecord: (job = {}) => {
    const index = jobs.findIndex((item) => String(item?.jobId || '').trim() === String(job?.jobId || '').trim());
    if (index >= 0) jobs[index] = job;
    else jobs.unshift(job);
  }
});

const server = app.listen(port, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

try {
  const createResponse = await fetch(`${host}/api/jobs`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'fundamental-agent-real',
      capability: 'btc-price-feed',
      budget: '0.00015',
      escrowAmount: '0.00015',
      payer: requester,
      executor,
      validator,
      input: { pair: 'BTCUSDT' }
    })
  });
  const createPayload = await createResponse.json();
  const jobId = String(createPayload?.job?.jobId || '').trim();
  assert(jobId, 'job create did not return jobId');

  const fundResponse = await fetch(`${host}/api/jobs/${encodeURIComponent(jobId)}/fund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const fundPayload = await fundResponse.json();
  const approvalId = String(fundPayload?.approval?.approvalId || '').trim();
  assert(fundResponse.status === 202, 'job fund did not return pending approval');
  assert(approvalId, 'job fund did not return approvalId');
  const pendingApproval = approvalRequests.find(
    (item) => String(item?.approvalRequestId || '').trim() === approvalId
  ) || null;
  assert(pendingApproval, 'pending approval record was not persisted');
  assert(typeof pendingApproval?.resumeToken === 'object' && pendingApproval.resumeToken, 'resumeToken was not persisted as an object');
  assert(pendingApproval?.resumeToken?.jobId === jobId, 'resumeToken did not persist jobId');
  assert(pendingApproval?.resumeToken?.traceId === String(createPayload?.job?.traceId || '').trim(), 'resumeToken did not persist traceId');
  assert(pendingApproval?.resumeToken?.approvalId === approvalId, 'resumeToken did not persist approvalId');
  assert(pendingApproval?.resumeToken?.fundRequest?.escrowAmount === '0.00015', 'resumeToken did not persist escrowAmount');
  assert(pendingApproval?.resumeToken?.fundRequest?.payerAaWallet === requester, 'resumeToken did not persist payerAaWallet');
  assert(pendingApproval?.resumeToken?.sessionAuthorizationRef === 'sga_cli_verify', 'resumeToken did not persist session authorization ref');

  const forbiddenListResponse = await fetch(`${host}/api/approvals?approvalKind=job&state=pending`, {
    headers: {
      Accept: 'application/json',
      'x-api-key': adminKey
    }
  });
  const forbiddenListPayload = await forbiddenListResponse.json();
  assert(forbiddenListResponse.status === 403, 'approval list accepted x-api-key instead of x-admin-key');
  assert(forbiddenListPayload?.error === 'approval_inbox_forbidden', 'approval list did not return the expected inbox auth error');

  const common = ['--json', '--base-url', host, '--api-key', adminKey, '--config', configPath];
  const approvalList = await runSilentCli([...common, 'approval', 'list', '--kind', 'job', '--state', 'pending']);
  const approvalShow = await runSilentCli([...common, 'approval', 'show', approvalId]);
  const approvalApprove = await runSilentCli([...common, 'approval', 'approve', approvalId, '--note', 'approved by cli']);

  assert(Array.isArray(approvalList?.data?.items) && approvalList.data.items.some((item) => item.approvalId === approvalId), 'approval list did not include pending approval');
  assert(approvalList?.data?.meta?.approvalPolicyDefaults?.threshold === 0.00001, 'approval list did not expose approval policy defaults');
  assert(approvalShow?.data?.approval?.approvalId === approvalId, 'approval show did not resolve approval');
  assert(approvalShow?.data?.nextStep?.policySnapshot?.threshold === 0.00001, 'approval show did not expose policy snapshot');
  assert(approvalShow?.data?.approval?.jobSummary?.jobId === jobId, 'approval show did not expose job summary');
  assert(approvalShow?.data?.approval?.reviewSummary?.exceeded === true, 'approval show did not expose review summary');
  assert(String(approvalShow?.data?.approval?.links?.publicJobAuditUrl || '').includes('/api/public/jobs/'), 'approval show did not expose audit links');
  assert(approvalApprove?.data?.approval?.approvalState === 'completed', 'approval approve did not complete approval');
  assert(approvalApprove?.data?.resume?.ok === true, 'approval approve did not resume job funding');

  const fundedJob = jobs.find((item) => String(item?.jobId || '').trim() === jobId) || null;
  assert(String(fundedJob?.state || '').trim() === 'funded', 'approval approve did not auto-resume job into funded');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          jobId,
          approvalId,
          approvalListCount: Array.isArray(approvalList?.data?.items) ? approvalList.data.items.length : 0,
          approvalState: approvalApprove?.data?.approval?.approvalState || '',
          jobState: fundedJob?.state || ''
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await unlink(configPath).catch(() => {});
  if (previousAdminKey === undefined) delete process.env.KTRACE_ADMIN_KEY;
  else process.env.KTRACE_ADMIN_KEY = previousAdminKey;
}
