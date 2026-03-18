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
import { createAutoXmtpNetworkLoop } from './lib/loops/xmtpLoop.js';
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
import { createLlmAdapter } from './services/llmAdapter.js';
import { createHyperliquidAdapter } from './services/hyperliquidAdapter.js';
import { createPersistenceStore } from './services/persistenceStore.js';
import { createMessageProviderAnalysisService } from './services/messageProviderAnalysisService.js';
import { createX402ReceiptService } from './services/x402ReceiptService.js';
import { createXmtpAgentRuntime } from './services/xmtpAgentRuntime.js';
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
import { registerXmtpNetworkRoutes } from './routes/xmtpNetworkRoutes.js';
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
import { createXmtpRuntimeRegistryHelpers } from './routes/xmtpRuntimeRegistryHelpers.js';
import { createServiceNetworkHelpers } from './routes/serviceNetworkHelpers.js';
import { createXmtpRouterService } from './services/xmtpRouterService.js';
import { registerMcpRoutes } from './mcp/mcpServer.js';
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
  workflowPath,
  identityChallengePath,
  servicesPath,
  templatesPath,
  serviceInvocationsPath,
  purchasesPath,
  jobsPath,
  reputationSignalsPath,
  validationRecordsPath,
  trustPublicationsPath,
  networkAgentsPath,
  xmtpEventsPath,
  xmtpGroupsPath,
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
  KITE_MIN_NATIVE_GAS,
  AA_V2_VERSION_TAG,
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
  XMTP_ROUTER_KEY_AVAILABLE,
  XMTP_RISK_KEY_AVAILABLE,
  XMTP_READER_KEY_AVAILABLE,
  XMTP_PRICE_KEY_AVAILABLE,
  XMTP_EXECUTOR_KEY_AVAILABLE,
  XMTP_ANY_KEY_AVAILABLE,
  XMTP_ENABLED_RAW,
  XMTP_ENABLED,
  XMTP_AUTO_ACK,
  XMTP_EVENT_RETENTION,
  XMTP_ENV,
  XMTP_API_URL,
  XMTP_HISTORY_SYNC_URL,
  XMTP_GATEWAY_HOST,
  XMTP_DB_ENCRYPTION_KEY,
  XMTP_DB_DIRECTORY,
  XMTP_WALLET_KEY,
  XMTP_ROUTER_WALLET_KEY,
  XMTP_RISK_WALLET_KEY,
  XMTP_READER_WALLET_KEY,
  XMTP_PRICE_WALLET_KEY,
  XMTP_EXECUTOR_WALLET_KEY,
  XMTP_ROUTER_AGENT_ADDRESS,
  XMTP_RISK_AGENT_ADDRESS,
  XMTP_READER_AGENT_ADDRESS,
  XMTP_PRICE_AGENT_ADDRESS,
  XMTP_EXECUTOR_AGENT_ADDRESS,
  XMTP_ROUTER_AGENT_AA_ADDRESS,
  XMTP_RISK_AGENT_AA_ADDRESS,
  XMTP_READER_AGENT_AA_ADDRESS,
  XMTP_PRICE_AGENT_AA_ADDRESS,
  XMTP_EXECUTOR_AGENT_AA_ADDRESS,
  XMTP_ROUTER_RUNTIME_ENABLED,
  XMTP_RISK_RUNTIME_ENABLED,
  XMTP_READER_RUNTIME_ENABLED,
  XMTP_PRICE_RUNTIME_ENABLED,
  XMTP_EXECUTOR_RUNTIME_ENABLED,
  XMTP_ANY_RUNTIME_ENABLED,
  XMTP_AUTO_NETWORK_ENABLED,
  XMTP_AUTO_NETWORK_INTERVAL_MS,
  XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
  XMTP_AUTO_NETWORK_TARGET_AGENT_IDS,
  XMTP_AUTO_NETWORK_CAPABILITY,
  XMTP_WORKERS_GROUP_LABEL,
  XMTP_WORKERS_GROUP_NAME,
  XMTP_WORKERS_GROUP_AGENT_IDS,
  AGENT001_REQUIRE_X402,
  AGENT001_PREBIND_ONLY,
  AGENT001_BIND_TIMEOUT_MS,
  ROLE_RANK,
  ROUTER_WALLET_KEY_NORMALIZED,
  RISK_WALLET_KEY_NORMALIZED,
  READER_WALLET_KEY_NORMALIZED,
  PRICE_WALLET_KEY_NORMALIZED,
  EXECUTOR_WALLET_KEY_NORMALIZED,
  ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED,
  ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED,
  ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED,
  XMTP_ROUTER_DERIVED_ADDRESS,
  XMTP_RISK_DERIVED_ADDRESS,
  XMTP_READER_DERIVED_ADDRESS,
  XMTP_PRICE_DERIVED_ADDRESS,
  XMTP_EXECUTOR_DERIVED_ADDRESS,
  ERC8183_REQUESTER_OWNER_ADDRESS,
  ERC8183_EXECUTOR_OWNER_ADDRESS,
  ERC8183_VALIDATOR_OWNER_ADDRESS,
  XMTP_ROUTER_RESOLVED_ADDRESS,
  XMTP_RISK_RESOLVED_ADDRESS,
  XMTP_READER_RESOLVED_ADDRESS,
  XMTP_PRICE_RESOLVED_ADDRESS,
  XMTP_EXECUTOR_RESOLVED_ADDRESS,
  XMTP_ROUTER_DB_DIRECTORY,
  XMTP_RISK_DB_DIRECTORY,
  XMTP_READER_DB_DIRECTORY,
  XMTP_PRICE_DB_DIRECTORY,
  XMTP_EXECUTOR_DB_DIRECTORY
} = runtimeConfig;
const { authConfigured, extractApiKey, resolveRoleByApiKey, requireRole } = createAuthHelpers({
  AUTH_DISABLED,
  API_KEY_ADMIN,
  API_KEY_AGENT,
  API_KEY_VIEWER,
  ROLE_RANK
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
  workflowPath,
  identityChallengePath,
  servicesPath,
  templatesPath,
  serviceInvocationsPath,
  purchasesPath,
  jobsPath,
  reputationSignalsPath,
  validationRecordsPath,
  trustPublicationsPath,
  networkAgentsPath,
  xmtpEventsPath,
  xmtpGroupsPath,
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

const autoXmtpNetworkState = {
  enabled: false,
  intervalMs: XMTP_AUTO_NETWORK_INTERVAL_MS,
  sourceAgentId: XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
  targetAgentIds: parseAgentIdList(XMTP_AUTO_NETWORK_TARGET_AGENT_IDS),
  capability: XMTP_AUTO_NETWORK_CAPABILITY || 'network-heartbeat',
  startedAt: '',
  lastTickAt: '',
  lastTraceId: '',
  lastRequestId: '',
  lastTaskId: '',
  lastTargetAgentId: '',
  lastStatus: '',
  lastError: '',
  sentCount: 0,
  failedCount: 0,
  cursor: 0
};

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
  readReputationSignals,
  writeReputationSignals,
  readValidationRecords,
  writeValidationRecords,
  readTrustPublications,
  writeTrustPublications,
  readNetworkAgents,
  writeNetworkAgents,
  ensureXmtpEventsStateLoaded,
  readXmtpEvents,
  writeXmtpEvents,
  readXmtpGroups,
  writeXmtpGroups,
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
    servicesPath,
    templatesPath,
    serviceInvocationsPath,
    purchasesPath,
    jobsPath,
    reputationSignalsPath,
    validationRecordsPath,
    trustPublicationsPath,
    networkAgentsPath,
    xmtpEventsPath,
    xmtpGroupsPath,
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
    ROUTER_WALLET_KEY_NORMALIZED,
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
    [ERC8183_VALIDATOR_AA_ADDRESS, ERC8183_VALIDATOR_OWNER_ADDRESS],
    [XMTP_ROUTER_AGENT_AA_ADDRESS, XMTP_ROUTER_DERIVED_ADDRESS],
    [XMTP_RISK_AGENT_AA_ADDRESS, XMTP_RISK_DERIVED_ADDRESS],
    [XMTP_READER_AGENT_AA_ADDRESS, XMTP_READER_DERIVED_ADDRESS],
    [XMTP_PRICE_AGENT_AA_ADDRESS, XMTP_PRICE_DERIVED_ADDRESS],
    [XMTP_EXECUTOR_AGENT_AA_ADDRESS, XMTP_EXECUTOR_DERIVED_ADDRESS]
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
  KITE_BUNDLER_RPC_TIMEOUT_MS,
  KITE_BUNDLER_RPC_RETRIES,
  BUNDLER_RPC_BACKOFF_POLICY,
  KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
});

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
  x402Price: X402_PRICE,
  xmtpReaderAgentAaAddress: XMTP_READER_AGENT_AA_ADDRESS,
  xmtpRiskAgentAaAddress: XMTP_RISK_AGENT_AA_ADDRESS
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
const escrowHelpers = createEscrowHelpers({
  backendSigner,
  ethers,
  escrowAddress: ERC8183_ESCROW_ADDRESS,
  settlementToken: SETTLEMENT_TOKEN,
  requesterPrivateKey: ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED,
  executorPrivateKey: ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED,
  validatorPrivateKey: ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED
});
const { lockEscrowFunds, acceptEscrowJob, submitEscrowResult, validateEscrowJob, expireEscrowJob, getEscrowJob } = escrowHelpers;

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
  XMTP_EXECUTOR_AGENT_AA_ADDRESS,
  XMTP_EXECUTOR_RESOLVED_ADDRESS,
  XMTP_PRICE_AGENT_AA_ADDRESS,
  XMTP_PRICE_RESOLVED_ADDRESS,
  XMTP_READER_AGENT_AA_ADDRESS,
  XMTP_READER_RESOLVED_ADDRESS,
  XMTP_ROUTER_AGENT_AA_ADDRESS,
  XMTP_ROUTER_RESOLVED_ADDRESS,
  XMTP_RISK_AGENT_AA_ADDRESS,
  XMTP_RISK_RESOLVED_ADDRESS,
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
  findXmtpGroupRecord,
  normalizeNetworkCommandPayload,
  normalizeNetworkCommandType,
  parseNetworkCommandFilterList,
  sanitizeXmtpGroupRecord,
  summarizeNetworkCommandExecution,
  upsertNetworkCommandRecord,
  upsertXmtpGroupRecord
} = createNetworkCommandHelpers({
  createTraceId,
  normalizeAddresses,
  parseAgentIdList,
  readNetworkCommands,
  readXmtpGroups,
  writeNetworkCommands,
  writeXmtpGroups
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
  isRecoverableXmtpFailure,
  runAgent001DispatchTask
} = createAgent001DispatchHelpers({
  XMTP_READER_RESOLVED_ADDRESS,
  XMTP_RISK_RESOLVED_ADDRESS,
  buildLocalTechnicalRecoveryDispatch,
  createTraceId,
  findNetworkAgentById,
  getReaderRuntime: () => xmtpReaderRuntime,
  getRiskRuntime: () => xmtpRiskRuntime,
  getRouterRuntime: () => xmtpRuntime,
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
  isRecoverableXmtpFailure,
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
  getXmtpRuntime: () => xmtpRuntime,
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
  getAllXmtpRuntimeStatuses: () => getAllXmtpRuntimeStatuses(),
  llmAdapter,
  parseJsonObjectFromText,
  resolveAgent001Intent
});
const { handleRouterRuntimeTextMessage } = createXmtpRouterService({
  handleAgent001AnalysisIntent,
  handleAgent001TradeIntent,
  resolveAgent001ConversationEntry
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
  prompt: AUTO_TRADE_PLAN_PROMPT,
  handleRouterRuntimeTextMessage
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

const {
  getAllXmtpRuntimeStatuses,
  startXmtpRuntimes,
  stopXmtpRuntimes,
  xmtpExecutorRuntime,
  xmtpPriceRuntime,
  xmtpReaderRuntime,
  xmtpRiskRuntime,
  xmtpRuntime
} = createXmtpRuntimeRegistryHelpers({
  createXmtpAgentRuntime,
  EXECUTOR_WALLET_KEY_NORMALIZED,
  findNetworkAgentById,
  handleExecutorRuntimeTaskEnvelope,
  handlePriceRuntimeTaskEnvelope,
  handleReaderRuntimeTaskEnvelope,
  handleRiskRuntimeTaskEnvelope,
  handleRouterRuntimeTextMessage,
  PRICE_WALLET_KEY_NORMALIZED,
  READER_WALLET_KEY_NORMALIZED,
  readXmtpEvents,
  RISK_WALLET_KEY_NORMALIZED,
  ROUTER_WALLET_KEY_NORMALIZED,
  writeXmtpEvents,
  XMTP_API_URL,
  XMTP_DB_ENCRYPTION_KEY,
  XMTP_ENV,
  XMTP_EVENT_RETENTION,
  XMTP_EXECUTOR_DB_DIRECTORY,
  XMTP_EXECUTOR_RUNTIME_ENABLED,
  XMTP_GATEWAY_HOST,
  XMTP_HISTORY_SYNC_URL,
  XMTP_PRICE_DB_DIRECTORY,
  XMTP_PRICE_RUNTIME_ENABLED,
  XMTP_READER_DB_DIRECTORY,
  XMTP_READER_RUNTIME_ENABLED,
  XMTP_RISK_DB_DIRECTORY,
  XMTP_RISK_RUNTIME_ENABLED,
  XMTP_ROUTER_DB_DIRECTORY,
  XMTP_ROUTER_RUNTIME_ENABLED
});
const {
  getAutoXmtpNetworkStatus,
  runAutoXmtpNetworkTick,
  startAutoXmtpNetworkLoop,
  stopAutoXmtpNetworkLoop
} = createAutoXmtpNetworkLoop({
  state: autoXmtpNetworkState,
  intervalMs: XMTP_AUTO_NETWORK_INTERVAL_MS,
  sourceAgentId: XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
  targetAgentIds: XMTP_AUTO_NETWORK_TARGET_AGENT_IDS,
  capability: XMTP_AUTO_NETWORK_CAPABILITY,
  findNetworkAgentById,
  xmtpRuntime,
  createTraceId
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
  SETTLEMENT_TOKEN,
  MERCHANT_ADDRESS,
  POLICY_MAX_PER_TX_DEFAULT,
  POLICY_DAILY_LIMIT_DEFAULT,
  KITE_AGENT1_ID,
  KITE_AGENT2_ID,
  KITE_AGENT2_AA_ADDRESS,
  KITE_REQUIRE_AA_V2,
  AA_V2_VERSION_TAG,
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
  XMTP_API_URL,
  XMTP_DB_ENCRYPTION_KEY,
  XMTP_ENV,
  XMTP_EVENT_RETENTION,
  XMTP_GATEWAY_HOST,
  XMTP_HISTORY_SYNC_URL,
  XMTP_ROUTER_RUNTIME_ENABLED,
  XMTP_ROUTER_DB_DIRECTORY,
  XMTP_ROUTER_DERIVED_ADDRESS,
  XMTP_ROUTER_RESOLVED_ADDRESS,
  XMTP_ROUTER_AGENT_AA_ADDRESS,
  XMTP_PRICE_RUNTIME_ENABLED,
  XMTP_PRICE_DB_DIRECTORY,
  XMTP_PRICE_RESOLVED_ADDRESS,
  XMTP_PRICE_AGENT_AA_ADDRESS,
  XMTP_READER_RUNTIME_ENABLED,
  XMTP_READER_DB_DIRECTORY,
  XMTP_READER_RESOLVED_ADDRESS,
  XMTP_READER_AGENT_AA_ADDRESS,
  XMTP_RISK_RUNTIME_ENABLED,
  XMTP_RISK_DB_DIRECTORY,
  XMTP_RISK_RESOLVED_ADDRESS,
  XMTP_RISK_AGENT_AA_ADDRESS,
  XMTP_EXECUTOR_RUNTIME_ENABLED,
  XMTP_EXECUTOR_DB_DIRECTORY,
  XMTP_EXECUTOR_RESOLVED_ADDRESS,
  XMTP_EXECUTOR_AGENT_AA_ADDRESS,
  XMTP_WORKERS_GROUP_AGENT_IDS,
  XMTP_WORKERS_GROUP_LABEL,
  XMTP_WORKERS_GROUP_NAME,
  ROUTER_WALLET_KEY_NORMALIZED,
  PRICE_WALLET_KEY_NORMALIZED,
  READER_WALLET_KEY_NORMALIZED,
  RISK_WALLET_KEY_NORMALIZED,
  EXECUTOR_WALLET_KEY_NORMALIZED,
  GokiteAASDK,
  crypto,
  ethers,
  path,
  llmAdapter,
  hyperliquidAdapter,
  persistenceStore,
  x402Path,
  sessionRuntimePath,
  xmtpRuntime,
  xmtpReaderRuntime,
  xmtpRiskRuntime,
  authConfigured,
  extractApiKey,
  resolveRoleByApiKey,
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
  createXmtpAgentRuntime,
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
  readIdentityProfile,
  readJobs,
  readNetworkAgents,
  readNetworkCommands,
  readPolicyConfig,
  readPolicyFailures,
  readPublishedServices,
  readPurchases,
  readRecords,
  readReputationSignals,
  readServiceInvocations,
  readSessionApprovalRequests,
  readSessionAuthorizations,
  readSessionRuntime,
  readTrustPublications,
  readValidationRecords,
  readWorkflows,
  readX402Requests,
  readXmtpEvents,
  readXmtpGroups,
  writeIdentityChallenges,
  writeJsonObject,
  writeNetworkAgents,
  writeNetworkCommands,
  writePolicyConfig,
  writePolicyFailures,
  writePublishedServices,
  writeRecords,
  writeSessionApprovalRequests,
  writeSessionAuthorizations,
  writeSessionRuntime,
  writeTemplates,
  writeX402Requests,
  writeXmtpEvents,
  writeXmtpGroups,
  upsertAgent001ResultRecord,
  upsertJobRecord,
  upsertNetworkCommandRecord,
  upsertPurchaseRecord,
  upsertServiceInvocation,
  upsertWorkflow,
  upsertXmtpGroupRecord,
  buildA2ACapabilities,
  buildA2AReceipt,
  buildAgent001DispatchSummary,
  buildAgent001FailureReply,
  buildAgent001StrictPaymentPlan,
  buildAgent001TradePlan,
  buildBestServiceQuote,
  buildInfoPaymentIntentForTask,
  buildLatestWorkflowByRequestId,
  buildLocalTechnicalRecoveryDispatch,
  buildNetworkRunSummaries,
  buildPaymentRequiredResponse,
  buildPolicySnapshot,
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
  findNetworkCommandById,
  findXmtpGroupRecord,
  getActionConfig,
  getAllXmtpRuntimeStatuses,
  getAutoTradePlanStatus,
  getAutoXmtpNetworkStatus,
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
  handleRouterRuntimeTextMessage,
  hasStrictX402Evidence,
  isAgent001ForceOrderRequested,
  isAgent001TaskSuccessful,
  isInfoAnalysisAction,
  isLegacyBtcOnlyTechnicalFailure,
  isRecoverableXmtpFailure,
  isTechnicalAnalysisAction,
  issueIdentityChallenge,
  listNetworkAuditEventsByTraceId,
  lockEscrowFunds,
  logPolicyFailure,
  mapServiceReceipt,
  markSessionPayFailure,
  markSessionPayRetry,
  markSessionPayRetryDelay,
  maybePolishAgent001Reply,
  maybeSendAgent001ProgressDm,
  maybeSendAgent001TradePlanDm,
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
  sanitizeXmtpGroupRecord,
  selectAgent001ProviderPlan,
  selectServiceCandidatesByCapability,
  sendSessionTransferViaEoaRelay,
  sessionPayConfigSnapshot,
  sessionPayMetrics,
  shouldFallbackToEoaRelay,
  shouldRetrySessionPayCategory,
  signResponseHash,
  startAutoTradePlanLoop,
  startAutoXmtpNetworkLoop,
  startXmtpRuntimes,
  stopAutoTradePlanLoop,
  stopAutoXmtpNetworkLoop,
  stopXmtpRuntimes,
  submitEscrowResult,
  summarizeNetworkCommandExecution,
  toPriceNumber,
  validateEscrowJob,
  validatePaymentProof,
  verifyIdentityChallengeResponse,
  verifyProofOnChain,
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
    requiredKeys: ['buildPaymentRequiredResponse', 'createX402Request', 'requireRole', 'upsertWorkflow']
  },
  {
    name: 'xmtpNetworkRoutes',
    register: registerXmtpNetworkRoutes,
    requiredKeys: ['createCommandId', 'executeNetworkCommand', 'findNetworkAgentById', 'requireRole']
  },
  {
    name: 'marketAgentServiceRoutes',
    register: registerMarketAgentServiceRoutes,
    requiredKeys: ['createX402Request', 'ensureServiceCatalog', 'requireRole', 'upsertServiceInvocation']
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
    requiredKeys: ['PACKAGE_VERSION', 'PORT', 'authConfigured', 'extractApiKey', 'getInternalAgentApiKey', 'resolveRoleByApiKey']
  }
];

for (const routeRegistration of routeRegistrations) {
  assertRouteDependencies(routeRegistration.name, routeDeps, routeRegistration.requiredKeys);
  routeRegistration.register(app, routeDeps);
}

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
  autoXmtp: {
    capability: XMTP_AUTO_NETWORK_CAPABILITY,
    enabled: XMTP_AUTO_NETWORK_ENABLED,
    intervalMs: XMTP_AUTO_NETWORK_INTERVAL_MS,
    sourceAgentId: XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
    start: startAutoXmtpNetworkLoop,
    targetAgentIds: XMTP_AUTO_NETWORK_TARGET_AGENT_IDS
  },
  ensureNetworkAgents,
  ensureServiceCatalog,
  ensureTemplateCatalog,
  initializePersistence,
  parseAgentIdList,
  persistenceStore,
  port: PORT,
  startXmtpRuntimes,
  stopAutoJobExpiryLoop,
  stopAutoTradePlanLoop,
  stopAutoXmtpNetworkLoop,
  stopXmtpRuntimes,
  xmtpAnyRuntimeEnabled: XMTP_ANY_RUNTIME_ENABLED
});

export { shutdownServer, startServer };


