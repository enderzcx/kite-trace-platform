import crypto from 'node:crypto';
import express from 'express';
import { registerJobLaneRoutes } from '../routes/jobLaneRoutes.js';

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeAddress(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function digestStableObject(input = {}) {
  const canonical = JSON.stringify(input);
  return {
    algorithm: 'sha256',
    canonicalization: 'json',
    value: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

export async function startTraceAnchorHarness({
  port = 34930,
  anchorRegistry = '',
  guardAddress = '',
  initialJobs = [],
  checkAnchorExists = async () => ({
    configured: Boolean(anchorRegistry),
    registryAddress: anchorRegistry || '',
    jobId: '',
    hasAnchor: false,
    latestAnchorId: ''
  }),
  publishAnchor = async () => ({
    configured: true,
    published: true,
    registryAddress: '0xanchor',
    anchorId: '1',
    anchorTxHash: '0xsubmitanchor'
  }),
  readLatestAnchorId = async () => ({
    configured: Boolean(anchorRegistry),
    registryAddress: anchorRegistry || '',
    jobId: '',
    latestAnchorId: ''
  }),
  submitEscrow = async () => ({
    configured: true,
    submitted: true,
    contractAddress: '0xescrow',
    tokenAddress: '0xtoken',
    txHash: '0xescrowsubmit',
    escrowState: 'submitted'
  }),
  invokeService = async ({ body }) => ({
    ok: true,
    traceId: String(body?.traceId || 'trace_harness').trim(),
    requestId: 'x402_trace_anchor_harness',
    txHash: '0xpaymenttx',
    workflow: {
      traceId: String(body?.traceId || 'trace_harness').trim(),
      requestId: 'x402_trace_anchor_harness',
      txHash: '0xpaymenttx',
      result: {
        summary: 'Harness job submitted.'
      }
    },
    receipt: {
      result: {
        summary: 'Harness job submitted.'
      }
    }
  })
} = {}) {
  const previousAnchorRegistry = process.env.ERC8183_JOB_ANCHOR_REGISTRY;
  const previousGuardAddress = process.env.ERC8183_TRACE_ANCHOR_GUARD;
  if (anchorRegistry) process.env.ERC8183_JOB_ANCHOR_REGISTRY = anchorRegistry;
  else delete process.env.ERC8183_JOB_ANCHOR_REGISTRY;
  if (guardAddress) process.env.ERC8183_TRACE_ANCHOR_GUARD = guardAddress;
  else delete process.env.ERC8183_TRACE_ANCHOR_GUARD;

  const jobs = Array.isArray(initialJobs) ? initialJobs.map((item) => ({ ...item })) : [];
  const approvalRequests = [];
  const counters = {
    anchorCalls: 0,
    escrowSubmitCalls: 0,
    invokeCalls: 0
  };

  function readJobs() {
    return jobs.map((item) => ({ ...item }));
  }

  function upsertJobRecord(record = {}) {
    const jobId = String(record?.jobId || '').trim();
    const index = jobs.findIndex((item) => String(item?.jobId || '').trim() === jobId);
    if (index >= 0) {
      jobs[index] = { ...jobs[index], ...record };
    } else {
      jobs.push({ ...record });
    }
    return jobs.find((item) => String(item?.jobId || '').trim() === jobId) || null;
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.traceId = `trace_anchor_harness_${Date.now()}`;
    next();
  });

  app.post('/api/services/:serviceId/invoke', async (req, res) => {
    counters.invokeCalls += 1;
    const payload = await invokeService({
      serviceId: req.params.serviceId,
      body: req.body || {}
    });
    return res.json(payload);
  });

  registerJobLaneRoutes(app, {
    checkAnchorExistsOnChain: async (jobId = '') => checkAnchorExists(jobId),
    ERC8183_TRACE_ANCHOR_GUARD: guardAddress,
    PORT: port,
    crypto,
    createTraceId: () => `trace_${Date.now()}`,
    digestStableObject,
    ensureServiceCatalog: () => [
      {
        id: 'svc_harness_submit',
        action: 'btc-price-feed',
        providerAgentId: 'provider-harness',
        active: true
      }
    ],
    getInternalAgentApiKey: () => '',
    lockEscrowFunds: async () => ({ configured: false, txHash: '', escrowState: 'not_configured' }),
    readSessionRuntime: () => ({}),
    requireRole: () => (_req, _res, next) => next(),
    resolveSessionOwnerByAaWallet: () => '',
    resolveWorkflowTraceId: (workflow = {}) => String(workflow?.traceId || '').trim(),
    submitEscrowResult: async (input = {}) => {
      counters.escrowSubmitCalls += 1;
      return submitEscrow(input);
    },
    upsertJobRecord,
    validateEscrowJob: async () => ({ configured: false, txHash: '', escrowState: 'not_configured' }),
    acceptEscrowJob: async () => ({ configured: false, txHash: '', escrowState: 'not_configured' }),
    expireEscrowJob: async () => ({ configured: false, txHash: '', escrowState: 'not_configured' }),
    publishJobLifecycleAnchorOnChain: async (input = {}) => {
      counters.anchorCalls += 1;
      return publishAnchor(input);
    },
    readLatestAnchorIdOnChain: async (jobId = '') => readLatestAnchorId(jobId),
    appendReputationSignal: () => null,
    appendValidationRecord: () => null,
    getEscrowJob: async () => ({ configured: false, found: false }),
    normalizeAddress,
    readJobs,
    readSessionApprovalRequests: () => approvalRequests.slice(),
    writeSessionApprovalRequests: (rows = []) => {
      approvalRequests.length = 0;
      approvalRequests.push(...rows);
    }
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(port, () => resolve(instance));
  });

  return {
    host: `http://127.0.0.1:${port}`,
    jobs,
    counters,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      if (previousAnchorRegistry === undefined) delete process.env.ERC8183_JOB_ANCHOR_REGISTRY;
      else process.env.ERC8183_JOB_ANCHOR_REGISTRY = previousAnchorRegistry;
      if (previousGuardAddress === undefined) delete process.env.ERC8183_TRACE_ANCHOR_GUARD;
      else process.env.ERC8183_TRACE_ANCHOR_GUARD = previousGuardAddress;
    }
  };
}
