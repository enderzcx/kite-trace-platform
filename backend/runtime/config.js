import fs from 'fs';
import path from 'path';

import {
  parseEnvAgentFallbackModelMap,
  parseEnvAgentModelMap,
  parseEnvCsvList,
  toBoundedIntEnv
} from '../lib/env.js';
import {
  DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION,
  DEFAULT_KITE_AA_REQUIRED_VERSION,
  DEFAULT_KITE_AA_ACCOUNT_IMPLEMENTATION,
  DEFAULT_KITE_AA_FACTORY_ADDRESS
} from '../lib/aaConfig.js';
import {
  applyNodeEnvProxyPreference,
  getEnvProxyDiagnostics,
  shouldUseEnvProxy
} from '../lib/envProxy.js';
import {
  deriveAddressFromPrivateKey,
  normalizeAddress,
  normalizePrivateKey
} from '../lib/addressPolicyHelpers.js';

function normalizeApprovalRuleValue(value = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.toLowerCase() : '';
}

function parseApprovalRules(raw = '') {
  const normalized = String(raw || '').trim();
  if (!normalized) return Object.freeze([]);
  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    const rules = parsed
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const threshold = Number(item.threshold);
        if (!Number.isFinite(threshold) || threshold <= 0) return null;
        const provider = normalizeApprovalRuleValue(item.provider || '');
        const capability = normalizeApprovalRuleValue(item.capability || '');
        return Object.freeze({
          provider: provider || '*',
          capability: capability || '*',
          threshold
        });
      })
      .filter(Boolean);
    return Object.freeze(rules);
  } catch {
    return Object.freeze([]);
  }
}

export function createRuntimeConfig() {
  applyNodeEnvProxyPreference();
  const PORT = String(process.env.PORT || 3001).trim() || '3001';
  const PACKAGE_VERSION = (() => {
    try {
      const raw = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
      return String(JSON.parse(raw || '{}')?.version || '0.0.0').trim() || '0.0.0';
    } catch {
      return '0.0.0';
    }
  })();
  const STARTED_AT_MS = Date.now();
  const KITE_NETWORK_NAME = 'kite-testnet';
  const dataPath = path.resolve('data', 'records.json');
  const x402Path = path.resolve('data', 'x402_requests.json');
  const policyFailurePath = path.resolve('data', 'policy_failures.json');
  const policyConfigPath = path.resolve('data', 'policy_config.json');
  const sessionRuntimePath = path.resolve('data', 'session_runtime.json');
  const sessionRuntimeIndexPath = path.resolve('data', 'session_runtimes.json');
  const sessionAuthorizationsPath = path.resolve('data', 'session_authorizations.json');
  const sessionApprovalRequestsPath = path.resolve('data', 'session_approval_requests.json');
  const onboardingChallengesPath = path.resolve('data', 'onboarding_challenges.json');
  const accountApiKeysPath = path.resolve('data', 'account_api_keys.json');
  const connectorInstallCodesPath = path.resolve('data', 'connector_install_codes.json');
  const connectorGrantsPath = path.resolve('data', 'connector_grants.json');
  const workflowPath = path.resolve('data', 'workflows.json');
  const identityChallengePath = path.resolve('data', 'identity_challenges.json');
  const servicesPath = path.resolve('data', 'services.json');
  const templatesPath = path.resolve('data', 'templates.json');
  const serviceInvocationsPath = path.resolve('data', 'service_invocations.json');
  const purchasesPath = path.resolve('data', 'purchases.json');
  const jobsPath = path.resolve('data', 'jobs.json');
  const consumerIntentsPath = path.resolve('data', 'consumer_intents.json');
  const reputationSignalsPath = path.resolve('data', 'reputation_signals.json');
  const validationRecordsPath = path.resolve('data', 'validation_records.json');
  const trustPublicationsPath = path.resolve('data', 'trust_publications.json');
  const networkAgentsPath = path.resolve('data', 'network_agents.json');
  const networkCommandsPath = path.resolve('data', 'network_commands.json');
  const networkAuditPath = path.resolve('data', 'network_audit_events.json');
  const agent001ResultsPath = path.resolve('data', 'agent001_results.json');

  const SETTLEMENT_TOKEN =
    process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
  const MERCHANT_ADDRESS =
    process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
  const X402_UNIFIED_SERVICE_PRICE =
    String(process.env.X402_UNIFIED_SERVICE_PRICE || '0.00015').trim() || '0.00015';
  const X402_PRICE = process.env.X402_PRICE || X402_UNIFIED_SERVICE_PRICE;
  const KITE_AGENT2_AA_ADDRESS =
    process.env.KITE_AGENT2_AA_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8';
  const X402_REACTIVE_PRICE = process.env.X402_REACTIVE_PRICE || X402_UNIFIED_SERVICE_PRICE;
  const X402_BTC_PRICE = process.env.X402_BTC_PRICE || X402_UNIFIED_SERVICE_PRICE;
  const X402_RISK_SCORE_PRICE = process.env.X402_RISK_SCORE_PRICE || X402_UNIFIED_SERVICE_PRICE;
  const X402_X_READER_PRICE = process.env.X402_X_READER_PRICE || X402_UNIFIED_SERVICE_PRICE;
  const X402_TECHNICAL_PRICE = process.env.X402_TECHNICAL_PRICE || X402_RISK_SCORE_PRICE;
  const X402_INFO_PRICE = process.env.X402_INFO_PRICE || X402_X_READER_PRICE;
  const X402_HYPERLIQUID_ORDER_PRICE =
    process.env.X402_HYPERLIQUID_ORDER_PRICE || X402_UNIFIED_SERVICE_PRICE;
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
  const ERC8183_REQUESTER_PRIVATE_KEY = process.env.ERC8183_REQUESTER_PRIVATE_KEY || '';
  const ERC8183_EXECUTOR_PRIVATE_KEY = process.env.ERC8183_EXECUTOR_PRIVATE_KEY || '';
  const ERC8183_VALIDATOR_PRIVATE_KEY = process.env.ERC8183_VALIDATOR_PRIVATE_KEY || '';
  const ENV_SESSION_PRIVATE_KEY = process.env.KITECLAW_SESSION_KEY || '';
  const ENV_SESSION_ADDRESS = process.env.KITECLAW_SESSION_ADDRESS || '';
  const ENV_SESSION_ID = process.env.KITECLAW_SESSION_ID || '';
  const BACKEND_RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
  const BACKEND_BUNDLER_URL =
    process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/';
  const BACKEND_ENTRYPOINT_ADDRESS =
    process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
  const KITE_AA_FACTORY_ADDRESS =
    normalizeAddress(process.env.KITE_AA_FACTORY_ADDRESS || DEFAULT_KITE_AA_FACTORY_ADDRESS) ||
    DEFAULT_KITE_AA_FACTORY_ADDRESS;
  const KITE_AA_ACCOUNT_IMPLEMENTATION =
    normalizeAddress(
      process.env.KITE_AA_ACCOUNT_IMPLEMENTATION ||
        process.env.KITE_AA_EXPECTED_IMPLEMENTATION ||
        DEFAULT_KITE_AA_ACCOUNT_IMPLEMENTATION
    ) || DEFAULT_KITE_AA_ACCOUNT_IMPLEMENTATION;
  const KITE_USE_ENV_PROXY = shouldUseEnvProxy();
  const NODE_USE_ENV_PROXY_ENABLED = /^(1|true|yes|on)$/i.test(
    String(process.env.NODE_USE_ENV_PROXY || '').trim()
  );
  const PROXY_TRANSPORT_DIAGNOSTICS = getEnvProxyDiagnostics();
  const KITE_MIN_NATIVE_GAS = String(process.env.KITE_MIN_NATIVE_GAS || '0.0001').trim();
  const AA_V2_VERSION_TAG = String(
    process.env.KITE_AA_REQUIRED_VERSION || DEFAULT_KITE_AA_REQUIRED_VERSION
  ).trim();
  const KITE_AA_JOB_LANE_REQUIRED_VERSION = String(
    process.env.KITE_AA_JOB_LANE_REQUIRED_VERSION || DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION
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
    1_000,
    800,
    15_000
  );
  const KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS = toBoundedIntEnv(
    process.env.KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS,
    30_000,
    5_000,
    300_000
  );
  const KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS = toBoundedIntEnv(
    process.env.KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS,
    300_000,
    30_000,
    900_000
  );
  const KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS = toBoundedIntEnv(
    process.env.KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS,
    Math.max(1_500, KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS),
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
    5_000
  );
  const KTRACE_JOB_APPROVAL_THRESHOLD = (() => {
    const value = Number(process.env.KTRACE_JOB_APPROVAL_THRESHOLD || '50');
    return Number.isFinite(value) && value > 0 ? value : 50;
  })();
  const KTRACE_JOB_APPROVAL_TTL_MS = toBoundedIntEnv(
    process.env.KTRACE_JOB_APPROVAL_TTL_MS,
    86_400_000,
    60_000,
    7 * 86_400_000
  );
  const KTRACE_ADMIN_KEY = String(process.env.KTRACE_ADMIN_KEY || '').trim();
  const BACKEND_PUBLIC_URL = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const KTRACE_ALLOWED_ORIGINS = Object.freeze(
    Array.from(
      new Set(
        parseEnvCsvList(process.env.KTRACE_ALLOWED_ORIGINS || '')
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    )
  );
  const KTRACE_APPROVAL_RULES = parseApprovalRules(process.env.KTRACE_APPROVAL_RULES || '');
  const ERC8183_DEFAULT_JOB_TIMEOUT_SEC = toBoundedIntEnv(
    process.env.ERC8183_DEFAULT_JOB_TIMEOUT_SEC,
    3600,
    60,
    7 * 24 * 3600
  );
  const ERC8183_EXECUTOR_STAKE_DEFAULT = String(process.env.ERC8183_EXECUTOR_STAKE_DEFAULT || '0').trim();
  const KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR = toBoundedIntEnv(
    process.env.KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR,
    2,
    1,
    6
  );
  const KITE_SESSION_PAY_METRICS_RECENT_LIMIT = toBoundedIntEnv(
    process.env.KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
    25,
    5,
    200
  );
  const KITE_NETWORK_AUDIT_MAX_EVENTS = toBoundedIntEnv(process.env.KITE_NETWORK_AUDIT_MAX_EVENTS, 20_000, 500, 200_000);

  const BUNDLER_RPC_BACKOFF_POLICY = Object.freeze({
    baseMs: KITE_BUNDLER_RPC_BACKOFF_BASE_MS,
    maxMs: KITE_BUNDLER_RPC_BACKOFF_MAX_MS,
    factor: KITE_BUNDLER_RPC_BACKOFF_FACTOR,
    jitterMs: KITE_BUNDLER_RPC_BACKOFF_JITTER_MS
  });
  const SESSION_PAY_TRANSPORT_BACKOFF_POLICY = Object.freeze({
    baseMs: KITE_SESSION_PAY_TRANSPORT_BACKOFF_BASE_MS,
    maxMs: KITE_SESSION_PAY_TRANSPORT_BACKOFF_MAX_MS,
    factor: KITE_SESSION_PAY_TRANSPORT_BACKOFF_FACTOR,
    jitterMs: KITE_SESSION_PAY_TRANSPORT_BACKOFF_JITTER_MS
  });
  const SESSION_PAY_REPLACEMENT_BACKOFF_POLICY = Object.freeze({
    baseMs: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_BASE_MS,
    maxMs: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_MAX_MS,
    factor: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR,
    jitterMs: KITE_SESSION_PAY_REPLACEMENT_BACKOFF_JITTER_MS
  });
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
    String(process.env.HYPERLIQUID_TESTNET_ENABLED || '').trim()
  );
  const HYPERLIQUID_TESTNET_PRIVATE_KEY = normalizePrivateKey(
    String(process.env.HYPERLIQUID_TESTNET_PRIVATE_KEY || '').trim()
  );
  const HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS = normalizeAddress(
    String(process.env.HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS || '').trim()
  );
  const HYPERLIQUID_TESTNET_API_URL = String(process.env.HYPERLIQUID_TESTNET_API_URL || '').trim();
  const HYPERLIQUID_TESTNET_TIMEOUT_MS = Math.max(
    1_000,
    Math.min(Number(process.env.HYPERLIQUID_TESTNET_TIMEOUT_MS || 12_000), 60_000)
  );
  const HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS = Math.max(
    1,
    Math.min(Number(process.env.HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS || 75), 5_000)
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
    process.env.TWITTER_TOKEN || process.env.KITE_TWITTER_TOKEN || process.env.KITE_OPENTWITTER_TOKEN || ''
  ).trim();
  const OPENTWITTER_TIMEOUT_MS = Math.max(2500, Math.min(Number(process.env.TWITTER_TIMEOUT_MS || 8000), 120000));
  const OPENTWITTER_RETRY = Math.max(0, Math.min(Number(process.env.TWITTER_RETRY || 1), 3));
  const OPENTWITTER_MAX_ROWS = Math.max(1, Math.min(Number(process.env.TWITTER_MAX_ROWS || 8), 50));
  const MESSAGE_PROVIDER_DEFAULT_KEYWORDS = String(process.env.MESSAGE_PROVIDER_DEFAULT_KEYWORDS || 'BTC,AI,美股,ETH')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const MESSAGE_PROVIDER_DISABLE_CLAWFEED = !/^(0|false|no|off)$/i.test(
    String(process.env.MESSAGE_PROVIDER_DISABLE_CLAWFEED || '').trim()
  );
  const MESSAGE_PROVIDER_MARKET_DATA_FALLBACK = !/^(0|false|no|off)$/i.test(
    String(process.env.MESSAGE_PROVIDER_MARKET_DATA_FALLBACK || '1').trim()
  );
  const ERC8004_IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
  const ERC8004_AGENT_ID_RAW = process.env.ERC8004_AGENT_ID || '';
  const ERC8004_AGENT_ID = Number.isFinite(Number(ERC8004_AGENT_ID_RAW))
    ? Number(ERC8004_AGENT_ID_RAW)
    : 1;
  const ERC8004_TRUST_ANCHOR_REGISTRY = process.env.ERC8004_TRUST_ANCHOR_REGISTRY || '';
  const ERC8183_JOB_ANCHOR_REGISTRY = process.env.ERC8183_JOB_ANCHOR_REGISTRY || '';
  const ERC8183_ESCROW_ADDRESS = process.env.ERC8183_ESCROW_ADDRESS || '';
  const ERC8183_TRACE_ANCHOR_GUARD = process.env.ERC8183_TRACE_ANCHOR_GUARD || '';
  const ERC8183_REQUESTER_AA_ADDRESS = process.env.ERC8183_REQUESTER_AA_ADDRESS || '';
  const ERC8183_EXECUTOR_AA_ADDRESS = process.env.ERC8183_EXECUTOR_AA_ADDRESS || '';
  const ERC8183_VALIDATOR_AA_ADDRESS = process.env.ERC8183_VALIDATOR_AA_ADDRESS || '';
  const API_KEY_ADMIN = String(process.env.KITECLAW_API_KEY_ADMIN || '').trim();
  const API_KEY_AGENT = String(process.env.KITECLAW_API_KEY_AGENT || '').trim();
  const API_KEY_VIEWER = String(process.env.KITECLAW_API_KEY_VIEWER || '').trim();
  const AUTH_DISABLED = /^(1|true|yes|on)$/i.test(String(process.env.KITECLAW_AUTH_DISABLED || '').trim());
  const KTRACE_ONBOARDING_COOKIE_NAME =
    String(process.env.KTRACE_ONBOARDING_COOKIE_NAME || 'ktrace_onboard').trim() || 'ktrace_onboard';
  const KTRACE_ONBOARDING_COOKIE_SECRET = String(process.env.KTRACE_ONBOARDING_COOKIE_SECRET || '').trim();
  const KTRACE_ONBOARDING_COOKIE_TTL_MS = toBoundedIntEnv(
    process.env.KTRACE_ONBOARDING_COOKIE_TTL_MS,
    30 * 60 * 1000,
    60_000,
    24 * 60 * 60 * 1000
  );
  const KTRACE_ONBOARDING_CHALLENGE_TTL_MS = toBoundedIntEnv(
    process.env.KTRACE_ONBOARDING_CHALLENGE_TTL_MS,
    10 * 60 * 1000,
    30_000,
    24 * 60 * 60 * 1000
  );
  const KTRACE_ONBOARDING_CHALLENGE_MAX_ROWS = toBoundedIntEnv(
    process.env.KTRACE_ONBOARDING_CHALLENGE_MAX_ROWS,
    500,
    50,
    5_000
  );
  const KTRACE_CONNECTOR_INSTALL_CODE_TTL_MS = toBoundedIntEnv(
    process.env.KTRACE_CONNECTOR_INSTALL_CODE_TTL_MS,
    900_000,
    60_000,
    7 * 24 * 60 * 60 * 1000
  );
  const KTRACE_CONNECTOR_INSTALL_CODE_MAX_ROWS = toBoundedIntEnv(
    process.env.KTRACE_CONNECTOR_INSTALL_CODE_MAX_ROWS,
    500,
    50,
    5_000
  );
  const KTRACE_CONNECTOR_GRANT_MAX_ROWS = toBoundedIntEnv(
    process.env.KTRACE_CONNECTOR_GRANT_MAX_ROWS,
    1_000,
    50,
    10_000
  );
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
  const KTRACE_AUTO_JOB_EXPIRY_ENABLED = /^(1|true|yes|on)$/i.test(
    String(process.env.KTRACE_AUTO_JOB_EXPIRY_ENABLED || '').trim()
  );
  const KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS = Math.max(
    60_000,
    Math.min(Number(process.env.KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS || 300_000), 3_600_000)
  );
  const X_READER_MAX_CHARS_DEFAULT = Math.max(200, Math.min(8000, Number(process.env.X_READER_MAX_CHARS_DEFAULT || 1200)));
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
  const ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED = normalizePrivateKey(ERC8183_REQUESTER_PRIVATE_KEY);
  const ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED = normalizePrivateKey(ERC8183_EXECUTOR_PRIVATE_KEY);
  const ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED = normalizePrivateKey(ERC8183_VALIDATOR_PRIVATE_KEY);
  const ERC8183_REQUESTER_OWNER_ADDRESS = deriveAddressFromPrivateKey(ERC8183_REQUESTER_PRIVATE_KEY_NORMALIZED);
  const ERC8183_EXECUTOR_OWNER_ADDRESS = deriveAddressFromPrivateKey(ERC8183_EXECUTOR_PRIVATE_KEY_NORMALIZED);
  const ERC8183_VALIDATOR_OWNER_ADDRESS = deriveAddressFromPrivateKey(ERC8183_VALIDATOR_PRIVATE_KEY_NORMALIZED);

  return {
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
    KITE_USE_ENV_PROXY,
    NODE_USE_ENV_PROXY_ENABLED,
    PROXY_TRANSPORT_DIAGNOSTICS,
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
  };
}
