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
import { registerJobLaneRoutes } from './routes/jobLaneRoutes.js';
import { registerTemplateRoutes } from './routes/templateRoutes.js';
import { registerTrustSignalRoutes } from './routes/trustSignalRoutes.js';
import { registerPlatformV1Routes } from './routes/platformV1Routes.js';
import { createIdentityVerificationHelpers } from './routes/identityVerificationHelpers.js';
import { createPaymentPolicyHelpers } from './routes/paymentPolicyHelpers.js';
import { createRuntimeSupportHelpers } from './routes/runtimeSupportHelpers.js';
import { createNetworkCommandHelpers } from './routes/networkCommandHelpers.js';
import { trustPublicationAnchorAbi } from './lib/contracts/trustPublicationAnchorAbi.js';
import { jobLifecycleAnchorAbi } from './lib/contracts/jobLifecycleAnchorAbi.js';
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

hydrateMessageProviderTokenFromLocalDocs();

const app = express();
const PORT = String(process.env.PORT || 3001).trim() || '3001';
const dataPath = path.resolve('data', 'records.json');
const x402Path = path.resolve('data', 'x402_requests.json');
const policyFailurePath = path.resolve('data', 'policy_failures.json');
const policyConfigPath = path.resolve('data', 'policy_config.json');
const sessionRuntimePath = path.resolve('data', 'session_runtime.json');
const sessionAuthorizationsPath = path.resolve('data', 'session_authorizations.json');
const workflowPath = path.resolve('data', 'workflows.json');
const identityChallengePath = path.resolve('data', 'identity_challenges.json');
const servicesPath = path.resolve('data', 'services.json');
const templatesPath = path.resolve('data', 'templates.json');
const serviceInvocationsPath = path.resolve('data', 'service_invocations.json');
const purchasesPath = path.resolve('data', 'purchases.json');
const jobsPath = path.resolve('data', 'jobs.json');
const reputationSignalsPath = path.resolve('data', 'reputation_signals.json');
const validationRecordsPath = path.resolve('data', 'validation_records.json');
const trustPublicationsPath = path.resolve('data', 'trust_publications.json');
const networkAgentsPath = path.resolve('data', 'network_agents.json');
const xmtpEventsPath = path.resolve('data', 'xmtp_events.json');
const xmtpGroupsPath = path.resolve('data', 'xmtp_groups.json');
const networkCommandsPath = path.resolve('data', 'network_commands.json');
const networkAuditPath = path.resolve('data', 'network_audit_events.json');
const agent001ResultsPath = path.resolve('data', 'agent001_results.json');

const SETTLEMENT_TOKEN =
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const MERCHANT_ADDRESS =
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const X402_UNIFIED_SERVICE_PRICE = String(process.env.X402_UNIFIED_SERVICE_PRICE || '0.00015').trim() || '0.00015';
const X402_PRICE = process.env.X402_PRICE || X402_UNIFIED_SERVICE_PRICE;
const KITE_AGENT2_AA_ADDRESS =
  process.env.KITE_AGENT2_AA_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8';
const X402_REACTIVE_PRICE = process.env.X402_REACTIVE_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_BTC_PRICE = process.env.X402_BTC_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_RISK_SCORE_PRICE = process.env.X402_RISK_SCORE_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_X_READER_PRICE = process.env.X402_X_READER_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_TECHNICAL_PRICE = process.env.X402_TECHNICAL_PRICE || X402_RISK_SCORE_PRICE;
const X402_INFO_PRICE = process.env.X402_INFO_PRICE || X402_X_READER_PRICE;
const X402_HYPERLIQUID_ORDER_PRICE = process.env.X402_HYPERLIQUID_ORDER_PRICE || X402_UNIFIED_SERVICE_PRICE;
const HYPERLIQUID_ORDER_RECIPIENT = normalizeAddress(
  String(process.env.X402_HYPERLIQUID_ORDER_RECIPIENT || process.env.HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS).trim()
);
const X402_TTL_MS = 10 * 60 * 1000;
const KITE_AGENT1_ID = process.env.KITE_AGENT1_ID || '1';
const KITE_AGENT2_ID = process.env.KITE_AGENT2_ID || '2';
const POLICY_MAX_PER_TX_DEFAULT = Number(process.env.KITE_POLICY_MAX_PER_TX || '0.20');
const POLICY_DAILY_LIMIT_DEFAULT = Number(process.env.KITE_POLICY_DAILY_LIMIT || '0.60');
const POLICY_ALLOWED_RECIPIENTS_DEFAULT = String(
  process.env.KITE_POLICY_ALLOWED_RECIPIENTS || `${MERCHANT_ADDRESS},${KITE_AGENT2_AA_ADDRESS}`
)
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const BACKEND_SIGNER_PRIVATE_KEY = process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const ENV_SESSION_PRIVATE_KEY = process.env.KITECLAW_SESSION_KEY || '';
const ENV_SESSION_ADDRESS = process.env.KITECLAW_SESSION_ADDRESS || '';
const ENV_SESSION_ID = process.env.KITECLAW_SESSION_ID || '';
const BACKEND_RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const BACKEND_BUNDLER_URL =
  process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/';
const BACKEND_ENTRYPOINT_ADDRESS =
  process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const KITE_MIN_NATIVE_GAS = String(process.env.KITE_MIN_NATIVE_GAS || '0.0001').trim();
const AA_V2_VERSION_TAG = String(
  process.env.KITE_AA_REQUIRED_VERSION || 'GokiteAccountV2-session-userop'
).trim();
const KITE_REQUIRE_AA_V2 = !/^(0|false|no|off)$/i.test(
  String(process.env.KITE_REQUIRE_AA_V2 || '1').trim()
);
const KITE_ALLOW_EOA_RELAY_FALLBACK = /^(1|true|yes|on)$/i.test(
  String(process.env.KITE_ALLOW_EOA_RELAY_FALLBACK || '0').trim()
);
const KITE_ALLOW_BACKEND_USEROP_SIGN = /^(1|true|yes|on)$/i.test(
  String(process.env.KITE_ALLOW_BACKEND_USEROP_SIGN || '0').trim()
);
const KITE_BUNDLER_RPC_TIMEOUT_MS = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS, 15_000, 2_000, 180_000);
const KITE_BUNDLER_RPC_RETRIES = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_RETRIES, 3, 1, 8);
const KITE_BUNDLER_RPC_BACKOFF_BASE_MS = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_BACKOFF_BASE_MS, 650, 100, 10_000);
const KITE_BUNDLER_RPC_BACKOFF_MAX_MS = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_BACKOFF_MAX_MS, 6_000, 200, 30_000);
const KITE_BUNDLER_RPC_BACKOFF_FACTOR = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_BACKOFF_FACTOR, 2, 1, 6);
const KITE_BUNDLER_RPC_BACKOFF_JITTER_MS = toBoundedIntEnv(
  process.env.KITE_BUNDLER_RPC_BACKOFF_JITTER_MS,
  Math.max(80, Math.round(KITE_BUNDLER_RPC_BACKOFF_BASE_MS / 2)),
  0,
  10_000
);
const KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS = toBoundedIntEnv(
  process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
  3_000,
  800,
  15_000
);
const KITE_SESSION_PAY_RETRIES = toBoundedIntEnv(process.env.KITE_SESSION_PAY_RETRIES, 3, 1, 8);
const KITE_SESSION_PAY_TRANSPORT_BACKOFF_BASE_MS = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_TRANSPORT_BACKOFF_BASE_MS,
  400,
  0,
  10_000
);
const KITE_SESSION_PAY_TRANSPORT_BACKOFF_MAX_MS = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_TRANSPORT_BACKOFF_MAX_MS,
  2_500,
  0,
  30_000
);
const KITE_SESSION_PAY_TRANSPORT_BACKOFF_JITTER_MS = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_TRANSPORT_BACKOFF_JITTER_MS,
  250,
  0,
  5_000
);
const KITE_SESSION_PAY_TRANSPORT_BACKOFF_FACTOR = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_TRANSPORT_BACKOFF_FACTOR,
  3,
  1,
  6
);
const KITE_SESSION_PAY_REPLACEMENT_BACKOFF_BASE_MS = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_REPLACEMENT_BACKOFF_BASE_MS,
  2_000,
  0,
  20_000
);
const KITE_SESSION_PAY_REPLACEMENT_BACKOFF_MAX_MS = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_REPLACEMENT_BACKOFF_MAX_MS,
  6_000,
  0,
  30_000
);
const KITE_SESSION_PAY_REPLACEMENT_BACKOFF_JITTER_MS = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_REPLACEMENT_BACKOFF_JITTER_MS,
  500,
  0,
  10_000
);
const KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR,
  2,
  1,
  6
);
const KITE_SESSION_PAY_METRICS_RECENT_LIMIT = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
  80,
  10,
  500
);
const KITE_NETWORK_AUDIT_MAX_EVENTS = toBoundedIntEnv(process.env.KITE_NETWORK_AUDIT_MAX_EVENTS, 20_000, 500, 200_000);

const BUNDLER_RPC_BACKOFF_POLICY = Object.freeze(
  normalizeBackoffPolicy({
    baseMs: KITE_BUNDLER_RPC_BACKOFF_BASE_MS,
    maxMs: KITE_BUNDLER_RPC_BACKOFF_MAX_MS,
    jitterMs: KITE_BUNDLER_RPC_BACKOFF_JITTER_MS,
    factor: KITE_BUNDLER_RPC_BACKOFF_FACTOR
  })
);

const SESSION_PAY_TRANSPORT_BACKOFF_POLICY = Object.freeze(
  normalizeBackoffPolicy({
    baseMs: KITE_SESSION_PAY_TRANSPORT_BACKOFF_BASE_MS,
    maxMs: KITE_SESSION_PAY_TRANSPORT_BACKOFF_MAX_MS,
    jitterMs: KITE_SESSION_PAY_TRANSPORT_BACKOFF_JITTER_MS,
    factor: KITE_SESSION_PAY_TRANSPORT_BACKOFF_FACTOR
  })
);

const SESSION_PAY_REPLACEMENT_BACKOFF_POLICY = Object.freeze(
  normalizeBackoffPolicy({
    baseMs: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_BASE_MS,
    maxMs: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_MAX_MS,
    jitterMs: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_JITTER_MS,
    factor: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR
  })
);
const PROOF_RPC_TIMEOUT_MS = Number(process.env.KITE_PROOF_RPC_TIMEOUT_MS || 10_000);
const PROOF_RPC_RETRIES = Number(process.env.KITE_PROOF_RPC_RETRIES || 3);
const PROOF_RECEIPT_WAIT_MS = Number(process.env.KITE_PROOF_RECEIPT_WAIT_MS || 45_000);
const PROOF_RECEIPT_POLL_INTERVAL_MS = Number(process.env.KITE_PROOF_RECEIPT_POLL_INTERVAL_MS || 2_500);
const LLM_BASE_URL = String(process.env.LLM_BASE_URL || '').trim();
const LLM_CHAT_PATH = String(process.env.LLM_CHAT_PATH || '/v1/chat/completions').trim();
const LLM_HEALTH_PATH = String(process.env.LLM_HEALTH_PATH || '/v1/models').trim();
const LLM_API_KEY = String(process.env.LLM_API_KEY || '').trim();
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 12_000);
const LLM_CHAT_PROTOCOL = String(process.env.LLM_CHAT_PROTOCOL || 'auto').trim().toLowerCase();
const LLM_MODEL = String(process.env.LLM_MODEL || '').trim();
const AGENT001_MODEL_PRIMARY = String(process.env.AGENT001_MODEL_PRIMARY || LLM_MODEL || '').trim();
const AGENT001_MODEL_FALLBACK = String(process.env.AGENT001_MODEL_FALLBACK || '').trim();
const AGENT_WORKER_MODEL = String(process.env.AGENT_WORKER_MODEL || '').trim();
const LLM_AGENT_MODELS = parseEnvAgentModelMap(process.env.LLM_AGENT_MODELS || '');
const LLM_AGENT_FALLBACK_MODELS = parseEnvAgentFallbackModelMap(process.env.LLM_AGENT_FALLBACK_MODELS || '');
const LLM_MODEL_FALLBACKS = parseEnvCsvList(process.env.LLM_MODEL_FALLBACKS || '');
const LLM_SYSTEM_PROMPT = String(process.env.LLM_SYSTEM_PROMPT || '').trim();
const HYPERLIQUID_TESTNET_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.HYPERLIQUID_TESTNET_ENABLED || '0').trim()
);
const HYPERLIQUID_TESTNET_PRIVATE_KEY = normalizePrivateKey(
  String(process.env.HYPERLIQUID_TESTNET_PRIVATE_KEY || '').trim()
);
const HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS = normalizeAddress(
  String(process.env.HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS || '').trim()
);
const HYPERLIQUID_TESTNET_API_URL = String(process.env.HYPERLIQUID_TESTNET_API_URL || '').trim();
const HYPERLIQUID_TESTNET_TIMEOUT_MS = Math.max(
  3000,
  Math.min(Number(process.env.HYPERLIQUID_TESTNET_TIMEOUT_MS || 12_000), 120_000)
);
const HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS = Math.max(
  1,
  Math.min(Number(process.env.HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS || 30), 1000)
);
const ANALYSIS_PROVIDER = 'market-data';
const OPENNEWS_API_BASE = String(process.env.OPENNEWS_API_BASE || 'https://ai.6551.io').trim().replace(/\/+$/, '');
const OPENNEWS_TOKEN = String(process.env.OPENNEWS_TOKEN || process.env.KITE_MESSAGE_PROVIDER_TOKEN || '').trim();
const OPENNEWS_TIMEOUT_MS = Math.max(2500, Math.min(Number(process.env.OPENNEWS_TIMEOUT_MS || 8000), 120000));
const OPENNEWS_RETRY = Math.max(0, Math.min(Number(process.env.OPENNEWS_RETRY || 1), 3));
const OPENNEWS_MAX_ROWS = Math.max(1, Math.min(Number(process.env.OPENNEWS_MAX_ROWS || 8), 50));
const OPENTWITTER_API_BASE = String(process.env.TWITTER_API_BASE || 'https://ai.6551.io')
  .trim()
  .replace(/\/+$/, '');
const OPENTWITTER_TOKEN = String(
  process.env.TWITTER_TOKEN || process.env.OPENNEWS_TOKEN || process.env.KITE_MESSAGE_PROVIDER_TOKEN || ''
).trim();
const OPENTWITTER_TIMEOUT_MS = Math.max(2500, Math.min(Number(process.env.TWITTER_TIMEOUT_MS || 8000), 120000));
const OPENTWITTER_RETRY = Math.max(0, Math.min(Number(process.env.TWITTER_RETRY || 1), 3));
const OPENTWITTER_MAX_ROWS = Math.max(1, Math.min(Number(process.env.TWITTER_MAX_ROWS || 8), 50));
const MESSAGE_PROVIDER_DEFAULT_KEYWORDS = String(process.env.MESSAGE_PROVIDER_DEFAULT_KEYWORDS || 'BTC,AI,美股,ETH')
  .split(',')
  .map((item) => String(item || '').trim())
  .filter(Boolean)
  .slice(0, 24);
const MESSAGE_PROVIDER_DISABLE_CLAWFEED = !/^(0|false|no|off)$/i.test(
  String(process.env.MESSAGE_PROVIDER_DISABLE_CLAWFEED || '1').trim()
);
const MESSAGE_PROVIDER_MARKET_DATA_FALLBACK = !/^(0|false|no|off)$/i.test(
  String(process.env.MESSAGE_PROVIDER_MARKET_DATA_FALLBACK || '0').trim()
);
const ERC8004_IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const ERC8004_AGENT_ID_RAW = process.env.ERC8004_AGENT_ID || '';
const ERC8004_AGENT_ID = Number.isFinite(Number(ERC8004_AGENT_ID_RAW))
  ? Number(ERC8004_AGENT_ID_RAW)
  : null;
const ERC8004_TRUST_ANCHOR_REGISTRY = process.env.ERC8004_TRUST_ANCHOR_REGISTRY || '';
const ERC8183_JOB_ANCHOR_REGISTRY = process.env.ERC8183_JOB_ANCHOR_REGISTRY || '';
const API_KEY_ADMIN = String(process.env.KITECLAW_API_KEY_ADMIN || '').trim();
const API_KEY_AGENT = String(process.env.KITECLAW_API_KEY_AGENT || '').trim();
const API_KEY_VIEWER = String(process.env.KITECLAW_API_KEY_VIEWER || '').trim();
const AUTH_DISABLED = /^(1|true|yes|on)$/i.test(String(process.env.KITECLAW_AUTH_DISABLED || '').trim());
const RATE_LIMIT_WINDOW_MS = Number(process.env.KITECLAW_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.KITECLAW_RATE_LIMIT_MAX || 240);
const IDENTITY_CHALLENGE_TTL_MS = Number(process.env.IDENTITY_CHALLENGE_TTL_MS || 120_000);
const IDENTITY_CHALLENGE_MAX_ROWS = Number(process.env.IDENTITY_CHALLENGE_MAX_ROWS || 500);
const IDENTITY_VERIFY_MODE = String(process.env.IDENTITY_VERIFY_MODE || 'signature').trim().toLowerCase();
const AUTO_TRADE_PLAN_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.AUTO_TRADE_PLAN_ENABLED || '').trim());
const AUTO_TRADE_PLAN_INTERVAL_MS = Math.max(60_000, Number(process.env.AUTO_TRADE_PLAN_INTERVAL_MS || 600_000));
const AUTO_TRADE_PLAN_SYMBOL = String(process.env.AUTO_TRADE_PLAN_SYMBOL || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
const AUTO_TRADE_PLAN_HORIZON_MIN = Math.max(5, Math.min(Number(process.env.AUTO_TRADE_PLAN_HORIZON_MIN || 60), 1440));
const AUTO_TRADE_PLAN_PROMPT = String(process.env.AUTO_TRADE_PLAN_PROMPT || '').trim();
const X_READER_MAX_CHARS_DEFAULT = Math.max(200, Math.min(8000, Number(process.env.X_READER_MAX_CHARS_DEFAULT || 1200)));
const XMTP_ROUTER_KEY_AVAILABLE = Boolean(
  String(process.env.XMTP_ROUTER_WALLET_KEY || process.env.XMTP_WALLET_KEY || '').trim()
);
const XMTP_RISK_KEY_AVAILABLE = Boolean(String(process.env.XMTP_RISK_WALLET_KEY || '').trim());
const XMTP_READER_KEY_AVAILABLE = Boolean(String(process.env.XMTP_READER_WALLET_KEY || '').trim());
const XMTP_PRICE_KEY_AVAILABLE = Boolean(String(process.env.XMTP_PRICE_WALLET_KEY || '').trim());
const XMTP_EXECUTOR_KEY_AVAILABLE = Boolean(String(process.env.XMTP_EXECUTOR_WALLET_KEY || '').trim());
const XMTP_ANY_KEY_AVAILABLE =
  XMTP_ROUTER_KEY_AVAILABLE ||
  XMTP_RISK_KEY_AVAILABLE ||
  XMTP_READER_KEY_AVAILABLE ||
  XMTP_PRICE_KEY_AVAILABLE ||
  XMTP_EXECUTOR_KEY_AVAILABLE;
const XMTP_ENABLED_RAW = String(process.env.XMTP_ENABLED || '').trim();
const XMTP_ENABLED = XMTP_ENABLED_RAW
  ? /^(1|true|yes|on)$/i.test(XMTP_ENABLED_RAW)
  : XMTP_ANY_KEY_AVAILABLE;
const XMTP_AUTO_ACK = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_AUTO_ACK || '').trim());
const XMTP_EVENT_RETENTION = Math.max(50, Math.min(Number(process.env.XMTP_EVENT_RETENTION || 600), 5000));
const XMTP_ENV = String(process.env.XMTP_ENV || 'dev').trim().toLowerCase() || 'dev';
const XMTP_API_URL = String(process.env.XMTP_API_URL || '').trim();
const XMTP_HISTORY_SYNC_URL = String(process.env.XMTP_HISTORY_SYNC_URL || '').trim();
const XMTP_GATEWAY_HOST = String(process.env.XMTP_GATEWAY_HOST || '').trim();
const XMTP_DB_ENCRYPTION_KEY = String(process.env.XMTP_DB_ENCRYPTION_KEY || '').trim();
const XMTP_DB_DIRECTORY = String(process.env.XMTP_DB_DIRECTORY || './data/xmtp-db').trim();
const XMTP_WALLET_KEY = String(process.env.XMTP_WALLET_KEY || '').trim();
const XMTP_ROUTER_WALLET_KEY = String(process.env.XMTP_ROUTER_WALLET_KEY || XMTP_WALLET_KEY).trim();
const XMTP_RISK_WALLET_KEY = String(process.env.XMTP_RISK_WALLET_KEY || '').trim();
const XMTP_READER_WALLET_KEY = String(process.env.XMTP_READER_WALLET_KEY || '').trim();
const XMTP_PRICE_WALLET_KEY = String(process.env.XMTP_PRICE_WALLET_KEY || '').trim();
const XMTP_EXECUTOR_WALLET_KEY = String(process.env.XMTP_EXECUTOR_WALLET_KEY || '').trim();
const XMTP_ROUTER_AGENT_ADDRESS = String(process.env.XMTP_ROUTER_AGENT_ADDRESS || '').trim();
const XMTP_RISK_AGENT_ADDRESS = String(process.env.XMTP_RISK_AGENT_ADDRESS || '').trim();
const XMTP_READER_AGENT_ADDRESS = String(process.env.XMTP_READER_AGENT_ADDRESS || '').trim();
const XMTP_PRICE_AGENT_ADDRESS = String(process.env.XMTP_PRICE_AGENT_ADDRESS || '').trim();
const XMTP_EXECUTOR_AGENT_ADDRESS = String(process.env.XMTP_EXECUTOR_AGENT_ADDRESS || '').trim();
const XMTP_ROUTER_AGENT_AA_ADDRESS = String(process.env.XMTP_ROUTER_AGENT_AA_ADDRESS || '').trim();
const XMTP_RISK_AGENT_AA_ADDRESS = String(process.env.XMTP_RISK_AGENT_AA_ADDRESS || '').trim();
const XMTP_READER_AGENT_AA_ADDRESS = String(process.env.XMTP_READER_AGENT_AA_ADDRESS || '').trim();
const XMTP_PRICE_AGENT_AA_ADDRESS = String(process.env.XMTP_PRICE_AGENT_AA_ADDRESS || '').trim();
const XMTP_EXECUTOR_AGENT_AA_ADDRESS = String(process.env.XMTP_EXECUTOR_AGENT_AA_ADDRESS || '').trim();
const XMTP_ROUTER_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_ROUTER_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_ROUTER_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_RISK_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_RISK_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_RISK_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_READER_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_READER_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_READER_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_PRICE_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_PRICE_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_PRICE_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_EXECUTOR_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_EXECUTOR_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_EXECUTOR_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_ANY_RUNTIME_ENABLED =
  XMTP_ROUTER_RUNTIME_ENABLED ||
  XMTP_RISK_RUNTIME_ENABLED ||
  XMTP_READER_RUNTIME_ENABLED ||
  XMTP_PRICE_RUNTIME_ENABLED ||
  XMTP_EXECUTOR_RUNTIME_ENABLED;
const XMTP_AUTO_NETWORK_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_AUTO_NETWORK_ENABLED || '').trim());
const XMTP_AUTO_NETWORK_INTERVAL_MS = Math.max(15_000, Number(process.env.XMTP_AUTO_NETWORK_INTERVAL_MS || 60_000));
const XMTP_AUTO_NETWORK_SOURCE_AGENT_ID = String(process.env.XMTP_AUTO_NETWORK_SOURCE_AGENT_ID || 'router-agent').trim().toLowerCase();
const XMTP_AUTO_NETWORK_TARGET_AGENT_IDS = String(process.env.XMTP_AUTO_NETWORK_TARGET_AGENT_IDS || 'risk-agent,reader-agent').trim();
const XMTP_AUTO_NETWORK_CAPABILITY = String(process.env.XMTP_AUTO_NETWORK_CAPABILITY || 'network-heartbeat').trim();
const XMTP_WORKERS_GROUP_LABEL = String(process.env.XMTP_WORKERS_GROUP_LABEL || 'workers-group').trim();
const XMTP_WORKERS_GROUP_NAME = String(process.env.XMTP_WORKERS_GROUP_NAME || 'Agent001 + Workers').trim();
const XMTP_WORKERS_GROUP_AGENT_IDS = String(
  process.env.XMTP_WORKERS_GROUP_AGENT_IDS || 'risk-agent,reader-agent,price-agent,executor-agent'
).trim();
const AGENT001_REQUIRE_X402 = true;
const AGENT001_PREBIND_ONLY = !/^(0|false|no|off)$/i.test(
  String(process.env.AGENT001_PREBIND_ONLY || '1').trim()
);
const AGENT001_BIND_TIMEOUT_MS = Math.max(
  30_000,
  Math.min(Number(process.env.AGENT001_BIND_TIMEOUT_MS || 210_000), 300_000)
);

const ROLE_RANK = {
  viewer: 1,
  agent: 2,
  admin: 3
};
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
  networkCommandsPath,
  networkAuditPath,
  agent001ResultsPath
];
const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath];
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
  sessionAuthorizationsPath,
  envSessionPrivateKey: ENV_SESSION_PRIVATE_KEY,
  envSessionAddress: ENV_SESSION_ADDRESS,
  envSessionId: ENV_SESSION_ID
});
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

const ROUTER_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_ROUTER_WALLET_KEY);
const RISK_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_RISK_WALLET_KEY);
const READER_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_READER_WALLET_KEY);
const PRICE_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_PRICE_WALLET_KEY);
const EXECUTOR_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_EXECUTOR_WALLET_KEY);
const XMTP_ROUTER_DERIVED_ADDRESS = deriveAddressFromPrivateKey(ROUTER_WALLET_KEY_NORMALIZED);
const XMTP_RISK_DERIVED_ADDRESS = deriveAddressFromPrivateKey(RISK_WALLET_KEY_NORMALIZED);
const XMTP_READER_DERIVED_ADDRESS = deriveAddressFromPrivateKey(READER_WALLET_KEY_NORMALIZED);
const XMTP_PRICE_DERIVED_ADDRESS = deriveAddressFromPrivateKey(PRICE_WALLET_KEY_NORMALIZED);
const XMTP_EXECUTOR_DERIVED_ADDRESS = deriveAddressFromPrivateKey(EXECUTOR_WALLET_KEY_NORMALIZED);
const XMTP_ROUTER_RESOLVED_ADDRESS = normalizeAddress(XMTP_ROUTER_AGENT_ADDRESS || XMTP_ROUTER_DERIVED_ADDRESS || '');
const XMTP_RISK_RESOLVED_ADDRESS = normalizeAddress(XMTP_RISK_AGENT_ADDRESS || XMTP_RISK_DERIVED_ADDRESS || '');
const XMTP_READER_RESOLVED_ADDRESS = normalizeAddress(XMTP_READER_AGENT_ADDRESS || XMTP_READER_DERIVED_ADDRESS || '');
const XMTP_PRICE_RESOLVED_ADDRESS = normalizeAddress(XMTP_PRICE_AGENT_ADDRESS || XMTP_PRICE_DERIVED_ADDRESS || '');
const XMTP_EXECUTOR_RESOLVED_ADDRESS = normalizeAddress(
  XMTP_EXECUTOR_AGENT_ADDRESS || XMTP_EXECUTOR_DERIVED_ADDRESS || ''
);
const XMTP_ROUTER_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'router-agent');
const XMTP_RISK_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'risk-agent');
const XMTP_READER_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'reader-agent');
const XMTP_PRICE_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'price-agent');
const XMTP_EXECUTOR_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'executor-agent');

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



const rateLimitStore = new Map();
function getRateKey(req) {
  const key = extractApiKey(req);
  if (key) return `k:${key.slice(0, 8)}`;
  return `ip:${String(req.ip || req.socket?.remoteAddress || 'unknown')}`;
}

function apiRateLimit(req, res, next) {
  const now = Date.now();
  const key = getRateKey(req);
  const current = rateLimitStore.get(key);
  if (!current || now - current.startMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { startMs: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      reason: 'Too many API requests',
      traceId: req.traceId || ''
    });
  }
  return next();
}

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

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const incoming =
    String(req.headers['x-trace-id'] || '').trim() ||
    String(req.query.traceId || '').trim() ||
    String(req.body?.traceId || '').trim();
  const traceId = incoming || createTraceId('req');
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
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
const { publishTrustPublicationOnChain, publishJobLifecycleAnchorOnChain } = createOnchainAnchorHelpers({
  backendSigner,
  digestStableObject,
  erc8004TrustAnchorRegistry: ERC8004_TRUST_ANCHOR_REGISTRY,
  erc8183JobAnchorRegistry: ERC8183_JOB_ANCHOR_REGISTRY,
  ethers,
  jobLifecycleAnchorAbi,
  trustPublicationAnchorAbi
});

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

function createRouteDepsProxy() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop)) return undefined;
        try {
          return eval(prop);
        } catch {
          return undefined;
        }
      }
    }
  );
}

const routeDeps = createRouteDepsProxy();

registerCoreIdentityChatRoutes(app, routeDeps);
registerWorkflowA2aRoutes(app, routeDeps);
registerXmtpNetworkRoutes(app, routeDeps);
registerMarketAgentServiceRoutes(app, routeDeps);
registerPlatformV1Routes(app, routeDeps);
registerTemplateRoutes(app, routeDeps);
registerJobLaneRoutes(app, routeDeps);
registerTrustSignalRoutes(app, routeDeps);
registerAutomationX402Routes(app, routeDeps);

let httpServer = null;

function logXmtpRuntimeStartup(name = '', runtimeStatus = null) {
  if (!runtimeStatus?.enabled) return;
  if (runtimeStatus?.running) {
    console.log(
      `[xmtp/${name}] env=${runtimeStatus.env} address=${runtimeStatus.address || '-'} inbox=${runtimeStatus.inboxId || '-'}`
    );
    return;
  }
  console.warn(`[xmtp/${name}] failed to start: ${runtimeStatus?.lastError || 'unknown_error'}`);
}

export async function startServer() {
  await initializePersistence();
  ensureServiceCatalog();
  ensureTemplateCatalog();
  ensureNetworkAgents();
  httpServer = app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    if (AUTO_TRADE_PLAN_ENABLED) {
      startAutoTradePlanLoop({
        intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
        symbol: AUTO_TRADE_PLAN_SYMBOL,
        horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
        prompt: AUTO_TRADE_PLAN_PROMPT,
        immediate: true,
        reason: 'startup'
      });
      console.log(
        `[auto-trade-plan] enabled intervalMs=${AUTO_TRADE_PLAN_INTERVAL_MS} symbol=${AUTO_TRADE_PLAN_SYMBOL} horizon=${AUTO_TRADE_PLAN_HORIZON_MIN}m`
      );
    }
  });
  if (XMTP_ANY_RUNTIME_ENABLED) {
    const status = await startXmtpRuntimes();
    logXmtpRuntimeStartup('router', status?.router);
    logXmtpRuntimeStartup('risk', status?.risk);
    logXmtpRuntimeStartup('reader', status?.reader);
    logXmtpRuntimeStartup('price', status?.price);
    logXmtpRuntimeStartup('executor', status?.executor);
    if (status?.router?.running && XMTP_AUTO_NETWORK_ENABLED) {
      startAutoXmtpNetworkLoop({
        intervalMs: XMTP_AUTO_NETWORK_INTERVAL_MS,
        sourceAgentId: XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
        targetAgentIds: XMTP_AUTO_NETWORK_TARGET_AGENT_IDS,
        capability: XMTP_AUTO_NETWORK_CAPABILITY,
        immediate: true,
        reason: 'startup'
      });
      console.log(
        `[auto-xmtp] enabled intervalMs=${XMTP_AUTO_NETWORK_INTERVAL_MS} source=${XMTP_AUTO_NETWORK_SOURCE_AGENT_ID} targets=${parseAgentIdList(XMTP_AUTO_NETWORK_TARGET_AGENT_IDS).join(',')}`
      );
    }
  }
}

export async function shutdownServer() {
  stopAutoTradePlanLoop();
  stopAutoXmtpNetworkLoop();
  await stopXmtpRuntimes();
  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
  } catch {
    // ignore server close errors
  }
  await persistenceStore.close();
}


