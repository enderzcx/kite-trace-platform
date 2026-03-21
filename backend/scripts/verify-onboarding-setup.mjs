import crypto from 'node:crypto';
import express from 'express';
import { ethers } from 'ethers';

import { createAuthHelpers } from '../lib/auth.js';
import { createClaudeConnectorAuthHelpers } from '../lib/claudeConnectorAuth.js';
import { createOnboardingSetupHelpers } from '../lib/onboardingSetupHelpers.js';
import { registerMcpRoutes } from '../mcp/mcpServer.js';
import { registerCoreIdentitySessionRoutes } from '../routes/coreIdentitySessionRoutes.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeAddress(value = '') {
  const text = normalizeText(value);
  return ethers.isAddress(text) ? ethers.getAddress(text) : '';
}

function buildSessionGrantMessage(payloadInput = {}) {
  const payload = {
    schema: 'kite-session-grant-v1',
    agentId: normalizeText(payloadInput.agentId || '1'),
    agentWallet: normalizeAddress(payloadInput.agentWallet || '0x1111111111111111111111111111111111111111'),
    identityRegistry: normalizeAddress(
      payloadInput.identityRegistry || '0x2222222222222222222222222222222222222222'
    ),
    chainId: normalizeText(payloadInput.chainId || 'kite-testnet'),
    payerAaWallet: normalizeAddress(
      payloadInput.payerAaWallet || '0x3333333333333333333333333333333333333333'
    ),
    tokenAddress: normalizeAddress(
      payloadInput.tokenAddress || '0x4444444444444444444444444444444444444444'
    ),
    gatewayRecipient: normalizeAddress(
      payloadInput.gatewayRecipient || '0x5555555555555555555555555555555555555555'
    ),
    audience: normalizeText(payloadInput.audience || 'http://127.0.0.1:3001'),
    singleLimit: normalizeText(payloadInput.singleLimit || '0.01'),
    dailyLimit: normalizeText(payloadInput.dailyLimit || '0.10'),
    allowedCapabilities: Array.isArray(payloadInput.allowedCapabilities)
      ? payloadInput.allowedCapabilities.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
      : [],
    nonce: normalizeText(payloadInput.nonce || `0x${crypto.randomBytes(16).toString('hex')}`),
    issuedAt: Number(payloadInput.issuedAt || Date.now()),
    expiresAt: Number(payloadInput.expiresAt || Date.now() + 24 * 60 * 60 * 1000)
  };
  return [
    'KTRACE Session Authorization',
    `schema: ${payload.schema}`,
    `agentId: ${payload.agentId}`,
    `agentWallet: ${payload.agentWallet}`,
    `identityRegistry: ${payload.identityRegistry}`,
    `chainId: ${payload.chainId}`,
    `payerAaWallet: ${payload.payerAaWallet}`,
    `tokenAddress: ${payload.tokenAddress}`,
    `gatewayRecipient: ${payload.gatewayRecipient}`,
    `singleLimit: ${payload.singleLimit}`,
    `dailyLimit: ${payload.dailyLimit}`,
    `allowedCapabilities: ${payload.allowedCapabilities.join(',')}`,
    `audience: ${payload.audience}`,
    `nonce: ${payload.nonce}`,
    `issuedAt: ${new Date(payload.issuedAt).toISOString()}`,
    `expiresAt: ${new Date(payload.expiresAt).toISOString()}`
  ].join('\n');
}

function buildSessionRuntimePayload(runtime = {}) {
  return {
    owner: normalizeAddress(runtime.owner || ''),
    aaWallet: normalizeAddress(runtime.aaWallet || ''),
    sessionAddress: normalizeAddress(runtime.sessionAddress || ''),
    sessionId: normalizeText(runtime.sessionId || ''),
    sessionTxHash: normalizeText(runtime.sessionTxHash || ''),
    maxPerTx: Number(runtime.maxPerTx || 0),
    dailyLimit: Number(runtime.dailyLimit || 0),
    gatewayRecipient: normalizeAddress(runtime.gatewayRecipient || ''),
    tokenAddress: normalizeAddress(runtime.tokenAddress || ''),
    authorizedBy: normalizeAddress(runtime.authorizedBy || ''),
    authorizedAt: Number(runtime.authorizedAt || 0),
    authorizationMode: normalizeText(runtime.authorizationMode || ''),
    authorizationPayloadHash: normalizeText(runtime.authorizationPayloadHash || ''),
    authorizationNonce: normalizeText(runtime.authorizationNonce || ''),
    authorizationExpiresAt: Number(runtime.authorizationExpiresAt || 0),
    authorizedAgentId: normalizeText(runtime.authorizedAgentId || ''),
    authorizedAgentWallet: normalizeAddress(runtime.authorizedAgentWallet || ''),
    authorizationAudience: normalizeText(runtime.authorizationAudience || ''),
    allowedCapabilities: Array.isArray(runtime.allowedCapabilities) ? runtime.allowedCapabilities : [],
    hasSessionPrivateKey: Boolean(runtime.sessionPrivateKey),
    source: normalizeText(runtime.source || ''),
    runtimePurpose: normalizeText(runtime.runtimePurpose || ''),
    aaDeployed: Boolean(runtime.aaDeployed),
    updatedAt: Number(runtime.updatedAt || 0)
  };
}

function extractCookie(setCookieHeader = '') {
  return normalizeText(String(setCookieHeader || '').split(';')[0] || '');
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

const port = 34974;
const host = `http://127.0.0.1:${port}`;
const ownerWallet = ethers.Wallet.createRandom();
const sessionWallet = ethers.Wallet.createRandom();

const state = {
  onboardingChallenges: [],
  accountApiKeys: [],
  connectorInstallCodes: [],
  connectorGrants: [],
  runtime: {},
  authority: null,
  services: [
    {
      id: 'svc-price',
      capabilityId: 'svc-price',
      name: 'Setup MCP Price Feed',
      action: 'svc-price',
      providerAgentId: 'price-agent',
      active: true
    }
  ]
};

const onboardingHelpers = createOnboardingSetupHelpers({
  ONBOARDING_COOKIE_NAME: 'ktrace_onboard',
  ONBOARDING_COOKIE_SECRET: 'setup-harness-secret',
  createTraceId,
  normalizeAddress,
  readOnboardingChallenges: () => state.onboardingChallenges,
  writeOnboardingChallenges: (rows = []) => {
    state.onboardingChallenges = Array.isArray(rows) ? rows : [];
  },
  readAccountApiKeys: () => state.accountApiKeys,
  writeAccountApiKeys: (rows = []) => {
    state.accountApiKeys = Array.isArray(rows) ? rows : [];
  }
});

const connectorHelpers = createClaudeConnectorAuthHelpers({
  CONNECTOR_INSTALL_CODE_TTL_MS: 15 * 60 * 1000,
  CONNECTOR_GRANT_TTL_MS: 24 * 60 * 60 * 1000,
  CONNECTOR_INSTALL_CODE_MAX_ROWS: 100,
  CONNECTOR_GRANT_MAX_ROWS: 100,
  createTraceId,
  normalizeAddress,
  readConnectorInstallCodes: () => state.connectorInstallCodes,
  writeConnectorInstallCodes: (rows = []) => {
    state.connectorInstallCodes = Array.isArray(rows) ? rows : [];
  },
  readConnectorGrants: () => state.connectorGrants,
  writeConnectorGrants: (rows = []) => {
    state.connectorGrants = Array.isArray(rows) ? rows : [];
  }
});

const {
  authConfigured,
  extractApiKey,
  resolveAuthRequest,
  resolveRoleByApiKey,
  requireRole
} = createAuthHelpers({
  AUTH_DISABLED: false,
  API_KEY_ADMIN: 'setup-admin-key',
  API_KEY_AGENT: 'setup-agent-key',
  API_KEY_VIEWER: 'setup-viewer-key',
  ROLE_RANK: {
    viewer: 1,
    agent: 2,
    admin: 3
  },
  ONBOARDING_COOKIE_NAME: onboardingHelpers.cookieName,
  hasDynamicAuthSource: () => Boolean(state.accountApiKeys.length > 0 || onboardingHelpers.cookieName),
  resolveAccountApiKey: onboardingHelpers.resolveAccountApiKey,
  resolveOnboardingCookie: onboardingHelpers.resolveOnboardingCookie,
  touchAccountApiKeyUsage: onboardingHelpers.touchAccountApiKeyUsage
});

function resolveSessionRuntime({ owner = '' } = {}) {
  const normalizedOwner = normalizeAddress(owner || '');
  if (!normalizedOwner || state.runtime.owner === normalizedOwner) {
    return {
      ...state.runtime
    };
  }
  return {
    ...state.runtime
  };
}

function writeSessionRuntime(next = {}) {
  state.runtime = {
    ...state.runtime,
    ...next,
    updatedAt: Date.now()
  };
  return {
    ...state.runtime
  };
}

function materializeAuthority() {
  if (!state.authority) {
    return { ok: false, statusCode: 404, code: 'authority_not_found', reason: 'not configured' };
  }
  return {
    ok: true,
    authority: {
      ...state.authority
    },
    runtime: {
      ...state.runtime
    }
  };
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = normalizeText(req.headers['x-trace-id'] || '') || createTraceId('req');
  next();
});

app.get('/api/v1/capabilities', requireRole('viewer'), (req, res) => {
  res.json({
    ok: true,
    traceId: req.traceId,
    items: state.services.map((service) => ({
      id: service.id,
      capabilityId: service.capabilityId,
      serviceId: service.id,
      name: service.name,
      description: 'Setup onboarding verifier capability',
      providerId: service.providerAgentId,
      providerAgentId: service.providerAgentId,
      action: service.action,
      active: true
    }))
  });
});

app.post('/api/services/:serviceId/invoke', requireRole('agent'), (req, res) => {
  res.json({
    ok: true,
    traceId: req.traceId,
    requestId: createTraceId('x402'),
    invocationId: createTraceId('svc'),
    serviceId: normalizeText(req.params.serviceId || ''),
    state: 'success',
    result: {
      summary: 'setup onboarding harness invoke ok'
    },
    receipt: {
      result: {
        summary: 'setup onboarding harness invoke ok'
      }
    }
  });
});

registerCoreIdentitySessionRoutes({
  app,
  deps: {
    ERC8004_AGENT_ID: '1',
    ERC8004_IDENTITY_REGISTRY: '0x2222222222222222222222222222222222222222',
    PORT: String(port),
    createTraceId,
    crypto,
    createOnboardingChallengeMessage: onboardingHelpers.createOnboardingChallengeMessage,
    ensureAAAccountDeployment: async () => null,
    buildAccountApiKeyPublicRecord: onboardingHelpers.buildAccountApiKeyPublicRecord,
    clearOnboardingAuthCookie: onboardingHelpers.clearOnboardingAuthCookie,
    findActiveClaudeConnectorGrant: connectorHelpers.findActiveGrantByOwner,
    findActiveAccountApiKey: onboardingHelpers.findActiveAccountApiKey,
    findPendingClaudeConnectorInstallCode: connectorHelpers.findPendingInstallCodeByOwner,
    generateAccountApiKey: onboardingHelpers.generateAccountApiKey,
    issueClaudeConnectorInstallCode: connectorHelpers.issueInstallCode,
    issueOnboardingAuthChallenge: onboardingHelpers.issueOnboardingAuthChallenge,
    maskSecret: (value = '') => (normalizeText(value) ? '***' : ''),
    readRecords: () => [],
    readSessionRuntime: () => ({ ...state.runtime }),
    requireRole,
    revokeClaudeConnectorGrant: connectorHelpers.revokeGrant,
    revokeAccountApiKey: onboardingHelpers.revokeAccountApiKey,
    sessionPayConfigSnapshot: () => ({}),
    sessionPayMetrics: {
      startedAt: Date.now(),
      totalRequests: 0,
      totalSuccess: 0,
      totalFailed: 0,
      totalRetryAttempts: 0,
      totalRetryDelayMs: 0,
      totalRetriesUsed: 0,
      totalFallbackAttempted: 0,
      totalFallbackSucceeded: 0,
      failuresByCategory: {},
      retriesByCategory: {},
      retryDelayMsByCategory: {},
      recentFailures: []
    },
    sessionRuntimePath: 'memory://session-runtime',
    materializeAuthority,
    revokeConsumerAuthorityPolicy: () => ({ ok: false, statusCode: 404, code: 'authority_not_found', reason: 'not configured' }),
    resolveSessionRuntime,
    validateConsumerAuthority: () => ({ ok: false, statusCode: 404, code: 'authority_not_found', reason: 'not configured' }),
    verifyOnboardingAuthChallenge: onboardingHelpers.verifyOnboardingAuthChallenge,
    writeConsumerAuthorityPolicy: () => ({ ok: false, statusCode: 404, code: 'authority_not_found', reason: 'not configured' }),
    writeOnboardingAuthCookie: onboardingHelpers.writeOnboardingAuthCookie,
    writeJsonObject: () => null,
    writeRecords: () => null,
    writeSessionRuntime
  },
  helpers: {
    appendSessionApprovalRequest: () => null,
    buildApprovalRequestToken: () => 'approval-token',
    buildSessionApprovalRequestPayload: () => ({}),
    buildSessionRuntimePayload,
    ensureBackendSessionRuntime: async ({ owner = '' } = {}) => {
      const normalizedOwner = normalizeAddress(owner || '');
      const runtime = writeSessionRuntime({
        owner: normalizedOwner,
        aaWallet: normalizeAddress('0x3333333333333333333333333333333333333333'),
        sessionAddress: normalizeAddress(sessionWallet.address),
        sessionPrivateKey: sessionWallet.privateKey,
        sessionId: `0x${'a'.repeat(64)}`,
        sessionTxHash: `0x${'b'.repeat(64)}`,
        maxPerTx: 0.01,
        dailyLimit: 0.1,
        gatewayRecipient: normalizeAddress('0x5555555555555555555555555555555555555555'),
        tokenAddress: normalizeAddress('0x4444444444444444444444444444444444444444'),
        source: 'setup-harness'
      });
      return {
        created: true,
        reused: false,
        tokenAddress: runtime.tokenAddress,
        runtime
      };
    },
    finalizeSessionAuthorization: async ({ body = {}, traceId = '' } = {}) => {
      const payload = body.payload || {};
      const userEoa = normalizeAddress(body.userEoa || '');
      const runtime = writeSessionRuntime({
        owner: userEoa,
        aaWallet: normalizeAddress(payload.payerAaWallet || state.runtime.aaWallet || ''),
        sessionAddress: state.runtime.sessionAddress || normalizeAddress(sessionWallet.address),
        sessionPrivateKey: state.runtime.sessionPrivateKey || sessionWallet.privateKey,
        sessionId: state.runtime.sessionId || `0x${'a'.repeat(64)}`,
        sessionTxHash: state.runtime.sessionTxHash || `0x${'b'.repeat(64)}`,
        maxPerTx: Number(payload.singleLimit || 0),
        dailyLimit: Number(payload.dailyLimit || 0),
        gatewayRecipient: normalizeAddress(payload.gatewayRecipient || state.runtime.gatewayRecipient || ''),
        tokenAddress: normalizeAddress(payload.tokenAddress || state.runtime.tokenAddress || ''),
        authorizedBy: userEoa,
        authorizedAt: Date.now(),
        authorizationMode: 'backend_managed_session',
        authorizationSignature: normalizeText(body.userSignature || ''),
        authorizationPayload: payload,
        authorizationPayloadHash: `0x${'c'.repeat(64)}`,
        authorizationNonce: normalizeText(payload.nonce || ''),
        authorizationExpiresAt: Number(payload.expiresAt || 0),
        authorizedAgentId: normalizeText(payload.agentId || ''),
        authorizedAgentWallet: normalizeAddress(payload.agentWallet || ''),
        authorizationAudience: normalizeText(payload.audience || ''),
        allowedCapabilities: Array.isArray(payload.allowedCapabilities) ? payload.allowedCapabilities : []
      });
      state.authority = {
        authorityId: 'setup-harness-authority',
        status: 'active',
        owner: userEoa,
        aaWallet: runtime.aaWallet,
        sessionId: runtime.sessionId,
        allowedCapabilities: Array.isArray(payload.allowedCapabilities) ? payload.allowedCapabilities : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        revokedAt: 0
      };
      return {
        ensured: {
          created: false,
          reused: true
        },
        executionMode: 'managed',
        authorizationId: createTraceId('auth'),
        authorizationMode: 'backend_managed_session',
        authorizedAt: runtime.authorizedAt,
        authorizationPayloadHash: runtime.authorizationPayloadHash,
        userEoa,
        payload,
        nextRuntime: runtime,
        authorizationRecord: {
          traceId,
          userEoa
        }
      };
    },
    getBackendSignerState: () => ({ enabled: false, address: '' }),
    listSessionApprovalRequests: () => [],
    normalizeSessionGrantAddress: normalizeAddress,
    normalizeSessionGrantPayload: (payload = {}, fallback = {}) => ({
      ...fallback,
      ...payload
    }),
    normalizeSessionGrantText: normalizeText,
    prepareSelfServeSessionRuntime: async ({ owner = '', singleLimit = '0.01', dailyLimit = '0.10', tokenAddress = '', gatewayRecipient = '' } = {}) => {
      const normalizedOwner = normalizeAddress(owner || '');
      const aaWallet = normalizeAddress('0x3333333333333333333333333333333333333333');
      return {
        owner: normalizedOwner,
        aaWallet,
        deployed: true,
        lifecycleStage: 'session_ready',
        salt: '0',
        accountFactoryAddress: normalizeAddress('0x6666666666666666666666666666666666666666'),
        entryPointAddress: normalizeAddress('0x7777777777777777777777777777777777777777'),
        tokenAddress: normalizeAddress(tokenAddress || '0x4444444444444444444444444444444444444444'),
        gatewayRecipient: normalizeAddress(gatewayRecipient || '0x5555555555555555555555555555555555555555'),
        singleLimit: normalizeText(singleLimit || '0.01'),
        dailyLimit: normalizeText(dailyLimit || '0.10'),
        currentBlockTimestamp: Math.floor(Date.now() / 1000),
        sessionRules: [
          {
            timeWindow: '0',
            budget: String(ethers.parseUnits(normalizeText(singleLimit || '0.01'), 18)),
            initialWindowStartTime: 0,
            targetProviders: []
          },
          {
            timeWindow: '86400',
            budget: String(ethers.parseUnits(normalizeText(dailyLimit || '0.10'), 18)),
            initialWindowStartTime: Math.floor(Date.now() / 1000),
            targetProviders: []
          }
        ],
        runtime: buildSessionRuntimePayload({
          owner: normalizedOwner,
          aaWallet,
          maxPerTx: Number(singleLimit || 0.01),
          dailyLimit: Number(dailyLimit || 0.1),
          gatewayRecipient: normalizeAddress(gatewayRecipient || '0x5555555555555555555555555555555555555555'),
          tokenAddress: normalizeAddress(tokenAddress || '0x4444444444444444444444444444444444444444'),
          source: 'self_serve_wallet_prepare',
          runtimePurpose: 'consumer',
          aaDeployed: true
        })
      };
    },
    finalizeSelfServeSessionRuntime: async ({ owner = '', runtime = {}, singleLimit = '0.01', dailyLimit = '0.10', tokenAddress = '', gatewayRecipient = '' } = {}) => {
      const prepared = await Promise.resolve({
        owner: normalizeAddress(owner || ''),
        aaWallet: normalizeAddress(runtime.aaWallet || '0x3333333333333333333333333333333333333333'),
        deployed: true,
        lifecycleStage: 'session_ready',
        salt: '0',
        accountFactoryAddress: normalizeAddress('0x6666666666666666666666666666666666666666'),
        entryPointAddress: normalizeAddress('0x7777777777777777777777777777777777777777'),
        tokenAddress: normalizeAddress(tokenAddress || '0x4444444444444444444444444444444444444444'),
        gatewayRecipient: normalizeAddress(gatewayRecipient || '0x5555555555555555555555555555555555555555'),
        singleLimit: normalizeText(singleLimit || '0.01'),
        dailyLimit: normalizeText(dailyLimit || '0.10'),
        currentBlockTimestamp: Math.floor(Date.now() / 1000),
        sessionRules: []
      });
      const nextRuntime = writeSessionRuntime({
        owner: prepared.owner,
        aaWallet: prepared.aaWallet,
        sessionAddress: normalizeAddress(runtime.sessionAddress || sessionWallet.address),
        sessionPrivateKey: normalizeText(runtime.sessionPrivateKey || sessionWallet.privateKey),
        sessionId: normalizeText(runtime.sessionId || `0x${'a'.repeat(64)}`),
        sessionTxHash: normalizeText(runtime.sessionTxHash || `0x${'b'.repeat(64)}`),
        maxPerTx: Number(singleLimit || 0.01),
        dailyLimit: Number(dailyLimit || 0.1),
        gatewayRecipient: prepared.gatewayRecipient,
        tokenAddress: prepared.tokenAddress,
        source: 'self_serve_wallet',
        runtimePurpose: 'consumer',
        aaDeployed: true
      });
      return {
        prepared,
        runtime: nextRuntime
      };
    }
  }
});

registerMcpRoutes(app, {
  PACKAGE_VERSION: '1.0.0',
  PORT: String(port),
  authConfigured,
  extractApiKey,
  resolveClaudeConnectorToken: connectorHelpers.resolveConnectorToken,
  resolveAuthRequest,
  resolveRoleByApiKey,
  claimClaudeConnectorInstallCode: connectorHelpers.claimInstallCode,
  touchClaudeConnectorGrantUsage: connectorHelpers.touchGrantUsage,
  getInternalAgentApiKey: () => 'setup-agent-key'
});

const server = await new Promise((resolve) => {
  const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
});

try {
  const challengeResponse = await fetch(`${host}/api/onboarding/auth/challenge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      ownerEoa: ownerWallet.address,
      chainId: 'kite-testnet'
    })
  });
  const challengePayload = await parseJson(challengeResponse);
  assert(challengeResponse.ok, 'onboarding challenge request failed');
  const challenge = challengePayload?.challenge || {};
  const loginSignature = await ownerWallet.signMessage(challenge.message);

  const verifyResponse = await fetch(`${host}/api/onboarding/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      ownerEoa: ownerWallet.address,
      chainId: 'kite-testnet',
      signature: loginSignature
    })
  });
  const verifyPayload = await parseJson(verifyResponse);
  const onboardingCookie = extractCookie(verifyResponse.headers.get('set-cookie') || '');
  assert(verifyResponse.ok, 'onboarding verify failed');
  assert(onboardingCookie.startsWith('ktrace_onboard='), 'onboarding cookie was not set');
  assert(
    normalizeAddress(verifyPayload?.auth?.ownerEoa || '') === normalizeAddress(ownerWallet.address),
    'verified ownerEoa mismatch'
  );

  const mismatchEnsure = await fetch(`${host}/api/session/runtime/ensure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      ownerEoa: ethers.Wallet.createRandom().address
    })
  });
  assert(mismatchEnsure.status === 403, 'setup owner mismatch did not return 403');

  const ensureResponse = await fetch(`${host}/api/session/runtime/ensure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      ownerEoa: ownerWallet.address
    })
  });
  const ensurePayload = await parseJson(ensureResponse);
  assert(ensureResponse.status === 409, 'legacy session runtime ensure should be blocked for onboarding-cookie callers');
  assert(
    normalizeText(ensurePayload?.error || '') === 'self_serve_runtime_prepare_required',
    'legacy session runtime ensure did not return the expected self-serve error'
  );

  const prepareResponse = await fetch(`${host}/api/setup/runtime/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      ownerEoa: ownerWallet.address,
      singleLimit: '0.01',
      dailyLimit: '0.10',
      tokenAddress: '0x4444444444444444444444444444444444444444',
      gatewayRecipient: '0x5555555555555555555555555555555555555555'
    })
  });
  const preparePayload = await parseJson(prepareResponse);
  assert(prepareResponse.ok, 'runtime prepare failed with onboarding cookie');
  assert(
    normalizeAddress(preparePayload?.bootstrap?.owner || '') === normalizeAddress(ownerWallet.address),
    'runtime prepare did not scope owner from onboarding cookie'
  );

  const finalizeResponse = await fetch(`${host}/api/setup/runtime/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      ownerEoa: ownerWallet.address,
      singleLimit: '0.01',
      dailyLimit: '0.10',
      tokenAddress: '0x4444444444444444444444444444444444444444',
      gatewayRecipient: '0x5555555555555555555555555555555555555555',
      runtime: {
        owner: ownerWallet.address,
        aaWallet: preparePayload?.bootstrap?.aaWallet || '0x3333333333333333333333333333333333333333',
        sessionAddress: sessionWallet.address,
        sessionPrivateKey: sessionWallet.privateKey,
        sessionId: `0x${'a'.repeat(64)}`,
        sessionTxHash: `0x${'b'.repeat(64)}`,
        source: 'self_serve_wallet',
        runtimePurpose: 'consumer'
      }
    })
  });
  const finalizePayload = await parseJson(finalizeResponse);
  assert(finalizeResponse.ok, 'runtime finalize failed with onboarding cookie');
  assert(
    normalizeAddress(finalizePayload?.runtime?.owner || '') === normalizeAddress(ownerWallet.address),
    'runtime finalize did not persist the onboarding owner'
  );

  const payload = {
    agentId: '1',
    agentWallet: '0x1111111111111111111111111111111111111111',
    identityRegistry: '0x2222222222222222222222222222222222222222',
    chainId: 'kite-testnet',
    payerAaWallet: finalizePayload?.runtime?.aaWallet || '0x3333333333333333333333333333333333333333',
    tokenAddress: '0x4444444444444444444444444444444444444444',
    gatewayRecipient: '0x5555555555555555555555555555555555555555',
    singleLimit: '0.01',
    dailyLimit: '0.10',
    allowedCapabilities: ['svc-price'],
    audience: host,
    nonce: `0x${crypto.randomBytes(16).toString('hex')}`,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };
  const sessionSignature = await ownerWallet.signMessage(buildSessionGrantMessage(payload));
  const authorizeResponse = await fetch(`${host}/api/v1/session/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      executionMode: 'external',
      ownerEoa: ownerWallet.address,
      payload,
      userSignature: sessionSignature,
      runtime: {
        owner: ownerWallet.address,
        aaWallet: finalizePayload?.runtime?.aaWallet || '0x3333333333333333333333333333333333333333',
        sessionAddress: finalizePayload?.runtime?.sessionAddress || sessionWallet.address,
        sessionId: finalizePayload?.runtime?.sessionId || `0x${'a'.repeat(64)}`,
        sessionTxHash: finalizePayload?.runtime?.sessionTxHash || `0x${'b'.repeat(64)}`,
        source: 'self_serve_wallet',
        runtimePurpose: 'consumer'
      }
    })
  });
  const authorizePayload = await parseJson(authorizeResponse);
  assert(authorizeResponse.ok, 'session authorize failed with onboarding cookie');
  assert(
    normalizeAddress(authorizePayload?.authorizedBy || authorizePayload?.authorization?.authorizedBy || '') ===
      normalizeAddress(ownerWallet.address),
    'session authorize did not bind authorizedBy to onboarding owner'
  );

  const connectorBootstrapResponse = await fetch(`${host}/api/connector/agent/bootstrap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      client: 'claude',
      clientId: 'setup-harness'
    })
  });
  const connectorBootstrapPayload = await parseJson(connectorBootstrapResponse);
  assert(connectorBootstrapResponse.ok, 'session-first connector bootstrap failed');
  const connectorUrl = normalizeText(connectorBootstrapPayload?.connector?.connectorUrl || '');
  const connectorToken = decodeURIComponent(connectorUrl.split('/mcp/connect/')[1] || '');
  assert(connectorToken.startsWith('ktrace_cc_'), 'connector bootstrap did not issue a connector token');

  const connectorStatusResponse = await fetch(`${host}/api/connector/agent/status?client=claude&clientId=setup-harness`, {
    headers: {
      Accept: 'application/json',
      Cookie: onboardingCookie
    }
  });
  const connectorStatusPayload = await parseJson(connectorStatusResponse);
  assert(connectorStatusResponse.ok, 'connector status lookup failed');
  assert(
    normalizeText(connectorStatusPayload?.connector?.state || '') === 'install_code_issued',
    'connector status mismatch after bootstrap'
  );

  const toolsListResponse = await fetch(`${host}/mcp/connect/${encodeURIComponent(connectorToken)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tools-list',
      method: 'tools/list',
      params: {}
    })
  });
  const toolsListText = await toolsListResponse.text();
  assert(toolsListResponse.ok, 'connector token could not reach MCP tools/list');
  assert(
    toolsListText.includes('ktrace__svc_price'),
    'MCP tools/list did not expose setup harness capability'
  );

  const revokeResponse = await fetch(`${host}/api/connector/agent/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: onboardingCookie
    },
    body: JSON.stringify({
      client: 'claude',
      clientId: 'setup-harness'
    })
  });
  assert(revokeResponse.ok, 'connector revoke failed');

  const revokedMcpResponse = await fetch(`${host}/mcp/connect/${encodeURIComponent(connectorToken)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'revoked-tools-list',
      method: 'tools/list',
      params: {}
    })
  });
  const revokedMcpPayload = await parseJson(revokedMcpResponse);
  assert(revokedMcpResponse.status === 401, 'revoked connector token did not return 401');
  assert(
    normalizeText(revokedMcpPayload?.error?.message || '') === 'Missing or invalid connector token.',
    'revoked connector token failure shape changed'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          ownerEoa: ownerWallet.address,
          aaWallet:
            finalizePayload?.runtime?.aaWallet ||
            preparePayload?.bootstrap?.aaWallet ||
            connectorBootstrapPayload?.connector?.aaWallet ||
            '',
          connectorInstallCodeId: connectorBootstrapPayload?.connector?.installCodeId || '',
          mcpTool: 'ktrace__svc_price'
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
