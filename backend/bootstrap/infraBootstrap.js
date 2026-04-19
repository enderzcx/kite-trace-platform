import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ethers } from 'ethers';
import {
  hydrateMessageProviderTokenFromLocalDocs,
  normalizeBackoffPolicy,
  parseEnvAgentFallbackModelMap,
  parseEnvAgentModelMap,
  parseEnvCsvList,
  toBoundedIntEnv
} from '../lib/env.js';
import { createAuthHelpers } from '../lib/auth.js';
import {
  createJsonPersistenceHelpers,
  loadJsonArrayFromFile,
  loadJsonObjectFromFile,
  persistenceKeyForPath,
  writeJsonArrayToFile,
  writeJsonObjectToFile
} from '../lib/persistence.js';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';
import { createKiteRpcProvider } from '../lib/kiteRpc.js';
import { createSessionPayHelpers } from '../lib/sessionPay.js';
import { createEnsureAAAccountDeployment } from '../lib/aaAccount.js';
import { createOnboardingSetupHelpers } from '../lib/onboardingSetupHelpers.js';
import { createClaudeConnectorAuthHelpers } from '../lib/claudeConnectorAuth.js';
import {
  createPolicyConfigHelpers,
  deriveAddressFromPrivateKey,
  getServiceProviderBytes32,
  normalizeAddress,
  normalizeAddresses,
  normalizePrivateKey,
  normalizeRecipients
} from '../lib/addressPolicyHelpers.js';
import { createSessionRuntimeHelpers, maskSecret } from '../lib/sessionRuntimeHelpers.js';
import { createNetworkAuditHelpers } from '../lib/networkAuditHelpers.js';
import { createWorkflowHelpers } from '../lib/workflowHelpers.js';
import { createA2AHelpers } from '../lib/a2aHelpers.js';
import { createRecordMutationHelpers, isAgent001TaskSuccessful } from '../lib/appRecordHelpers.js';
import { createDataStoreAccessors } from '../lib/dataStoreAccessors.js';
import { createLlmAdapter } from '../services/llmAdapter.js';
import { createHyperliquidAdapter } from '../services/hyperliquidAdapter.js';
import { createPersistenceStore } from '../services/persistenceStore.js';
import { createRuntimeConfig } from '../runtime/config.js';
import {
  applyRuntimeServerMiddleware,
  createApiRateLimit
} from '../runtime/server.js';

export async function infraBootstrap(ctx) {
  // ── Pure utility functions (hoisted within this function scope) ──────────

  function createTraceId(prefix = 'trace') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  function getUtcDateKey(ms = Date.now()) {
    const d = new Date(Number(ms) || Date.now());
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate()
    ).padStart(2, '0')}`;
  }

  function waitMs(ms = 0) {
    const duration = Math.max(0, Number(ms) || 0);
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  // ── App + config ─────────────────────────────────────────────────────────

  hydrateMessageProviderTokenFromLocalDocs();

  const app = express();
  const runtimeConfig = createRuntimeConfig();
  const {
    PORT,
    PACKAGE_VERSION,
    STARTED_AT_MS,
    KITE_NETWORK_NAME,
    dataPath,
    x402Path,
    policyFailurePath,
    policyConfigPath,
    sessionRuntimePath,
    sessionRuntimeIndexPath,
    sessionAuthorizationsPath,
    sessionApprovalRequestsPath,
    onboardingChallengesPath,
    accountApiKeysPath,
    connectorInstallCodesPath,
    connectorGrantsPath,
    workflowPath,
    identityChallengePath,
    servicesPath,
    templatesPath,
    serviceInvocationsPath,
    purchasesPath,
    jobsPath,
    consumerIntentsPath,
    reputationSignalsPath,
    validationRecordsPath,
    trustPublicationsPath,
    networkAgentsPath,
    networkCommandsPath,
    networkAuditPath,
    agent001ResultsPath,
    SETTLEMENT_TOKEN,
    MERCHANT_ADDRESS,
    X402_UNIFIED_SERVICE_PRICE,
    X402_PRICE,
    KITE_AGENT2_AA_ADDRESS,
    X402_REACTIVE_PRICE,
    X402_BTC_PRICE,
    X402_RISK_SCORE_PRICE,
    X402_X_READER_PRICE,
    X402_TECHNICAL_PRICE,
    X402_INFO_PRICE,
    X402_HYPERLIQUID_ORDER_PRICE,
    HYPERLIQUID_ORDER_RECIPIENT,
    X402_TTL_MS,
    KITE_AGENT1_ID,
    KITE_AGENT2_ID,
    POLICY_MAX_PER_TX_DEFAULT,
    POLICY_DAILY_LIMIT_DEFAULT,
    POLICY_ALLOWED_RECIPIENTS_DEFAULT,
    BACKEND_SIGNER_PRIVATE_KEY,
    ERC8183_REQUESTER_PRIVATE_KEY,
    ERC8183_EXECUTOR_PRIVATE_KEY,
    ERC8183_VALIDATOR_PRIVATE_KEY,
    ENV_SESSION_PRIVATE_KEY,
    ENV_SESSION_ADDRESS,
    ENV_SESSION_ID,
    BACKEND_RPC_URL,
    BACKEND_BUNDLER_URL,
    BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS,
    KITE_AA_ACCOUNT_IMPLEMENTATION,
    KITE_MIN_NATIVE_GAS,
    AA_V2_VERSION_TAG,
    KITE_AA_JOB_LANE_REQUIRED_VERSION,
    KITE_REQUIRE_AA_V2,
    KITE_ALLOW_EOA_RELAY_FALLBACK,
    KITE_ALLOW_BACKEND_USEROP_SIGN,
    KITE_BUNDLER_RPC_TIMEOUT_MS,
    KITE_BUNDLER_RPC_RETRIES,
    KITE_BUNDLER_RPC_BACKOFF_BASE_MS,
    KITE_BUNDLER_RPC_BACKOFF_MAX_MS,
    KITE_BUNDLER_RPC_BACKOFF_FACTOR,
    KITE_BUNDLER_RPC_BACKOFF_JITTER_MS,
    KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS,
    KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS,
    KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS,
    KITE_SESSION_PAY_RETRIES,
    KITE_SESSION_PAY_TRANSPORT_BACKOFF_BASE_MS,
    KITE_SESSION_PAY_TRANSPORT_BACKOFF_MAX_MS,
    KITE_SESSION_PAY_TRANSPORT_BACKOFF_JITTER_MS,
    KITE_SESSION_PAY_TRANSPORT_BACKOFF_FACTOR,
    KITE_SESSION_PAY_REPLACEMENT_BACKOFF_BASE_MS,
    KITE_SESSION_PAY_REPLACEMENT_BACKOFF_MAX_MS,
    KITE_SESSION_PAY_REPLACEMENT_BACKOFF_JITTER_MS,
    KTRACE_JOB_APPROVAL_THRESHOLD,
    KTRACE_JOB_APPROVAL_TTL_MS,
    KTRACE_ADMIN_KEY,
    BACKEND_PUBLIC_URL,
    KTRACE_ALLOWED_ORIGINS,
    KTRACE_APPROVAL_RULES,
    ERC8183_DEFAULT_JOB_TIMEOUT_SEC,
    ERC8183_EXECUTOR_STAKE_DEFAULT,
    KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR,
    KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
    KITE_NETWORK_AUDIT_MAX_EVENTS,
    BUNDLER_RPC_BACKOFF_POLICY,
    SESSION_PAY_TRANSPORT_BACKOFF_POLICY,
    SESSION_PAY_REPLACEMENT_BACKOFF_POLICY,
    PROOF_RPC_TIMEOUT_MS,
    PROOF_RPC_RETRIES,
    PROOF_RECEIPT_WAIT_MS,
    PROOF_RECEIPT_POLL_INTERVAL_MS,
    LLM_BASE_URL,
    LLM_CHAT_PATH,
    LLM_HEALTH_PATH,
    LLM_API_KEY,
    LLM_TIMEOUT_MS,
    LLM_CHAT_PROTOCOL,
    LLM_MODEL,
    AGENT001_MODEL_PRIMARY,
    AGENT001_MODEL_FALLBACK,
    AGENT_WORKER_MODEL,
    LLM_AGENT_MODELS,
    LLM_AGENT_FALLBACK_MODELS,
    LLM_MODEL_FALLBACKS,
    LLM_SYSTEM_PROMPT,
    HYPERLIQUID_TESTNET_ENABLED,
    HYPERLIQUID_TESTNET_PRIVATE_KEY,
    HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS,
    HYPERLIQUID_TESTNET_API_URL,
    HYPERLIQUID_TESTNET_TIMEOUT_MS,
    HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS,
    ANALYSIS_PROVIDER,
    OPENNEWS_API_BASE,
    OPENNEWS_TOKEN,
    OPENNEWS_TIMEOUT_MS,
    OPENNEWS_RETRY,
    OPENNEWS_MAX_ROWS,
    OPENTWITTER_API_BASE,
    OPENTWITTER_TOKEN,
    OPENTWITTER_TIMEOUT_MS,
    OPENTWITTER_RETRY,
    OPENTWITTER_MAX_ROWS,
    MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
    MESSAGE_PROVIDER_DISABLE_CLAWFEED,
    MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    ERC8004_IDENTITY_REGISTRY,
    ERC8004_AGENT_ID_RAW,
    ERC8004_AGENT_ID,
    ERC8004_TRUST_ANCHOR_REGISTRY,
    ERC8183_JOB_ANCHOR_REGISTRY,
    ERC8183_ESCROW_ADDRESS,
    ERC8183_TRACE_ANCHOR_GUARD,
    ERC8183_REQUESTER_AA_ADDRESS,
    ERC8183_EXECUTOR_AA_ADDRESS,
    ERC8183_VALIDATOR_AA_ADDRESS,
    API_KEY_ADMIN,
    API_KEY_AGENT,
    API_KEY_VIEWER,
    AUTH_DISABLED,
    KTRACE_ONBOARDING_COOKIE_NAME,
    KTRACE_ONBOARDING_COOKIE_SECRET,
    KTRACE_ONBOARDING_COOKIE_TTL_MS,
    KTRACE_ONBOARDING_CHALLENGE_TTL_MS,
    KTRACE_ONBOARDING_CHALLENGE_MAX_ROWS,
    KTRACE_CONNECTOR_INSTALL_CODE_TTL_MS,
    KTRACE_CONNECTOR_INSTALL_CODE_MAX_ROWS,
    KTRACE_CONNECTOR_GRANT_MAX_ROWS,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    IDENTITY_CHALLENGE_TTL_MS,
    IDENTITY_CHALLENGE_MAX_ROWS,
    IDENTITY_VERIFY_MODE,
    AUTO_TRADE_PLAN_ENABLED,
    AUTO_TRADE_PLAN_INTERVAL_MS,
    AUTO_TRADE_PLAN_SYMBOL,
    AUTO_TRADE_PLAN_HORIZON_MIN,
    AUTO_TRADE_PLAN_PROMPT,
    KTRACE_AUTO_JOB_EXPIRY_ENABLED,
    KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    X_READER_MAX_CHARS_DEFAULT,
    AGENT001_REQUIRE_X402,
    AGENT001_PREBIND_ONLY,
    AGENT001_BIND_TIMEOUT_MS,
    ROLE_RANK,
    ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED,
    ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED,
    ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED,
    ERC8183_REQUESTER_OWNER_ADDRESS,
    ERC8183_EXECUTOR_OWNER_ADDRESS,
    ERC8183_VALIDATOR_OWNER_ADDRESS
  } = runtimeConfig;

  const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
  const IS_PRODUCTION = NODE_ENV === 'production';
  if (IS_PRODUCTION) {
    if (AUTH_DISABLED) {
      throw new Error(
        'Production startup blocked: KITECLAW_AUTH_DISABLED must be 0.'
      );
    }
    const effectiveAllowedOrigins = Array.from(
      new Set(
        [
          ...((Array.isArray(KTRACE_ALLOWED_ORIGINS) ? KTRACE_ALLOWED_ORIGINS : []).map((item) =>
            String(item || '').trim()
          )),
          (() => {
            try {
              return BACKEND_PUBLIC_URL ? new URL(BACKEND_PUBLIC_URL).origin : '';
            } catch {
              return '';
            }
          })()
        ].filter(Boolean)
      )
    );
    if (!effectiveAllowedOrigins.length) {
      throw new Error(
        'Production startup blocked: configure KTRACE_ALLOWED_ORIGINS or BACKEND_PUBLIC_URL.'
      );
    }
  }

  // ── Auth (with forward references to onboarding/connector helpers) ────────

  let onboardingSetupHelpers = null;
  let claudeConnectorAuthHelpers = null;
  const { authConfigured, extractApiKey, resolveRoleByApiKey, resolveAuthRequest, requireRole } = createAuthHelpers({
    AUTH_DISABLED,
    API_KEY_ADMIN,
    API_KEY_AGENT,
    API_KEY_VIEWER,
    ROLE_RANK,
    ONBOARDING_COOKIE_NAME: KTRACE_ONBOARDING_COOKIE_NAME,
    hasDynamicAuthSource: () =>
      Boolean(
        KTRACE_ONBOARDING_COOKIE_SECRET ||
          (typeof readAccountApiKeys === 'function' && readAccountApiKeys().length > 0)
      ),
    resolveAccountApiKey: (key) => onboardingSetupHelpers?.resolveAccountApiKey?.(key) || null,
    resolveOnboardingCookie: (token) => onboardingSetupHelpers?.resolveOnboardingCookie?.(token) || null,
    touchAccountApiKeyUsage: (record) => onboardingSetupHelpers?.touchAccountApiKeyUsage?.(record) || null
  });

  // ── LLM + exchange adapters ───────────────────────────────────────────────

  const LLM_AGENT_MODEL_MAP = { ...LLM_AGENT_MODELS };
  const LLM_AGENT_FALLBACK_MODEL_MAP = { ...LLM_AGENT_FALLBACK_MODELS };
  if (AGENT001_MODEL_PRIMARY) {
    LLM_AGENT_MODEL_MAP['router-agent'] = AGENT001_MODEL_PRIMARY;
    LLM_AGENT_MODEL_MAP['agent001_intent'] = AGENT001_MODEL_PRIMARY;
    LLM_AGENT_MODEL_MAP['agent001_chat'] = AGENT001_MODEL_PRIMARY;
    LLM_AGENT_MODEL_MAP['agent001_polish'] = AGENT001_MODEL_PRIMARY;
  }
  if (AGENT_WORKER_MODEL) {
    LLM_AGENT_MODEL_MAP['reader-agent'] = AGENT_WORKER_MODEL;
    LLM_AGENT_MODEL_MAP['message-agent'] = AGENT_WORKER_MODEL;
    LLM_AGENT_MODEL_MAP['risk-agent'] = AGENT_WORKER_MODEL;
    LLM_AGENT_MODEL_MAP['technical-agent'] = AGENT_WORKER_MODEL;
    LLM_AGENT_MODEL_MAP['price-agent'] = AGENT_WORKER_MODEL;
    LLM_AGENT_MODEL_MAP['executor-agent'] = AGENT_WORKER_MODEL;
  }
  if (AGENT001_MODEL_FALLBACK) {
    const existing = Array.isArray(LLM_AGENT_FALLBACK_MODEL_MAP['router-agent'])
      ? LLM_AGENT_FALLBACK_MODEL_MAP['router-agent']
      : [];
    LLM_AGENT_FALLBACK_MODEL_MAP['router-agent'] = [...existing, AGENT001_MODEL_FALLBACK]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item, idx, arr) => arr.indexOf(item) === idx);
  }

  const llmAdapter = createLlmAdapter({
    baseUrl: LLM_BASE_URL,
    chatPath: LLM_CHAT_PATH,
    healthPath: LLM_HEALTH_PATH,
    apiKey: LLM_API_KEY,
    timeoutMs: LLM_TIMEOUT_MS,
    protocol: LLM_CHAT_PROTOCOL,
    model: LLM_MODEL,
    modelFallbacks: LLM_MODEL_FALLBACKS,
    agentModels: LLM_AGENT_MODEL_MAP,
    agentFallbackModels: LLM_AGENT_FALLBACK_MODEL_MAP,
    systemPrompt: LLM_SYSTEM_PROMPT
  });

  const hyperliquidAdapter = createHyperliquidAdapter({
    enabled: HYPERLIQUID_TESTNET_ENABLED,
    isTestnet: true,
    privateKey: HYPERLIQUID_TESTNET_PRIVATE_KEY,
    accountAddress: HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS,
    apiUrl: HYPERLIQUID_TESTNET_API_URL,
    timeoutMs: HYPERLIQUID_TESTNET_TIMEOUT_MS,
    defaultMarketSlippageBps: HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS
  });

  // ── Persistence layer ─────────────────────────────────────────────────────

  const persistenceStore = createPersistenceStore({
    mode: process.env.KITE_PERSISTENCE_MODE || '',
    databaseUrl: process.env.DATABASE_URL || ''
  });

  const PERSIST_ARRAY_PATHS = [
    dataPath, x402Path, policyFailurePath, onboardingChallengesPath, accountApiKeysPath,
    connectorInstallCodesPath, connectorGrantsPath, workflowPath, identityChallengePath,
    servicesPath, templatesPath, serviceInvocationsPath, purchasesPath, jobsPath,
    consumerIntentsPath, reputationSignalsPath, validationRecordsPath, trustPublicationsPath,
    networkAgentsPath, sessionAuthorizationsPath, sessionApprovalRequestsPath,
    networkCommandsPath, networkAuditPath, agent001ResultsPath
  ];
  const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath, sessionRuntimeIndexPath];
  const persistArrayCache = new Map();
  const persistObjectCache = new Map();
  const { readJsonArray, writeJsonArray, readJsonObject, writeJsonObject, queuePersistWrite } =
    createJsonPersistenceHelpers({
      persistenceStore,
      persistArrayCache,
      persistObjectCache,
      onPersistWriteError: (message) => console.error(message)
    });
  let persistenceInitDone = false;

  const autoTradePlanState = {
    enabled: false,
    intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
    symbol: AUTO_TRADE_PLAN_SYMBOL,
    horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
    prompt: AUTO_TRADE_PLAN_PROMPT,
    startedAt: '',
    lastTickAt: '',
    lastStatus: '',
    lastDecision: '',
    lastSummary: '',
    lastRequestId: '',
    lastTxHash: '',
    lastError: '',
    runs: 0,
    orderRuns: 0,
    noOrderRuns: 0,
    failedRuns: 0
  };

  const autoJobExpiryState = {
    enabled: false,
    intervalMs: KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    startedAt: '',
    lastTickAt: '',
    lastStatus: '',
    lastError: '',
    lastExpiredJobId: '',
    lastExpiredTraceId: '',
    scannedCount: 0,
    expiredCount: 0,
    failedCount: 0
  };

  // ── Data store accessors ─────────────────────────────────────────────────

  const {
    readRecords, writeRecords,
    readX402Requests, writeX402Requests,
    readPolicyFailures, writePolicyFailures,
    readWorkflows, writeWorkflows,
    readIdentityChallenges, writeIdentityChallenges,
    readOnboardingChallenges, writeOnboardingChallenges,
    readAccountApiKeys, writeAccountApiKeys,
    readConnectorInstallCodes, writeConnectorInstallCodes,
    readConnectorGrants, writeConnectorGrants,
    readPublishedServices, writePublishedServices,
    readTemplates, writeTemplates,
    readServiceInvocations, writeServiceInvocations,
    readPurchases, writePurchases,
    readJobs, writeJobs,
    readConsumerIntents, writeConsumerIntents,
    readReputationSignals, writeReputationSignals,
    readValidationRecords, writeValidationRecords,
    readTrustPublications, writeTrustPublications,
    readNetworkAgents, writeNetworkAgents,
    readNetworkCommands, writeNetworkCommands,
    readNetworkAuditEvents, writeNetworkAuditEvents,
    readAgent001Results, writeAgent001Results
  } = createDataStoreAccessors({
    paths: {
      dataPath, x402Path, policyFailurePath, workflowPath, identityChallengePath,
      onboardingChallengesPath, accountApiKeysPath, connectorInstallCodesPath,
      connectorGrantsPath, servicesPath, templatesPath, serviceInvocationsPath,
      purchasesPath, jobsPath, consumerIntentsPath, reputationSignalsPath,
      validationRecordsPath, trustPublicationsPath, networkAgentsPath,
      networkCommandsPath, networkAuditPath, agent001ResultsPath
    },
    readJsonArray, writeJsonArray, loadJsonArrayFromFile, persistenceKeyForPath,
    persistArrayCache, queuePersistWrite, writeJsonArrayToFile
  });

  // ── Onboarding + connector auth (resolves forward references) ────────────

  onboardingSetupHelpers = createOnboardingSetupHelpers({
    ONBOARDING_COOKIE_NAME: KTRACE_ONBOARDING_COOKIE_NAME,
    ONBOARDING_COOKIE_SECRET: KTRACE_ONBOARDING_COOKIE_SECRET,
    ONBOARDING_COOKIE_TTL_MS: KTRACE_ONBOARDING_COOKIE_TTL_MS,
    ONBOARDING_CHALLENGE_TTL_MS: KTRACE_ONBOARDING_CHALLENGE_TTL_MS,
    ONBOARDING_CHALLENGE_MAX_ROWS: KTRACE_ONBOARDING_CHALLENGE_MAX_ROWS,
    NODE_ENV: process.env.NODE_ENV || '',
    createTraceId,
    normalizeAddress,
    readOnboardingChallenges,
    writeOnboardingChallenges,
    readAccountApiKeys,
    writeAccountApiKeys
  });

  claudeConnectorAuthHelpers = createClaudeConnectorAuthHelpers({
    CONNECTOR_INSTALL_CODE_TTL_MS: KTRACE_CONNECTOR_INSTALL_CODE_TTL_MS,
    CONNECTOR_INSTALL_CODE_MAX_ROWS: KTRACE_CONNECTOR_INSTALL_CODE_MAX_ROWS,
    CONNECTOR_GRANT_MAX_ROWS: KTRACE_CONNECTOR_GRANT_MAX_ROWS,
    DEFAULT_CONNECTOR_IDENTITY_REGISTRY: ERC8004_IDENTITY_REGISTRY,
    createTraceId,
    normalizeAddress,
    readConnectorInstallCodes,
    writeConnectorInstallCodes,
    readConnectorGrants,
    writeConnectorGrants
  });

  // ── Session runtime + audit helpers ──────────────────────────────────────

  const {
    sanitizeSessionRuntime, readSessionRuntime, readSessionRuntimeByOwner,
    readSessionRuntimeIndex, writeSessionRuntimeIndex, listSessionRuntimes,
    resolveSessionRuntime, writeSessionRuntime,
    sanitizeSessionAuthorizationRecord, readSessionAuthorizations, writeSessionAuthorizations
  } = createSessionRuntimeHelpers({
    normalizeAddress, readJsonObject, writeJsonObject, readJsonArray, writeJsonArray,
    sessionRuntimePath, sessionRuntimeIndexPath, sessionAuthorizationsPath,
    envSessionPrivateKey: ENV_SESSION_PRIVATE_KEY,
    envSessionAddress: ENV_SESSION_ADDRESS,
    envSessionId: ENV_SESSION_ID
  });

  const readSessionApprovalRequests = () => readJsonArray(sessionApprovalRequestsPath);
  const writeSessionApprovalRequests = (rows = []) => writeJsonArray(sessionApprovalRequestsPath, rows);

  const {
    toAuditText, sanitizeAuditRefs, sanitizeAuditQuote, sanitizeAuditSla,
    sanitizeAuditRationale, sanitizeAuditStepDetails, sanitizeAuditSummary,
    resolveAuditQuoteFromPaymentIntent, appendNetworkAuditEvent,
    listNetworkAuditEventsByTraceId, appendWorkflowStep
  } = createNetworkAuditHelpers({
    normalizeAddress, readX402Requests, readNetworkAuditEvents, writeNetworkAuditEvents,
    kiteNetworkAuditMaxEvents: KITE_NETWORK_AUDIT_MAX_EVENTS
  });

  const { buildWorkflowFallbackAuditEvents, deriveNegotiationTermsFromAuditEvents } =
    createWorkflowHelpers({ toAuditText, sanitizeAuditSummary, sanitizeAuditQuote, sanitizeAuditSla, sanitizeAuditRationale });

  const { buildNetworkRunSummaries } = createA2AHelpers({ toAuditText, readWorkflows, readNetworkAuditEvents });

  const {
    upsertServiceInvocation, upsertJobRecord, upsertPurchaseRecord,
    appendReputationSignal, appendValidationRecord, appendTrustPublication
  } = createRecordMutationHelpers({
    readJobs, readPurchases, readReputationSignals, readServiceInvocations,
    readTrustPublications, readValidationRecords,
    writeJobs, writePurchases, writeReputationSignals, writeServiceInvocations,
    writeTrustPublications, writeValidationRecords
  });

  // ── Crypto / AA account setup ─────────────────────────────────────────────

  const sessionOwnerPrivateKeyByAddress = (() => {
    const pairs = new Map();
    for (const [name, value] of Object.entries(process.env)) {
      if (!/(PRIVATE_KEY|WALLET_KEY)$/i.test(String(name || '').trim())) continue;
      const normalized = normalizePrivateKey(value || '');
      const derivedAddress = deriveAddressFromPrivateKey(normalized);
      if (!normalized || !derivedAddress) continue;
      pairs.set(normalizeAddress(derivedAddress), normalized);
    }
    for (const normalized of [
      normalizePrivateKey(BACKEND_SIGNER_PRIVATE_KEY),
      ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED,
      ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED,
      ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED
    ]) {
      const derivedAddress = deriveAddressFromPrivateKey(normalized);
      if (!normalized || !derivedAddress) continue;
      pairs.set(normalizeAddress(derivedAddress), normalized);
    }
    return pairs;
  })();

  function resolveSessionOwnerPrivateKey(owner = '') {
    const normalizedOwner = normalizeAddress(owner || '');
    if (!normalizedOwner) return '';
    return sessionOwnerPrivateKeyByAddress.get(normalizedOwner) || '';
  }

  const sessionOwnerByAaWallet = (() => {
    const pairs = new Map();
    for (const [aaWallet, owner] of [
      [ERC8183_REQUESTER_AA_ADDRESS, ERC8183_REQUESTER_OWNER_ADDRESS],
      [ERC8183_EXECUTOR_AA_ADDRESS, ERC8183_EXECUTOR_OWNER_ADDRESS],
      [ERC8183_VALIDATOR_AA_ADDRESS, ERC8183_VALIDATOR_OWNER_ADDRESS]
    ]) {
      const normalizedAaWallet = normalizeAddress(aaWallet || '');
      const normalizedOwner = normalizeAddress(owner || '');
      if (!normalizedAaWallet || !normalizedOwner) continue;
      pairs.set(normalizedAaWallet, normalizedOwner);
    }
    try {
      const runtimesData = JSON.parse(require('fs').readFileSync(
        require('path').resolve(require('path').dirname(require('url').fileURLToPath(import.meta.url)), '..', 'data', 'session_runtimes.json'), 'utf8'
      ));
      const runtimes = runtimesData?.runtimes || {};
      for (const [ownerKey, runtime] of Object.entries(runtimes)) {
        const aa = normalizeAddress(runtime?.aaWallet || '');
        const ow = normalizeAddress(runtime?.owner || ownerKey || '');
        if (aa && ow && !pairs.has(aa)) pairs.set(aa, ow);
      }
    } catch { /* ignore if file missing */ }
    return pairs;
  })();

  function resolveSessionOwnerByAaWallet(aaWallet = '') {
    const normalizedAaWallet = normalizeAddress(aaWallet || '');
    if (!normalizedAaWallet) return '';
    return sessionOwnerByAaWallet.get(normalizedAaWallet) || '';
  }

  function getInternalAgentApiKey() {
    return API_KEY_AGENT || API_KEY_ADMIN || '';
  }

  const {
    sessionPayMetrics, classifySessionPayFailure, getSessionPayRetryBackoffMs,
    markSessionPayFailure, markSessionPayRetry, markSessionPayRetryDelay,
    sessionPayConfigSnapshot, shouldRetrySessionPayCategory, postSessionPayWithRetry
  } = createSessionPayHelpers({
    KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
    KITE_SESSION_PAY_RETRIES,
    SESSION_PAY_TRANSPORT_BACKOFF_POLICY,
    SESSION_PAY_REPLACEMENT_BACKOFF_POLICY,
    KITE_BUNDLER_RPC_TIMEOUT_MS,
    KITE_BUNDLER_RPC_RETRIES,
    BUNDLER_RPC_BACKOFF_POLICY,
    KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    KITE_ALLOW_EOA_RELAY_FALLBACK,
    KITE_ALLOW_BACKEND_USEROP_SIGN,
    getInternalAgentApiKey,
    PORT,
    waitMs
  });

  const apiRateLimit = createApiRateLimit({
    extractApiKey,
    rateLimitMax: RATE_LIMIT_MAX,
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS
  });

  let backendSigner = null;
  if (BACKEND_SIGNER_PRIVATE_KEY) {
    try {
      backendSigner = new ethers.Wallet(
        BACKEND_SIGNER_PRIVATE_KEY,
        createKiteRpcProvider(ethers, BACKEND_RPC_URL)
      );
    } catch {
      backendSigner = null;
    }
  }

  const ensureAAAccountDeployment = createEnsureAAAccountDeployment({
    backendSigner, normalizeAddress,
    BACKEND_RPC_URL, BACKEND_BUNDLER_URL, BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS, KITE_AA_ACCOUNT_IMPLEMENTATION, AA_V2_VERSION_TAG,
    KITE_BUNDLER_RPC_TIMEOUT_MS, KITE_BUNDLER_RPC_RETRIES,
    BUNDLER_RPC_BACKOFF_POLICY, KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
  });

  const MANAGED_ROLE_ACCOUNT_ABI = [
    'function version() view returns (string)',
    'function addSupportedToken(address token) external',
    'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
    'function sessionExists(bytes32 sessionId) view returns (bool)',
    'function getSessionAgent(bytes32 sessionId) view returns (address)'
  ];

  function parseManagedAaSalt() {
    const saltRaw = String(process.env.KITECLAW_AA_SALT ?? '0').trim();
    try { return BigInt(saltRaw || '0'); } catch { return 0n; }
  }

  function buildManagedSessionRules({ singleLimitHuman = '1', dailyLimitHuman = '5', nowTs = 0 } = {}) {
    return [
      {
        timeWindow: 0n,
        budget: ethers.parseUnits(String(singleLimitHuman || '1').trim() || '1', 18),
        initialWindowStartTime: 0,
        targetProviders: []
      },
      {
        timeWindow: 86400n,
        budget: ethers.parseUnits(String(dailyLimitHuman || '5').trim() || '5', 18),
        initialWindowStartTime: Math.max(0, Number(nowTs || 0) - 1),
        targetProviders: []
      }
    ];
  }

  async function ensureManagedAaNativeBalance(aaWallet = '') {
    const normalizedAaWallet = normalizeAddress(aaWallet || '');
    if (!normalizedAaWallet || !backendSigner?.provider) {
      return { funded: false, targetWei: 0n, balanceWei: 0n };
    }
    let minTargetWei = 0n;
    let bufferedTargetWei = 0n;
    try { minTargetWei = ethers.parseEther(String(KITE_MIN_NATIVE_GAS || '0.0001').trim() || '0.0001'); } catch { minTargetWei = 0n; }
    try { bufferedTargetWei = ethers.parseEther('0.001'); } catch { bufferedTargetWei = 0n; }
    const targetWei = bufferedTargetWei > minTargetWei ? bufferedTargetWei : minTargetWei;
    if (targetWei <= 0n) return { funded: false, targetWei, balanceWei: 0n };
    const balanceWei = await backendSigner.provider.getBalance(normalizedAaWallet);
    if (balanceWei >= targetWei) return { funded: false, targetWei, balanceWei };
    const transferTx = await backendSigner.sendTransaction({ to: normalizedAaWallet, value: targetWei - balanceWei });
    await transferTx.wait();
    const nextBalanceWei = await backendSigner.provider.getBalance(normalizedAaWallet);
    return { funded: true, targetWei, balanceWei: nextBalanceWei, txHash: transferTx.hash };
  }

  async function ensureManagedRoleSessionRuntime({ ownerAddress = '', roleLabel = 'service' } = {}) {
    const normalizedOwner = normalizeAddress(ownerAddress || '');
    const ownerKey = resolveSessionOwnerPrivateKey(normalizedOwner);
    if (!normalizedOwner || !ownerKey) return null;
    const provider = backendSigner?.provider || createKiteRpcProvider(ethers, BACKEND_RPC_URL);
    const ownerWallet = new ethers.Wallet(ownerKey, provider);
    const salt = parseManagedAaSalt();
    const currentRuntime = resolveSessionRuntime({ owner: normalizedOwner, strictOwnerMatch: true });
    const managedRequiredVersion = String(KITE_AA_JOB_LANE_REQUIRED_VERSION || '').trim();
    const ensured = await ensureAAAccountDeployment({
      owner: normalizedOwner,
      salt,
      requiredVersion: managedRequiredVersion || undefined
    });
    const account = new ethers.Contract(ensured.accountAddress, MANAGED_ROLE_ACCOUNT_ABI, ownerWallet);
    let accountVersion = '';
    try { accountVersion = String(await account.version()).trim(); } catch { accountVersion = ''; }

    const singleLimitHuman = String(POLICY_MAX_PER_TX_DEFAULT || '1').trim() || '1';
    const dailyLimitHuman = String(POLICY_DAILY_LIMIT_DEFAULT || '5').trim() || '5';
    const normalizedTokenAddress = normalizeAddress(SETTLEMENT_TOKEN || '');
    const normalizedGatewayRecipient = normalizeAddress(MERCHANT_ADDRESS || '');

    const canReuse =
      normalizeAddress(currentRuntime?.aaWallet || '') === normalizeAddress(ensured.accountAddress || '') &&
      currentRuntime?.sessionPrivateKey && currentRuntime?.sessionAddress && currentRuntime?.sessionId;
    if (canReuse) {
      try {
        const [exists, agentAddress] = await Promise.all([
          account.sessionExists(currentRuntime.sessionId),
          account.getSessionAgent(currentRuntime.sessionId)
        ]);
        if (exists && normalizeAddress(agentAddress || '') === normalizeAddress(currentRuntime.sessionAddress || '')) {
          const gasStatus = await ensureManagedAaNativeBalance(ensured.accountAddress);
          return writeSessionRuntime(
            {
              ...currentRuntime,
              aaWallet: ensured.accountAddress, owner: normalizedOwner,
              tokenAddress: normalizedTokenAddress, gatewayRecipient: normalizedGatewayRecipient,
              accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
              accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
              accountVersion: accountVersion || currentRuntime.accountVersion || '',
              maxPerTx: Number(singleLimitHuman), dailyLimit: Number(dailyLimitHuman),
              runtimePurpose: currentRuntime.runtimePurpose || 'service',
              source: currentRuntime.source || `backend-managed-${roleLabel}`,
              lastNativeTopUpTxHash: String(gasStatus?.txHash || currentRuntime.lastNativeTopUpTxHash || '').trim(),
              updatedAt: Date.now()
            },
            { setCurrent: false }
          );
        }
      } catch { /* fall through to create a fresh managed session */ }
    }

    if (normalizedTokenAddress) {
      try {
        const addSupportedTokenTx = await account.addSupportedToken(normalizedTokenAddress);
        await addSupportedTokenTx.wait();
      } catch { /* token may already be configured */ }
    }

    const latestBlock = await provider.getBlock('latest');
    const sessionWallet = ethers.Wallet.createRandom();
    const sessionId = ethers.keccak256(
      ethers.toUtf8Bytes(`${roleLabel}:${sessionWallet.address}:${Date.now()}:${salt.toString()}`)
    );
    const createSessionTx = await account.createSession(
      sessionId, sessionWallet.address,
      buildManagedSessionRules({
        singleLimitHuman, dailyLimitHuman,
        nowTs: Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000))
      })
    );
    await createSessionTx.wait();
    const gasStatus = await ensureManagedAaNativeBalance(ensured.accountAddress);

    return writeSessionRuntime(
      {
        ...currentRuntime,
        aaWallet: ensured.accountAddress, owner: normalizedOwner,
        sessionAddress: sessionWallet.address, sessionPrivateKey: sessionWallet.privateKey,
        sessionId, sessionTxHash: createSessionTx.hash,
        tokenAddress: normalizedTokenAddress, gatewayRecipient: normalizedGatewayRecipient,
        accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
        accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
        accountVersion: accountVersion || (ensured.deployed ? 'unknown_or_legacy' : ''),
        maxPerTx: Number(singleLimitHuman), dailyLimit: Number(dailyLimitHuman),
        runtimePurpose: currentRuntime.runtimePurpose || 'service',
        source: `backend-managed-${roleLabel}`,
        lastNativeTopUpTxHash: String(gasStatus?.txHash || '').trim(),
        updatedAt: Date.now()
      },
      { setCurrent: false }
    );
  }

  async function ensureManagedJobLaneRoleRuntimes() {
    const roles = [
      { ownerAddress: ERC8183_EXECUTOR_OWNER_ADDRESS, roleLabel: 'erc8183-executor' },
      { ownerAddress: ERC8183_VALIDATOR_OWNER_ADDRESS, roleLabel: 'erc8183-validator' }
    ];
    for (const role of roles) {
      try {
        const runtime = await ensureManagedRoleSessionRuntime(role);
        if (runtime?.aaWallet) {
          console.log(JSON.stringify({
            component: 'managed-role-runtime', event: 'ready', role: role.roleLabel,
            owner: normalizeAddress(role.ownerAddress || ''),
            aaWallet: normalizeAddress(runtime.aaWallet || ''),
            accountVersion: String(runtime.accountVersion || '').trim(),
            sessionId: String(runtime.sessionId || '').trim()
          }));
        }
      } catch (error) {
        console.warn(JSON.stringify({
          component: 'managed-role-runtime', event: 'ensure_failed', role: role.roleLabel,
          owner: normalizeAddress(role.ownerAddress || ''),
          error: String(error?.message || error || '')
        }));
      }
    }
  }

  if (!String(process.env.KITE_SKIP_MANAGED_ROLES || '').trim()) {
    await ensureManagedJobLaneRoleRuntimes();
  } else {
    console.log('[infra] Skipping managed role runtimes (KITE_SKIP_MANAGED_ROLES set)');
  }

  applyRuntimeServerMiddleware(app, {
    adminKey: KTRACE_ADMIN_KEY,
    allowedOrigins: KTRACE_ALLOWED_ORIGINS,
    cors,
    createTraceId,
    express
  });

  app.use('/api', apiRateLimit);

  // ── Persistence management functions ─────────────────────────────────────

  function broadcastEvent(eventName, payload = {}) {
    void eventName;
    void payload;
  }

  async function hydratePersistenceCachesFromDatabase() {
    if (!persistenceStore.isConnected()) return;
    for (const targetPath of PERSIST_ARRAY_PATHS) {
      const stateKey = persistenceKeyForPath(targetPath);
      const payload = await persistenceStore.getDocument(stateKey);
      if (!Array.isArray(payload)) continue;
      persistArrayCache.set(stateKey, payload);
      writeJsonArrayToFile(targetPath, payload);
    }
    for (const targetPath of PERSIST_OBJECT_PATHS) {
      const stateKey = persistenceKeyForPath(targetPath);
      const payload = await persistenceStore.getDocument(stateKey);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      persistObjectCache.set(stateKey, payload);
      writeJsonObjectToFile(targetPath, payload);
    }
  }

  async function seedPersistenceFromFilesIfMissing() {
    if (!persistenceStore.isConnected()) return;
    for (const targetPath of PERSIST_ARRAY_PATHS) {
      const stateKey = persistenceKeyForPath(targetPath);
      const exists = await persistenceStore.hasDocument(stateKey);
      if (exists) continue;
      const rows = loadJsonArrayFromFile(targetPath);
      await persistenceStore.setDocument(stateKey, rows);
    }
    for (const targetPath of PERSIST_OBJECT_PATHS) {
      const stateKey = persistenceKeyForPath(targetPath);
      const exists = await persistenceStore.hasDocument(stateKey);
      if (exists) continue;
      const payload = loadJsonObjectFromFile(targetPath);
      await persistenceStore.setDocument(stateKey, payload);
    }
  }

  async function initializePersistence() {
    if (persistenceInitDone) return;
    persistenceInitDone = true;
    try {
      await persistenceStore.init();
    } catch (error) {
      console.error(`[persistence] init failed, fallback to file mode: ${error?.message || error}`);
      return;
    }
    if (!persistenceStore.isConnected()) return;
    await seedPersistenceFromFilesIfMissing();
    await hydratePersistenceCachesFromDatabase();
    const info = persistenceStore.info();
    console.log(`[persistence] mode=${info.mode} connected=${info.connected}`);
  }

  // ── Populate ctx ──────────────────────────────────────────────────────────

  Object.assign(ctx, {
    // App
    app, runtimeConfig,
    // Env config
    PORT, PACKAGE_VERSION, STARTED_AT_MS, KITE_NETWORK_NAME,
    dataPath, x402Path, policyFailurePath, policyConfigPath,
    sessionRuntimePath, sessionRuntimeIndexPath, sessionAuthorizationsPath,
    sessionApprovalRequestsPath, onboardingChallengesPath, accountApiKeysPath,
    connectorInstallCodesPath, connectorGrantsPath, workflowPath, identityChallengePath,
    servicesPath, templatesPath, serviceInvocationsPath, purchasesPath, jobsPath,
    consumerIntentsPath, reputationSignalsPath, validationRecordsPath, trustPublicationsPath,
    networkAgentsPath, networkCommandsPath, networkAuditPath, agent001ResultsPath,
    SETTLEMENT_TOKEN, MERCHANT_ADDRESS, X402_UNIFIED_SERVICE_PRICE, X402_PRICE,
    KITE_AGENT2_AA_ADDRESS, X402_REACTIVE_PRICE, X402_BTC_PRICE, X402_RISK_SCORE_PRICE,
    X402_X_READER_PRICE, X402_TECHNICAL_PRICE, X402_INFO_PRICE, X402_HYPERLIQUID_ORDER_PRICE,
    HYPERLIQUID_ORDER_RECIPIENT, X402_TTL_MS, KITE_AGENT1_ID, KITE_AGENT2_ID,
    POLICY_MAX_PER_TX_DEFAULT, POLICY_DAILY_LIMIT_DEFAULT, POLICY_ALLOWED_RECIPIENTS_DEFAULT,
    BACKEND_SIGNER_PRIVATE_KEY, ERC8183_REQUESTER_PRIVATE_KEY, ERC8183_EXECUTOR_PRIVATE_KEY,
    ERC8183_VALIDATOR_PRIVATE_KEY, ENV_SESSION_PRIVATE_KEY, ENV_SESSION_ADDRESS, ENV_SESSION_ID,
    BACKEND_RPC_URL, BACKEND_BUNDLER_URL, BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS, KITE_AA_ACCOUNT_IMPLEMENTATION, KITE_MIN_NATIVE_GAS,
    AA_V2_VERSION_TAG, KITE_AA_JOB_LANE_REQUIRED_VERSION, KITE_REQUIRE_AA_V2,
    KITE_ALLOW_EOA_RELAY_FALLBACK, KITE_ALLOW_BACKEND_USEROP_SIGN,
    KITE_BUNDLER_RPC_TIMEOUT_MS, KITE_BUNDLER_RPC_RETRIES, KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS, KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS,
    KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS, KITE_SESSION_PAY_RETRIES,
    KTRACE_JOB_APPROVAL_THRESHOLD, KTRACE_JOB_APPROVAL_TTL_MS, KTRACE_ADMIN_KEY,
    BACKEND_PUBLIC_URL, KTRACE_ALLOWED_ORIGINS, KTRACE_APPROVAL_RULES,
    ERC8183_DEFAULT_JOB_TIMEOUT_SEC, ERC8183_EXECUTOR_STAKE_DEFAULT,
    KITE_SESSION_PAY_METRICS_RECENT_LIMIT, KITE_NETWORK_AUDIT_MAX_EVENTS,
    BUNDLER_RPC_BACKOFF_POLICY, SESSION_PAY_TRANSPORT_BACKOFF_POLICY,
    SESSION_PAY_REPLACEMENT_BACKOFF_POLICY,
    PROOF_RPC_TIMEOUT_MS, PROOF_RPC_RETRIES, PROOF_RECEIPT_WAIT_MS, PROOF_RECEIPT_POLL_INTERVAL_MS,
    LLM_BASE_URL, LLM_CHAT_PATH, LLM_HEALTH_PATH, LLM_API_KEY, LLM_TIMEOUT_MS,
    LLM_CHAT_PROTOCOL, LLM_MODEL, AGENT001_MODEL_PRIMARY, AGENT001_MODEL_FALLBACK,
    AGENT_WORKER_MODEL, LLM_AGENT_MODELS, LLM_AGENT_FALLBACK_MODELS, LLM_MODEL_FALLBACKS, LLM_SYSTEM_PROMPT,
    HYPERLIQUID_TESTNET_ENABLED, HYPERLIQUID_TESTNET_PRIVATE_KEY, HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS,
    HYPERLIQUID_TESTNET_API_URL, HYPERLIQUID_TESTNET_TIMEOUT_MS, HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS,
    ANALYSIS_PROVIDER, OPENNEWS_API_BASE, OPENNEWS_TOKEN, OPENNEWS_TIMEOUT_MS, OPENNEWS_RETRY, OPENNEWS_MAX_ROWS,
    OPENTWITTER_API_BASE, OPENTWITTER_TOKEN, OPENTWITTER_TIMEOUT_MS, OPENTWITTER_RETRY, OPENTWITTER_MAX_ROWS,
    MESSAGE_PROVIDER_DEFAULT_KEYWORDS, MESSAGE_PROVIDER_DISABLE_CLAWFEED, MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    ERC8004_IDENTITY_REGISTRY, ERC8004_AGENT_ID_RAW, ERC8004_AGENT_ID, ERC8004_TRUST_ANCHOR_REGISTRY,
    ERC8183_JOB_ANCHOR_REGISTRY, ERC8183_ESCROW_ADDRESS, ERC8183_TRACE_ANCHOR_GUARD,
    ERC8183_REQUESTER_AA_ADDRESS, ERC8183_EXECUTOR_AA_ADDRESS, ERC8183_VALIDATOR_AA_ADDRESS,
    API_KEY_ADMIN, API_KEY_AGENT, API_KEY_VIEWER, AUTH_DISABLED,
    KTRACE_ONBOARDING_COOKIE_NAME, KTRACE_ONBOARDING_COOKIE_SECRET,
    RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, IDENTITY_CHALLENGE_TTL_MS, IDENTITY_CHALLENGE_MAX_ROWS,
    IDENTITY_VERIFY_MODE, AUTO_TRADE_PLAN_ENABLED, AUTO_TRADE_PLAN_INTERVAL_MS,
    AUTO_TRADE_PLAN_SYMBOL, AUTO_TRADE_PLAN_HORIZON_MIN, AUTO_TRADE_PLAN_PROMPT,
    KTRACE_AUTO_JOB_EXPIRY_ENABLED, KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    X_READER_MAX_CHARS_DEFAULT, AGENT001_REQUIRE_X402, AGENT001_PREBIND_ONLY, AGENT001_BIND_TIMEOUT_MS,
    ROLE_RANK, ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED, ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED,
    ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED, ERC8183_REQUESTER_OWNER_ADDRESS,
    ERC8183_EXECUTOR_OWNER_ADDRESS, ERC8183_VALIDATOR_OWNER_ADDRESS,
    // Node modules passed through (needed by routes)
    GokiteAASDK, crypto, ethers, path,
    // Auth
    authConfigured, extractApiKey, resolveRoleByApiKey, resolveAuthRequest, requireRole,
    // Adapters
    llmAdapter, hyperliquidAdapter, persistenceStore,
    // Address helpers
    normalizeAddress, normalizeAddresses, normalizePrivateKey, normalizeRecipients,
    deriveAddressFromPrivateKey, getServiceProviderBytes32,
    // Persistence helpers
    readJsonArray, writeJsonArray, readJsonObject, writeJsonObject, queuePersistWrite,
    persistArrayCache, persistObjectCache,
    loadJsonArrayFromFile, loadJsonObjectFromFile, persistenceKeyForPath,
    writeJsonArrayToFile, writeJsonObjectToFile,
    PERSIST_ARRAY_PATHS, PERSIST_OBJECT_PATHS,
    // Loop state
    autoTradePlanState, autoJobExpiryState,
    // Data accessors
    readRecords, writeRecords,
    readX402Requests, writeX402Requests,
    readPolicyFailures, writePolicyFailures,
    readWorkflows, writeWorkflows,
    readIdentityChallenges, writeIdentityChallenges,
    readOnboardingChallenges, writeOnboardingChallenges,
    readAccountApiKeys, writeAccountApiKeys,
    readConnectorInstallCodes, writeConnectorInstallCodes,
    readConnectorGrants, writeConnectorGrants,
    readPublishedServices, writePublishedServices,
    readTemplates, writeTemplates,
    readServiceInvocations, writeServiceInvocations,
    readPurchases, writePurchases,
    readJobs, writeJobs,
    readConsumerIntents, writeConsumerIntents,
    readReputationSignals, writeReputationSignals,
    readValidationRecords, writeValidationRecords,
    readTrustPublications, writeTrustPublications,
    readNetworkAgents, writeNetworkAgents,
    readNetworkCommands, writeNetworkCommands,
    readNetworkAuditEvents, writeNetworkAuditEvents,
    readAgent001Results, writeAgent001Results,
    // Session runtime
    sanitizeSessionRuntime, readSessionRuntime, readSessionRuntimeByOwner,
    readSessionRuntimeIndex, writeSessionRuntimeIndex, listSessionRuntimes,
    resolveSessionRuntime, writeSessionRuntime,
    sanitizeSessionAuthorizationRecord, readSessionAuthorizations, writeSessionAuthorizations,
    readSessionApprovalRequests, writeSessionApprovalRequests,
    // Audit
    toAuditText, sanitizeAuditRefs, sanitizeAuditQuote, sanitizeAuditSla,
    sanitizeAuditRationale, sanitizeAuditStepDetails, sanitizeAuditSummary,
    resolveAuditQuoteFromPaymentIntent, appendNetworkAuditEvent,
    listNetworkAuditEventsByTraceId, appendWorkflowStep,
    buildWorkflowFallbackAuditEvents, deriveNegotiationTermsFromAuditEvents,
    buildNetworkRunSummaries,
    // Record mutation
    upsertServiceInvocation, upsertJobRecord, upsertPurchaseRecord,
    appendReputationSignal, appendValidationRecord, appendTrustPublication,
    // Record helpers
    isAgent001TaskSuccessful, maskSecret,
    // Crypto/AA
    resolveSessionOwnerPrivateKey, resolveSessionOwnerByAaWallet,
    getInternalAgentApiKey, backendSigner, ensureAAAccountDeployment,
    // Session pay
    sessionPayMetrics, classifySessionPayFailure, getSessionPayRetryBackoffMs,
    markSessionPayFailure, markSessionPayRetry, markSessionPayRetryDelay,
    sessionPayConfigSnapshot, shouldRetrySessionPayCategory, postSessionPayWithRetry,
    // Onboarding helpers (extracted methods for routeDeps)
    onboardingSetupHelpers, claudeConnectorAuthHelpers,
    // Utilities
    createTraceId, waitMs, getUtcDateKey,
    // Persistence management
    broadcastEvent, initializePersistence
  });
}
