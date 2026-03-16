import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { unlink } from 'node:fs/promises';
import { ethers } from 'ethers';
import { runKtraceCli } from '../cli/runKtraceCli.js';
import { registerJobLaneRoutes } from '../routes/jobLaneRoutes.js';
import { registerPlatformV1Routes } from '../routes/platformV1Routes.js';
import { registerTemplateRoutes } from '../routes/templateRoutes.js';
import { registerTrustSignalRoutes } from '../routes/trustSignalRoutes.js';

const port = 34610;
const host = `http://127.0.0.1:${port}`;
const wallet = '0x1111111111111111111111111111111111111111';
const sessionAddress = '0x2222222222222222222222222222222222222222';
const externalProviderWallet = ethers.Wallet.createRandom();
const sessionAuthorizationWallet = ethers.Wallet.createRandom();
const configPath = path.join(os.tmpdir(), `ktrace-smoke-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);

const jobs = [];
const templates = [];
const purchases = [];
const reputationSignals = [];
const validationRecords = [];
const trustPublications = [];
const jobAnchors = [];
let latestProviderIdentityChallenge = null;
let publicEvidenceApiKeyHeader = '';
const sessionRuntimeState = {
  owner: wallet,
  aaWallet: wallet,
  sessionAddress,
  sessionId: 'session-smoke',
  sessionTxHash: '0xsession',
  sessionPrivateKeyMasked: '0x****smoke',
  hasSessionPrivateKey: true,
  maxPerTx: 7,
  dailyLimit: 21,
  gatewayRecipient: '0x3333333333333333333333333333333333333333',
  source: 'smoke',
  updatedAt: Date.now()
};
const services = [
  {
    id: 'svc-price',
    active: true,
    providerAgentId: 'price-agent',
    action: 'btc-price-feed',
    name: 'BTC Price Feed'
  }
];
const invocations = [];
const providers = [
  {
    id: 'price-agent',
    name: 'Price Agent',
    role: 'provider',
    mode: 'a2api',
    description: 'Price provider',
    capabilities: ['btc-price-feed'],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function digestStableObject(input = {}) {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return {
    value: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function latestInvocationByTrace(traceId = '') {
  return invocations.find((item) => String(item.traceId || '') === String(traceId || '')) || null;
}

function latestInvocationByRequest(requestId = '') {
  return invocations.find((item) => String(item.requestId || '') === String(requestId || '')) || null;
}

const app = express();
app.use(express.json());

registerJobLaneRoutes(app, {
  appendReputationSignal: (signal = {}) => {
    reputationSignals.unshift(signal);
    return signal;
  },
  appendValidationRecord: (record = {}) => {
    validationRecords.unshift(record);
    return record;
  },
  createTraceId,
  digestStableObject,
  ensureServiceCatalog: () => services,
  getInternalAgentApiKey: () => '',
  normalizeAddress: (value = '') => String(value || '').trim().toLowerCase(),
  PORT: String(port),
  publishJobLifecycleAnchorOnChain: async (input = {}) => {
    const anchor = {
      anchorId: String(jobAnchors.length + 1),
      anchorTxHash: `0xjobanchor${String(jobAnchors.length + 1).padStart(4, '0')}`,
      registryAddress: '0x4444444444444444444444444444444444444444',
      ...input
    };
    jobAnchors.push(anchor);
    return {
      configured: true,
      published: true,
      registryAddress: anchor.registryAddress,
      anchorId: anchor.anchorId,
      anchorTxHash: anchor.anchorTxHash,
      payloadHash: ethers.ZeroHash
    };
  },
  readJobs: () => jobs.slice(),
  readSessionRuntime: () => ({
    aaWallet: wallet,
    owner: wallet,
    sessionAddress,
    sessionId: 'session-smoke',
    sessionTxHash: '0xsession',
    hasSessionPrivateKey: true,
    maxPerTx: 7,
    dailyLimit: 21,
    gatewayRecipient: '0x3333333333333333333333333333333333333333',
    source: 'smoke'
  }),
  requireRole: () => (_req, _res, next) => next(),
  resolveWorkflowTraceId: (traceId = '') => String(traceId || '').trim() || createTraceId('workflow'),
  upsertJobRecord: (job = {}) => {
    const idx = jobs.findIndex((item) => String(item.jobId || '') === String(job.jobId || ''));
    if (idx >= 0) jobs[idx] = job;
    else jobs.unshift(job);
  }
});

registerTemplateRoutes(app, {
  appendReputationSignal: (signal = {}) => {
    reputationSignals.unshift(signal);
    return signal;
  },
  createTraceId,
  ensureServiceCatalog: () => services,
  ensureTemplateCatalog: () => {
    if (templates.length > 0) return templates.slice();
    const seeded = [
      {
        templateId: 'tpl_svc-price',
        templateVersion: 1,
        name: 'BTC Price Direct Buy',
        description: 'Direct template for BTC price feed',
        providerAgentId: 'price-agent',
        capabilityId: 'btc-price-feed',
        serviceId: 'svc-price',
        pricingTerms: {
          amount: '0.001',
          currency: 'token',
          tokenAddress: '0xtoken'
        },
        settlementTerms: {
          paymentMode: 'x402',
          recipient: '0x3333333333333333333333333333333333333333',
          tokenAddress: '0xtoken',
          proofMode: 'on-chain'
        },
        fulfillmentMode: 'direct',
        validFrom: new Date().toISOString(),
        validUntil: '',
        status: 'active',
        active: true,
        tags: ['smoke', 'direct-buy'],
        exampleInput: { pair: 'BTCUSDT' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedBy: 'system'
      }
    ];
    templates.splice(0, templates.length, ...seeded);
    return templates.slice();
  },
  getInternalAgentApiKey: () => '',
  normalizeAddress: (value = '') => String(value || '').trim().toLowerCase(),
  PORT: String(port),
  readPurchases: () => purchases.slice(),
  readSessionRuntime: () => ({
    aaWallet: wallet,
    owner: wallet,
    sessionAddress,
    sessionId: 'session-smoke',
    hasSessionPrivateKey: true
  }),
  requireRole: () => (_req, _res, next) => next(),
  upsertPurchaseRecord: (purchase = {}) => {
    const idx = purchases.findIndex((item) => String(item?.purchaseId || '') === String(purchase.purchaseId || ''));
    if (idx >= 0) purchases[idx] = purchase;
    else purchases.unshift(purchase);
  },
  writeTemplates: (records = []) => {
    templates.splice(0, templates.length, ...(Array.isArray(records) ? records : []));
  }
});

registerTrustSignalRoutes(app, {
  appendReputationSignal: (signal = {}) => {
    reputationSignals.unshift(signal);
    return signal;
  },
  appendValidationRecord: (record = {}) => {
    validationRecords.unshift(record);
    return record;
  },
  createTraceId,
  readReputationSignals: () => reputationSignals.slice(),
  readValidationRecords: () => validationRecords.slice(),
  requireRole: () => (_req, _res, next) => next()
});

registerPlatformV1Routes(app, {
  PORT: String(port),
  createTraceId,
  ensureNetworkAgents: () => providers.slice(),
  ensureServiceCatalog: () => services,
  ensureTemplateCatalog: () => templates.slice(),
  issueIdentityChallenge: async ({ traceId = '', identityInput = {} } = {}) => {
    latestProviderIdentityChallenge = {
      challengeId: createTraceId('idv'),
      traceId: String(traceId || '').trim(),
      identityRegistry: String(identityInput?.identityRegistry || identityInput?.registry || '0xidentity').trim(),
      identityAgentId: String(identityInput?.identityAgentId || identityInput?.agentId || '9').trim(),
      message: `Kite Trace smoke identity challenge for agent ${String(identityInput?.identityAgentId || identityInput?.agentId || '9').trim()}`,
      ownerAddress: externalProviderWallet.address.toLowerCase(),
      agentWallet: externalProviderWallet.address.toLowerCase()
    };
    return {
      challengeId: latestProviderIdentityChallenge.challengeId,
      traceId: latestProviderIdentityChallenge.traceId,
      signatureRequired: true,
      message: latestProviderIdentityChallenge.message,
      identity: {
        registry: latestProviderIdentityChallenge.identityRegistry,
        agentId: latestProviderIdentityChallenge.identityAgentId,
        ownerAddress: latestProviderIdentityChallenge.ownerAddress,
        agentWallet: latestProviderIdentityChallenge.agentWallet,
        tokenURI: 'data:application/json;base64,smoke'
      },
      profile: {
        available: true,
        agentId: latestProviderIdentityChallenge.identityAgentId,
        registry: latestProviderIdentityChallenge.identityRegistry,
        ownerAddress: latestProviderIdentityChallenge.ownerAddress,
        agentWallet: latestProviderIdentityChallenge.agentWallet,
        tokenURI: 'data:application/json;base64,smoke'
      }
    };
  },
  readReputationSignals: () => reputationSignals.slice(),
  readTrustPublications: () => trustPublications.slice(),
  readValidationRecords: () => validationRecords.slice(),
  readIdentityProfile: async ({ registry = '', agentId = '' } = {}) => ({
    configured: {
      registry: String(registry || '0xidentity').trim(),
      agentId: String(agentId || '1').trim()
    },
    available: true,
    ownerAddress: wallet,
    agentWallet: wallet,
    tokenURI: 'data:application/json;base64,smoke'
  }),
  verifyIdentityChallengeResponse: async ({ challengeId = '', signature = '' } = {}) => {
    if (!latestProviderIdentityChallenge || String(challengeId || '').trim() !== latestProviderIdentityChallenge.challengeId) {
      throw new Error('identity_challenge_not_found');
    }
    const recovered = ethers.verifyMessage(latestProviderIdentityChallenge.message, String(signature || '').trim()).toLowerCase();
    if (recovered !== latestProviderIdentityChallenge.ownerAddress) {
      throw new Error('identity_signature_invalid');
    }
    return {
      verifyMode: 'signature',
      signerType: 'owner',
      verifiedAt: new Date().toISOString(),
      identity: {
        registry: latestProviderIdentityChallenge.identityRegistry,
        agentId: latestProviderIdentityChallenge.identityAgentId,
        ownerAddress: latestProviderIdentityChallenge.ownerAddress,
        agentWallet: latestProviderIdentityChallenge.agentWallet,
        tokenURI: 'data:application/json;base64,smoke'
      }
    };
  },
  appendTrustPublication: (record = {}) => {
    trustPublications.unshift(record);
    return record;
  },
  getInternalAgentApiKey: () => '',
  requireRole: () => (_req, _res, next) => next(),
  sanitizeNetworkAgentRecord: (input = {}, existing = null) => ({
    ...(existing || {}),
    ...(input || {}),
    id: String(input?.id || existing?.id || '').trim().toLowerCase(),
    name: String(input?.name || existing?.name || '').trim(),
    role: String(input?.role || existing?.role || '').trim().toLowerCase(),
    mode: String(input?.mode || existing?.mode || '').trim().toLowerCase(),
    xmtpAddress: String(input?.xmtpAddress || existing?.xmtpAddress || '').trim().toLowerCase(),
    aaAddress: String(input?.aaAddress || existing?.aaAddress || '').trim().toLowerCase(),
    inboxId: String(input?.inboxId || existing?.inboxId || '').trim(),
    ownerWallet: String(input?.ownerWallet || existing?.ownerWallet || '').trim().toLowerCase(),
    identityRegistry: String(input?.identityRegistry || existing?.identityRegistry || '').trim().toLowerCase(),
    identityAgentId: String(input?.identityAgentId || existing?.identityAgentId || '').trim(),
    description: String(input?.description || existing?.description || '').trim(),
    capabilities: Array.isArray(input?.capabilities)
      ? input.capabilities.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : Array.isArray(existing?.capabilities)
        ? existing.capabilities
        : [],
    active: input?.active ?? existing?.active ?? true,
    createdAt: String(existing?.createdAt || input?.createdAt || new Date().toISOString()).trim(),
    updatedAt: new Date().toISOString()
  }),
  sanitizeServiceRecord: (input = {}, existing = null) => ({
    ...(existing || {}),
    ...(input || {}),
    id: String(input?.id || existing?.id || '').trim(),
    name: String(input?.name || existing?.name || '').trim(),
    description: String(input?.description || existing?.description || '').trim(),
    action: String(input?.action || existing?.action || '').trim().toLowerCase(),
    providerAgentId: String(input?.providerAgentId || existing?.providerAgentId || '').trim().toLowerCase(),
    recipient: String(input?.recipient || existing?.recipient || '0x3333333333333333333333333333333333333333').trim().toLowerCase(),
    tokenAddress: String(input?.tokenAddress || existing?.tokenAddress || '0xtoken').trim().toLowerCase(),
    price: String(input?.price || existing?.price || '0.001').trim(),
    tags: Array.isArray(input?.tags) ? input.tags : Array.isArray(existing?.tags) ? existing.tags : [],
    slaMs: Number(input?.slaMs || existing?.slaMs || 12000),
    rateLimitPerMinute: Number(input?.rateLimitPerMinute || existing?.rateLimitPerMinute || 10),
    budgetPerDay: Number(input?.budgetPerDay || existing?.budgetPerDay || 0.05),
    exampleInput:
      input?.exampleInput && typeof input.exampleInput === 'object' && !Array.isArray(input.exampleInput)
        ? input.exampleInput
        : existing?.exampleInput && typeof existing.exampleInput === 'object' && !Array.isArray(existing.exampleInput)
          ? existing.exampleInput
          : { pair: 'BTCUSDT' },
    active: input?.active ?? existing?.active ?? true,
    createdAt: String(existing?.createdAt || input?.createdAt || new Date().toISOString()).trim(),
    updatedAt: new Date().toISOString()
  }),
  writeNetworkAgents: (records = []) => {
    providers.splice(0, providers.length, ...(Array.isArray(records) ? records : []));
  },
  writePublishedServices: (records = []) => {
    services.splice(0, services.length, ...(Array.isArray(records) ? records : []));
  }
});

app.get('/api/auth/info', (_req, res) => {
  res.json({
    ok: true,
    role: 'agent',
    authDisabled: false,
    authConfigured: true,
    acceptedHeaders: ['x-api-key']
  });
});

app.get('/api/identity/current', (_req, res) => {
  res.json({
    ok: true,
    profile: {
      available: true,
      chainId: '2368',
      configured: {
        registry: '0x9999999999999999999999999999999999999999',
        agentId: '1'
      },
      ownerAddress: wallet,
      agentWallet: '0x7777777777777777777777777777777777777777',
      tokenURI: 'data:application/json;base64,smoke'
    }
  });
});

app.get('/api/session/runtime', (_req, res) => {
  res.json({
    ok: true,
    runtime: sessionRuntimeState
  });
});

app.post('/api/session/runtime/ensure', (_req, res) => {
  res.json({
    ok: true,
    created: false,
    reused: true,
    traceId: 'session-trace',
    owner: sessionRuntimeState.owner,
    aaWallet: sessionRuntimeState.aaWallet,
    session: {
      address: sessionRuntimeState.sessionAddress,
      id: sessionRuntimeState.sessionId,
      txHash: sessionRuntimeState.sessionTxHash,
      maxPerTx: sessionRuntimeState.maxPerTx,
      dailyLimit: sessionRuntimeState.dailyLimit,
      gatewayRecipient: sessionRuntimeState.gatewayRecipient,
      tokenAddress: '0xtoken'
    },
    runtime: sessionRuntimeState
  });
});

app.post('/api/v1/session/authorize', (req, res) => {
  const payload = req.body?.payload || {};
  const userEoa = String(req.body?.userEoa || '').trim().toLowerCase();
  sessionRuntimeState.authorizedBy = userEoa;
  sessionRuntimeState.authorizedAt = Date.now();
  sessionRuntimeState.authorizationMode = 'user_grant_backend_executed';
  sessionRuntimeState.authorizationPayload = payload;
  sessionRuntimeState.authorizationPayloadHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(payload))
  );
  sessionRuntimeState.authorizationSignatureMasked = '0xauth...sig';
  sessionRuntimeState.hasAuthorizationSignature = true;
  sessionRuntimeState.authorizationNonce = String(payload?.nonce || '').trim();
  sessionRuntimeState.authorizationExpiresAt = Number(payload?.expiresAt || 0);
  sessionRuntimeState.authorizedAgentId = String(payload?.agentId || '').trim();
  sessionRuntimeState.authorizedAgentWallet = String(payload?.agentWallet || '').trim().toLowerCase();
  sessionRuntimeState.authorizationAudience = String(payload?.audience || '').trim();
  sessionRuntimeState.allowedCapabilities = Array.isArray(payload?.allowedCapabilities)
    ? payload.allowedCapabilities
    : [];
  sessionRuntimeState.updatedAt = Date.now();

  res.json({
    ok: true,
    schemaVersion: 'v1',
    traceId: 'session-auth-trace',
    created: false,
    reused: true,
    authorizedBy: userEoa,
    authorization: {
      authorizationId: 'sga_smoke',
      mode: 'user_grant_backend_executed',
      authorizedBy: userEoa,
      authorizedAt: sessionRuntimeState.authorizedAt,
      payload,
      payloadHash: sessionRuntimeState.authorizationPayloadHash,
      signatureMasked: '0xauth...sig',
      expiresAt: sessionRuntimeState.authorizationExpiresAt,
      nonce: sessionRuntimeState.authorizationNonce,
      allowedCapabilities: sessionRuntimeState.allowedCapabilities
    },
    session: {
      address: sessionRuntimeState.sessionAddress,
      id: sessionRuntimeState.sessionId,
      txHash: sessionRuntimeState.sessionTxHash,
      maxPerTx: sessionRuntimeState.maxPerTx,
      dailyLimit: sessionRuntimeState.dailyLimit,
      gatewayRecipient: sessionRuntimeState.gatewayRecipient,
      tokenAddress: '0xtoken',
      authorizedBy: sessionRuntimeState.authorizedBy,
      authorizationMode: sessionRuntimeState.authorizationMode
    },
    runtime: sessionRuntimeState
  });
});

app.get('/api/services', (_req, res) => {
  res.json({
    ok: true,
    items: services
  });
});

app.post('/api/services/:serviceId/invoke', (req, res) => {
  const traceId = String(req.body?.traceId || createTraceId('trace')).trim();
  const requestId = traceId.startsWith('job_') ? 'req-job' : 'req-buy';
  const summary = traceId.startsWith('job_') ? 'Job service delivered' : 'BTC price delivered';
  const record = {
    invocationId: createTraceId('inv'),
    serviceId: req.params.serviceId,
    serviceName: 'BTC Price Feed',
    providerAgentId: 'price-agent',
    capability: 'btc-price-feed',
    traceId,
    requestId,
    state: 'success',
    payer: wallet,
    summary,
    txHash: traceId.startsWith('job_') ? '0xjobtx' : '0xbuytx',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    receipt: {
      requestId,
      traceId,
      txHash: traceId.startsWith('job_') ? '0xjobtx' : '0xbuytx',
      amount: traceId.startsWith('job_') ? '0.01' : '0.001',
      result: { summary }
    }
  };
  invocations.unshift(record);
  res.json({
    ok: true,
    traceId,
    requestId,
    state: 'success',
    invocationId: record.invocationId,
    txHash: record.txHash,
    workflow: {
      traceId,
      requestId,
      state: 'success',
      txHash: record.txHash,
      result: { summary }
    },
    receipt: record.receipt
  });
});

app.get('/api/service-invocations', (req, res) => {
  const traceId = String(req.query.traceId || '').trim();
  const requestId = String(req.query.requestId || '').trim();
  const provider = String(req.query.provider || '').trim();
  const capability = String(req.query.capability || '').trim();
  const items = invocations.filter((item) => {
    if (traceId && item.traceId !== traceId) return false;
    if (requestId && item.requestId !== requestId) return false;
    if (provider && item.providerAgentId !== provider) return false;
    if (capability && item.capability !== capability) return false;
    return true;
  });
  res.json({ ok: true, items });
});

app.get('/api/workflow/:traceId', (req, res) => {
  const record = latestInvocationByTrace(req.params.traceId);
  if (!record) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    workflow: {
      traceId: record.traceId,
      requestId: record.requestId,
      state: 'completed',
      txHash: record.txHash,
      result: { summary: record.summary }
    }
  });
});

app.get('/api/network/audit/:traceId', (req, res) => {
  const record = latestInvocationByTrace(req.params.traceId);
  if (!record) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    traceId: record.traceId,
    events: [{ kind: 'quote' }, { kind: 'payment' }, { kind: 'result' }]
  });
});

app.get('/api/receipt/:requestId', (req, res) => {
  const record = latestInvocationByRequest(req.params.requestId);
  if (!record) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, receipt: record.receipt });
});

app.get('/api/evidence/export', (req, res) => {
  const traceId = String(req.query.traceId || '').trim();
  const record = latestInvocationByTrace(traceId);
  if (!record) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    evidence: {
      traceId: record.traceId,
      requestId: record.requestId,
      receiptRef: `/api/receipt/${record.requestId}`,
      events: [{ kind: 'quote' }, { kind: 'payment' }],
      runtimeSnapshot: {
        ...sessionRuntimeState
      }
    }
  });
});

app.get('/api/public/evidence/:traceId', (req, res) => {
  publicEvidenceApiKeyHeader = String(req.headers['x-api-key'] || '').trim();
  const traceId = String(req.params.traceId || '').trim();
  const record = latestInvocationByTrace(traceId);
  if (!record) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    traceId,
    evidence: {
      traceId,
      state: 'completed',
      paymentProof: {
        txHash: record.txHash,
        requestId: record.requestId
      },
      authorizedBy: sessionRuntimeState.authorizedBy || '',
      authorizationMode: sessionRuntimeState.authorizationMode || '',
      jobAnchorTxHash: traceId.startsWith('job_') ? '0xjobanchor0008' : '',
      anchorContract: traceId.startsWith('job_') ? '0x4444444444444444444444444444444444444444' : '',
      anchorNetwork: 'kite-testnet',
      issuedAt: new Date().toISOString(),
      evidenceRef: `/api/public/evidence/${encodeURIComponent(traceId)}`
    }
  });
});

const server = app.listen(port, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

try {
  const common = ['--json', '--base-url', host, '--api-key', 'agent-key', '--wallet', wallet, '--config', configPath];
  process.env.KTRACE_USER_EOA_PRIVATE_KEY = sessionAuthorizationWallet.privateKey;
  const missingProviderResponse = await fetch(`${host}/api/v1/providers/does-not-exist`);
  const missingProviderPayload = await missingProviderResponse.json();
  const templateResolveResponse = await fetch(`${host}/api/v1/templates/resolve?provider=price-agent&capability=btc-price-feed`);
  const templateResolvePayload = await templateResolveResponse.json();
  const templateShowResponse = await fetch(`${host}/api/v1/templates/tpl_svc-price`);
  const templateShowPayload = await templateShowResponse.json();
  const invalidCapabilityResponse = await fetch(`${host}/api/v1/capabilities`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      capabilityId: 'svc-invalid',
      providerId: 'missing-agent',
      action: 'btc-price-feed'
    })
  });
  const invalidCapabilityPayload = await invalidCapabilityResponse.json();
  const configShow = await runSilentCli([...common, 'config', 'show']);
  const authLogin = await runSilentCli([...common, 'auth', 'login']);
  const authWhoami = await runSilentCli([...common, 'auth', 'whoami']);
  const authSession = await runSilentCli([...common, 'auth', 'session', '--single-limit', '7', '--daily-limit', '21']);
  const sessionAuthorize = await runSilentCli([
    ...common,
    'session',
    'authorize',
    '--eoa',
    sessionAuthorizationWallet.address,
    '--single-limit',
    '7',
    '--daily-limit',
    '21',
    '--allowed-capabilities',
    'btc-price-feed'
  ]);
  const buy = await runSilentCli([...common, 'buy', 'request', '--provider', 'price-agent', '--capability', 'btc-price-feed', '--input', '{"pair":"BTCUSDT"}']);
  const templateList = await runSilentCli([...common, 'template', 'list', '--active', 'true']);
  const providerList = await runSilentCli([...common, 'provider', 'list', '--role', 'provider']);
  const providerShow = await runSilentCli([...common, 'provider', 'show', 'price-agent']);
  const providerRegister = await runSilentCli([
    ...common,
    'provider',
    'register',
    '--input',
    '{"providerId":"signal-agent","name":"Signal Agent","role":"provider","mode":"a2a","capabilities":["signal-feed"],"active":true}'
  ]);
  const providerIdentityChallenge = await runSilentCli([
    ...common,
    'provider',
    'identity-challenge',
    '--input',
    '{"providerId":"external-agent","name":"External Agent","role":"provider","mode":"a2a","capabilities":["external-feed"],"identityRegistry":"0xidentity","identityAgentId":"9","active":true}'
  ]);
  const providerIdentitySignature = await externalProviderWallet.signMessage(
    String(providerIdentityChallenge?.data?.challenge?.message || '')
  );
  const providerRegisterIdentity = await runSilentCli([
    ...common,
    'provider',
    'register-identity',
    '--input',
    JSON.stringify({
      providerId: 'external-agent',
      name: 'External Agent',
      role: 'provider',
      mode: 'a2a',
      capabilities: ['external-feed'],
      challengeId: providerIdentityChallenge?.data?.challenge?.challengeId || '',
      signature: providerIdentitySignature,
      identityRegistry: '0xidentity',
      identityAgentId: '9',
      active: true
    })
  ]);
  const providerApprove = await runSilentCli([
    ...common,
    'provider',
    'approve',
    'external-agent'
  ]);
  const duplicateIdentityImportResponse = await fetch(`${host}/api/v1/providers/import-identity`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      providerId: 'duplicate-identity-agent',
      name: 'Duplicate Identity Agent',
      role: 'provider',
      mode: 'a2a',
      capabilities: ['duplicate-feed'],
      identityRegistry: '0xidentity',
      identityAgentId: '9',
      active: true
    })
  });
  const duplicateIdentityImportPayload = await duplicateIdentityImportResponse.json();
  const providerImportIdentity = await runSilentCli([
    ...common,
    'provider',
    'import-identity',
    '--input',
    '{"providerId":"identity-agent","name":"Identity Agent","role":"provider","mode":"a2a","capabilities":["identity-feed"],"identityRegistry":"0xidentity","identityAgentId":"7","active":true}'
  ]);
  const capabilityList = await runSilentCli([...common, 'capability', 'list', '--provider', 'price-agent']);
  const capabilityShow = await runSilentCli([...common, 'capability', 'show', 'svc-price']);
  const capabilityPublish = await runSilentCli([
    ...common,
    'capability',
    'publish',
    '--input',
    '{"capabilityId":"svc-signal","name":"Signal Feed","description":"Signal feed","action":"btc-price-feed","providerId":"signal-agent","price":"0.002"}'
  ]);
  const externalCapabilityPublish = await runSilentCli([
    ...common,
    'capability',
    'publish',
    '--input',
    '{"capabilityId":"svc-external","name":"External Feed","description":"External identity-linked feed","action":"external-feed","providerId":"external-agent","price":"0.003","tags":["external","identity-linked"]}'
  ]);
  const providerListVerified = await runSilentCli([
    ...common,
    'provider',
    'list',
    '--verified',
    'true',
    '--discoverable',
    'true',
    '--q',
    'external'
  ]);
  const capabilityListVerified = await runSilentCli([
    ...common,
    'capability',
    'list',
    '--provider-discoverable',
    'true',
    '--q',
    'external'
  ]);
  const discoverySelect = await runSilentCli([
    ...common,
    'discovery',
    'select',
    '--capability',
    'external-feed',
    '--discoverable',
    'true'
  ]);
  const discoveryCompare = await runSilentCli([
    ...common,
    'discovery',
    'compare',
    '--capability',
    'external-feed',
    '--discoverable',
    'true',
    '--limit',
    '3'
  ]);
  const discoveryRecommendBuy = await runSilentCli([
    ...common,
    'discovery',
    'recommend-buy',
    '--capability',
    'btc-price-feed'
  ]);
  const templateResolve = await runSilentCli([...common, 'template', 'resolve', '--provider', 'price-agent', '--capability', 'btc-price-feed']);
  const templateShow = await runSilentCli([...common, 'template', 'show', 'tpl_svc-price']);
  const templatePublish = await runSilentCli([
    ...common,
    'template',
    'publish',
    '--input',
    '{"templateId":"tpl_custom","name":"Custom BTC Price","serviceId":"svc-price","active":true}'
  ]);
  const templateRevoke = await runSilentCli([...common, 'template', 'revoke', 'tpl_custom']);
  const templateActivate = await runSilentCli([...common, 'template', 'activate', 'tpl_custom']);
  const templateExpire = await runSilentCli([...common, 'template', 'expire', 'tpl_custom']);
  const directBuy = await runSilentCli([...common, 'buy', 'direct', '--provider', 'price-agent', '--capability', 'btc-price-feed', '--input', '{"pair":"BTCUSDT"}']);
  const directPurchaseId = String(directBuy?.data?.purchase?.purchaseId || '').trim();
  const buyTraceId = String(buy?.data?.buy?.traceId || '').trim();
  const flowStatus = await runSilentCli([...common, 'flow', 'status', buyTraceId]);
  const flowDirect = await runSilentCli([...common, 'flow', 'show', directPurchaseId]);
  const artifactReceipt = await runSilentCli([...common, 'artifact', 'receipt', buyTraceId]);
  const artifactEvidence = await runSilentCli([...common, 'artifact', 'evidence', buyTraceId]);
  const publicEvidence = await runSilentCli([...common, 'evidence', 'get', buyTraceId, '--public']);
  const jobCreate = await runSilentCli([...common, 'job', 'create', '--provider', 'price-agent', '--capability', 'btc-price-feed', '--budget', '0.01', '--input', '{"pair":"BTCUSDT"}']);
  const jobId = String(jobCreate?.data?.job?.jobId || '').trim();
  const jobFund = await runSilentCli([...common, 'job', 'fund', jobId]);
  const jobSubmit = await runSilentCli([...common, 'job', 'submit', jobId]);
  const jobShow = await runSilentCli([...common, 'job', 'show', jobId]);
  const jobCreateReject = await runSilentCli([...common, 'job', 'create', '--provider', 'price-agent', '--capability', 'btc-price-feed', '--budget', '0.02', '--input', '{"pair":"BTCUSDT"}']);
  const rejectJobId = String(jobCreateReject?.data?.job?.jobId || '').trim();
  const rejectJobFund = await runSilentCli([...common, 'job', 'fund', rejectJobId]);
  const jobReject = await runSilentCli([...common, 'job', 'reject', rejectJobId, '--input', '{"reason":"quality check failed","evaluator":"risk-agent"}']);
  const trustReputation = await runSilentCli([...common, 'trust', 'reputation', '--agent', 'price-agent']);
  const trustValidations = await runSilentCli([...common, 'trust', 'validations', '--agent', 'price-agent']);
  const publicationSourceId = String(trustReputation?.data?.items?.[0]?.signalId || '').trim();
  const trustPublish = await runSilentCli([
    ...common,
    'trust',
    'publish',
    '--input',
    JSON.stringify({
      publicationType: 'reputation',
      sourceId: publicationSourceId,
      agentId: 'price-agent',
      status: 'pending',
      publicationRef: `ktrace://trust/reputation/${publicationSourceId}`
    })
  ]);
  const trustPublications = await runSilentCli([...common, 'trust', 'publications', '--agent', 'price-agent']);
  const flowJob = await runSilentCli([...common, 'flow', 'status', jobId]);
  const artifactJobReceipt = await runSilentCli([...common, 'artifact', 'receipt', jobId]);
  const history = await runSilentCli([...common, 'flow', 'history', '--limit', '10']);

  assert(configShow?.ok === true, 'config show failed');
  assert(missingProviderResponse.status === 404, 'missing provider did not return 404');
  assert(missingProviderPayload?.schemaVersion === 'v1', 'missing provider did not return v1 schema');
  assert(missingProviderPayload?.errorDetail?.code === 'provider_not_found', 'missing provider did not return error detail');
  assert(templateResolveResponse.status === 200, 'versioned template resolve did not return 200');
  assert(templateResolvePayload?.schemaVersion === 'v1', 'versioned template resolve did not return v1 schema');
  assert(templateResolvePayload?.template?.templateId === 'tpl_svc-price', 'versioned template resolve did not resolve template');
  assert(templateShowResponse.status === 200, 'versioned template show did not return 200');
  assert(templateShowPayload?.schemaVersion === 'v1', 'versioned template show did not return v1 schema');
  assert(templateShowPayload?.template?.templateId === 'tpl_svc-price', 'versioned template show did not load template');
  assert(invalidCapabilityResponse.status === 400, 'invalid capability publish did not return 400');
  assert(invalidCapabilityPayload?.schemaVersion === 'v1', 'invalid capability publish did not return v1 schema');
  assert(invalidCapabilityPayload?.errorDetail?.code === 'invalid_capability', 'invalid capability publish did not return versioned error detail');
  assert(authLogin?.ok === true, 'auth login failed');
  assert(authWhoami?.data?.session?.ready === true, 'auth whoami did not report ready session');
  assert(authSession?.data?.session?.sessionId === 'session-smoke', 'auth session did not return session id');
  assert(String(sessionAuthorize?.data?.authorization?.authorizedBy || '').toLowerCase() === sessionAuthorizationWallet.address.toLowerCase(), 'session authorize did not return authorizedBy');
  assert(String(sessionAuthorize?.data?.session?.authorizedBy || '').toLowerCase() === sessionAuthorizationWallet.address.toLowerCase(), 'session authorize did not return authorized session');
  assert(Array.isArray(templateList?.data?.templates) && templateList.data.templates.length > 0, 'template list returned no templates');
  assert(Array.isArray(providerList?.data?.providers) && providerList.data.providers.length > 0, 'provider list returned no providers');
  assert(providerShow?.data?.provider?.providerId === 'price-agent', 'provider show did not return provider');
  assert(providerRegister?.data?.provider?.providerId === 'signal-agent', 'provider register did not create provider');
  assert(providerIdentityChallenge?.data?.challenge?.challengeId, 'provider identity challenge did not issue challenge');
  assert(providerIdentityChallenge?.data?.challenge?.signatureRequired === true, 'provider identity challenge did not require signature');
  assert(providerRegisterIdentity?.data?.provider?.providerId === 'external-agent', 'provider register identity did not create provider');
  assert(providerRegisterIdentity?.data?.identity?.agentId === '9', 'provider register identity did not return verified identity');
  assert(providerRegisterIdentity?.data?.verification?.signerType === 'owner', 'provider register identity did not record signer type');
  assert(duplicateIdentityImportResponse.status === 400, 'duplicate identity import did not return 400');
  assert(duplicateIdentityImportPayload?.errorDetail?.code === 'invalid_provider_identity_import', 'duplicate identity import did not return versioned error');
  assert(providerImportIdentity?.data?.provider?.providerId === 'identity-agent', 'provider import identity did not create provider');
  assert(providerImportIdentity?.data?.identity?.agentId === '7', 'provider import identity did not return identity payload');
  assert(Array.isArray(capabilityList?.data?.capabilities) && capabilityList.data.capabilities.length > 0, 'capability list returned no capabilities');
  assert(capabilityShow?.data?.capability?.capabilityId === 'svc-price', 'capability show did not return capability');
  assert(capabilityPublish?.data?.capability?.capabilityId === 'svc-signal', 'capability publish did not create capability');
  assert(externalCapabilityPublish?.data?.capability?.capabilityId === 'svc-external', 'external capability publish did not create capability');
  assert(Array.isArray(providerListVerified?.data?.providers) && providerListVerified.data.providers.length >= 1, 'verified provider list returned no providers');
  assert(providerListVerified?.data?.providers?.[0]?.verification?.verified === true, 'verified provider list did not expose verification state');
  assert(Array.isArray(capabilityListVerified?.data?.capabilities) && capabilityListVerified.data.capabilities.length >= 1, 'verified capability list returned no capabilities');
  assert(capabilityListVerified?.data?.capabilities?.[0]?.provider?.verified === true, 'verified capability list did not expose provider verification');
  assert(Array.isArray(discoverySelect?.data?.items) && discoverySelect.data.items.length >= 1, 'discovery select returned no ranked candidates');
  assert(Number(discoverySelect?.data?.items?.[0]?.selectionScore || 0) > 0, 'discovery select did not expose a positive selection score');
  assert(Array.isArray(discoveryCompare?.data?.items) && discoveryCompare.data.items.length >= 1, 'discovery compare returned no ranked candidates');
  assert(discoveryCompare?.data?.top?.provider?.providerId === discoveryCompare?.data?.items?.[0]?.provider?.providerId, 'discovery compare top did not match first item');
  assert(discoveryRecommendBuy?.data?.selection?.directBuyReady === true, 'discovery recommend-buy did not return a direct-buy-ready selection');
  assert(discoveryRecommendBuy?.data?.template?.templateId === 'tpl_svc-price', 'discovery recommend-buy did not return the seeded direct-buy template');
  assert(templateResolve?.data?.template?.templateId === 'tpl_svc-price', 'template resolve did not resolve seeded template');
  assert(templateShow?.data?.template?.templateId === 'tpl_svc-price', 'template show did not load seeded template');
  assert(templatePublish?.data?.template?.templateId === 'tpl_custom', 'template publish did not create custom template');
  assert(templateRevoke?.data?.template?.status === 'inactive', 'template revoke did not inactivate template');
  assert(templateActivate?.data?.template?.status === 'active', 'template activate did not reactivate template');
  assert(templateExpire?.data?.template?.status === 'expired', 'template expire did not expire template');
  assert(buy?.data?.buy?.state === 'completed', 'buy request did not complete');
  assert(directBuy?.data?.purchase?.state === 'completed', 'buy direct did not complete');
  assert(flowStatus?.data?.flow?.traceId === buyTraceId, 'flow status did not resolve buy trace');
  assert(flowDirect?.data?.flow?.referenceId === directPurchaseId, 'flow show did not resolve direct purchase');
  assert(artifactReceipt?.data?.requestId === 'req-buy', 'artifact receipt did not resolve buy request');
  assert(String(artifactEvidence?.data?.evidence?.runtimeSnapshot?.authorizedBy || '').toLowerCase() === sessionAuthorizationWallet.address.toLowerCase(), 'artifact evidence did not expose authorizedBy');
  assert(String(publicEvidence?.data?.evidence?.authorizedBy || '').toLowerCase() === sessionAuthorizationWallet.address.toLowerCase(), 'public evidence did not expose authorizedBy');
  assert(publicEvidenceApiKeyHeader === '', 'public evidence endpoint unexpectedly received an api key header');
  assert(Boolean(jobCreate?.data?.job?.createAnchorId), 'job create did not publish create anchor');
  assert(jobFund?.data?.job?.state === 'funded', 'job fund did not mark funded');
  assert(Boolean(jobFund?.data?.job?.fundingAnchorId), 'job fund did not publish funding anchor');
  assert(jobSubmit?.data?.job?.state === 'completed', 'job submit did not complete');
  assert(Boolean(jobSubmit?.data?.job?.outcomeAnchorId), 'job submit did not publish outcome anchor');
  assert(Boolean(jobShow?.data?.job?.receiptRef), 'job show did not expose receipt ref');
  assert(rejectJobFund?.data?.job?.state === 'funded', 'second job fund did not mark funded');
  assert(jobReject?.data?.job?.state === 'rejected', 'job reject did not reject the job');
  assert(Boolean(jobReject?.data?.job?.outcomeAnchorId), 'job reject did not publish outcome anchor');
  assert((trustReputation?.data?.aggregate?.count || 0) >= 2, 'trust reputation did not record signals');
  assert(Array.isArray(trustValidations?.data?.items) && trustValidations.data.items.length >= 2, 'trust validations did not record evaluator records');
  assert(trustPublish?.data?.publication?.publicationType === 'reputation', 'trust publish did not create publication record');
  assert(Array.isArray(trustPublications?.data?.items) && trustPublications.data.items.length >= 1, 'trust publications did not return publication records');
  assert(flowJob?.data?.flow?.lane === 'job', 'flow status did not resolve job lane');
  assert(artifactJobReceipt?.data?.requestId === 'req-job', 'artifact receipt did not resolve job request');
  assert(Array.isArray(history?.data?.history) && history.data.history.length >= 2, 'flow history did not return normalized items');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          configProfile: configShow?.data?.config?.profile || '',
          sessionAuthorizedBy: sessionAuthorize?.data?.authorization?.authorizedBy || '',
          buyTraceId,
          directPurchaseId: directBuy?.data?.purchase?.purchaseId || '',
          providerCount: Array.isArray(providerList?.data?.providers) ? providerList.data.providers.length : 0,
          publishedProviderId: providerRegister?.data?.provider?.providerId || '',
            challengedProviderId: providerIdentityChallenge?.data?.providerDraft?.providerId || '',
            registeredIdentityProviderId: providerRegisterIdentity?.data?.provider?.providerId || '',
            approvedProviderId: providerApprove?.data?.provider?.providerId || '',
            identityChallengeId: providerIdentityChallenge?.data?.challenge?.challengeId || '',
            identitySignerType: providerRegisterIdentity?.data?.verification?.signerType || '',
            duplicateIdentityImportCode: duplicateIdentityImportPayload?.errorDetail?.code || '',
          importedProviderId: providerImportIdentity?.data?.provider?.providerId || '',
          capabilityCount: Array.isArray(capabilityList?.data?.capabilities) ? capabilityList.data.capabilities.length : 0,
          publishedCapabilityId: capabilityPublish?.data?.capability?.capabilityId || '',
          externalCapabilityId: externalCapabilityPublish?.data?.capability?.capabilityId || '',
            verifiedProviderCount: Array.isArray(providerListVerified?.data?.providers) ? providerListVerified.data.providers.length : 0,
            verifiedCapabilityCount: Array.isArray(capabilityListVerified?.data?.capabilities) ? capabilityListVerified.data.capabilities.length : 0,
            discoverableProviderCount: Array.isArray(providerListVerified?.data?.providers) ? providerListVerified.data.providers.length : 0,
            discoverableCapabilityCount: Array.isArray(capabilityListVerified?.data?.capabilities) ? capabilityListVerified.data.capabilities.length : 0,
            rankedSelectionCount: Array.isArray(discoverySelect?.data?.items) ? discoverySelect.data.items.length : 0,
            topSelectionCapabilityId: discoverySelect?.data?.items?.[0]?.capability?.capabilityId || '',
            comparedSelectionCount: Array.isArray(discoveryCompare?.data?.items) ? discoveryCompare.data.items.length : 0,
            recommendedTemplateId: discoveryRecommendBuy?.data?.template?.templateId || '',
            templateCount: Array.isArray(templateList?.data?.templates) ? templateList.data.templates.length : 0,
          resolvedTemplateId: templateResolve?.data?.template?.templateId || '',
          expiredTemplateId: templateExpire?.data?.template?.templateId || '',
          flowState: flowStatus?.data?.flow?.state || '',
          directFlowLane: flowDirect?.data?.flow?.lane || '',
          receiptRequestId: artifactReceipt?.data?.requestId || '',
          publicEvidenceAuthorizedBy: publicEvidence?.data?.evidence?.authorizedBy || '',
          jobId,
          jobState: jobShow?.data?.job?.state || '',
          jobCreateAnchorId: jobCreate?.data?.job?.createAnchorId || '',
          jobFundingAnchorId: jobFund?.data?.job?.fundingAnchorId || '',
          jobOutcomeAnchorId: jobSubmit?.data?.job?.outcomeAnchorId || '',
          jobReceiptRef: jobShow?.data?.job?.receiptRef || '',
          rejectedJobId: rejectJobId,
          rejectedJobState: jobReject?.data?.job?.state || '',
          jobFlowLane: flowJob?.data?.flow?.lane || '',
          historyCount: Array.isArray(history?.data?.history) ? history.data.history.length : 0,
          reputationSignalCount: trustReputation?.data?.aggregate?.count || 0,
          validationCount: Array.isArray(trustValidations?.data?.items) ? trustValidations.data.items.length : 0,
          publicationCount: Array.isArray(trustPublications?.data?.items) ? trustPublications.data.items.length : 0
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await unlink(configPath).catch(() => {});
}
