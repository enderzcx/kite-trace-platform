import crypto from 'node:crypto';
import express from 'express';
import { ethers } from 'ethers';

import { createAuthHelpers } from '../lib/auth.js';
import { createClaudeConnectorAuthHelpers } from '../lib/claudeConnectorAuth.js';
import { createConsumerAuthorityHelpers } from '../lib/consumerAuthority.js';
import { registerMcpRoutes } from '../mcp/mcpServer.js';
import { registerCoreIdentitySessionRoutes } from '../routes/coreIdentitySessionRoutes.js';
import { registerJobLaneRoutes } from '../routes/jobLaneRoutes.js';
import { registerMarketAgentServiceRoutes } from '../routes/marketAgentServiceRoutes.js';
import { createPaymentPolicyHelpers } from '../routes/paymentPolicyHelpers.js';
import { registerReceiptEvidenceRoutes } from '../routes/receiptEvidenceRoutes.js';
import { registerTemplateRoutes } from '../routes/templateRoutes.js';
import { registerTrustV1Routes } from '../routes/v1/trustV1Routes.js';

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAddress(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function digestStableObject(input = {}) {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return {
    algorithm: 'sha256',
    canonicalization: 'sorted-top-level-json',
    value: crypto.createHash('sha256').update(canonical).digest('hex')
  };
}

function buildSessionRuntimePayload(runtime = {}) {
  return {
    owner: String(runtime?.owner || '').trim(),
    aaWallet: String(runtime?.aaWallet || '').trim(),
    sessionAddress: String(runtime?.sessionAddress || '').trim(),
    sessionId: String(runtime?.sessionId || '').trim(),
    sessionTxHash: String(runtime?.sessionTxHash || '').trim(),
    maxPerTx: Number(runtime?.maxPerTx || 0),
    dailyLimit: Number(runtime?.dailyLimit || 0),
    totalLimit: Number(runtime?.totalLimit || 0),
    gatewayRecipient: String(runtime?.gatewayRecipient || '').trim(),
    authorizedBy: String(runtime?.authorizedBy || '').trim(),
    authorizedAt: Number(runtime?.authorizedAt || 0),
    authorizationMode: String(runtime?.authorizationMode || '').trim(),
    authorizationPayloadHash: String(runtime?.authorizationPayloadHash || '').trim(),
    authorizationNonce: String(runtime?.authorizationNonce || '').trim(),
    authorizationExpiresAt: Number(runtime?.authorizationExpiresAt || 0),
    authorizedAgentId: String(runtime?.authorizedAgentId || '').trim(),
    authorizedAgentWallet: String(runtime?.authorizedAgentWallet || '').trim(),
    authorizationAudience: String(runtime?.authorizationAudience || '').trim(),
    allowedCapabilities: Array.isArray(runtime?.allowedCapabilities) ? runtime.allowedCapabilities : [],
    allowedProviders: Array.isArray(runtime?.allowedProviders) ? runtime.allowedProviders : [],
    allowedRecipients: Array.isArray(runtime?.allowedRecipients) ? runtime.allowedRecipients : [],
    authorityId: String(runtime?.authorityId || '').trim(),
    consumerAgentLabel: String(runtime?.consumerAgentLabel || '').trim(),
    authorityExpiresAt: Number(runtime?.authorityExpiresAt || 0),
    authorityStatus: String(runtime?.authorityStatus || '').trim(),
    authorityRevokedAt: Number(runtime?.authorityRevokedAt || 0),
    authorityRevocationReason: String(runtime?.authorityRevocationReason || '').trim(),
    hasSessionPrivateKey: Boolean(runtime?.hasSessionPrivateKey),
    source: String(runtime?.source || '').trim(),
    updatedAt: Number(runtime?.updatedAt || 0)
  };
}

function createJsonResponse(response) {
  return response.json().catch(() => ({}));
}

export async function createConsumerAuthorityHarness(options = {}) {
  const port = Number(options.port || 34620 + Math.floor(Math.random() * 500));
  const host = `http://127.0.0.1:${port}`;
  const authEnabled = Boolean(options.authEnabled);
  const enableMcp = Boolean(options.enableMcp);
  const packageVersion = normalizeText(options.packageVersion || '1.0.0') || '1.0.0';
  const wallet = normalizeAddress(options.wallet || '0x1111111111111111111111111111111111111111');
  const sessionAddress = normalizeAddress(options.sessionAddress || '0x2222222222222222222222222222222222222222');
  const gatewayRecipient = normalizeAddress(
    options.gatewayRecipient || '0x3333333333333333333333333333333333333333'
  );
  const settlementToken = normalizeAddress(
    options.settlementToken || '0x4444444444444444444444444444444444444444'
  );
  const providerAgentId = String(options.providerAgentId || 'price-agent').trim();
  const providerRecipient = normalizeAddress(options.providerRecipient || gatewayRecipient);
  const providerServiceId = String(options.serviceId || 'svc-price').trim();
  const providerTemplateId = String(options.templateId || 'tpl_svc-price').trim();
  const providerCapability = String(options.capability || 'btc-price-feed').trim().toLowerCase();
  const identityRegistry = normalizeAddress(
    options.identityRegistry || '0x7777777777777777777777777777777777777777'
  );

  const state = {
    runtime: {
      owner: wallet,
      aaWallet: wallet,
      sessionAddress,
      sessionId: String(options.sessionId || 'session-smoke').trim(),
      sessionTxHash: String(options.sessionTxHash || '0xsession').trim(),
      hasSessionPrivateKey: true,
      maxPerTx: Number(options.maxPerTx || 7),
      dailyLimit: Number(options.dailyLimit || 21),
      totalLimit: Number(options.totalLimit || 0),
      gatewayRecipient,
      authorizedBy: normalizeAddress(options.authorizedBy || '0x5555555555555555555555555555555555555555'),
      authorizedAt: Number(options.authorizedAt || Date.now()),
      authorizationMode: String(options.authorizationMode || 'user_grant_backend_executed').trim(),
      authorizationSignature:
        String(options.authorizationSignature || `0x${'2'.repeat(130)}`).trim(),
      authorizationPayloadHash:
        String(options.authorizationPayloadHash || `0x${'1'.repeat(64)}`).trim(),
      authorizationNonce: String(options.authorizationNonce || 'nonce-smoke').trim(),
      authorizationExpiresAt:
        Number(options.authorizationExpiresAt || Date.now() + 24 * 60 * 60 * 1000),
      authorizedAgentId: String(options.authorizedAgentId || 'consumer-agent').trim(),
      authorizedAgentWallet: normalizeAddress(
        options.authorizedAgentWallet || '0x6666666666666666666666666666666666666666'
      ),
      authorizationAudience: String(options.authorizationAudience || host).trim(),
      allowedCapabilities: Array.isArray(options.allowedCapabilities)
        ? options.allowedCapabilities
        : [providerCapability],
      source: 'consumer-authority-harness',
      updatedAt: Date.now()
    },
    policyConfig: {
      allowedRecipients: [providerRecipient],
      maxPerTx: Number(options.maxPerTx || 7),
      dailyLimit: Number(options.dailyLimit || 21),
      revokedPayers: []
    },
    policyFailures: [],
    consumerIntents: [],
    records: [],
    workflows: [],
    x402Requests: [],
    serviceInvocations: [],
    purchases: [],
    jobs: [],
    connectorInstallCodes: [],
    connectorGrants: [],
    reputationSignals: [],
    trustPublications: [],
    validationRecords: [],
    templates: [
      {
        templateId: providerTemplateId,
        templateVersion: 1,
        name: 'BTC Price Direct Buy',
        description: 'Direct template for BTC price feed',
        providerAgentId,
        capabilityId: providerCapability,
        serviceId: providerServiceId,
        pricingTerms: {
          amount: String(options.servicePrice || '0.001'),
          currency: 'token',
          tokenAddress: settlementToken
        },
        settlementTerms: {
          paymentMode: 'x402',
          recipient: providerRecipient,
          tokenAddress: settlementToken,
          proofMode: 'on-chain'
        },
        fulfillmentMode: 'direct',
        validFrom: new Date().toISOString(),
        validUntil: '',
        status: 'active',
        active: true,
        tags: ['consumer-authority'],
        exampleInput: { pair: 'BTCUSDT' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedBy: 'system'
      }
    ],
    networkAgents: [
      {
        id: providerAgentId,
        name: 'Harness Provider',
        role: 'provider',
        mode: 'a2api',
        identityRegistry,
        identityAgentId: '42',
        identityVerifiedAt: new Date().toISOString(),
        active: true,
        capabilities: [providerCapability]
      }
    ],
    services: [
      {
        id: providerServiceId,
        active: true,
        providerAgentId,
        action: providerCapability,
        name: 'BTC Price Feed',
        price: String(options.servicePrice || '0.001'),
        recipient: providerRecipient,
        tokenAddress: settlementToken
      }
    ]
  };

  const keys = {
    admin: authEnabled ? 'consumer-authority-admin-key' : '',
    agent: authEnabled ? 'consumer-authority-agent-key' : '',
    viewer: authEnabled ? 'consumer-authority-viewer-key' : '',
    accountAgent: authEnabled ? 'ktrace_sk_harness_account_agent' : ''
  };

  const { authConfigured, extractApiKey, resolveRoleByApiKey, resolveAuthRequest, requireRole } = createAuthHelpers({
    AUTH_DISABLED: !authEnabled,
    API_KEY_ADMIN: keys.admin,
    API_KEY_AGENT: keys.agent,
    API_KEY_VIEWER: keys.viewer,
    resolveAccountApiKey: (secret = '') => {
      const normalized = String(secret || '').trim();
      if (normalized !== keys.accountAgent) return null;
      return {
        role: 'agent',
        ownerEoa: wallet,
        authSource: 'account-api-key',
        keyId: 'harness-account-agent'
      };
    },
    ROLE_RANK: {
      viewer: 1,
      agent: 2,
      admin: 3
    }
  });

  function readRows(key) {
    return state[key].map((item) => clone(item));
  }

  function writeRows(key, rows = []) {
    state[key].splice(0, state[key].length, ...rows.map((item) => clone(item)));
    return readRows(key);
  }

  function upsertByKey(key, matchKey, record = {}) {
    const normalized = clone(record);
    const wanted = String(normalized?.[matchKey] || '').trim();
    const idx = state[key].findIndex((item) => String(item?.[matchKey] || '').trim() === wanted);
    if (idx >= 0) state[key][idx] = normalized;
    else state[key].unshift(normalized);
    return clone(normalized);
  }

  function readSessionRuntime() {
    return clone(state.runtime);
  }

  function resolveSessionRuntime({ owner = '', aaWallet = '', sessionId = '' } = {}) {
    const normalizedOwner = normalizeAddress(owner || '');
    const normalizedWallet = normalizeAddress(aaWallet || '');
    const normalizedSessionId = String(sessionId || '').trim();
    const runtime = readSessionRuntime();
    if (
      (!normalizedOwner || runtime.owner === normalizedOwner) &&
      (!normalizedWallet || runtime.aaWallet === normalizedWallet) &&
      (!normalizedSessionId || runtime.sessionId === normalizedSessionId)
    ) {
      return runtime;
    }
    return {};
  }

  function writeSessionRuntime(next = {}) {
    state.runtime = {
      ...state.runtime,
      ...clone(next),
      updatedAt: Date.now()
    };
    return readSessionRuntime();
  }

  function readPolicyConfig() {
    return clone(state.policyConfig);
  }

  function readPolicyFailures() {
    return readRows('policyFailures');
  }

  function writePolicyFailures(rows = []) {
    return writeRows('policyFailures', rows);
  }

  const paymentHelpers = createPaymentPolicyHelpers({
    BACKEND_RPC_URL: 'http://127.0.0.1:8545',
    HYPERLIQUID_ORDER_RECIPIENT: providerRecipient,
    KITE_AGENT2_AA_ADDRESS: providerRecipient,
    KITE_AGENT2_ID: providerAgentId,
    MERCHANT_ADDRESS: providerRecipient,
    PROOF_RECEIPT_POLL_INTERVAL_MS: 10,
    PROOF_RECEIPT_WAIT_MS: 25,
    PROOF_RPC_RETRIES: 1,
    PROOF_RPC_TIMEOUT_MS: 25,
    SETTLEMENT_TOKEN: settlementToken,
    X402_BTC_PRICE: String(options.servicePrice || '0.001'),
    X402_HYPERLIQUID_ORDER_PRICE: '0.01',
    X402_INFO_PRICE: '0.002',
    X402_REACTIVE_PRICE: '0.003',
    X402_RISK_SCORE_PRICE: '0.004',
    X402_TECHNICAL_PRICE: '0.005',
    crypto,
    ethers,
    getBackendSigner: null,
    normalizeAddress,
    readPolicyConfig,
    readPolicyFailures,
    resolveInfoSettlementRecipient: () => providerRecipient,
    resolveTechnicalSettlementRecipient: () => providerRecipient,
    waitMs: async () => null,
    writePolicyFailures
  });

  const sessionPayMetrics = {
    startedAt: Date.now(),
    totalRequests: 0,
    totalSuccess: 0,
    totalFailed: 0,
    totalRetryAttempts: 0,
    totalRetryDelayMs: 0,
    totalRetriesUsed: 0,
    totalFallbackAttempted: 0,
    totalFallbackSucceeded: 0,
    failuresByCategory: {
      policy: 0,
      network: 0,
      bundler: 0,
      unknown: 0
    },
    retriesByCategory: {},
    retryDelayMsByCategory: {},
    recentFailures: []
  };

  function markSessionPayFailure(entry = {}) {
    sessionPayMetrics.totalFailed += 1;
    sessionPayMetrics.failuresByCategory.policy =
      Number(sessionPayMetrics.failuresByCategory.policy || 0) + 1;
    sessionPayMetrics.recentFailures.unshift({
      code: String(entry?.errorCode || '').trim(),
      reason: String(entry?.reason || '').trim(),
      traceId: String(entry?.traceId || '').trim()
    });
    sessionPayMetrics.recentFailures = sessionPayMetrics.recentFailures.slice(0, 20);
  }

  const consumerAuthorityHelpers = createConsumerAuthorityHelpers({
    crypto,
    normalizeAddress,
    readPolicyConfig,
    buildPolicySnapshot: paymentHelpers.buildPolicySnapshot,
    evaluateTransferPolicy: paymentHelpers.evaluateTransferPolicy,
    logPolicyFailure: paymentHelpers.logPolicyFailure,
    markSessionPayFailure,
    readX402Requests: () => readRows('x402Requests'),
    readConsumerIntents: () => readRows('consumerIntents'),
    writeConsumerIntents: (rows = []) => writeRows('consumerIntents', rows),
    readSessionRuntime,
    resolveSessionRuntime,
    writeSessionRuntime
  });
  const claudeConnectorHelpers = createClaudeConnectorAuthHelpers({
    CONNECTOR_INSTALL_CODE_TTL_MS: 900_000,
    CONNECTOR_INSTALL_CODE_MAX_ROWS: 500,
    CONNECTOR_GRANT_MAX_ROWS: 1_000,
    DEFAULT_CONNECTOR_IDENTITY_REGISTRY: identityRegistry,
    createTraceId,
    normalizeAddress,
    readConnectorInstallCodes: () => readRows('connectorInstallCodes'),
    writeConnectorInstallCodes: (rows = []) => writeRows('connectorInstallCodes', rows),
    readConnectorGrants: () => readRows('connectorGrants'),
    writeConnectorGrants: (rows = []) => writeRows('connectorGrants', rows)
  });

  function buildCapabilityCatalog() {
    const now = new Date().toISOString();
    return state.services.map((service) => ({
      id: normalizeText(service?.id || ''),
      capabilityId: normalizeText(service?.id || ''),
      serviceId: normalizeText(service?.id || ''),
      name: normalizeText(service?.name || service?.id || ''),
      description: `Harness capability for ${normalizeText(service?.action || service?.id || 'service invoke')}.`,
      action: normalizeText(service?.action || ''),
      providerId: normalizeText(service?.providerAgentId || ''),
      providerAgentId: normalizeText(service?.providerAgentId || ''),
      exampleInput: {
        pair: 'BTCUSDT'
      },
      pricing: {
        amount: Number(service?.price || 0) || 0,
        currency: 'token'
      },
      audience: 'public_product',
      scopeMode: 'scoped',
      riskLevel: 'standard',
      active: service?.active !== false,
      createdAt: now,
      updatedAt: now
    }));
  }

  function appendWorkflowStep(workflow = {}, name = '', status = '', details = {}) {
    if (!Array.isArray(workflow.steps)) workflow.steps = [];
    workflow.steps.push({
      name,
      status,
      at: new Date().toISOString(),
      details: details && typeof details === 'object' ? clone(details) : {}
    });
  }

  function upsertWorkflow(record = {}) {
    return upsertByKey('workflows', 'traceId', record);
  }

  function upsertPurchaseRecord(record = {}) {
    return upsertByKey('purchases', 'purchaseId', record);
  }

  function upsertServiceInvocation(record = {}) {
    return upsertByKey('serviceInvocations', 'invocationId', record);
  }

  function upsertJobRecord(record = {}) {
    return upsertByKey('jobs', 'jobId', record);
  }

  function upsertX402RequestRecord(record = {}) {
    return upsertByKey('x402Requests', 'requestId', record);
  }

  function appendRecord(record = {}) {
    state.records.unshift(clone(record));
    return clone(record);
  }

  function appendReputationSignal(record = {}) {
    state.reputationSignals.unshift(clone(record));
    return clone(record);
  }

  function appendValidationRecord(record = {}) {
    state.validationRecords.unshift(clone(record));
    return clone(record);
  }

  function appendTrustPublication(record = {}) {
    state.trustPublications.unshift(clone(record));
    return clone(record);
  }

  function evaluateServiceInvokeGuard() {
    return {
      ok: true,
      checks: []
    };
  }

  async function postSessionPayWithRetry() {
    return {
      ok: true,
      body: {
        payment: {
          txHash: `0x${'a'.repeat(64)}`,
          userOpHash: `0x${'b'.repeat(64)}`
        }
      }
    };
  }

  function buildPaymentRequiredResponse(request = {}, reason = '') {
    return {
      ok: false,
      error: 'payment_required',
      reason,
      requestId: String(request?.requestId || '').trim()
    };
  }

  async function publishJobLifecycleAnchorOnChain() {
    const idx = state.jobs.length + state.workflows.length + state.purchases.length + state.serviceInvocations.length + 1;
    return {
      configured: false,
      published: false,
      registryAddress: '',
      anchorId: String(idx),
      anchorTxHash: ''
    };
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.traceId = normalizeText(req.headers['x-trace-id'] || '') || createTraceId('req');
    next();
  });

  app.get('/api/v1/capabilities', requireRole('viewer'), (req, res) =>
    res.json({
      ok: true,
      traceId: req.traceId,
      items: buildCapabilityCatalog()
    })
  );

  app.post('/api/workflow/btc-price/run', (req, res) => {
    const traceId = String(req.body?.traceId || createTraceId('workflow')).trim();
    const requestId = createTraceId('req');
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const summary = `BTC quote delivered for ${String(req.body?.pair || 'BTCUSDT').trim()}`;
    const workflow = {
      traceId,
      requestId,
      type: 'btc-price-feed',
      state: 'success',
      payer: normalizeAddress(req.body?.payer || state.runtime.aaWallet || ''),
      txHash,
      userOpHash: `0x${crypto.randomBytes(32).toString('hex')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: {
        summary,
        pair: String(req.body?.pair || 'BTCUSDT').trim()
      }
    };
    upsertWorkflow(workflow);
    upsertX402RequestRecord({
      requestId,
      status: 'paid',
      action: 'btc-price-feed',
      amount: String(state.services[0]?.price || '0.001'),
      payer: workflow.payer,
      recipient: normalizeAddress(state.services[0]?.recipient || providerRecipient),
      tokenAddress: normalizeAddress(state.services[0]?.tokenAddress || settlementToken),
      paymentTxHash: txHash,
      paymentProof: {
        requestId,
        txHash,
        payer: workflow.payer,
        recipient: normalizeAddress(state.services[0]?.recipient || providerRecipient),
        tokenAddress: normalizeAddress(state.services[0]?.tokenAddress || settlementToken),
        amount: String(state.services[0]?.price || '0.001')
      },
      proofVerification: {
        mode: 'stub',
        verifiedAt: Date.now(),
        details: {
          blockNumber: 42
        }
      },
      result: {
        summary
      }
    });
    appendRecord({
      time: new Date().toISOString(),
      type: 'aa-session-payment',
      amount: String(state.services[0]?.price || '0.001'),
      token: normalizeAddress(state.services[0]?.tokenAddress || settlementToken),
      recipient: normalizeAddress(state.services[0]?.recipient || providerRecipient),
      txHash,
      status: 'success',
      requestId
    });
    return res.json({
      ok: true,
      traceId,
      requestId,
      state: 'success',
      invocationId: createTraceId('svc'),
      txHash,
      workflow,
      receipt: {
        requestId,
        traceId,
        txHash,
        amount: String(state.services[0]?.price || '0.001'),
        result: {
          summary
        }
      }
    });
  });

  registerCoreIdentitySessionRoutes({
    app,
    deps: {
      ERC8004_AGENT_ID: null,
      ERC8004_IDENTITY_REGISTRY: identityRegistry,
      BACKEND_PUBLIC_URL: host,
      PORT: String(port),
      createTraceId,
      crypto,
      ensureAAAccountDeployment: async () => null,
      buildClaudeConnectorGrantPublicRecord: claudeConnectorHelpers.buildGrantPublicRecord,
      buildClaudeConnectorInstallCodePublicRecord: claudeConnectorHelpers.buildInstallCodePublicRecord,
      maskSecret: (value = '') => String(value || '').trim() ? '***' : '',
      findActiveClaudeConnectorGrant: claudeConnectorHelpers.findActiveGrantByOwner,
      readRecords: () => readRows('records'),
      readSessionRuntime,
      findPendingClaudeConnectorInstallCode: claudeConnectorHelpers.findPendingInstallCodeByOwner,
      issueClaudeConnectorInstallCode: claudeConnectorHelpers.issueInstallCode,
      resolveSessionRuntime,
      requireRole,
      revokeClaudeConnectorGrant: claudeConnectorHelpers.revokeGrant,
      sessionPayConfigSnapshot: () => ({
        maxPerTx: Number(state.runtime.maxPerTx || 0),
        dailyLimit: Number(state.runtime.dailyLimit || 0)
      }),
      sessionPayMetrics,
      sessionRuntimePath: 'memory://session-runtime',
      materializeAuthority: consumerAuthorityHelpers.materializeAuthority,
      revokeConsumerAuthorityPolicy: consumerAuthorityHelpers.revokeConsumerAuthorityPolicy,
      validateConsumerAuthority: consumerAuthorityHelpers.validateConsumerAuthority,
      writeConsumerAuthorityPolicy: consumerAuthorityHelpers.writeConsumerAuthorityPolicy,
      writeJsonObject: () => null,
      writeRecords: (rows = []) => writeRows('records', rows),
      writeSessionRuntime
    },
    helpers: {
      appendSessionApprovalRequest: () => ({}),
      buildApprovalRequestToken: () => 'approval-token',
      buildSessionApprovalRequestPayload: () => ({}),
      buildSessionRuntimePayload,
      ensureBackendSessionRuntime: async () => ({
        created: false,
        reused: true,
        runtime: readSessionRuntime(),
        tokenAddress: settlementToken
      }),
      finalizeSessionAuthorization: async () => {
        throw new Error('not_implemented_in_harness');
      },
      getBackendSignerState: () => ({
        configured: false,
        address: ''
      }),
      listSessionApprovalRequests: () => [],
      normalizeSessionGrantAddress: normalizeAddress,
      normalizeSessionGrantPayload: (payload = {}) => payload,
      normalizeSessionGrantText: (value = '', fallback = '') => String(value || fallback || '').trim()
    }
  });

  registerTemplateRoutes(app, {
    appendReputationSignal,
    beginConsumerIntent: consumerAuthorityHelpers.beginConsumerIntent,
    buildAuthorityPublicSummary: consumerAuthorityHelpers.buildAuthorityPublicSummary,
    buildAuthoritySnapshot: consumerAuthorityHelpers.buildAuthoritySnapshot,
    buildPolicySnapshotHash: consumerAuthorityHelpers.buildPolicySnapshotHash,
    createTraceId,
    ensureNetworkAgents: () => readRows('networkAgents'),
    ensureServiceCatalog: () => readRows('services'),
    ensureNetworkAgents: () => readRows('networkAgents'),
    ensureTemplateCatalog: () => readRows('templates'),
    finalizeConsumerIntent: consumerAuthorityHelpers.finalizeConsumerIntent,
    findConsumerIntent: consumerAuthorityHelpers.findConsumerIntent,
    getInternalAgentApiKey: () => normalizeText(keys.agent || keys.admin || ''),
    normalizeAddress,
    PORT: String(port),
    readPurchases: () => readRows('purchases'),
    readSessionRuntime,
    requireRole,
    upsertWorkflow,
    upsertPurchaseRecord,
    validateConsumerAuthority: consumerAuthorityHelpers.validateConsumerAuthority,
    writeTemplates: (rows = []) => writeRows('templates', rows)
  });

  registerMarketAgentServiceRoutes(app, {
    ANALYSIS_PROVIDER: '',
    appendWorkflowStep,
    beginConsumerIntent: consumerAuthorityHelpers.beginConsumerIntent,
    buildAuthorityPublicSummary: consumerAuthorityHelpers.buildAuthorityPublicSummary,
    buildAuthoritySnapshot: consumerAuthorityHelpers.buildAuthoritySnapshot,
    buildPolicySnapshotHash: consumerAuthorityHelpers.buildPolicySnapshotHash,
    buildPaymentRequiredResponse,
    buildResponseHash: paymentHelpers.buildResponseHash,
    buildServiceStatus: () => ({}),
    broadcastEvent: () => null,
    computeServiceReputation: () => ({}),
    createX402Request: (query = '', payer = '', action = '', extras = {}) => ({
      requestId: createTraceId('x402'),
      query,
      payer,
      action,
      amount: String(extras?.amount || state.services[0]?.price || '0.001'),
      recipient: normalizeAddress(extras?.recipient || state.services[0]?.recipient || providerRecipient),
      tokenAddress: normalizeAddress(extras?.tokenAddress || state.services[0]?.tokenAddress || settlementToken),
      identity: extras?.identity || null,
      createdAt: Date.now()
    }),
    appendReputationSignal,
    appendTrustPublication,
    createTraceId,
    ensureNetworkAgents: () => readRows('networkAgents'),
    ensureServiceCatalog: () => readRows('services'),
    evaluateServiceInvokeGuard,
    finalizeConsumerIntent: consumerAuthorityHelpers.finalizeConsumerIntent,
    findConsumerIntent: consumerAuthorityHelpers.findConsumerIntent,
    getInternalAgentApiKey: () => normalizeText(keys.agent || keys.admin || ''),
    hasStrictX402Evidence: false,
    handleRouterRuntimeTextMessage: async () => null,
    hyperliquidAdapter: null,
    KITE_AGENT1_ID: 'consumer-agent',
    KITE_AGENT2_AA_ADDRESS: providerRecipient,
    KITE_AGENT2_ID: providerAgentId,
    mapServiceReceipt: (invocation = {}) => invocation,
    normalizeAddress,
    normalizeRiskScoreParams: (input = {}) => input,
    normalizeXReaderParams: (input = {}) => input,
    PORT: String(port),
    postSessionPayWithRetry,
    publishTrustPublicationOnChain: async (input = {}) => {
      const mode = String(options.trustPublicationMode || '').trim().toLowerCase();
      if (mode === 'fail') {
        throw new Error('simulated_trust_publication_failure');
      }
      if (mode === 'published') {
        return {
          configured: true,
          published: true,
          registryAddress: '0x9999999999999999999999999999999999999999',
          anchorId: createTraceId('anchor'),
          anchorTxHash: `0x${'c'.repeat(64)}`
        };
      }
      return {
        configured: false,
        published: false,
        registryAddress: '',
        anchorId: '',
        anchorTxHash: ''
      };
    },
    readRecords: () => readRows('records'),
    readServiceInvocations: () => readRows('serviceInvocations'),
    readSessionRuntime,
    resolveSessionRuntime,
    readWorkflows: () => readRows('workflows'),
    readX402Requests: () => readRows('x402Requests'),
    requireRole,
    resolveAnalysisErrorStatus: () => 500,
    resolveWorkflowTraceId: (traceId = '') => String(traceId || '').trim() || createTraceId('workflow'),
    runAgent001HyperliquidOrderWorkflow: async () => ({}),
    runRiskScoreAnalysis: async () => ({}),
    sanitizeServiceRecord: (record = {}) => record,
    SETTLEMENT_TOKEN: settlementToken,
    startXmtpRuntimes: async () => null,
    upsertWorkflow,
    upsertAgent001ResultRecord: () => null,
    upsertServiceInvocation,
    validateConsumerAuthority: consumerAuthorityHelpers.validateConsumerAuthority,
    validatePaymentProof: paymentHelpers.validatePaymentProof,
    verifyProofOnChain: async () => ({
      ok: true,
      details: {
        blockNumber: 42
      }
    }),
    writeX402Requests: (rows = []) => writeRows('x402Requests', rows),
    writeRecords: (rows = []) => writeRows('records', rows),
    writePublishedServices: (rows = []) => writeRows('services', rows),
    X_READER_MAX_CHARS_DEFAULT: 800,
    X402_BTC_PRICE: String(state.services[0]?.price || '0.001')
  });

  registerTrustV1Routes(app, {
    createTraceId,
    publishTrustPublicationOnChain: async (input = {}) => {
      const mode = String(options.trustPublicationMode || '').trim().toLowerCase();
      if (mode === 'fail') {
        throw new Error('simulated_trust_publication_failure');
      }
      if (mode === 'published') {
        return {
          configured: true,
          published: true,
          registryAddress: '0x9999999999999999999999999999999999999999',
          anchorId: createTraceId('anchor'),
          anchorTxHash: `0x${'c'.repeat(64)}`
        };
      }
      return {
        configured: false,
        published: false,
        registryAddress: '',
        anchorId: '',
        anchorTxHash: ''
      };
    },
    readReputationSignals: () => readRows('reputationSignals'),
    readTrustPublications: () => readRows('trustPublications'),
    readValidationRecords: () => readRows('validationRecords'),
    appendTrustPublication,
    requireRole,
    readIdentityProfile: async ({ registry = '', agentId = '' } = {}) => ({
      configured: {
        registry: normalizeText(registry || identityRegistry),
        agentId: normalizeText(agentId || state.runtime.authorizedAgentId || '')
      },
      available: Boolean(normalizeText(registry || identityRegistry) && normalizeText(agentId || state.runtime.authorizedAgentId)),
      ownerAddress: wallet,
      agentWallet: wallet,
      tokenURI: ''
    })
  });

  registerJobLaneRoutes(app, {
    appendReputationSignal,
    appendValidationRecord,
    beginConsumerIntent: consumerAuthorityHelpers.beginConsumerIntent,
    buildAuthorityPublicSummary: consumerAuthorityHelpers.buildAuthorityPublicSummary,
    buildAuthoritySnapshot: consumerAuthorityHelpers.buildAuthoritySnapshot,
    buildPolicySnapshotHash: consumerAuthorityHelpers.buildPolicySnapshotHash,
    checkAnchorExistsOnChain: async () => ({
      configured: false,
      hasAnchor: false,
      latestAnchorId: ''
    }),
    createTraceId,
    digestStableObject,
    ERC8183_EXECUTOR_AA_ADDRESS: '0x7777777777777777777777777777777777777777',
    ERC8183_EXECUTOR_OWNER_ADDRESS: '0x7777777777777777777777777777777777777777',
    ERC8183_REQUESTER_AA_ADDRESS: wallet,
    ERC8183_REQUESTER_OWNER_ADDRESS: wallet,
    ERC8183_VALIDATOR_AA_ADDRESS: '0x8888888888888888888888888888888888888888',
    ERC8183_VALIDATOR_OWNER_ADDRESS: '0x8888888888888888888888888888888888888888',
    ensureServiceCatalog: () => readRows('services'),
    finalizeConsumerIntent: consumerAuthorityHelpers.finalizeConsumerIntent,
    findConsumerIntent: consumerAuthorityHelpers.findConsumerIntent,
    getInternalAgentApiKey: () => normalizeText(keys.agent || keys.admin || ''),
    lockEscrowFunds: async () => ({
      configured: false,
      txHash: ''
    }),
    normalizeAddress,
    PORT: String(port),
    publishJobLifecycleAnchorOnChain,
    readJobs: () => readRows('jobs'),
    readSessionRuntime,
    readLatestAnchorIdOnChain: async () => ({
      configured: false,
      latestAnchorId: ''
    }),
    requireRole,
    resolveSessionOwnerByAaWallet: (aaWallet = '') =>
      normalizeAddress(aaWallet || '') === wallet ? wallet : '',
    resolveWorkflowTraceId: (traceId = '') => String(traceId || '').trim() || createTraceId('job'),
    submitEscrowResult: async () => ({
      configured: false,
      txHash: ''
    }),
    upsertJobRecord,
    validateConsumerAuthority: consumerAuthorityHelpers.validateConsumerAuthority,
    validateEscrowJob: async () => ({
      configured: false,
      txHash: ''
    }),
    acceptEscrowJob: async () => ({
      configured: false,
      txHash: ''
    }),
    KTRACE_JOB_APPROVAL_THRESHOLD: 0,
    KTRACE_JOB_APPROVAL_TTL_MS: 60_000
  });

  registerReceiptEvidenceRoutes(app, {
    buildResponseHash: paymentHelpers.buildResponseHash,
    digestStableObject,
    ethers,
    listNetworkAuditEventsByTraceId: () => [],
    readJobs: () => readRows('jobs'),
    readPurchases: () => readRows('purchases'),
    readRecords: () => readRows('records'),
    readServiceInvocations: () => readRows('serviceInvocations'),
    readSessionRuntime,
    readWorkflows: () => readRows('workflows'),
    readX402Requests: () => readRows('x402Requests'),
    requireRole,
    signResponseHash: paymentHelpers.signResponseHash
  });

  if (enableMcp) {
    registerMcpRoutes(app, {
      PACKAGE_VERSION: packageVersion,
      PORT: String(port),
      authConfigured,
      extractApiKey,
      resolveAuthRequest,
      resolveRoleByApiKey,
      readSessionRuntime,
      readSessionRuntimeByOwner: (owner = '') => {
        const runtime = readSessionRuntime();
        return normalizeAddress(owner || '') === normalizeAddress(runtime?.owner || '') ? runtime : {};
      },
      getInternalAgentApiKey: () => normalizeText(keys.agent || keys.admin || ''),
      resolveClaudeConnectorToken: claudeConnectorHelpers.resolveConnectorToken,
      claimClaudeConnectorInstallCode: claudeConnectorHelpers.claimInstallCode,
      touchClaudeConnectorGrantUsage: claudeConnectorHelpers.touchGrantUsage
    });
  }

  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  async function requestJson(pathname = '', options = {}) {
    const response = await fetch(`${host}${pathname}`, options);
    const payload = await createJsonResponse(response);
    return {
      response,
      payload
    };
  }

  return {
    app,
    host,
    keys,
    port,
    state,
    helpers: consumerAuthorityHelpers,
    paymentHelpers,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    requestJson,
    resetAuthorityRuntime(patch = {}) {
      state.runtime = {
        ...state.runtime,
        authorityId: '',
        allowedProviders: [],
        allowedRecipients: [],
        authorityExpiresAt: 0,
        authorityStatus: '',
        authorityRevokedAt: 0,
        authorityRevocationReason: '',
        authorityCreatedAt: 0,
        authorityUpdatedAt: 0,
        ...clone(patch),
        updatedAt: Date.now()
      };
      return readSessionRuntime();
    }
  };
}
