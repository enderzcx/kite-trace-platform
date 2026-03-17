import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { ethers } from 'ethers';
import { registerCoreIdentityChatRoutes } from '../routes/coreIdentityChatRoutes.js';

const port = 34611;
const host = `http://127.0.0.1:${port}`;

const jobs = [];
const approvalRequests = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function normalizeAddress(value = '') {
  const text = String(value || '').trim();
  return text ? text.toLowerCase() : '';
}

function readJobs() {
  return jobs.slice();
}

function upsertJobRecord(job = {}) {
  const index = jobs.findIndex((item) => String(item?.jobId || '').trim() === String(job?.jobId || '').trim());
  if (index >= 0) jobs[index] = job;
  else jobs.unshift(job);
}

function readSessionApprovalRequests() {
  return approvalRequests.slice();
}

function writeSessionApprovalRequests(rows = []) {
  approvalRequests.splice(0, approvalRequests.length, ...(Array.isArray(rows) ? rows : []));
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = createTraceId('verify');
  next();
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
  IDENTITY_CHALLENGE_TTL_MS: 60000,
  IDENTITY_VERIFY_MODE: 'owner',
  KITE_AGENT1_ID: '',
  KITE_AGENT2_ID: '',
  KITE_REQUIRE_AA_V2: false,
  AA_V2_VERSION_TAG: '',
  maskSecret: () => '',
  normalizeAddress,
  normalizeReactiveParams: (value = {}) => value,
  llmAdapter: null,
  PORT: String(port),
  readJobs,
  readSessionAuthorizations: () => [],
  readSessionApprovalRequests,
  XMTP_ROUTER_DERIVED_ADDRESS: '',
  readIdentityChallenges: () => [],
  readRecords: () => [],
  readSessionRuntime: () => ({}),
  resolveSessionOwnerPrivateKey: () => '',
  resolveSessionRuntime: () => ({}),
  readWorkflows: () => [],
  readX402Requests: () => [],
  requireRole: () => (_req, _res, next) => next(),
  resolveRoleByApiKey: () => '',
  sessionPayConfigSnapshot: () => ({}),
  sessionPayMetrics: () => ({}),
  sessionRuntimePath: '',
  writeIdentityChallenges: () => {},
  writeJsonObject: () => {},
  writeRecords: () => {},
  writeSessionApprovalRequests,
  writeSessionAuthorizations: () => {},
  writeSessionRuntime: () => {},
  upsertJobRecord
});

const approvalId = 'apr_expired_case';
const approvalToken = 'sat_expired_case';
const jobId = 'job_expired_case';
const now = Date.now();

upsertJobRecord({
  jobId,
  traceId: 'job_trace_expired_case',
  state: 'pending_approval',
  provider: 'fundamental-agent-real',
  capability: 'btc-price-feed',
  payer: '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4',
  approvalId,
  approvalState: 'pending',
  approvalRequestedAt: now - 10_000,
  approvalExpiresAt: now - 1_000,
  updatedAt: new Date(now - 10_000).toISOString(),
  summary: 'Job funding is waiting for human approval.'
});

writeSessionApprovalRequests([
  {
    approvalKind: 'job',
    approvalRequestId: approvalId,
    approvalToken,
    status: 'pending',
    createdAt: now - 10_000,
    updatedAt: now - 10_000,
    expiresAt: now - 1_000,
    jobId,
    traceId: 'job_trace_expired_case',
    requestedByAaWallet: '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4',
    requestedByOwnerEoa: '0xf02fe12689e5026707d1be150b268e0fa5a37320',
    requestedAction: 'fund_job',
    reasonCode: 'amount_threshold',
    authorizationAudience: host,
    policySnapshot: {
      threshold: 0.00001,
      amount: 0.00015,
      currency: 'USDT'
    },
    jobSnapshot: {
      jobId,
      capability: 'btc-price-feed',
      provider: 'fundamental-agent-real'
    }
  }
]);

const server = app.listen(port);

try {
  const detailResponse = await fetch(`${host}/api/approvals/${approvalId}?token=${approvalToken}`, {
    headers: {
      Accept: 'application/json'
    }
  });
  const detailPayload = await detailResponse.json().catch(() => ({}));

  assert(detailResponse.ok, 'approval detail did not return 200');
  assert(detailPayload?.ok === true, 'approval detail response was not ok');
  assert(detailPayload?.approval?.approvalKind === 'job', 'approval detail did not return job approval');
  assert(detailPayload?.approval?.approvalState === 'expired', 'approval detail did not materialize expired state');

  const expiredJob = readJobs().find((item) => String(item?.jobId || '').trim() === jobId) || null;
  const expiredApproval =
    readSessionApprovalRequests().find(
      (item) => String(item?.approvalRequestId || item?.approvalId || '').trim() === approvalId
    ) || null;

  assert(expiredJob?.state === 'approval_expired', 'job was not transitioned to approval_expired');
  assert(expiredJob?.approvalState === 'expired', 'job approvalState was not marked expired');
  assert(expiredApproval?.status === 'expired', 'approval request was not marked expired');
  assert(expiredApproval?.resumeStatus === 'expired', 'approval request resumeStatus was not marked expired');

  const approveResponse = await fetch(`${host}/api/approvals/${approvalId}/approve?token=${approvalToken}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const approvePayload = await approveResponse.json().catch(() => ({}));

  assert(approveResponse.status === 409, 'expired approval approve did not return 409');
  assert(approvePayload?.ok === false, 'expired approval approve unexpectedly returned ok');
  assert(approvePayload?.error === 'approval_request_expired', 'expired approval approve returned wrong error code');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          approvalId,
          jobId,
          approvalState: detailPayload?.approval?.approvalState || '',
          jobState: expiredJob?.state || '',
          approveStatus: approveResponse.status,
          approveError: approvePayload?.error || ''
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
