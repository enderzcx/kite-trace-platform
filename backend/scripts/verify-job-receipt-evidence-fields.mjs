import express from 'express';
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { registerReceiptEvidenceRoutes } from '../routes/receiptEvidenceRoutes.js';

const port = 34612;
const host = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function digestStableObject(input = {}) {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return {
    algorithm: 'sha256',
    canonicalization: 'sorted-top-level-json',
    value: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

function buildResponseHash(requestId = '', action = '', payload = {}) {
  const canonical = JSON.stringify({ requestId, action, payload });
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

const traceId = 'job_trace_receipt_fields';
const requestId = 'x402_receipt_fields';

const jobs = [
  {
    jobId: 'job_receipt_fields',
    traceId,
    state: 'completed',
    provider: 'fundamental-agent-real',
    capability: 'btc-price-feed',
    budget: '0.00015',
    payer: '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4',
    executor: '0x3333333333333333333333333333333333333333',
    validator: '0x4444444444444444444444444444444444444444',
    escrowAmount: '0.00015',
    executorStakeAmount: '0.00005',
    escrowAddress: '0x5555555555555555555555555555555555555555',
    escrowTokenAddress: '0x6666666666666666666666666666666666666666',
    paymentRequestId: requestId,
    paymentTxHash: '0xabc123',
    approvalId: 'apr_receipt_fields',
    approvalState: 'completed',
    approvalReasonCode: 'amount_threshold',
    approvalRequestedAt: 1773740000000,
    approvalExpiresAt: 1773826400000,
    approvalDecidedAt: 1773740005000,
    approvalDecidedBy: '0xf02fe12689e5026707d1be150b268e0fa5a37320',
      approvalDecisionNote: 'approved in test',
      approvalPolicy: {
        threshold: 0.001,
        ttlMs: 86400000,
        amount: 0.01,
        currency: '0xtoken',
        exceeded: true,
        reasonCode: 'amount_threshold'
      },
      authorizationId: 'sga_receipt_fields',
    authorizedBy: '0xf02fe12689e5026707d1be150b268e0fa5a37320',
    authorizedAt: 1773739999000,
    authorizationMode: 'user_grant_self_custodial',
      authorizationPayloadHash: '0x' + '1'.repeat(64),
      authorizationExpiresAt: 1773826400000,
      authorizationAudience: host,
      allowedCapabilities: ['btc-price-feed'],
      expiresAt: '2026-03-18T00:00:00.000Z',
      receiptRef: `/api/receipt/${requestId}`,
    evidenceRef: `/api/evidence/export?traceId=${traceId}`,
    createAnchorTxHash: '0xcreate',
    fundingAnchorTxHash: '0xfundanchor',
    acceptAnchorTxHash: '0xacceptanchor',
    submitAnchorTxHash: '0xsubmitanchor',
    outcomeAnchorTxHash: '0xoutcomeanchor',
    escrowFundTxHash: '0xfundtx',
    escrowAcceptTxHash: '0xaccepttx',
    escrowSubmitTxHash: '0xsubmittx',
    escrowValidateTxHash: '0xvalidatetx',
    resultHash: '0x' + '2'.repeat(64),
    submissionHash: '0x' + '3'.repeat(64),
    input: { pair: 'BTCUSDT' }
  }
];

const workflows = [
  {
    traceId,
    requestId,
    type: 'btc-price-feed',
    state: 'completed',
    txHash: '0xabc123',
    userOpHash: '0xuserop123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    amount: '0.00015',
    payer: '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4',
    recipient: '0x7777777777777777777777777777777777777777',
    tokenAddress: '0x6666666666666666666666666666666666666666',
    paymentTxHash: '0xabc123',
    paymentProof: {
      txHash: '0xabc123'
    },
    proofVerification: {
      mode: 'onchain_transfer_log',
      verifiedAt: 1773740010000,
      details: {
        blockNumber: 42
      }
    },
    result: {
      summary: 'BTC price delivered'
    }
  }
];

const records = [
  {
    txHash: '0xabc123',
    status: 'success',
    requestId
  }
];

const runtime = {
  aaWallet: '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4',
  sessionAddress: '0x8888888888888888888888888888888888888888',
  sessionId: 'session_receipt_fields',
  maxPerTx: 7,
  dailyLimit: 21,
  gatewayRecipient: '0x7777777777777777777777777777777777777777',
  authorizedBy: '0xf02fe12689e5026707d1be150b268e0fa5a37320',
  authorizedAt: 1773739999000,
  authorizationMode: 'user_grant_self_custodial',
  authorizationPayloadHash: '0x' + '1'.repeat(64),
  authorizationNonce: 'nonce_receipt_fields',
  authorizationExpiresAt: 1773826400000,
  authorizedAgentId: '1',
  authorizedAgentWallet: '0x9999999999999999999999999999999999999999',
  authorizationAudience: host,
  allowedCapabilities: ['btc-price-feed']
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = 'verify_receipt_fields';
  next();
});

registerReceiptEvidenceRoutes(app, {
  digestStableObject,
  buildResponseHash,
  signResponseHash,
  readWorkflows: () => workflows.slice(),
  readX402Requests: () => x402Requests.slice(),
  readRecords: () => records.slice(),
  readSessionRuntime: () => ({ ...runtime }),
  readJobs: () => jobs.slice(),
  readPurchases: () => [],
  listNetworkAuditEventsByTraceId: () => [],
  requireRole: () => (_req, _res, next) => next(),
  ethers
});

const server = app.listen(port);

try {
  const receiptResponse = await fetch(`${host}/api/receipt/${requestId}`, {
    headers: { Accept: 'application/json' }
  });
  const receiptPayload = await receiptResponse.json().catch(() => ({}));
  const receipt = receiptPayload?.receipt || {};
  assert(receiptResponse.ok, 'job receipt route did not return 200');
  assert(receipt.traceId === traceId, 'job receipt missing normalized traceId');
  assert(receipt.jobId === 'job_receipt_fields', 'job receipt missing normalized jobId');
  assert(receipt.state === 'completed', 'job receipt missing normalized state');
  assert(receipt.requester === '0x514ae5f90bcfd2a6cd61aea032f76702861fcee4', 'job receipt missing requester');
  assert(receipt.executor === '0x3333333333333333333333333333333333333333', 'job receipt missing executor');
  assert(receipt.validator === '0x4444444444444444444444444444444444444444', 'job receipt missing validator');
  assert(receipt.capability === 'btc-price-feed', 'job receipt missing normalized capability');
  assert(receipt.executorStakeAmount === '0.00005', 'job receipt missing executorStakeAmount');
  assert(typeof receipt.inputHash === 'string' && receipt.inputHash.length > 0, 'job receipt missing inputHash');
  assert(receipt.resultHash === '0x' + '2'.repeat(64), 'job receipt missing resultHash');
  assert(receipt.approved === true, 'job receipt missing normalized approved flag');
  assert(receipt.approvalState === 'completed', 'job receipt missing normalized approvalState');
  assert(receipt.approvalRequestedAt === 1773740000000, 'job receipt missing approvalRequestedAt');
  assert(receipt.approvalDecidedAt === 1773740005000, 'job receipt missing approvalDecidedAt');
  assert(receipt.approvalDecidedBy === '0xf02fe12689e5026707d1be150b268e0fa5a37320', 'job receipt missing approvalDecidedBy');
  assert(receipt.approvalReasonCode === 'amount_threshold', 'job receipt missing approvalReasonCode');
  assert(receipt.authorizationId === 'sga_receipt_fields', 'job receipt missing normalized authorizationId');
  assert(receipt.authorizedBy === '0xf02fe12689e5026707d1be150b268e0fa5a37320', 'job receipt missing normalized authorizedBy');
  assert(receipt.authorizationMode === 'user_grant_self_custodial', 'job receipt missing authorizationMode');
  assert(receipt.authorizationPayloadHash === '0x' + '1'.repeat(64), 'job receipt missing authorizationPayloadHash');
  assert(receipt.authorizationExpiresAt === 1773826400000, 'job receipt missing authorizationExpiresAt');
  assert(Array.isArray(receipt.allowedCapabilities) && receipt.allowedCapabilities[0] === 'btc-price-feed', 'job receipt missing allowedCapabilities');
  assert(receipt.escrowAddress === '0x5555555555555555555555555555555555555555', 'job receipt missing escrowAddress');
  assert(receipt.tokenAddress === '0x6666666666666666666666666666666666666666', 'job receipt missing tokenAddress');
  assert(receipt.amount === '0.00015', 'job receipt missing amount');
  assert(receipt.createAnchorTxHash === '0xcreate', 'job receipt missing createAnchorTxHash');
  assert(receipt.fundingAnchorTxHash === '0xfundanchor', 'job receipt missing fundingAnchorTxHash');
  assert(receipt.acceptAnchorTxHash === '0xacceptanchor', 'job receipt missing acceptAnchorTxHash');
  assert(receipt.submitAnchorTxHash === '0xsubmitanchor', 'job receipt missing submitAnchorTxHash');
  assert(receipt.outcomeAnchorTxHash === '0xoutcomeanchor', 'job receipt missing outcomeAnchorTxHash');
  assert(receipt.escrowFundTxHash === '0xfundtx', 'job receipt missing escrowFundTxHash');
  assert(receipt.escrowAcceptTxHash === '0xaccepttx', 'job receipt missing escrowAcceptTxHash');
  assert(receipt.escrowSubmitTxHash === '0xsubmittx', 'job receipt missing escrowSubmitTxHash');
  assert(receipt.escrowValidateTxHash === '0xvalidatetx', 'job receipt missing escrowValidateTxHash');
  assert(receipt.receiptRef === `/api/receipt/${requestId}`, 'job receipt missing receiptRef');
  assert(receipt.evidenceRef === `/api/evidence/export?traceId=${traceId}`, 'job receipt missing evidenceRef');
  assert(receipt.approvalPolicy?.threshold === 0.001, 'job receipt missing approval policy');
  assert(receipt.deadline?.onchainEnforced === true, 'job receipt missing deadline contract');
  assert(receipt.contractPrimitives?.escrow?.present === true, 'job receipt missing contract primitives');
  assert(receipt.contractPrimitives?.roleEnforcement?.executionMode === 'requester_executor_validator_signers', 'job receipt missing role enforcement detail');
  assert(receipt.contractPrimitives?.deadline?.timeoutResolution === 'onchain_expire_refund_and_optional_slash', 'job receipt missing timeout resolution detail');
  assert(receipt.contractPrimitives?.staking?.present === true, 'job receipt missing staking detail');
  assert(receipt.contractPrimitives?.slashing?.present === true, 'job receipt missing slashing detail');
  assert(receipt.deliveryStandard?.satisfied === true, 'job receipt missing delivery standard');
  assert(receipt.job?.jobId === 'job_receipt_fields', 'job receipt did not include job block');
  assert(receipt.authorization?.authorizationId === 'sga_receipt_fields', 'job receipt missing authorization block');
  assert(receipt.authorization?.authorizedBy === '0xf02fe12689e5026707d1be150b268e0fa5a37320', 'job receipt missing authorization block authorizedBy');
  assert(receipt.humanApproval?.approvalState === 'completed', 'job receipt missing humanApproval block');
  assert(receipt.humanApproval?.approvalDecidedBy === '0xf02fe12689e5026707d1be150b268e0fa5a37320', 'job receipt missing humanApproval decidedBy');

  const evidenceResponse = await fetch(`${host}/api/evidence/export?traceId=${encodeURIComponent(traceId)}`, {
    headers: { Accept: 'application/json' }
  });
  const evidencePayload = await evidenceResponse.json().catch(() => ({}));
  assert(evidenceResponse.ok, 'job evidence export route did not return 200');
    assert(evidencePayload?.evidence?.job?.authorizationId === 'sga_receipt_fields', 'job evidence missing authorizationId');
    assert(evidencePayload?.evidence?.authorization?.authorizationPayloadHash === '0x' + '1'.repeat(64), 'job evidence missing authorization payload hash');
    assert(evidencePayload?.evidence?.humanApproval?.approvalDecisionNote === 'approved in test', 'job evidence missing approval decision note');
    assert(evidencePayload?.evidence?.humanApproval?.approvalPolicy?.threshold === 0.001, 'job evidence missing approval policy');
    assert(evidencePayload?.evidence?.deadline?.onchainEnforced === true, 'job evidence missing deadline block');
    assert(evidencePayload?.evidence?.contractPrimitives?.roleEnforcement?.onchainEnforced === true, 'job evidence missing contract primitives');
    assert(evidencePayload?.evidence?.contractPrimitives?.roleEnforcement?.executorAddress === '0x3333333333333333333333333333333333333333', 'job evidence missing role addresses');
    assert(evidencePayload?.evidence?.contractPrimitives?.staking?.present === true, 'job evidence missing staking detail');
    assert(evidencePayload?.evidence?.deliveryStandard?.satisfied === true, 'job evidence missing delivery standard');

  const publicEvidenceResponse = await fetch(`${host}/api/public/evidence/${traceId}`, {
    headers: { Accept: 'application/json' }
  });
  const publicEvidencePayload = await publicEvidenceResponse.json().catch(() => ({}));
    assert(publicEvidenceResponse.ok, 'public evidence route did not return 200');
    assert(publicEvidencePayload?.evidence?.approvalState === 'completed', 'public evidence missing approvalState');
    assert(publicEvidencePayload?.evidence?.approvalDecidedBy === '0xf02fe12689e5026707d1be150b268e0fa5a37320', 'public evidence missing approvalDecidedBy');
    assert(publicEvidencePayload?.evidence?.approvalPolicy?.threshold === 0.001, 'public evidence missing approval policy');
    assert(publicEvidencePayload?.evidence?.deadline?.onchainEnforced === true, 'public evidence missing deadline block');
    assert(publicEvidencePayload?.evidence?.contractPrimitives?.escrow?.present === true, 'public evidence missing contract primitives');
    assert(publicEvidencePayload?.evidence?.contractPrimitives?.staking?.present === true, 'public evidence missing staking detail');
    assert(publicEvidencePayload?.evidence?.deliveryStandard?.satisfied === true, 'public evidence missing delivery standard');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          requestId,
          traceId,
          normalizedJobId: receiptPayload?.receipt?.jobId || '',
          receiptAuthorizationId: receiptPayload?.receipt?.authorization?.authorizationId || '',
          receiptApprovalState: receiptPayload?.receipt?.humanApproval?.approvalState || '',
          evidenceAuthorizedBy: evidencePayload?.evidence?.authorization?.authorizedBy || '',
          publicApprovalState: publicEvidencePayload?.evidence?.approvalState || ''
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
