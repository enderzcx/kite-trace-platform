import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ethers } from 'ethers';
import {
  hydrateMessageProviderTokenFromLocalDocs,
  normalizeBackoffPolicy,
  parseAgentIdList,
  parseEnvAgentFallbackModelMap,
  parseEnvAgentModelMap,
  parseEnvCsvList,
  toBoundedIntEnv
} from './lib/env.js';
import { createAuthHelpers } from './lib/auth.js';
import {
  createJsonPersistenceHelpers,
  loadJsonArrayFromFile,
  loadJsonObjectFromFile,
  persistenceKeyForPath,
  writeJsonArrayToFile,
  writeJsonObjectToFile
} from './lib/persistence.js';
import {
  fetchBinanceTicker24h,
  fetchBtcPriceQuote,
  fetchCoinGeckoBtcSnapshot,
  fetchJsonWithTimeout,
  normalizeBtcPriceParams
} from './lib/priceFeed.js';
import { GokiteAASDK } from './lib/gokite-aa-sdk.js';
import { createSessionPayHelpers } from './lib/sessionPay.js';
import { createEnsureAAAccountDeployment } from './lib/aaAccount.js';
import { createOnboardingSetupHelpers } from './lib/onboardingSetupHelpers.js';
import { createClaudeConnectorAuthHelpers } from './lib/claudeConnectorAuth.js';
import { createAutoTradePlanLoop } from './lib/loops/tradePlanLoop.js';
import { createAutoJobExpiryLoop } from './lib/loops/jobExpiryLoop.js';
import {
  createPolicyConfigHelpers,
  deriveAddressFromPrivateKey,
  getServiceProviderBytes32,
  normalizeAddress,
  normalizeAddresses,
  normalizePrivateKey,
  normalizeRecipients
} from './lib/addressPolicyHelpers.js';
import { createSessionRuntimeHelpers, maskSecret } from './lib/sessionRuntimeHelpers.js';
import { createNetworkAuditHelpers } from './lib/networkAuditHelpers.js';
import { createMarketAnalysisHelpers } from './lib/marketAnalysisHelpers.js';
import { createMarketAnalysisRuntime } from './lib/marketAnalysisRuntime.js';
import { createCatalogHelpers, createRecordMutationHelpers, isAgent001TaskSuccessful } from './lib/appRecordHelpers.js';
import { createOnchainAnchorHelpers } from './lib/onchainAnchors.js';
import { createEscrowHelpers } from './lib/escrowHelpers.js';
import { createXReaderDigestFetcher, fetchTextWithTimeout } from './lib/httpFetch.js';
import { createServiceRoutingHelpers, isInfoAnalysisAction, isTechnicalAnalysisAction } from './lib/serviceRouting.js';
import { createWorkflowHelpers } from './lib/workflowHelpers.js';
import { createA2AHelpers } from './lib/a2aHelpers.js';
import { createDataStoreAccessors } from './lib/dataStoreAccessors.js';
import { createX402WorkflowHelpers } from './lib/x402WorkflowHelpers.js';
import { createConsumerAuthorityHelpers } from './lib/consumerAuthority.js';
import { createLlmAdapter } from './services/llmAdapter.js';
import { createHyperliquidAdapter } from './services/hyperliquidAdapter.js';
import { createPersistenceStore } from './services/persistenceStore.js';
import { createMessageProviderAnalysisService } from './services/messageProviderAnalysisService.js';
import { createX402ReceiptService } from './services/x402ReceiptService.js';
import { createAgent001ExecutionService } from './services/agent001ExecutionService.js';
import { createAgent001PlanningService } from './services/agent001PlanningService.js';
import { createAgent001Orchestrator } from './services/agent001Orchestrator.js';
import {
  classifyAgent001IntentFallback,
  detectAgent001IntentOverrides,
  extractFirstUrlFromText,
  extractHorizonFromText,
  extractTradingSymbolFromText,
  isAgent001ForceOrderRequested,
  parseAgent001OrderDirectives,
  resolveAgent001Intent
} from './services/agent001Intent.js';
import { registerAutomationX402Routes } from './routes/automationX402Routes.js';
import { registerWorkflowA2aRoutes } from './routes/workflowA2aRoutes.js';
import { registerCoreIdentityChatRoutes } from './routes/coreIdentityChatRoutes.js';
import { registerMarketAgentServiceRoutes } from './routes/marketAgentServiceRoutes.js';
import { createJobExpiryExecutor, registerJobLaneRoutes } from './routes/jobLaneRoutes.js';
import { registerDataFeedRoutes } from './routes/dataFeedRoutes.js';
import { registerDailyNewsRoutes } from './routes/dailyNewsRoutes.js';
import { registerTemplateRoutes } from './routes/templateRoutes.js';
import { registerTrustSignalRoutes } from './routes/trustSignalRoutes.js';
import { registerPlatformV1Routes } from './routes/platformV1Routes.js';
import { registerAgentCardRoutes } from './routes/agentCardRoutes.js';
import { createIdentityVerificationHelpers } from './routes/identityVerificationHelpers.js';
import { createPaymentPolicyHelpers } from './routes/paymentPolicyHelpers.js';
import { createRuntimeSupportHelpers } from './routes/runtimeSupportHelpers.js';
import { createNetworkCommandHelpers } from './routes/networkCommandHelpers.js';
import { trustPublicationAnchorAbi } from './lib/contracts/trustPublicationAnchorAbi.js';
import { jobLifecycleAnchorV2Abi } from './lib/contracts/jobLifecycleAnchorV2Abi.js';
import { createNetworkCommandExecutionHelpers } from './routes/networkCommandExecutionHelpers.js';
import { createRuntimeDecisionHelpers } from './routes/runtimeDecisionHelpers.js';
import { createAgent001ReplyHelpers } from './routes/agent001ReplyHelpers.js';
import { createAgent001DispatchRecoveryHelpers } from './routes/agent001DispatchRecoveryHelpers.js';
import { createAgent001DispatchHelpers } from './routes/agent001DispatchHelpers.js';
import { createAgent001TradeFlowHelpers } from './routes/agent001TradeFlowHelpers.js';
import { createAgent001AnalysisFlowHelpers } from './routes/agent001AnalysisFlowHelpers.js';
import { createAgent001ConversationGateHelpers } from './routes/agent001ConversationGateHelpers.js';
import { createRuntimeTaskEnvelopeHelpers } from './routes/runtimeTaskEnvelopeHelpers.js';
import { createServiceNetworkHelpers } from './routes/serviceNetworkHelpers.js';
import { registerMcpRoutes } from './mcp/mcpServer.js';
import { registerX402DiscoveryRoutes } from './routes/x402DiscoveryRoutes.js';
import { createRuntimeConfig } from './runtime/config.js';
import {
  applyRuntimeServerMiddleware,
  createApiRateLimit,
  createRuntimeServerLifecycle,
  registerHealthRoutes
} from './runtime/server.js';

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

const LLM_AGENT_MODEL_MAP = {
  ...LLM_AGENT_MODELS
};
const LLM_AGENT_FALLBACK_MODEL_MAP = {
  ...LLM_AGENT_FALLBACK_MODELS
};
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

const persistenceStore = createPersistenceStore({
  mode: process.env.KITE_PERSISTENCE_MODE || '',
  databaseUrl: process.env.DATABASE_URL || ''
});

const PERSIST_ARRAY_PATHS = [
  dataPath,
  x402Path,
  policyFailurePath,
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
  sessionAuthorizationsPath,
  sessionApprovalRequestsPath,
  networkCommandsPath,
  networkAuditPath,
  agent001ResultsPath
];
const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath, sessionRuntimeIndexPath];
const persistArrayCache = new Map();
const persistObjectCache = new Map();
const { readJsonArray, writeJsonArray, readJsonObject, writeJsonObject, queuePersistWrite } = createJsonPersistenceHelpers({
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
const {
  readRecords,
  writeRecords,
  readX402Requests,
  writeX402Requests,
  readPolicyFailures,
  writePolicyFailures,
  readWorkflows,
  writeWorkflows,
  readIdentityChallenges,
  writeIdentityChallenges,
  readOnboardingChallenges,
  writeOnboardingChallenges,
  readAccountApiKeys,
  writeAccountApiKeys,
  readConnectorInstallCodes,
  writeConnectorInstallCodes,
  readConnectorGrants,
  writeConnectorGrants,
  readPublishedServices,
  writePublishedServices,
  readTemplates,
  writeTemplates,
  readServiceInvocations,
  writeServiceInvocations,
  readPurchases,
  writePurchases,
  readJobs,
  writeJobs,
  readConsumerIntents,
  writeConsumerIntents,
  readReputationSignals,
  writeReputationSignals,
  readValidationRecords,
  writeValidationRecords,
  readTrustPublications,
  writeTrustPublications,
  readNetworkAgents,
  writeNetworkAgents,
  readNetworkCommands,
  writeNetworkCommands,
  readNetworkAuditEvents,
  writeNetworkAuditEvents,
  readAgent001Results,
  writeAgent001Results
} = createDataStoreAccessors({
  paths: {
    dataPath,
    x402Path,
    policyFailurePath,
    workflowPath,
    identityChallengePath,
    onboardingChallengesPath,
    accountApiKeysPath,
    connectorInstallCodesPath,
    connectorGrantsPath,
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
    agent001ResultsPath
  },
  readJsonArray,
  writeJsonArray,
  loadJsonArrayFromFile,
  persistenceKeyForPath,
  persistArrayCache,
  queuePersistWrite,
  writeJsonArrayToFile
});
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
const {
  sanitizeSessionRuntime,
  readSessionRuntime,
  readSessionRuntimeByOwner,
  readSessionRuntimeIndex,
  writeSessionRuntimeIndex,
  listSessionRuntimes,
  resolveSessionRuntime,
  writeSessionRuntime,
  sanitizeSessionAuthorizationRecord,
  readSessionAuthorizations,
  writeSessionAuthorizations
} = createSessionRuntimeHelpers({
  normalizeAddress,
  readJsonObject,
  writeJsonObject,
  readJsonArray,
  writeJsonArray,
  sessionRuntimePath,
  sessionRuntimeIndexPath,
  sessionAuthorizationsPath,
  envSessionPrivateKey: ENV_SESSION_PRIVATE_KEY,
  envSessionAddress: ENV_SESSION_ADDRESS,
  envSessionId: ENV_SESSION_ID
});
const readSessionApprovalRequests = () => readJsonArray(sessionApprovalRequestsPath);
const writeSessionApprovalRequests = (rows = []) => writeJsonArray(sessionApprovalRequestsPath, rows);
const {
  toAuditText,
  sanitizeAuditRefs,
  sanitizeAuditQuote,
  sanitizeAuditSla,
  sanitizeAuditRationale,
  sanitizeAuditStepDetails,
  sanitizeAuditSummary,
  resolveAuditQuoteFromPaymentIntent,
  appendNetworkAuditEvent,
  listNetworkAuditEventsByTraceId,
  appendWorkflowStep
} = createNetworkAuditHelpers({
  normalizeAddress,
  readX402Requests,
  readNetworkAuditEvents,
  writeNetworkAuditEvents,
  kiteNetworkAuditMaxEvents: KITE_NETWORK_AUDIT_MAX_EVENTS
});
const { buildWorkflowFallbackAuditEvents, deriveNegotiationTermsFromAuditEvents } = createWorkflowHelpers({
  toAuditText,
  sanitizeAuditSummary,
  sanitizeAuditQuote,
  sanitizeAuditSla,
  sanitizeAuditRationale
});
const { buildNetworkRunSummaries } = createA2AHelpers({
  toAuditText,
  readWorkflows,
  readNetworkAuditEvents
});
const {
  upsertServiceInvocation,
  upsertJobRecord,
  upsertPurchaseRecord,
  appendReputationSignal,
  appendValidationRecord,
  appendTrustPublication
} = createRecordMutationHelpers({
  readJobs,
  readPurchases,
  readReputationSignals,
  readServiceInvocations,
  readTrustPublications,
  readValidationRecords,
  writeJobs,
  writePurchases,
  writeReputationSignals,
  writeServiceInvocations,
  writeTrustPublications,
  writeValidationRecords
});

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
  sessionPayMetrics,
  classifySessionPayFailure,
  getSessionPayRetryBackoffMs,
  markSessionPayFailure,
  markSessionPayRetry,
  markSessionPayRetryDelay,
  sessionPayConfigSnapshot,
  shouldRetrySessionPayCategory,
  postSessionPayWithRetry
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
    backendSigner = new ethers.Wallet(BACKEND_SIGNER_PRIVATE_KEY, new ethers.JsonRpcProvider(BACKEND_RPC_URL));
  } catch {
    backendSigner = null;
  }
}
const ensureAAAccountDeployment = createEnsureAAAccountDeployment({
  backendSigner,
  normalizeAddress,
  BACKEND_RPC_URL,
  BACKEND_BUNDLER_URL,
  BACKEND_ENTRYPOINT_ADDRESS,
  KITE_AA_FACTORY_ADDRESS,
  KITE_AA_ACCOUNT_IMPLEMENTATION,
  AA_V2_VERSION_TAG,
  KITE_BUNDLER_RPC_TIMEOUT_MS,
  KITE_BUNDLER_RPC_RETRIES,
  BUNDLER_RPC_BACKOFF_POLICY,
  KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
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
  try {
    return BigInt(saltRaw || '0');
  } catch {
    return 0n;
  }
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
  try {
    minTargetWei = ethers.parseEther(String(KITE_MIN_NATIVE_GAS || '0.0001').trim() || '0.0001');
  } catch {
    minTargetWei = 0n;
  }
  try {
    bufferedTargetWei = ethers.parseEther('0.001');
  } catch {
    bufferedTargetWei = 0n;
  }
  const targetWei = bufferedTargetWei > minTargetWei ? bufferedTargetWei : minTargetWei;
  if (targetWei <= 0n) {
    return { funded: false, targetWei, balanceWei: 0n };
  }
  const balanceWei = await backendSigner.provider.getBalance(normalizedAaWallet);
  if (balanceWei >= targetWei) {
    return { funded: false, targetWei, balanceWei };
  }
  const transferTx = await backendSigner.sendTransaction({
    to: normalizedAaWallet,
    value: targetWei - balanceWei
  });
  await transferTx.wait();
  const nextBalanceWei = await backendSigner.provider.getBalance(normalizedAaWallet);
  return {
    funded: true,
    targetWei,
    balanceWei: nextBalanceWei,
    txHash: transferTx.hash
  };
}

async function ensureManagedRoleSessionRuntime({
  ownerAddress = '',
  roleLabel = 'service'
} = {}) {
  const normalizedOwner = normalizeAddress(ownerAddress || '');
  const ownerKey = resolveSessionOwnerPrivateKey(normalizedOwner);
  if (!normalizedOwner || !ownerKey) {
    return null;
  }
  const provider = backendSigner?.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
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
  try {
    accountVersion = String(await account.version()).trim();
  } catch {
    accountVersion = '';
  }

  const singleLimitHuman = String(POLICY_MAX_PER_TX_DEFAULT || '1').trim() || '1';
  const dailyLimitHuman = String(POLICY_DAILY_LIMIT_DEFAULT || '5').trim() || '5';
  const normalizedTokenAddress = normalizeAddress(SETTLEMENT_TOKEN || '');
  const normalizedGatewayRecipient = normalizeAddress(MERCHANT_ADDRESS || '');

  const canReuse =
    normalizeAddress(currentRuntime?.aaWallet || '') === normalizeAddress(ensured.accountAddress || '') &&
    currentRuntime?.sessionPrivateKey &&
    currentRuntime?.sessionAddress &&
    currentRuntime?.sessionId;
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
            aaWallet: ensured.accountAddress,
            owner: normalizedOwner,
            tokenAddress: normalizedTokenAddress,
            gatewayRecipient: normalizedGatewayRecipient,
            accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
            accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
            accountVersion: accountVersion || currentRuntime.accountVersion || '',
            maxPerTx: Number(singleLimitHuman),
            dailyLimit: Number(dailyLimitHuman),
            runtimePurpose: currentRuntime.runtimePurpose || 'service',
            source: currentRuntime.source || `backend-managed-${roleLabel}`,
            lastNativeTopUpTxHash: String(gasStatus?.txHash || currentRuntime.lastNativeTopUpTxHash || '').trim(),
            updatedAt: Date.now()
          },
          { setCurrent: false }
        );
      }
    } catch {
      // fall through to create a fresh managed session
    }
  }

  if (normalizedTokenAddress) {
    try {
      const addSupportedTokenTx = await account.addSupportedToken(normalizedTokenAddress);
      await addSupportedTokenTx.wait();
    } catch {
      // token may already be configured
    }
  }

  const latestBlock = await provider.getBlock('latest');
  const sessionWallet = ethers.Wallet.createRandom();
  const sessionId = ethers.keccak256(
    ethers.toUtf8Bytes(`${roleLabel}:${sessionWallet.address}:${Date.now()}:${salt.toString()}`)
  );
  const createSessionTx = await account.createSession(
    sessionId,
    sessionWallet.address,
    buildManagedSessionRules({
      singleLimitHuman,
      dailyLimitHuman,
      nowTs: Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000))
    })
  );
  await createSessionTx.wait();
  const gasStatus = await ensureManagedAaNativeBalance(ensured.accountAddress);

  return writeSessionRuntime(
    {
      ...currentRuntime,
      aaWallet: ensured.accountAddress,
      owner: normalizedOwner,
      sessionAddress: sessionWallet.address,
      sessionPrivateKey: sessionWallet.privateKey,
      sessionId,
      sessionTxHash: createSessionTx.hash,
      tokenAddress: normalizedTokenAddress,
      gatewayRecipient: normalizedGatewayRecipient,
      accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
      accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
      accountVersion: accountVersion || (ensured.deployed ? 'unknown_or_legacy' : ''),
      maxPerTx: Number(singleLimitHuman),
      dailyLimit: Number(dailyLimitHuman),
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
        console.log(
          JSON.stringify({
            component: 'managed-role-runtime',
            event: 'ready',
            role: role.roleLabel,
            owner: normalizeAddress(role.ownerAddress || ''),
            aaWallet: normalizeAddress(runtime.aaWallet || ''),
            accountVersion: String(runtime.accountVersion || '').trim(),
            sessionId: String(runtime.sessionId || '').trim()
          })
        );
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          component: 'managed-role-runtime',
          event: 'ensure_failed',
          role: role.roleLabel,
          owner: normalizeAddress(role.ownerAddress || ''),
          error: String(error?.message || error || '')
        })
      );
    }
  }
}

await ensureManagedJobLaneRoleRuntimes();

applyRuntimeServerMiddleware(app, {
  adminKey: KTRACE_ADMIN_KEY,
  allowedOrigins: KTRACE_ALLOWED_ORIGINS,
  cors,
  createTraceId,
  express
});

app.use('/api', apiRateLimit);

function broadcastEvent(eventName, payload = {}) {
  // SSE module removed; keep no-op to avoid touching workflow call sites.
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
const {
  computeX402StatusCounts,
  expireStaleX402PendingRequests,
  scheduleX402PendingCleanup,
  upsertAgent001ResultRecord,
  upsertWorkflow,
  createX402Request,
  buildPaymentRequiredResponse
} = createX402WorkflowHelpers({
  crypto,
  normalizeAddress,
  createTraceId,
  toAuditText,
  appendNetworkAuditEvent,
  readX402Requests,
  writeX402Requests,
  readAgent001Results,
  writeAgent001Results,
  readWorkflows,
  writeWorkflows,
  x402Price: X402_PRICE,
  x402TtlMs: X402_TTL_MS,
  settlementToken: SETTLEMENT_TOKEN,
  merchantAddress: MERCHANT_ADDRESS,
  kiteNetworkAuditMaxEvents: KITE_NETWORK_AUDIT_MAX_EVENTS,
  erc8004IdentityRegistry: ERC8004_IDENTITY_REGISTRY,
  erc8004AgentId: ERC8004_AGENT_ID
});

const {
  assertBackendSigner,
  ensureWorkflowIdentityVerified,
  getLatestIdentityChallengeSnapshot,
  issueIdentityChallenge,
  readIdentityProfile,
  verifyIdentityChallengeResponse
} = createIdentityVerificationHelpers({
  BACKEND_RPC_URL,
  ERC8004_AGENT_ID,
  ERC8004_IDENTITY_REGISTRY,
  IDENTITY_CHALLENGE_MAX_ROWS,
  IDENTITY_CHALLENGE_TTL_MS,
  IDENTITY_VERIFY_MODE,
  createTraceId,
  crypto,
  ethers,
  getBackendSigner: () => backendSigner,
  normalizeAddress,
  readIdentityChallenges,
  writeIdentityChallenges
});

const x402ReceiptService = createX402ReceiptService({
  readX402Requests,
  readWorkflows
});
const {
  normalizeReactiveParams,
  normalizeRiskScoreParams,
  normalizeXReaderParams,
  parseExcerptMaxChars,
  extractXReaderDigest,
  clampNumber,
  normalizeStringArray,
  normalizeFreshIsoTimestamp,
  normalizeInfoAnalysisResult,
  normalizeTechnicalAnalysisResult,
  averageNumbers,
  computeEma,
  computeRsi,
  computeMacd,
  computeAtr,
  toRiskLevel,
  buildRiskScoreSummary
} = createMarketAnalysisHelpers({
  analysisProvider: ANALYSIS_PROVIDER,
  normalizeBtcPriceParams,
  xReaderMaxCharsDefault: X_READER_MAX_CHARS_DEFAULT
});
const {
  mapX402Item,
  buildLatestWorkflowByRequestId,
  buildDemoPriceSeries,
  normalizeExecutionState,
  buildA2AReceipt,
  listA2AReceipts,
  buildA2ANetworkGraph,
  computeDashboardKpi
} = x402ReceiptService;
const {
  fetchFearGreedIndex,
  fetchBinanceKlines,
  runMarketInfoAnalysis,
  buildFallbackTechnicalFromQuote,
  runMarketTechnicalAnalysis,
  runRiskScoreAnalysis
} = createMarketAnalysisRuntime({
  averageNumbers,
  buildDemoPriceSeries,
  buildRiskScoreSummary,
  clampNumber,
  computeAtr,
  computeEma,
  computeMacd,
  computeRsi,
  fetchBtcPriceQuote,
  fetchBinanceTicker24h,
  fetchCoinGeckoBtcSnapshot,
  fetchJsonWithTimeout,
  normalizeInfoAnalysisResult,
  normalizeRiskScoreParams,
  normalizeTechnicalAnalysisResult,
  normalizeXReaderParams,
  toRiskLevel
});

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

function resolveWorkflowTraceId(requestedTraceId = '') {
  const input = String(requestedTraceId || '').trim();
  if (!input) return createTraceId('workflow');
  const exists = readWorkflows().some((item) => String(item?.traceId || '') === input);
  return exists ? createTraceId('workflow') : input;
}

const {
  buildInfoPaymentIntentForTask,
  buildInternalAgentHeaders,
  buildRiskScorePaymentIntentForTask,
  fetchJsonResponseWithTimeout,
  hasStrictX402Evidence,
  isTransientTransportError
} = createRuntimeSupportHelpers({
  AGENT001_BIND_TIMEOUT_MS,
  AGENT001_PREBIND_ONLY,
  API_KEY_ADMIN,
  API_KEY_AGENT,
  API_KEY_VIEWER,
  KITE_AGENT1_ID,
  KITE_AGENT2_ID,
  PORT,
  X_READER_MAX_CHARS_DEFAULT,
  buildLatestWorkflowByRequestId,
  createTraceId,
  normalizeAddress,
  normalizeRiskScoreParams,
  normalizeXReaderParams,
  readWorkflows,
  readX402Requests,
  resolveWorkflowTraceId
});
const buildXReaderPaymentIntentForTask = buildInfoPaymentIntentForTask;
const {
  resolveTechnicalSettlementRecipient,
  resolveInfoSettlementRecipient,
  getActionConfig
} = createServiceRoutingHelpers({
  ethers,
  hyperliquidOrderRecipient: HYPERLIQUID_ORDER_RECIPIENT,
  kiteAgent2AaAddress: KITE_AGENT2_AA_ADDRESS,
  merchantAddress: MERCHANT_ADDRESS,
  normalizeAddress,
  x402BtcPrice: X402_BTC_PRICE,
  x402HyperliquidOrderPrice: X402_HYPERLIQUID_ORDER_PRICE,
  x402InfoPrice: X402_INFO_PRICE,
  x402ReactivePrice: X402_REACTIVE_PRICE,
  x402RiskScorePrice: X402_RISK_SCORE_PRICE,
  x402TechnicalPrice: X402_TECHNICAL_PRICE,
  x402XReaderPrice: X402_X_READER_PRICE,
  x402Price: X402_PRICE
});
const {
  getCoreAllowedRecipients,
  mergeAllowedRecipients,
  sanitizePolicy,
  ensurePolicyFile,
  readPolicyConfig,
  writePolicyConfig
} = createPolicyConfigHelpers({
  fs,
  path,
  policyConfigPath,
  policyMaxPerTxDefault: POLICY_MAX_PER_TX_DEFAULT,
  policyDailyLimitDefault: POLICY_DAILY_LIMIT_DEFAULT,
  policyAllowedRecipientsDefault: POLICY_ALLOWED_RECIPIENTS_DEFAULT,
  merchantAddress: MERCHANT_ADDRESS,
  kiteAgent2AaAddress: KITE_AGENT2_AA_ADDRESS,
  resolveTechnicalSettlementRecipient,
  resolveInfoSettlementRecipient
});

const {
  buildA2ACapabilities,
  buildPolicySnapshot,
  buildResponseHash,
  digestStableObject,
  evaluateTransferPolicy,
  extractUserOpHashFromReason,
  logPolicyFailure,
  sendSessionTransferViaEoaRelay,
  shouldFallbackToEoaRelay,
  signResponseHash,
  validatePaymentProof,
  verifyProofOnChain,
  withSessionUserOpLock
} = createPaymentPolicyHelpers({
  BACKEND_RPC_URL,
  HYPERLIQUID_ORDER_RECIPIENT,
  KITE_AGENT2_AA_ADDRESS,
  KITE_AGENT2_ID,
  MERCHANT_ADDRESS,
  PROOF_RECEIPT_POLL_INTERVAL_MS,
  PROOF_RECEIPT_WAIT_MS,
  PROOF_RPC_RETRIES,
  PROOF_RPC_TIMEOUT_MS,
  SETTLEMENT_TOKEN,
  X402_BTC_PRICE,
  X402_HYPERLIQUID_ORDER_PRICE,
  X402_INFO_PRICE,
  X402_REACTIVE_PRICE,
  X402_RISK_SCORE_PRICE,
  X402_TECHNICAL_PRICE,
  crypto,
  ethers,
  getBackendSigner: () => backendSigner,
  normalizeAddress,
  readPolicyConfig,
  readPolicyFailures,
  resolveInfoSettlementRecipient,
  resolveTechnicalSettlementRecipient,
  waitMs,
  writePolicyFailures
});
const { checkAnchorExistsOnChain, publishTrustPublicationOnChain, publishJobLifecycleAnchorOnChain, readLatestAnchorIdOnChain } = createOnchainAnchorHelpers({
  backendSigner,
  backendRpcUrl: BACKEND_RPC_URL,
  digestStableObject,
  erc8004TrustAnchorRegistry: ERC8004_TRUST_ANCHOR_REGISTRY,
  erc8183JobAnchorRegistry: ERC8183_JOB_ANCHOR_REGISTRY,
  ethers,
  jobLifecycleAnchorAbi: jobLifecycleAnchorV2Abi,
  trustPublicationAnchorAbi
});
const {
  beginConsumerIntent,
  buildAuthorityPublicSummary,
  buildAuthoritySnapshot,
  buildPolicySnapshotHash,
  finalizeConsumerIntent,
  findConsumerIntent,
  materializeAuthority,
  revokeConsumerAuthorityPolicy,
  validateConsumerAuthority,
  writeConsumerAuthorityPolicy
} = createConsumerAuthorityHelpers({
  crypto,
  normalizeAddress,
  readPolicyConfig,
  buildPolicySnapshot,
  evaluateTransferPolicy,
  logPolicyFailure,
  markSessionPayFailure,
  readX402Requests,
  readConsumerIntents,
  writeConsumerIntents,
  readSessionRuntime,
  resolveSessionRuntime,
  writeSessionRuntime
});
const escrowHelpers = createEscrowHelpers({
  backendSigner,
  ethers,
  escrowAddress: ERC8183_ESCROW_ADDRESS,
  settlementToken: SETTLEMENT_TOKEN,
  resolveSessionRuntime,
  resolveSessionOwnerByAaWallet,
  resolveSessionOwnerPrivateKey,
  rpcUrl: BACKEND_RPC_URL,
  bundlerUrl: BACKEND_BUNDLER_URL,
  entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
  accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
  accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
  bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
  bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
  bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
  bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
  bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
  bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
  bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
  escrowUserOpSubmitTimeoutMs: KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS,
  escrowUserOpWaitTimeoutMs: KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS,
  escrowUserOpPollIntervalMs: KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS,
  aaVersionTag: AA_V2_VERSION_TAG,
  jobLaneRequiredAaVersionTag: KITE_AA_JOB_LANE_REQUIRED_VERSION,
  requireAaV2: KITE_REQUIRE_AA_V2,
  kiteMinNativeGas: KITE_MIN_NATIVE_GAS
});
const {
  preflightJobLaneCapability,
  prepareEscrowFunding,
  lockEscrowFunds,
  acceptEscrowJob,
  submitEscrowResult,
  validateEscrowJob,
  expireEscrowJob,
  getEscrowJob
} = escrowHelpers;

const {
  buildServiceStatus,
  computeServiceReputation,
  defaultAgentIdByCapability,
  ensureNetworkAgents,
  ensureServiceCatalog,
  evaluateServiceInvokeGuard,
  findNetworkAgentById,
  mapServiceReceipt,
  resolveAgentAddressesByIds,
  resolveAnalysisErrorStatus,
  sanitizeNetworkAgentRecord,
  sanitizeServiceRecord,
  selectServiceCandidatesByCapability,
  toPriceNumber
} = createServiceNetworkHelpers({
  ERC8004_AGENT_ID,
  ERC8004_IDENTITY_REGISTRY,
  ethers,
  HYPERLIQUID_ORDER_RECIPIENT,
  KITE_AGENT2_AA_ADDRESS,
  KITE_AGENT2_ID,
  MERCHANT_ADDRESS,
  SETTLEMENT_TOKEN,
  X402_BTC_PRICE,
  X402_HYPERLIQUID_ORDER_PRICE,
  X402_INFO_PRICE,
  X402_RISK_SCORE_PRICE,
  X402_TECHNICAL_PRICE,
  X402_UNIFIED_SERVICE_PRICE,
  X_READER_MAX_CHARS_DEFAULT,
  getUtcDateKey,
  isInfoAnalysisAction,
  isTechnicalAnalysisAction,
  normalizeAddress,
  normalizeAddresses,
  normalizeBtcPriceParams,
  normalizeRiskScoreParams,
  normalizeXReaderParams,
  parseAgentIdList,
  readNetworkAgents,
  readPublishedServices,
  resolveInfoSettlementRecipient,
  resolveTechnicalSettlementRecipient,
  writeNetworkAgents,
  writePublishedServices
});
const { buildTemplateRecordFromService, ensureTemplateCatalog } = createCatalogHelpers({
  ensureServiceCatalog,
  readTemplates,
  writeTemplates,
  createTemplateId
});
const messageProviderAnalysisService = createMessageProviderAnalysisService({
  analysisProvider: ANALYSIS_PROVIDER,
  messageProviderDefaultKeywords: MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
  messageProviderMarketDataFallback: MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
  openNews: {
    baseUrl: OPENNEWS_API_BASE,
    token: OPENNEWS_TOKEN,
    timeoutMs: OPENNEWS_TIMEOUT_MS,
    retries: OPENNEWS_RETRY,
    maxRows: OPENNEWS_MAX_ROWS
  },
  openTwitter: {
    baseUrl: OPENTWITTER_API_BASE,
    token: OPENTWITTER_TOKEN,
    timeoutMs: OPENTWITTER_TIMEOUT_MS,
    retries: OPENTWITTER_RETRY,
    maxRows: OPENTWITTER_MAX_ROWS
  },
  clampNumber,
  normalizeFreshIsoTimestamp,
  normalizeStringArray,
  normalizeInfoAnalysisResult,
  averageNumbers,
  normalizeXReaderParams,
  runMarketInfoAnalysis
});
const { runInfoAnalysis } = messageProviderAnalysisService;
const fetchXReaderDigest = createXReaderDigestFetcher({
  analysisProvider: ANALYSIS_PROVIDER,
  normalizeXReaderParams,
  runInfoAnalysis
});

function createServiceId() {
  return `svc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function createTemplateId() {
  return `tpl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

const {
  appendNetworkCommandEvent,
  createCommandId,
  extractNetworkCommandRefs,
  findNetworkCommandById,
  normalizeNetworkCommandPayload,
  normalizeNetworkCommandType,
  parseNetworkCommandFilterList,
  summarizeNetworkCommandExecution,
  upsertNetworkCommandRecord
} = createNetworkCommandHelpers({
  createTraceId,
  normalizeAddresses,
  parseAgentIdList,
  readNetworkCommands,
  writeNetworkCommands
});

const { executeNetworkCommand } = createNetworkCommandExecutionHelpers({
  PORT,
  appendNetworkCommandEvent,
  extractNetworkCommandRefs,
  fetchImpl: fetch,
  getInternalAgentApiKey,
  normalizeNetworkCommandPayload,
  normalizeNetworkCommandType,
  summarizeNetworkCommandExecution,
  upsertNetworkCommandRecord
});

const {
  buildBestServiceQuote,
  buildTaskPaymentFromIntent,
  buildTaskReceiptRef,
  getTaskEnvelopeInput,
  normalizeTaskFailure,
  parseJsonObjectFromText,
  pickBestServiceByReputationAndPrice
} = createRuntimeDecisionHelpers({
  KITE_AGENT2_AA_ADDRESS,
  SETTLEMENT_TOKEN,
  computeServiceReputation,
  defaultAgentIdByCapability,
  mapServiceReceipt,
  readServiceInvocations,
  readWorkflows,
  readX402Requests,
  selectServiceCandidatesByCapability,
  toPriceNumber
});

const {
  buildLocalTechnicalRecoveryDispatch,
  isLegacyBtcOnlyTechnicalFailure
} = createAgent001DispatchRecoveryHelpers({
  normalizeRiskScoreParams,
  runRiskScoreAnalysis
});

const {
  runAgent001DispatchTask
} = createAgent001DispatchHelpers({
  buildLocalTechnicalRecoveryDispatch,
  createTraceId,
  findNetworkAgentById,
  isLegacyBtcOnlyTechnicalFailure,
  normalizeAddress,
  waitMs
});

const {
  applyAgent001LocalFallback,
  buildAgent001DispatchSummary,
  maybePolishAgent001Reply
} = createAgent001ReplyHelpers({
  createTraceId,
  extractFirstUrlFromText,
  extractHorizonFromText,
  extractTradingSymbolFromText,
  fetchXReaderDigest,
  normalizeStringArray,
  normalizeXReaderParams,
  llmAdapter,
  runRiskScoreAnalysis
});

const agent001Orchestrator = createAgent001Orchestrator({
  normalizeAddress,
  readIdentityProfile,
  defaultAgentIdByCapability,
  ensureNetworkAgents,
  findNetworkAgentById,
  selectServiceCandidatesByCapability,
  readServiceInvocations,
  readWorkflows,
  readX402Requests,
  mapServiceReceipt,
  computeServiceReputation,
  pickBestServiceByReputationAndPrice,
  runAgent001DispatchTask,
  extractTradingSymbolFromText,
  extractHorizonFromText,
  extractFirstUrlFromText,
  buildRiskScorePaymentIntentForTask,
  buildInfoPaymentIntentForTask,
  createTraceId
});
const {
  selectAgent001ProviderPlan,
  runAgent001QuoteNegotiation,
  buildAgent001StrictPaymentPlan
} = agent001Orchestrator;
const agent001ExecutionService = createAgent001ExecutionService({
  fetchJsonResponseWithTimeout,
  buildInternalAgentHeaders,
  createTraceId,
  isTransientTransportError,
  waitMs,
  hasStrictX402Evidence,
  upsertAgent001ResultRecord,
  normalizeAddress,
  port: PORT
});
const {
  appendAgent001OrderExecutionLines,
  buildAgent001FailureReply,
  maybeSendAgent001ProgressDm,
  maybeSendAgent001TradePlanDm,
  runAgent001HyperliquidOrderWorkflow,
  runAgent001StopOrderWorkflow
} = agent001ExecutionService;
const agent001PlanningService = createAgent001PlanningService({
  parseAgent001OrderDirectives,
  extractTradingSymbolFromText,
  extractHorizonFromText,
  clampNumber,
  toRiskLevel
});
const {
  buildAgent001TradePlan,
  coerceAgent001ForcedTradePlan
} = agent001PlanningService;
const { handleAgent001TradeIntent } = createAgent001TradeFlowHelpers({
  appendAgent001OrderExecutionLines,
  buildAgent001FailureReply,
  buildAgent001StrictPaymentPlan,
  buildAgent001TradePlan,
  buildTaskReceiptRef,
  coerceAgent001ForcedTradePlan,
  extractTradingSymbolFromText,
  hasStrictX402Evidence,
  isAgent001ForceOrderRequested,
  isAgent001TaskSuccessful,
  maybeSendAgent001ProgressDm,
  maybeSendAgent001TradePlanDm,
  normalizeAddress,
  parseAgent001OrderDirectives,
  readSessionRuntime,
  runAgent001DispatchTask,
  runAgent001QuoteNegotiation,
  selectAgent001ProviderPlan,
  upsertAgent001ResultRecord
});
const { handleAgent001AnalysisIntent } = createAgent001AnalysisFlowHelpers({
  AGENT001_REQUIRE_X402,
  applyAgent001LocalFallback,
  buildAgent001DispatchSummary,
  buildAgent001FailureReply,
  buildAgent001StrictPaymentPlan,
  buildAgent001TradePlan,
  buildTaskReceiptRef,
  extractFirstUrlFromText,
  hasStrictX402Evidence,
  isAgent001TaskSuccessful,
  maybePolishAgent001Reply,
  maybeSendAgent001ProgressDm,
  maybeSendAgent001TradePlanDm,
  normalizeAddress,
  readSessionRuntime,
  runAgent001DispatchTask,
  runAgent001QuoteNegotiation,
  selectAgent001ProviderPlan,
  upsertAgent001ResultRecord
});
const { resolveAgent001ConversationEntry } = createAgent001ConversationGateHelpers({
  AGENT001_REQUIRE_X402,
  classifyAgent001IntentFallback,
  createTraceId,
  detectAgent001IntentOverrides,
  llmAdapter,
  parseJsonObjectFromText,
  resolveAgent001Intent
});
const {
  getAutoTradePlanStatus,
  runAutoTradePlanTick,
  startAutoTradePlanLoop,
  stopAutoTradePlanLoop
} = createAutoTradePlanLoop({
  state: autoTradePlanState,
  intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
  symbol: AUTO_TRADE_PLAN_SYMBOL,
  horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
  prompt: AUTO_TRADE_PLAN_PROMPT
});
const executeJobExpiry = createJobExpiryExecutor({
  readJobs,
  upsertJobRecord,
  expireEscrowJob,
  publishJobLifecycleAnchorOnChain,
  anchorRegistryRequired: Boolean(process.env.ERC8183_JOB_ANCHOR_REGISTRY)
});
const {
  getAutoJobExpiryStatus,
  runAutoJobExpiryTick,
  startAutoJobExpiryLoop,
  stopAutoJobExpiryLoop
} = createAutoJobExpiryLoop({
  state: autoJobExpiryState,
  intervalMs: KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
  readJobs,
  expireJob: executeJobExpiry
});

registerHealthRoutes(app, {
  getAutoJobExpiryStatus,
  kiteNetworkName: KITE_NETWORK_NAME,
  packageVersion: PACKAGE_VERSION,
  startedAtMs: STARTED_AT_MS
});

const {
  handleExecutorRuntimeTaskEnvelope,
  handlePriceRuntimeTaskEnvelope,
  handleReaderRuntimeTaskEnvelope,
  handleRiskRuntimeTaskEnvelope
} = createRuntimeTaskEnvelopeHelpers({
  X_READER_MAX_CHARS_DEFAULT,
  buildBestServiceQuote,
  buildTaskPaymentFromIntent,
  buildTaskReceiptRef,
  checkAnchorExistsOnChain,
  createTraceId,
  fetchBtcPriceQuote,
  fetchXReaderDigest,
  getTaskEnvelopeInput,
  normalizeBtcPriceParams,
  normalizeRiskScoreParams,
  normalizeTaskFailure,
  normalizeXReaderParams,
  llmAdapter,
  runRiskScoreAnalysis
});

function assertRouteDependencies(routeName = '', deps = {}, requiredKeys = []) {
  const missing = requiredKeys.filter((key) => typeof deps[key] === 'undefined');
  if (missing.length > 0) {
    throw new Error(
      `Missing required route dependencies for ${routeName}: ${missing.sort().join(', ')}`
    );
  }
}

const routeDeps = Object.freeze({
  PACKAGE_VERSION,
  PORT,
  BACKEND_RPC_URL,
  BACKEND_BUNDLER_URL,
  BACKEND_ENTRYPOINT_ADDRESS,
  KITE_AA_FACTORY_ADDRESS,
  KITE_AA_ACCOUNT_IMPLEMENTATION,
  SETTLEMENT_TOKEN,
  MERCHANT_ADDRESS,
  POLICY_MAX_PER_TX_DEFAULT,
  POLICY_DAILY_LIMIT_DEFAULT,
  KITE_AGENT1_ID,
  KITE_AGENT2_ID,
  KITE_AGENT2_AA_ADDRESS,
  KITE_REQUIRE_AA_V2,
  AA_V2_VERSION_TAG,
  KITE_AA_JOB_LANE_REQUIRED_VERSION,
  KITE_MIN_NATIVE_GAS,
  KITE_BUNDLER_RPC_TIMEOUT_MS,
  KITE_BUNDLER_RPC_RETRIES,
  BUNDLER_RPC_BACKOFF_POLICY,
  KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
  KITE_SESSION_PAY_RETRIES,
  KITE_ALLOW_EOA_RELAY_FALLBACK,
  KITE_ALLOW_BACKEND_USEROP_SIGN,
  KTRACE_ADMIN_KEY,
  KTRACE_JOB_APPROVAL_THRESHOLD,
  KTRACE_JOB_APPROVAL_TTL_MS,
  BACKEND_PUBLIC_URL,
  KTRACE_APPROVAL_RULES,
  ERC8004_AGENT_ID,
  ERC8004_IDENTITY_REGISTRY,
  ERC8183_DEFAULT_JOB_TIMEOUT_SEC,
  ERC8183_ESCROW_ADDRESS,
  ERC8183_REQUESTER_AA_ADDRESS,
  ERC8183_REQUESTER_OWNER_ADDRESS,
  ERC8183_EXECUTOR_AA_ADDRESS,
  ERC8183_EXECUTOR_OWNER_ADDRESS,
  ERC8183_EXECUTOR_STAKE_DEFAULT,
  ERC8183_VALIDATOR_AA_ADDRESS,
  ERC8183_VALIDATOR_OWNER_ADDRESS,
  ANALYSIS_PROVIDER,
  AUTH_DISABLED,
  API_KEY_ADMIN,
  API_KEY_AGENT,
  API_KEY_VIEWER,
  AGENT001_BIND_TIMEOUT_MS,
  AGENT001_PREBIND_ONLY,
  AGENT001_REQUIRE_X402,
  HYPERLIQUID_ORDER_RECIPIENT,
  IDENTITY_CHALLENGE_MAX_ROWS,
  IDENTITY_CHALLENGE_TTL_MS,
  IDENTITY_VERIFY_MODE,
  MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
  MESSAGE_PROVIDER_DISABLE_CLAWFEED,
  MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
  OPENNEWS_API_BASE,
  OPENNEWS_MAX_ROWS,
  OPENNEWS_RETRY,
  OPENNEWS_TIMEOUT_MS,
  OPENNEWS_TOKEN,
  OPENTWITTER_API_BASE,
  OPENTWITTER_MAX_ROWS,
  OPENTWITTER_RETRY,
  OPENTWITTER_TIMEOUT_MS,
  OPENTWITTER_TOKEN,
  PROOF_RPC_TIMEOUT_MS,
  PROOF_RPC_RETRIES,
  PROOF_RECEIPT_WAIT_MS,
  PROOF_RECEIPT_POLL_INTERVAL_MS,
  X402_BTC_PRICE,
  X402_REACTIVE_PRICE,
  X402_RISK_SCORE_PRICE,
  X402_X_READER_PRICE,
  X402_TECHNICAL_PRICE,
  X402_INFO_PRICE,
  X402_HYPERLIQUID_ORDER_PRICE,
  X402_UNIFIED_SERVICE_PRICE,
  X_READER_MAX_CHARS_DEFAULT,
  GokiteAASDK,
  crypto,
  ethers,
  path,
  llmAdapter,
  hyperliquidAdapter,
  persistenceStore,
  x402Path,
  sessionRuntimePath,
  authConfigured,
  extractApiKey,
  resolveRoleByApiKey,
  resolveAuthRequest,
  requireRole,
  normalizeAddress,
  normalizeAddresses,
  normalizeBtcPriceParams,
  normalizeReactiveParams,
  normalizeRiskScoreParams,
  normalizeXReaderParams,
  normalizeStringArray,
  normalizeNetworkCommandPayload,
  normalizeNetworkCommandType,
  normalizeTaskFailure,
  maskSecret,
  parseAgentIdList,
  parseAgent001OrderDirectives,
  parseExcerptMaxChars,
  parseJsonObjectFromText,
  parseNetworkCommandFilterList,
  fetchBtcPriceQuote,
  fetchXReaderDigest,
  createTraceId,
  createCommandId,
  createX402Request,
  appendReputationSignal,
  appendTrustPublication,
  appendValidationRecord,
  appendWorkflowStep,
  appendNetworkAuditEvent,
  appendNetworkCommandEvent,
  appendAgent001OrderExecutionLines,
  broadcastEvent,
  assertBackendSigner,
  ensureAAAccountDeployment,
  ensureNetworkAgents,
  ensureServiceCatalog,
  ensureTemplateCatalog,
  ensureWorkflowIdentityVerified,
  readAgent001Results,
  readIdentityChallenges,
  readOnboardingChallenges,
  readIdentityProfile,
  readJobs,
  readNetworkAgents,
  readNetworkCommands,
  readPolicyConfig,
  readPolicyFailures,
  readPublishedServices,
  readPurchases,
  readRecords,
  readAccountApiKeys,
  readReputationSignals,
  readConsumerIntents,
  readServiceInvocations,
  readSessionApprovalRequests,
  readSessionAuthorizations,
  readSessionRuntime,
  readTrustPublications,
  readValidationRecords,
  readWorkflows,
  readX402Requests,
  writeIdentityChallenges,
  writeOnboardingChallenges,
  writeJsonObject,
  writeNetworkAgents,
  writeNetworkCommands,
  writePolicyConfig,
  writePolicyFailures,
  writePublishedServices,
  writeAccountApiKeys,
  writeRecords,
  writeConsumerIntents,
  writeSessionApprovalRequests,
  writeSessionAuthorizations,
  writeSessionRuntime,
  writeTemplates,
  writeX402Requests,
  upsertAgent001ResultRecord,
  upsertJobRecord,
  upsertNetworkCommandRecord,
  upsertPurchaseRecord,
  upsertServiceInvocation,
  upsertWorkflow,
  buildA2ACapabilities,
  buildA2AReceipt,
  buildAgent001DispatchSummary,
  buildAgent001FailureReply,
  buildAgent001StrictPaymentPlan,
  buildAgent001TradePlan,
  buildBestServiceQuote,
  buildInfoPaymentIntentForTask,
  buildLatestWorkflowByRequestId,
  buildAuthorityPublicSummary,
  buildAuthoritySnapshot,
  buildLocalTechnicalRecoveryDispatch,
  buildNetworkRunSummaries,
  buildPaymentRequiredResponse,
  buildPolicySnapshot,
  buildPolicySnapshotHash,
  buildResponseHash,
  buildRiskScorePaymentIntentForTask,
  buildServiceStatus,
  buildTaskPaymentFromIntent,
  buildTaskReceiptRef,
  buildWorkflowFallbackAuditEvents,
  buildXReaderPaymentIntentForTask,
  checkAnchorExistsOnChain,
  classifyAgent001IntentFallback,
  classifySessionPayFailure,
  coerceAgent001ForcedTradePlan,
  computeServiceReputation,
  computeX402StatusCounts,
  defaultAgentIdByCapability,
  deriveNegotiationTermsFromAuditEvents,
  detectAgent001IntentOverrides,
  digestStableObject,
  evaluateServiceInvokeGuard,
  evaluateTransferPolicy,
  applyAgent001LocalFallback,
  acceptEscrowJob,
  executeNetworkCommand,
  expireEscrowJob,
  expireStaleX402PendingRequests,
  extractFirstUrlFromText,
  extractHorizonFromText,
  extractNetworkCommandRefs,
  extractTradingSymbolFromText,
  extractUserOpHashFromReason,
  findNetworkAgentById,
  findConsumerIntent,
  findNetworkCommandById,
  getActionConfig,
  getAutoTradePlanStatus,
  getEscrowJob,
  getInternalAgentApiKey,
  getLatestIdentityChallengeSnapshot,
  getServiceProviderBytes32,
  getSessionPayRetryBackoffMs,
  getTaskEnvelopeInput,
  getUtcDateKey,
  handleExecutorRuntimeTaskEnvelope,
  handlePriceRuntimeTaskEnvelope,
  handleReaderRuntimeTaskEnvelope,
  handleRiskRuntimeTaskEnvelope,
  hasStrictX402Evidence,
  isAgent001ForceOrderRequested,
  isAgent001TaskSuccessful,
  isInfoAnalysisAction,
  isLegacyBtcOnlyTechnicalFailure,
  isTechnicalAnalysisAction,
  issueIdentityChallenge,
  listNetworkAuditEventsByTraceId,
  lockEscrowFunds,
  preflightJobLaneCapability,
  prepareEscrowFunding,
  logPolicyFailure,
  mapServiceReceipt,
  markSessionPayFailure,
  markSessionPayRetry,
  markSessionPayRetryDelay,
  maybePolishAgent001Reply,
  maybeSendAgent001ProgressDm,
  maybeSendAgent001TradePlanDm,
  materializeAuthority,
  postSessionPayWithRetry,
  publishJobLifecycleAnchorOnChain,
  publishTrustPublicationOnChain,
  readLatestAnchorIdOnChain,
  resolveAgent001Intent,
  resolveAgentAddressesByIds,
  resolveAnalysisErrorStatus,
  resolveAuditQuoteFromPaymentIntent,
  resolveInfoSettlementRecipient,
  resolveSessionOwnerByAaWallet,
  resolveSessionOwnerPrivateKey,
  resolveSessionRuntime,
  resolveTechnicalSettlementRecipient,
  resolveWorkflowTraceId,
  runAgent001DispatchTask,
  runAgent001HyperliquidOrderWorkflow,
  runAgent001QuoteNegotiation,
  runRiskScoreAnalysis,
  sanitizeNetworkAgentRecord,
  sanitizeServiceRecord,
  selectAgent001ProviderPlan,
  selectServiceCandidatesByCapability,
  sendSessionTransferViaEoaRelay,
  sessionPayConfigSnapshot,
  sessionPayMetrics,
  shouldFallbackToEoaRelay,
  shouldRetrySessionPayCategory,
  signResponseHash,
  startAutoTradePlanLoop,
  stopAutoTradePlanLoop,
  submitEscrowResult,
  summarizeNetworkCommandExecution,
  toPriceNumber,
  validateEscrowJob,
  validateConsumerAuthority,
  validatePaymentProof,
  verifyIdentityChallengeResponse,
  verifyProofOnChain,
  beginConsumerIntent,
  finalizeConsumerIntent,
  revokeConsumerAuthorityPolicy,
  writeConsumerAuthorityPolicy,
  createOnboardingChallengeMessage: onboardingSetupHelpers.createOnboardingChallengeMessage,
  issueOnboardingAuthChallenge: onboardingSetupHelpers.issueOnboardingAuthChallenge,
  verifyOnboardingAuthChallenge: onboardingSetupHelpers.verifyOnboardingAuthChallenge,
  writeOnboardingAuthCookie: onboardingSetupHelpers.writeOnboardingAuthCookie,
  clearOnboardingAuthCookie: onboardingSetupHelpers.clearOnboardingAuthCookie,
  findActiveAccountApiKey: onboardingSetupHelpers.findActiveAccountApiKey,
  generateAccountApiKey: onboardingSetupHelpers.generateAccountApiKey,
  revokeAccountApiKey: onboardingSetupHelpers.revokeAccountApiKey,
  buildAccountApiKeyPublicRecord: onboardingSetupHelpers.buildAccountApiKeyPublicRecord,
  findPendingClaudeConnectorInstallCode: claudeConnectorAuthHelpers.findPendingInstallCodeByOwner,
  findActiveClaudeConnectorGrant: claudeConnectorAuthHelpers.findActiveGrantByOwner,
  issueClaudeConnectorInstallCode: claudeConnectorAuthHelpers.issueInstallCode,
  revokeClaudeConnectorGrant: claudeConnectorAuthHelpers.revokeGrant,
  resolveClaudeConnectorToken: claudeConnectorAuthHelpers.resolveConnectorToken,
  claimClaudeConnectorInstallCode: claudeConnectorAuthHelpers.claimInstallCode,
  touchClaudeConnectorGrantUsage: claudeConnectorAuthHelpers.touchGrantUsage,
  issueAgentConnectorCredential:
    claudeConnectorAuthHelpers.issueSessionConnector || claudeConnectorAuthHelpers.issueInstallCode,
  revokeAgentConnectorGrant: claudeConnectorAuthHelpers.revokeGrant,
  resolveAgentConnectorToken:
    claudeConnectorAuthHelpers.resolveAgentConnectorToken || claudeConnectorAuthHelpers.resolveConnectorToken,
  claimAgentConnectorInstallCode: claudeConnectorAuthHelpers.claimInstallCode,
  touchAgentConnectorGrantUsage: claudeConnectorAuthHelpers.touchGrantUsage,
  buildClaudeConnectorInstallCodePublicRecord: claudeConnectorAuthHelpers.buildInstallCodePublicRecord,
  buildClaudeConnectorGrantPublicRecord: claudeConnectorAuthHelpers.buildGrantPublicRecord,
  waitMs,
  withSessionUserOpLock,
  ERC8183_TRACE_ANCHOR_GUARD
});

const routeRegistrations = [
  {
    name: 'coreIdentityChatRoutes',
    register: registerCoreIdentityChatRoutes,
    requiredKeys: ['createTraceId', 'readSessionRuntime', 'requireRole', 'writeSessionRuntime']
  },
  {
    name: 'workflowA2aRoutes',
    register: registerWorkflowA2aRoutes,
    requiredKeys: [
      'appendReputationSignal',
      'appendTrustPublication',
      'buildPaymentRequiredResponse',
      'createX402Request',
      'ensureNetworkAgents',
      'publishTrustPublicationOnChain',
      'requireRole',
      'upsertWorkflow'
    ]
  },
  {
    name: 'marketAgentServiceRoutes',
    register: registerMarketAgentServiceRoutes,
    requiredKeys: [
      'appendReputationSignal',
      'appendTrustPublication',
      'createX402Request',
      'ensureNetworkAgents',
      'ensureServiceCatalog',
      'publishTrustPublicationOnChain',
      'requireRole',
      'upsertServiceInvocation'
    ]
  },
  {
    name: 'dataFeedRoutes',
    register: registerDataFeedRoutes,
    requiredKeys: ['requireRole']
  },
  {
    name: 'dailyNewsRoutes',
    register: registerDailyNewsRoutes,
    requiredKeys: ['requireRole']
  },
  {
    name: 'agentCardRoutes',
    register: registerAgentCardRoutes,
    requiredKeys: ['PACKAGE_VERSION', 'authConfigured']
  },
  {
    name: 'platformV1Routes',
    register: registerPlatformV1Routes,
    requiredKeys: ['ensureNetworkAgents', 'ensureServiceCatalog', 'ensureTemplateCatalog', 'requireRole']
  },
  {
    name: 'templateRoutes',
    register: registerTemplateRoutes,
    requiredKeys: ['ensureServiceCatalog', 'ensureTemplateCatalog', 'requireRole', 'writeTemplates']
  },
  {
    name: 'jobLaneRoutes',
    register: registerJobLaneRoutes,
    requiredKeys: ['readJobs', 'readSessionApprovalRequests', 'requireRole', 'upsertJobRecord', 'writeSessionApprovalRequests']
  },
  {
    name: 'trustSignalRoutes',
    register: registerTrustSignalRoutes,
    requiredKeys: ['appendReputationSignal', 'appendValidationRecord', 'readReputationSignals', 'readValidationRecords', 'requireRole']
  },
  {
    name: 'automationX402Routes',
    register: registerAutomationX402Routes,
    requiredKeys: ['buildPolicySnapshot', 'readSessionRuntime', 'readX402Requests', 'requireRole']
  },
  {
    name: 'mcpRoutes',
    register: registerMcpRoutes,
    requiredKeys: ['PACKAGE_VERSION', 'PORT', 'authConfigured', 'extractApiKey', 'getInternalAgentApiKey', 'resolveAuthRequest']
  },
  {
    name: 'x402DiscoveryRoutes',
    register: registerX402DiscoveryRoutes,
    requiredKeys: ['ensureServiceCatalog']
  }
];

for (const routeRegistration of routeRegistrations) {
  assertRouteDependencies(routeRegistration.name, routeDeps, routeRegistration.requiredKeys);
  routeRegistration.register(app, routeDeps);
}

scheduleX402PendingCleanup(5 * 60 * 1000);

const { startServer, shutdownServer } = createRuntimeServerLifecycle({
  app,
  autoJobExpiry: {
    enabled: KTRACE_AUTO_JOB_EXPIRY_ENABLED,
    intervalMs: KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    start: startAutoJobExpiryLoop
  },
  autoTradePlan: {
    enabled: AUTO_TRADE_PLAN_ENABLED,
    horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
    intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
    prompt: AUTO_TRADE_PLAN_PROMPT,
    start: startAutoTradePlanLoop,
    symbol: AUTO_TRADE_PLAN_SYMBOL
  },
  ensureNetworkAgents,
  ensureServiceCatalog,
  ensureTemplateCatalog,
  initializePersistence,
  parseAgentIdList,
  persistenceStore,
  port: PORT,
  stopAutoJobExpiryLoop,
  stopAutoTradePlanLoop
});

export { shutdownServer, startServer };

