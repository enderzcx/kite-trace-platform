import crypto from 'node:crypto';
import express from 'express';
import { ethers } from 'ethers';
import { registerJobLaneRoutes } from '../routes/jobLaneRoutes.js';
import { registerReceiptEvidenceRoutes } from '../routes/receiptEvidenceRoutes.js';

const port = 34613;
const host = `http://127.0.0.1:${port}`;
const jobId = 'job_onchain_read_model';
const traceId = 'trace_onchain_read_model';
const requestId = 'req_onchain_read_model';
const fundedAt = 1773800000;
const acceptedAt = 1773800060;
const submittedAt = 1773800120;
const deadlineAt = 1773803600;
const resultHash = `0x${'4'.repeat(64)}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function digestStableObject(input = {}) {
  const canonical = JSON.stringify(input);
  return {
    algorithm: 'sha256',
    canonicalization: 'json',
    value: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

function buildResponseHash(requestRef = '', action = '', payload = {}) {
  const canonical = JSON.stringify({ requestId: requestRef, action, payload });
  return {
    responseHash: ethers.keccak256(ethers.toUtf8Bytes(canonical))
  };
}

async function signResponseHash(responseHash = '') {
  return {
    signature: `sig:${String(responseHash || '').slice(0, 18)}`,
    signer: '0x9999999999999999999999999999999999999999',
    scheme: 'mock',
    available: true
  };
}

const jobs = [
  {
    jobId,
    traceId,
    state: 'funded',
    provider: 'price-agent',
    capability: 'btc-price-feed',
    budget: '0.01',
    payer: '0x1111111111111111111111111111111111111111',
    executor: '0x2222222222222222222222222222222222222222',
    validator: '0x3333333333333333333333333333333333333333',
    escrowAmount: '0.01',
    escrowAddress: '0x4444444444444444444444444444444444444444',
    escrowTokenAddress: '0x5555555555555555555555555555555555555555',
    paymentRequestId: requestId,
    fundingAnchorTxHash: '0xfund',
    createAnchorTxHash: '0xcreate',
    summary: 'Job funded locally before onchain hydration.',
    createdAt: '2026-03-17T09:00:00.000Z',
    updatedAt: '2026-03-17T09:05:00.000Z'
  }
];

const workflows = [
  {
    traceId,
    requestId,
    type: 'btc-price-feed',
    state: 'submitted',
    txHash: '0xabc123',
    createdAt: '2026-03-17T09:00:00.000Z',
    updatedAt: '2026-03-17T09:05:00.000Z',
    result: {
      summary: 'BTC price delivered'
    }
  }
];

const x402Requests = [
  {
    requestId,
    status: 'paid',
    action: 'btc-price-feed',
    amount: '0.01',
    payer: '0x1111111111111111111111111111111111111111',
    recipient: '0x7777777777777777777777777777777777777777',
    tokenAddress: '0x5555555555555555555555555555555555555555',
    paymentTxHash: '0xabc123',
    paymentProof: {
      txHash: '0xabc123'
    },
    proofVerification: {
      mode: 'onchain_transfer_log',
      verifiedAt: 1773800200000,
      details: {
        blockNumber: 42
      }
    },
    result: {
      summary: 'BTC price delivered'
    }
  }
];

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = 'verify_onchain_read_model';
  next();
});

const commonDeps = {
  createTraceId,
  digestStableObject,
  normalizeAddress: (value = '') => String(value || '').trim().toLowerCase(),
  PORT: String(port),
  readJobs: () => jobs.slice(),
  readSessionRuntime: () => ({
    owner: '0x1111111111111111111111111111111111111111',
    aaWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    authorizationId: 'auth_onchain_read_model',
    authorizedBy: '0x1111111111111111111111111111111111111111',
    authorizedAt: 1773799900000,
    authorizationMode: 'user_grant_self_custodial',
    authorizationPayloadHash: `0x${'1'.repeat(64)}`,
    authorizationExpiresAt: 1773807200000,
    authorizationAudience: host,
    allowedCapabilities: ['btc-price-feed']
  }),
  getEscrowJob: async ({ jobId: wantedJobId = '' } = {}) => {
    if (String(wantedJobId || '').trim() !== jobId) {
      return { configured: true, found: false };
    }
    return {
      configured: true,
      found: true,
      contractAddress: '0x4444444444444444444444444444444444444444',
      tokenAddress: '0x5555555555555555555555555555555555555555',
      requester: '0x1111111111111111111111111111111111111111',
      executor: '0x2222222222222222222222222222222222222222',
      validator: '0x3333333333333333333333333333333333333333',
      amount: '0.01',
      executorStakeAmount: '0.0025',
      escrowState: 'submitted',
      resultHash,
      deadlineAt,
      fundedAt,
      acceptedAt,
      submittedAt,
      resolvedAt: 0,
      stakeFundedAt: acceptedAt
    };
  }
};

registerJobLaneRoutes(app, {
  ...commonDeps,
  acceptEscrowJob: async () => ({ configured: false }),
  appendReputationSignal: () => ({ signalId: '' }),
  appendValidationRecord: () => ({ validationId: '' }),
  crypto,
  ensureServiceCatalog: () => [],
  ERC8183_DEFAULT_JOB_TIMEOUT_SEC: 3600,
  ERC8183_EXECUTOR_AA_ADDRESS: '',
  ERC8183_EXECUTOR_OWNER_ADDRESS: '0x2222222222222222222222222222222222222222',
  ERC8183_EXECUTOR_STAKE_DEFAULT: '0',
  ERC8183_REQUESTER_AA_ADDRESS: '',
  ERC8183_REQUESTER_OWNER_ADDRESS: '0x1111111111111111111111111111111111111111',
  ERC8183_VALIDATOR_AA_ADDRESS: '',
  ERC8183_VALIDATOR_OWNER_ADDRESS: '0x3333333333333333333333333333333333333333',
  expireEscrowJob: async () => ({ configured: false }),
  getInternalAgentApiKey: () => '',
  KTRACE_JOB_APPROVAL_THRESHOLD: 0,
  KTRACE_JOB_APPROVAL_TTL_MS: 86400000,
  lockEscrowFunds: async () => ({ configured: false }),
  publishJobLifecycleAnchorOnChain: async () => ({ registryAddress: '', anchorId: '', anchorTxHash: '' }),
  readSessionApprovalRequests: () => [],
  resolveSessionOwnerByAaWallet: () => '',
  requireRole: () => (_req, _res, next) => next(),
  resolveWorkflowTraceId: (value = '') => String(value || '').trim(),
  submitEscrowResult: async () => ({ configured: false }),
  upsertJobRecord: () => {},
  validateEscrowJob: async () => ({ configured: false }),
  writeSessionApprovalRequests: () => {}
});

registerReceiptEvidenceRoutes(app, {
  ...commonDeps,
  buildResponseHash,
  signResponseHash,
  readWorkflows: () => workflows.slice(),
  readX402Requests: () => x402Requests.slice(),
  readRecords: () => [{ txHash: '0xabc123', status: 'success', requestId }],
  readPurchases: () => [],
  listNetworkAuditEventsByTraceId: () => [],
  requireRole: () => (_req, _res, next) => next(),
  ethers
});

const server = app.listen(port);

try {
  const auditResponse = await fetch(`${host}/api/jobs/${jobId}/audit`);
  const auditPayload = await auditResponse.json().catch(() => ({}));
  assert(auditResponse.ok, 'job audit did not return 200');
  assert(auditPayload?.audit?.summary?.state === 'submitted', 'job audit did not hydrate onchain state');
  assert(auditPayload?.audit?.summary?.executorStakeAmount === '0.0025', 'job audit did not hydrate executor stake');
  assert(
    String(auditPayload?.audit?.evidence?.resultHash || '').toLowerCase() === resultHash.toLowerCase(),
    'job audit did not hydrate onchain result hash'
  );
  assert(auditPayload?.audit?.deadline?.onchainEnforced === true, 'job audit did not preserve onchain deadline semantics');

  const receiptResponse = await fetch(`${host}/api/receipt/${requestId}`);
  const receiptPayload = await receiptResponse.json().catch(() => ({}));
  assert(receiptResponse.ok, 'receipt did not return 200');
  assert(receiptPayload?.receipt?.state === 'submitted', 'receipt did not hydrate onchain state');
  assert(receiptPayload?.receipt?.executorStakeAmount === '0.0025', 'receipt did not hydrate executor stake');
  assert(
    String(receiptPayload?.receipt?.resultHash || '').toLowerCase() === resultHash.toLowerCase(),
    'receipt did not hydrate onchain result hash'
  );
  assert(receiptPayload?.receipt?.deadline?.onchainEnforced === true, 'receipt did not keep onchain deadline semantics');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          jobId,
          state: receiptPayload?.receipt?.state || '',
          executorStakeAmount: receiptPayload?.receipt?.executorStakeAmount || '',
          resultHash: receiptPayload?.receipt?.resultHash || ''
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
