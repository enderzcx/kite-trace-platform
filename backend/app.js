import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { GokiteAASDK } from './lib/gokite-aa-sdk.js';
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
import { createIdentityVerificationHelpers } from './routes/identityVerificationHelpers.js';
import { createPaymentPolicyHelpers } from './routes/paymentPolicyHelpers.js';
import { createRuntimeSupportHelpers } from './routes/runtimeSupportHelpers.js';
import { createNetworkCommandHelpers } from './routes/networkCommandHelpers.js';
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

function resolveSharedTokenFromMarkdown(repoRoot = '') {
  const normalizedRoot = String(repoRoot || '').trim();
  if (!normalizedRoot) return '';
  const explicitCandidates = [
    path.resolve(normalizedRoot, '重要信息.md'),
    path.resolve(normalizedRoot, 'IMPORTANT.md'),
    path.resolve(normalizedRoot, 'IMPORTANT_INFO.md')
  ];
  const visited = new Set();
  for (const targetPath of explicitCandidates) {
    const normalizedPath = path.normalize(targetPath);
    if (visited.has(normalizedPath)) continue;
    visited.add(normalizedPath);
    try {
      if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) continue;
      const lines = fs.readFileSync(normalizedPath, 'utf8').split(/\r?\n/);
      const matchedLines = lines
        .map((line) => String(line || '').trim())
        .filter((line) => /^OPENNEWS_TOKEN\/TWITTER_TOKEN\s*=/.test(line));
      const matched = matchedLines.length > 0 ? matchedLines[matchedLines.length - 1] : '';
      if (!matched) continue;
      const token = String(matched.split('=', 2)[1] || '').trim();
      if (token) return token;
    } catch {
      // ignore token file read failure
    }
  }
  try {
    const mdFiles = fs
      .readdirSync(normalizedRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => path.resolve(normalizedRoot, entry.name));
    for (const mdPath of mdFiles) {
      const normalizedPath = path.normalize(mdPath);
      if (visited.has(normalizedPath)) continue;
      visited.add(normalizedPath);
      try {
        const lines = fs.readFileSync(normalizedPath, 'utf8').split(/\r?\n/);
        const matchedLines = lines
          .map((line) => String(line || '').trim())
          .filter((line) => /^OPENNEWS_TOKEN\/TWITTER_TOKEN\s*=/.test(line));
        const matched = matchedLines.length > 0 ? matchedLines[matchedLines.length - 1] : '';
        if (!matched) continue;
        const token = String(matched.split('=', 2)[1] || '').trim();
        if (token) return token;
      } catch {
        // ignore per-file read failures
      }
    }
  } catch {
    // ignore root read failures
  }
  return '';
}

function hydrateMessageProviderTokenFromLocalDocs() {
  const hasOpenNewsToken = Boolean(String(process.env.OPENNEWS_TOKEN || '').trim());
  const hasTwitterToken = Boolean(String(process.env.TWITTER_TOKEN || '').trim());
  const hasSharedToken = Boolean(String(process.env.KITE_MESSAGE_PROVIDER_TOKEN || '').trim());
  if (hasOpenNewsToken || hasTwitterToken || hasSharedToken) return;
  const repoRoot = path.resolve(process.cwd(), '..');
  const token = resolveSharedTokenFromMarkdown(repoRoot);
  if (!token) return;
  process.env.OPENNEWS_TOKEN = token;
  process.env.TWITTER_TOKEN = token;
}

hydrateMessageProviderTokenFromLocalDocs();

function toBoundedIntEnv(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(min, Math.min(rounded, max));
}

function normalizeBackoffPolicy({
  baseMs = 0,
  maxMs = 0,
  jitterMs = 0,
  factor = 2,
  maxFactor = 6
} = {}) {
  const base = Math.max(0, Number(baseMs) || 0);
  const max = Math.max(base, Number(maxMs) || 0);
  const jitter = Math.min(max, Math.max(0, Number(jitterMs) || 0));
  const boundedMaxFactor = Math.max(1, Number(maxFactor) || 6);
  const retryFactor = Math.max(1, Math.min(Number(factor) || 1, boundedMaxFactor));
  return {
    baseMs: base,
    maxMs: max,
    jitterMs: jitter,
    factor: retryFactor
  };
}

function parseEnvCsvList(raw = '') {
  return String(raw || '')
    .split(/[,\|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function parseEnvAgentModelMap(raw = '') {
  const map = {};
  const text = String(raw || '').trim();
  if (!text) return map;
  const pairs = text.split(/[;,]/);
  for (const pair of pairs) {
    const [left, right] = String(pair || '').split('=', 2);
    const key = String(left || '').trim().toLowerCase();
    const value = String(right || '').trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  return map;
}

function parseEnvAgentFallbackModelMap(raw = '') {
  const map = {};
  const text = String(raw || '').trim();
  if (!text) return map;
  const pairs = text.split(';');
  for (const pair of pairs) {
    const [left, right] = String(pair || '').split('=', 2);
    const key = String(left || '').trim().toLowerCase();
    const values = parseEnvCsvList(right);
    if (!key || values.length === 0) continue;
    map[key] = values;
  }
  return map;
}

const app = express();
const PORT = String(process.env.PORT || 3001).trim() || '3001';
const dataPath = path.resolve('data', 'records.json');
const x402Path = path.resolve('data', 'x402_requests.json');
const policyFailurePath = path.resolve('data', 'policy_failures.json');
const policyConfigPath = path.resolve('data', 'policy_config.json');
const sessionRuntimePath = path.resolve('data', 'session_runtime.json');
const workflowPath = path.resolve('data', 'workflows.json');
const identityChallengePath = path.resolve('data', 'identity_challenges.json');
const servicesPath = path.resolve('data', 'services.json');
const serviceInvocationsPath = path.resolve('data', 'service_invocations.json');
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
  serviceInvocationsPath,
  networkAgentsPath,
  xmtpEventsPath,
  xmtpGroupsPath,
  networkCommandsPath,
  networkAuditPath,
  agent001ResultsPath
];
const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath];
const persistArrayCache = new Map();
const persistObjectCache = new Map();
const xmtpEventsState = {
  loaded: false,
  rows: []
};
let persistenceInitDone = false;
let autoXmtpNetworkTimer = null;
let autoXmtpNetworkBusy = false;
let autoTradePlanTimer = null;
let autoTradePlanBusy = false;

function parseAgentIdList(input = '') {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }
  return String(input || '')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

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

function authConfigured() {
  if (AUTH_DISABLED) return false;
  return Boolean(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER);
}

function extractApiKey(req) {
  const xApiKey = String(req.headers['x-api-key'] || '').trim();
  if (xApiKey) return xApiKey;
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const streamQueryKey = String(req.query?.apiKey || req.query?.token || '').trim();
  if (streamQueryKey && req.method === 'GET' && String(req.path || '').includes('/stream')) {
    return streamQueryKey;
  }
  return '';
}

function resolveRoleByApiKey(key) {
  if (!key) return '';
  if (API_KEY_ADMIN && key === API_KEY_ADMIN) return 'admin';
  if (API_KEY_AGENT && key === API_KEY_AGENT) return 'agent';
  if (API_KEY_VIEWER && key === API_KEY_VIEWER) return 'viewer';
  return '';
}

function requireRole(requiredRole = 'viewer') {
  return (req, res, next) => {
    if (!authConfigured()) {
      req.authRole = 'dev-open';
      return next();
    }
    const providedKey = extractApiKey(req);
    const role = resolveRoleByApiKey(providedKey);
    if (!role) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        reason: 'Missing or invalid API key.',
        traceId: req.traceId || ''
      });
    }
    const roleRank = ROLE_RANK[role] || 0;
    const requiredRank = ROLE_RANK[requiredRole] || ROLE_RANK.viewer;
    if (roleRank < requiredRank) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        reason: `Role "${role}" cannot access "${requiredRole}" endpoint.`,
        traceId: req.traceId || ''
      });
    }
    req.authRole = role;
    return next();
  };
}

function getInternalAgentApiKey() {
  return API_KEY_AGENT || API_KEY_ADMIN || '';
}

function buildSessionPayCategoryCounters() {
  return {
    transport: 0,
    replacement_fee: 0,
    session_validation: 0,
    funding: 0,
    policy: 0,
    aa_version: 0,
    config: 0,
    unknown: 0
  };
}

const sessionPayMetrics = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalSuccess: 0,
  totalFailed: 0,
  totalRetryAttempts: 0,
  totalRetryDelayMs: 0,
  totalRetriesUsed: 0,
  totalFallbackAttempted: 0,
  totalFallbackSucceeded: 0,
  failuresByCategory: buildSessionPayCategoryCounters(),
  retriesByCategory: buildSessionPayCategoryCounters(),
  retryDelayMsByCategory: buildSessionPayCategoryCounters(),
  recentFailures: []
};

function shouldRetrySessionPayReason(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('timeout') ||
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('und_err_socket') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('socket hang up') ||
    text.includes('network') ||
    text.includes('tls') ||
    text.includes('secure connection') ||
    text.includes('client network socket disconnected') ||
    text.includes('bad gateway') ||
    text.includes('gateway timeout') ||
    text.includes('service unavailable') ||
    text.includes('http 502') ||
    text.includes('http 503') ||
    text.includes('http 504')
  );
}

function classifySessionPayFailure({ reason = '', errorCode = '' } = {}) {
  const code = String(errorCode || '').trim().toLowerCase();
  const text = String(reason || '').trim().toLowerCase();
  if (code === 'aa_version_mismatch' || text.includes('aa must be upgraded to v2')) return 'aa_version';
  if (
    [
      'session_not_configured',
      'invalid_session_id',
      'session_not_found',
      'session_agent_mismatch',
      'session_rule_failed'
    ].includes(code)
  ) {
    return 'session_validation';
  }
  if (['insufficient_funds', 'insufficient_kite_gas'].includes(code)) return 'funding';
  if (
    [
      'unsupported_settlement_token',
      'invalid_token_contract',
      'invalid_tokenaddress',
      'invalid_recipient',
      'invalid_amount',
      'aa_wallet_not_deployed_or_incompatible'
    ].includes(code)
  ) {
    return 'config';
  }
  if (
    code.includes('backend_signer') ||
    text.includes('eoa_relay_disabled') ||
    text.includes('backend userop signing is disabled')
  ) {
    return 'policy';
  }
  if (
    text.includes('replacement fee too low') ||
    text.includes('replacement underpriced') ||
    text.includes('cannot be replaced') ||
    text.includes('replacement transaction underpriced')
  ) {
    return 'replacement_fee';
  }
  if (shouldRetrySessionPayReason(text)) return 'transport';
  return 'unknown';
}

function shouldRetrySessionPayCategory(category = '') {
  const kind = String(category || '').trim().toLowerCase();
  return kind === 'transport' || kind === 'replacement_fee';
}

function pushRecentSessionPayFailure(entry = {}) {
  sessionPayMetrics.recentFailures.unshift(entry);
  if (sessionPayMetrics.recentFailures.length > KITE_SESSION_PAY_METRICS_RECENT_LIMIT) {
    sessionPayMetrics.recentFailures = sessionPayMetrics.recentFailures.slice(0, KITE_SESSION_PAY_METRICS_RECENT_LIMIT);
  }
}

function markSessionPayFailure({ errorCode = '', reason = '', traceId = '', requestId = '', attempts = 0 } = {}) {
  sessionPayMetrics.totalFailed += 1;
  const category = classifySessionPayFailure({ errorCode, reason });
  if (sessionPayMetrics.failuresByCategory[category] === undefined) {
    sessionPayMetrics.failuresByCategory[category] = 0;
  }
  sessionPayMetrics.failuresByCategory[category] += 1;
  pushRecentSessionPayFailure({
    time: new Date().toISOString(),
    category,
    errorCode: String(errorCode || '').trim(),
    reason: String(reason || '').trim(),
    traceId: String(traceId || '').trim(),
    requestId: String(requestId || '').trim(),
    attempts: Number.isFinite(Number(attempts)) ? Number(attempts) : 0
  });
  return category;
}

function markSessionPayRetry({ reason = '', errorCode = '' } = {}) {
  sessionPayMetrics.totalRetryAttempts += 1;
  const category = classifySessionPayFailure({ reason, errorCode });
  if (sessionPayMetrics.retriesByCategory[category] === undefined) {
    sessionPayMetrics.retriesByCategory[category] = 0;
  }
  sessionPayMetrics.retriesByCategory[category] += 1;
  return category;
}

function markSessionPayRetryDelay({ category = 'unknown', delayMs = 0 } = {}) {
  const kind = String(category || '').trim().toLowerCase() || 'unknown';
  const normalizedDelayMs = Math.max(0, Math.round(Number(delayMs) || 0));
  if (sessionPayMetrics.retryDelayMsByCategory[kind] === undefined) {
    sessionPayMetrics.retryDelayMsByCategory[kind] = 0;
  }
  sessionPayMetrics.retryDelayMsByCategory[kind] += normalizedDelayMs;
  sessionPayMetrics.totalRetryDelayMs += normalizedDelayMs;
  return normalizedDelayMs;
}

function buildRetryBackoffMs({ attempt = 1, baseMs = 0, maxMs = 0, jitterMs = 0, factor = 2 } = {}) {
  const index = Math.max(1, Number(attempt) || 1);
  const base = Math.max(0, Number(baseMs) || 0);
  const max = Math.max(base, Number(maxMs) || 0);
  if (base === 0 || max === 0) return 0;
  const retryFactor = Math.max(1, Number(factor) || 1);
  const exponential = Math.min(max, Math.round(base * Math.pow(retryFactor, index - 1)));
  const jitterCap = Math.max(0, Number(jitterMs) || 0);
  const jitter = jitterCap > 0 ? Math.floor(Math.random() * (jitterCap + 1)) : 0;
  return Math.min(max, exponential + jitter);
}

function getSessionPayRetryBackoffMs({ attempt = 1, category = 'unknown' } = {}) {
  const kind = String(category || '').trim().toLowerCase();
  if (kind === 'replacement_fee') {
    return buildRetryBackoffMs({
      attempt,
      baseMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.baseMs,
      maxMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.maxMs,
      jitterMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.jitterMs,
      factor: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.factor
    });
  }
  if (kind === 'transport') {
    return buildRetryBackoffMs({
      attempt,
      baseMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.baseMs,
      maxMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.maxMs,
      jitterMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.jitterMs,
      factor: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.factor
    });
  }
  return 0;
}

function sessionPayConfigSnapshot() {
  return {
    sessionPayRetries: KITE_SESSION_PAY_RETRIES,
    sessionPayTransportBackoffBaseMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.baseMs,
    sessionPayTransportBackoffMaxMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.maxMs,
    sessionPayTransportBackoffJitterMs: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.jitterMs,
    sessionPayTransportBackoffFactor: SESSION_PAY_TRANSPORT_BACKOFF_POLICY.factor,
    sessionPayReplacementBackoffBaseMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.baseMs,
    sessionPayReplacementBackoffMaxMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.maxMs,
    sessionPayReplacementBackoffJitterMs: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.jitterMs,
    sessionPayReplacementBackoffFactor: SESSION_PAY_REPLACEMENT_BACKOFF_POLICY.factor,
    bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
    bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
    bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
    bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
    bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
    bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
    bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    recentFailureLimit: KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
    eoaRelayFallbackEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
    backendUserOpSignEnabled: KITE_ALLOW_BACKEND_USEROP_SIGN
  };
}

async function postSessionPayWithRetry(payload = {}, options = {}) {
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts || KITE_SESSION_PAY_RETRIES), 8));
  const timeoutMs = Math.max(30_000, Math.min(Number(options.timeoutMs || 210_000), 300_000));
  const internalApiKey = getInternalAgentApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (internalApiKey) headers['x-api-key'] = internalApiKey;

  let lastError = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const attempt = i + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/session/pay`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && body?.ok) {
        return { resp, body, attempts: attempt };
      }
      const reason = String(body?.reason || body?.error || `HTTP ${resp.status}`).trim();
      const err = new Error(reason || 'session pay failed');
      err.payBody = body;
      err.status = resp.status;
      err.attempts = attempt;
      const reasonCategory = classifySessionPayFailure({ reason, errorCode: String(body?.error || '').trim() });
      err.reasonCategory = reasonCategory;
      err.retryable = shouldRetrySessionPayCategory(reasonCategory);
      lastError = err;
      if (!err.retryable || i >= maxAttempts - 1) throw err;
      const retryCategory = markSessionPayRetry({ reason, errorCode: String(body?.error || '').trim() });
      const retryDelayMs = getSessionPayRetryBackoffMs({ attempt, category: retryCategory });
      markSessionPayRetryDelay({ category: retryCategory, delayMs: retryDelayMs });
      if (retryDelayMs > 0) await waitMs(retryDelayMs);
      continue;
    } catch (error) {
      const reason = String(error?.message || '').trim();
      const reasonCategory = classifySessionPayFailure({ reason });
      const retryable = shouldRetrySessionPayCategory(reasonCategory) || error?.name === 'AbortError';
      const wrapped = error instanceof Error ? error : new Error(reason || 'session pay failed');
      wrapped.attempts = attempt;
      wrapped.retryable = retryable;
      wrapped.reasonCategory = reasonCategory;
      lastError = wrapped;
      if (!retryable || i >= maxAttempts - 1) throw wrapped;
      const retryCategory = markSessionPayRetry({ reason });
      const retryDelayMs = getSessionPayRetryBackoffMs({ attempt, category: retryCategory });
      markSessionPayRetryDelay({ category: retryCategory, delayMs: retryDelayMs });
      if (retryDelayMs > 0) await waitMs(retryDelayMs);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('session pay failed');
}

function getAutoXmtpNetworkStatus() {
  return {
    ...autoXmtpNetworkState,
    running: Boolean(autoXmtpNetworkTimer),
    busy: autoXmtpNetworkBusy
  };
}

function resolveAutoXmtpTargetAgentId() {
  const ids = Array.isArray(autoXmtpNetworkState.targetAgentIds) ? autoXmtpNetworkState.targetAgentIds : [];
  if (!ids.length) return '';
  const total = ids.length;
  const current = Math.max(0, Number(autoXmtpNetworkState.cursor || 0));
  for (let i = 0; i < total; i += 1) {
    const idx = (current + i) % total;
    const candidate = String(ids[idx] || '').trim().toLowerCase();
    if (!candidate) continue;
    const row = findNetworkAgentById(candidate);
    if (row?.active === false) continue;
    autoXmtpNetworkState.cursor = (idx + 1) % total;
    return candidate;
  }
  return '';
}

async function runAutoXmtpNetworkTick(reason = 'timer') {
  if (autoXmtpNetworkBusy) return;
  autoXmtpNetworkBusy = true;
  autoXmtpNetworkState.lastTickAt = new Date().toISOString();
  autoXmtpNetworkState.lastStatus = 'running';
  autoXmtpNetworkState.lastError = '';

  try {
    if (!xmtpRuntime.getStatus().running) {
      await xmtpRuntime.start();
    }
    if (!xmtpRuntime.getStatus().running) {
      throw new Error(xmtpRuntime.getStatus().lastError || 'xmtp_runtime_not_running');
    }

    const toAgentId = resolveAutoXmtpTargetAgentId();
    if (!toAgentId) throw new Error('no_active_target_agent');

    const traceId = createTraceId('xmtp_auto_trace');
    const requestId = createTraceId('xmtp_auto_req');
    const taskId = createTraceId('xmtp_auto_task');
    const envelope = {
      kind: 'task-envelope',
      protocolVersion: 'kite-agent-task-v1',
      traceId,
      requestId,
      taskId,
      fromAgentId: String(autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase(),
      toAgentId,
      channel: 'dm',
      hopIndex: 1,
      mode: 'a2a',
      capability: String(autoXmtpNetworkState.capability || 'network-heartbeat').trim(),
      input: {
        source: 'xmtp-auto-loop',
        reason,
        fromAgentId: String(autoXmtpNetworkState.sourceAgentId || '').trim(),
        toAgentId,
        tickAt: new Date().toISOString()
      },
      paymentIntent: {},
      expectsReply: true,
      timestamp: new Date().toISOString()
    };

    const sent = await xmtpRuntime.sendDm({
      toAgentId,
      envelope,
      traceId,
      requestId,
      taskId,
      fromAgentId: String(autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase(),
      channel: 'dm',
      hopIndex: 1
    });
    if (!sent?.ok) {
      throw new Error(String(sent?.reason || sent?.error || 'xmtp_auto_send_failed').trim());
    }

    autoXmtpNetworkState.lastTraceId = traceId;
    autoXmtpNetworkState.lastRequestId = requestId;
    autoXmtpNetworkState.lastTaskId = taskId;
    autoXmtpNetworkState.lastTargetAgentId = toAgentId;
    autoXmtpNetworkState.lastStatus = 'success';
    autoXmtpNetworkState.sentCount += 1;
  } catch (error) {
    autoXmtpNetworkState.lastStatus = 'failed';
    autoXmtpNetworkState.lastError = String(error?.message || 'auto_xmtp_tick_failed').trim();
    autoXmtpNetworkState.failedCount += 1;
  } finally {
    autoXmtpNetworkBusy = false;
    if (reason === 'startup' || reason === 'manual') {
      console.log(
        `[auto-xmtp] tick ${autoXmtpNetworkState.lastStatus} target=${autoXmtpNetworkState.lastTargetAgentId || '-'} task=${autoXmtpNetworkState.lastTaskId || '-'}`
      );
    }
  }
}

function stopAutoXmtpNetworkLoop() {
  if (autoXmtpNetworkTimer) {
    clearInterval(autoXmtpNetworkTimer);
    autoXmtpNetworkTimer = null;
  }
  autoXmtpNetworkState.enabled = false;
}

function startAutoXmtpNetworkLoop(options = {}) {
  const intervalMs = Math.max(15_000, Number(options.intervalMs || autoXmtpNetworkState.intervalMs || 60_000));
  const targetAgentIds = parseAgentIdList(options.targetAgentIds || autoXmtpNetworkState.targetAgentIds.join(','));
  autoXmtpNetworkState.intervalMs = intervalMs;
  autoXmtpNetworkState.sourceAgentId = String(options.sourceAgentId || autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase();
  autoXmtpNetworkState.targetAgentIds = targetAgentIds;
  autoXmtpNetworkState.capability = String(options.capability || autoXmtpNetworkState.capability || 'network-heartbeat').trim();
  autoXmtpNetworkState.enabled = true;
  autoXmtpNetworkState.startedAt = new Date().toISOString();
  autoXmtpNetworkState.lastError = '';
  autoXmtpNetworkState.lastStatus = '';

  if (autoXmtpNetworkTimer) clearInterval(autoXmtpNetworkTimer);
  autoXmtpNetworkTimer = setInterval(() => {
    runAutoXmtpNetworkTick('timer').catch(() => {});
  }, intervalMs);

  if (options.immediate !== false) {
    runAutoXmtpNetworkTick(options.reason || 'manual').catch(() => {});
  }
}

function getAutoTradePlanStatus() {
  return {
    ...autoTradePlanState,
    running: Boolean(autoTradePlanTimer),
    busy: autoTradePlanBusy
  };
}

function buildAutoTradePlanPrompt() {
  const customPrompt = String(autoTradePlanState.prompt || '').trim();
  if (customPrompt) return customPrompt;
  const symbol = String(autoTradePlanState.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const horizonMin = Math.max(5, Math.min(Number(autoTradePlanState.horizonMin || 60), 1440));
  return `请基于技术面和消息面给出 ${symbol} ${horizonMin}m 交易计划，并按规则判定是否下单；不要强制下单。`;
}

function extractAutoTradePlanPaymentEvidence(replyText = '') {
  const lines = String(replyText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  for (const line of lines) {
    const directMatch = line.match(/^x402 requestId:\s*([^\s]+)\s*$/i);
    if (!directMatch) continue;
    const idx = lines.indexOf(line);
    const nextLine = idx >= 0 ? String(lines[idx + 1] || '').trim() : '';
    const txMatch = nextLine.match(/^x402 txHash:\s*([^\s]+)\s*$/i);
    return {
      requestId: String(directMatch[1] || '').trim(),
      txHash: txMatch ? String(txMatch[1] || '').trim() : ''
    };
  }
  const inlineMatch = String(replyText || '').match(/x402:\s*requestId=([^\s]+)\s+txHash=([^\s]+)/i);
  if (inlineMatch) {
    return {
      requestId: String(inlineMatch[1] || '').trim(),
      txHash: String(inlineMatch[2] || '').trim()
    };
  }
  return { requestId: '', txHash: '' };
}

function classifyAutoTradePlanOutcome(replyText = '') {
  const text = String(replyText || '').trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const decisionLine =
    lines.find((line) => /^决策:\s*/i.test(line)) ||
    lines.find((line) => /^执行结果:\s*/i.test(line)) ||
    lines[0] ||
    '';

  if (/下单执行失败|交易链路中断|交易执行前置条件不足|交易计划生成失败|执行阻断/i.test(text)) {
    return {
      status: 'failed',
      decision: 'failed',
      summary: decisionLine || '交易计划执行失败。',
      reason: decisionLine || 'trade_plan_execution_failed'
    };
  }
  if (/下单执行:\s*已触发 Hyperliquid 测试网下单/i.test(text)) {
    return {
      status: 'ordered',
      decision: 'ordered',
      summary: decisionLine || '触发下单。',
      reason: ''
    };
  }
  if (/执行结果:\s*不满足自动下单条件，本轮不下单|决策:\s*不挂单/i.test(text)) {
    return {
      status: 'no-order',
      decision: 'no-order',
      summary: decisionLine || '本轮不下单。',
      reason: ''
    };
  }
  return {
    status: 'success',
    decision: 'unknown',
    summary: decisionLine || '交易计划已执行。',
    reason: ''
  };
}

async function runAutoTradePlanTick(reason = 'timer') {
  if (autoTradePlanBusy) return;
  autoTradePlanBusy = true;
  autoTradePlanState.lastTickAt = new Date().toISOString();
  autoTradePlanState.lastStatus = 'running';
  autoTradePlanState.lastError = '';

  let countedRun = false;
  try {
    const reply = await handleRouterRuntimeTextMessage({
      text: buildAutoTradePlanPrompt(),
      context: null
    });
    const replyText = String(reply || '').trim();
    if (!replyText) {
      throw new Error('auto_trade_plan_empty_reply');
    }
    autoTradePlanState.runs += 1;
    countedRun = true;

    const outcome = classifyAutoTradePlanOutcome(replyText);
    const payment = extractAutoTradePlanPaymentEvidence(replyText);
    autoTradePlanState.lastDecision = String(outcome.decision || '').trim();
    autoTradePlanState.lastSummary = String(outcome.summary || '').trim();
    autoTradePlanState.lastRequestId = String(payment.requestId || '').trim();
    autoTradePlanState.lastTxHash = String(payment.txHash || '').trim();
    autoTradePlanState.lastStatus = String(outcome.status || 'success').trim();
    autoTradePlanState.lastError = String(outcome.reason || '').trim();

    if (outcome.status === 'ordered') {
      autoTradePlanState.orderRuns += 1;
    } else if (outcome.status === 'no-order') {
      autoTradePlanState.noOrderRuns += 1;
    } else if (outcome.status === 'failed') {
      autoTradePlanState.failedRuns += 1;
    }
  } catch (error) {
    if (!countedRun) autoTradePlanState.runs += 1;
    autoTradePlanState.failedRuns += 1;
    autoTradePlanState.lastStatus = 'failed';
    autoTradePlanState.lastDecision = 'failed';
    autoTradePlanState.lastError = String(error?.message || 'auto_trade_plan_failed').trim();
    autoTradePlanState.lastSummary = '';
    autoTradePlanState.lastRequestId = '';
    autoTradePlanState.lastTxHash = '';
  } finally {
    autoTradePlanBusy = false;
    if (reason === 'startup' || reason === 'manual') {
      console.log(
        `[auto-trade-plan] tick ${autoTradePlanState.lastStatus} decision=${autoTradePlanState.lastDecision || '-'} requestId=${autoTradePlanState.lastRequestId || '-'}`
      );
    }
  }
}

function stopAutoTradePlanLoop() {
  if (autoTradePlanTimer) {
    clearInterval(autoTradePlanTimer);
    autoTradePlanTimer = null;
  }
  autoTradePlanState.enabled = false;
}

function startAutoTradePlanLoop(options = {}) {
  const intervalMs = Math.max(60_000, Number(options.intervalMs || autoTradePlanState.intervalMs || 600_000));
  const horizonMin = Math.max(5, Math.min(Number(options.horizonMin || autoTradePlanState.horizonMin || 60), 1440));
  const symbol = String(options.symbol || autoTradePlanState.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const prompt = String(options.prompt || autoTradePlanState.prompt || '').trim();

  autoTradePlanState.intervalMs = intervalMs;
  autoTradePlanState.symbol = symbol;
  autoTradePlanState.horizonMin = horizonMin;
  autoTradePlanState.prompt = prompt;
  autoTradePlanState.enabled = true;
  autoTradePlanState.startedAt = new Date().toISOString();
  autoTradePlanState.lastError = '';
  autoTradePlanState.lastStatus = '';

  if (autoTradePlanTimer) clearInterval(autoTradePlanTimer);
  autoTradePlanTimer = setInterval(() => {
    runAutoTradePlanTick('timer').catch(() => {});
  }, intervalMs);

  if (options.immediate !== false) {
    runAutoTradePlanTick(options.reason || 'manual').catch(() => {});
  }
}

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

async function ensureAAAccountDeployment({ owner, salt = 0n } = {}) {
  if (!backendSigner) {
    throw new Error('Backend signer unavailable. Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY first.');
  }
  const normalizedOwner = normalizeAddress(owner || '');
  if (!ethers.isAddress(normalizedOwner)) {
    throw new Error('A valid owner address is required.');
  }

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: BACKEND_RPC_URL,
    bundlerUrl: BACKEND_BUNDLER_URL,
    entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
    bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
    bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
    bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
    bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
    bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
    bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
    bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
  });
  const accountAddress = sdk.getAccountAddress(normalizedOwner, salt);
  const provider = backendSigner.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
  const beforeCode = await provider.getCode(accountAddress);
  const alreadyDeployed = Boolean(beforeCode && beforeCode !== '0x');

  if (alreadyDeployed) {
    return {
      owner: normalizedOwner,
      accountAddress,
      salt: salt.toString(),
      deployed: true,
      createdNow: false,
      txHash: ''
    };
  }

  const factory = new ethers.Contract(
    sdk.config.accountFactoryAddress,
    ['function createAccount(address owner, uint256 salt) returns (address)'],
    backendSigner
  );
  const tx = await factory.createAccount(normalizedOwner, salt);
  await tx.wait();

  const afterCode = await provider.getCode(accountAddress);
  const deployed = Boolean(afterCode && afterCode !== '0x');
  if (!deployed) {
    throw new Error('AA createAccount confirmed, but no code found at predicted address.');
  }

  return {
    owner: normalizedOwner,
    accountAddress,
    salt: salt.toString(),
    deployed: true,
    createdNow: true,
    txHash: tx.hash
  };
}

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

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function persistenceKeyForPath(targetPath) {
  const base = String(path.basename(targetPath || '') || '').trim().toLowerCase();
  return `doc:${base}`;
}

function ensureJsonFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '[]', 'utf8');
  }
}

function loadJsonArrayFromFile(targetPath) {
  ensureJsonFile(targetPath);
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArrayToFile(targetPath, records) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(Array.isArray(records) ? records : [], null, 2), 'utf8');
}

function ensureJsonObjectFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '{}', 'utf8');
  }
}

function loadJsonObjectFromFile(targetPath) {
  ensureJsonObjectFile(targetPath);
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObjectToFile(targetPath, payload) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

function queuePersistWrite(stateKey, payload) {
  if (!persistenceStore.isConnected()) return;
  persistenceStore.setDocument(stateKey, payload).catch((error) => {
    console.error(`[persistence] failed writing ${stateKey}: ${error?.message || error}`);
  });
}

function readJsonArray(targetPath) {
  const stateKey = persistenceKeyForPath(targetPath);
  if (persistArrayCache.has(stateKey)) {
    return cloneValue(persistArrayCache.get(stateKey) || []);
  }
  const rows = loadJsonArrayFromFile(targetPath);
  persistArrayCache.set(stateKey, rows);
  queuePersistWrite(stateKey, rows);
  return cloneValue(rows);
}

function writeJsonArray(targetPath, records) {
  const stateKey = persistenceKeyForPath(targetPath);
  const rows = Array.isArray(records) ? records : [];
  persistArrayCache.set(stateKey, cloneValue(rows));
  writeJsonArrayToFile(targetPath, rows);
  queuePersistWrite(stateKey, rows);
}

function readJsonObject(targetPath) {
  const stateKey = persistenceKeyForPath(targetPath);
  if (persistObjectCache.has(stateKey)) {
    return cloneValue(persistObjectCache.get(stateKey) || {});
  }
  const payload = loadJsonObjectFromFile(targetPath);
  persistObjectCache.set(stateKey, payload);
  queuePersistWrite(stateKey, payload);
  return cloneValue(payload);
}

function writeJsonObject(targetPath, payload) {
  const stateKey = persistenceKeyForPath(targetPath);
  const normalized = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  persistObjectCache.set(stateKey, cloneValue(normalized));
  writeJsonObjectToFile(targetPath, normalized);
  queuePersistWrite(stateKey, normalized);
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

function readRecords() {
  return readJsonArray(dataPath);
}

function writeRecords(records) {
  writeJsonArray(dataPath, records);
}

function readX402Requests() {
  return readJsonArray(x402Path);
}

function writeX402Requests(records) {
  writeJsonArray(x402Path, records);
}

function computeX402StatusCounts(rows = [], now = Date.now()) {
  const items = Array.isArray(rows) ? rows : [];
  let pending = 0;
  let paid = 0;
  let expired = 0;
  let failed = 0;
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    const expiresAt = Number(item?.expiresAt || 0);
    if (status === 'paid') {
      paid += 1;
    } else if (status === 'pending') {
      if (expiresAt > 0 && now > expiresAt) expired += 1;
      else pending += 1;
    } else if (status === 'expired') {
      expired += 1;
    } else if (status) {
      failed += 1;
    }
  }
  return {
    total: items.length,
    pending,
    paid,
    expired,
    failed
  };
}

function expireStaleX402PendingRequests({
  dryRun = false,
  stalePendingMs = 24 * 60 * 60 * 1000,
  limit = 0,
  reason = 'ttl_or_stale_pending'
} = {}) {
  const now = Date.now();
  const maxStalePendingMs = Number.isFinite(Number(stalePendingMs)) && Number(stalePendingMs) > 0
    ? Number(stalePendingMs)
    : 24 * 60 * 60 * 1000;
  const maxUpdates = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), 10_000)
    : 0;
  const rows = readX402Requests();
  const before = computeX402StatusCounts(rows, now);
  let touched = 0;
  const touchedIds = [];
  const nextRows = rows.map((item) => {
    const status = String(item?.status || '').trim().toLowerCase();
    if (status !== 'pending') return item;
    if (maxUpdates > 0 && touched >= maxUpdates) return item;
    const expiresAt = Number(item?.expiresAt || 0);
    const createdAt = Number(item?.createdAt || 0);
    const expiredByTtl = expiresAt > 0 && now > expiresAt;
    const expiredByAge = (!expiresAt || expiresAt <= 0) && createdAt > 0 && now - createdAt > maxStalePendingMs;
    if (!expiredByTtl && !expiredByAge) return item;
    touched += 1;
    touchedIds.push(String(item?.requestId || '').trim());
    if (dryRun) return item;
    return {
      ...item,
      status: 'expired',
      expiredAt: now,
      cleanup: {
        reason,
        expiredBy: expiredByTtl ? 'ttl' : 'age',
        stalePendingMs: maxStalePendingMs,
        cleanedAt: now
      }
    };
  });
  if (!dryRun && touched > 0) {
    writeX402Requests(nextRows);
  }
  const after = computeX402StatusCounts(dryRun ? rows : nextRows, now);
  return {
    ok: true,
    dryRun,
    now,
    stalePendingMs: maxStalePendingMs,
    requestedLimit: maxUpdates,
    cleaned: touched,
    before,
    after,
    requestIds: touchedIds.slice(0, 100)
  };
}

function readPolicyFailures() {
  return readJsonArray(policyFailurePath);
}

function writePolicyFailures(records) {
  writeJsonArray(policyFailurePath, records);
}

function readWorkflows() {
  return readJsonArray(workflowPath);
}

function writeWorkflows(records) {
  writeJsonArray(workflowPath, records);
}

function readIdentityChallenges() {
  return readJsonArray(identityChallengePath);
}

function writeIdentityChallenges(records) {
  writeJsonArray(identityChallengePath, records);
}

const {
  assertBackendSigner,
  ensureWorkflowIdentityVerified,
  getLatestIdentityChallengeSnapshot,
  readIdentityProfile
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
function readPublishedServices() {
  return readJsonArray(servicesPath);
}

function writePublishedServices(records) {
  writeJsonArray(servicesPath, records);
}

function readServiceInvocations() {
  return readJsonArray(serviceInvocationsPath);
}

function writeServiceInvocations(records) {
  writeJsonArray(serviceInvocationsPath, records);
}

function readNetworkAgents() {
  return readJsonArray(networkAgentsPath);
}

function writeNetworkAgents(records) {
  writeJsonArray(networkAgentsPath, records);
}

function ensureXmtpEventsStateLoaded() {
  if (xmtpEventsState.loaded) return;
  const rows = loadJsonArrayFromFile(xmtpEventsPath);
  xmtpEventsState.rows = Array.isArray(rows) ? rows : [];
  const stateKey = persistenceKeyForPath(xmtpEventsPath);
  persistArrayCache.set(stateKey, xmtpEventsState.rows);
  xmtpEventsState.loaded = true;
}

function readXmtpEvents() {
  ensureXmtpEventsStateLoaded();
  return xmtpEventsState.rows;
}

function writeXmtpEvents(records) {
  ensureXmtpEventsStateLoaded();
  const rows = Array.isArray(records) ? records : [];
  xmtpEventsState.rows = rows;
  const stateKey = persistenceKeyForPath(xmtpEventsPath);
  persistArrayCache.set(stateKey, rows);
  writeJsonArrayToFile(xmtpEventsPath, rows);
  queuePersistWrite(stateKey, rows);
}

function readXmtpGroups() {
  return readJsonArray(xmtpGroupsPath);
}

function writeXmtpGroups(records) {
  writeJsonArray(xmtpGroupsPath, records);
}

function readNetworkCommands() {
  return readJsonArray(networkCommandsPath);
}

function writeNetworkCommands(records) {
  writeJsonArray(networkCommandsPath, records);
}

function readNetworkAuditEvents() {
  return readJsonArray(networkAuditPath);
}

function writeNetworkAuditEvents(records) {
  writeJsonArray(networkAuditPath, records);
}

function readAgent001Results() {
  return readJsonArray(agent001ResultsPath);
}

function writeAgent001Results(records) {
  writeJsonArray(agent001ResultsPath, records);
}

function upsertAgent001ResultRecord(input = {}) {
  const requestId = String(input?.requestId || '').trim();
  if (!requestId) return null;
  const rows = readAgent001Results();
  const now = new Date().toISOString();
  const existingIndex = rows.findIndex((item) => String(item?.requestId || '').trim() === requestId);
  const prev = existingIndex >= 0 ? rows[existingIndex] : null;
  const merged = {
    requestId,
    capability: String(input?.capability || prev?.capability || '').trim().toLowerCase(),
    stage: String(input?.stage || prev?.stage || '').trim().toLowerCase(),
    status: String(input?.status || prev?.status || '').trim().toLowerCase(),
    traceId: String(input?.traceId || prev?.traceId || '').trim(),
    taskId: String(input?.taskId || prev?.taskId || '').trim(),
    toAgentId: String(input?.toAgentId || prev?.toAgentId || '').trim().toLowerCase(),
    payer: normalizeAddress(input?.payer || prev?.payer || ''),
    input:
      input?.input && typeof input.input === 'object' && !Array.isArray(input.input)
        ? input.input
        : prev?.input && typeof prev.input === 'object' && !Array.isArray(prev.input)
          ? prev.input
          : {},
    quote:
      input?.quote && typeof input.quote === 'object' && !Array.isArray(input.quote)
        ? input.quote
        : prev?.quote && typeof prev.quote === 'object' && !Array.isArray(prev.quote)
          ? prev.quote
          : null,
    payment:
      input?.payment && typeof input.payment === 'object' && !Array.isArray(input.payment)
        ? input.payment
        : prev?.payment && typeof prev.payment === 'object' && !Array.isArray(prev.payment)
          ? prev.payment
          : null,
    receiptRef:
      input?.receiptRef && typeof input.receiptRef === 'object' && !Array.isArray(input.receiptRef)
        ? input.receiptRef
        : prev?.receiptRef && typeof prev.receiptRef === 'object' && !Array.isArray(prev.receiptRef)
          ? prev.receiptRef
          : null,
    result:
      input?.result && typeof input.result === 'object' && !Array.isArray(input.result)
        ? input.result
        : prev?.result && typeof prev.result === 'object' && !Array.isArray(prev.result)
          ? prev.result
          : null,
    error: String(input?.error || prev?.error || '').trim(),
    reason: String(input?.reason || prev?.reason || '').trim(),
    warnings: Array.isArray(input?.warnings)
      ? input.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : Array.isArray(prev?.warnings)
        ? prev.warnings.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    dm:
      input?.dm && typeof input.dm === 'object' && !Array.isArray(input.dm)
        ? input.dm
        : prev?.dm && typeof prev.dm === 'object' && !Array.isArray(prev.dm)
          ? prev.dm
          : null,
    source: String(input?.source || prev?.source || '').trim().toLowerCase(),
    createdAt: String(prev?.createdAt || now).trim() || now,
    updatedAt: now
  };
  if (existingIndex >= 0) rows[existingIndex] = merged;
  else rows.unshift(merged);
  writeAgent001Results(rows);
  return merged;
}

function upsertWorkflow(workflow) {
  const rows = readWorkflows();
  const idx = rows.findIndex((w) => String(w.traceId || '') === String(workflow.traceId || ''));
  const prev = idx >= 0 ? rows[idx] : null;
  if (idx >= 0) rows[idx] = workflow;
  else rows.unshift(workflow);
  writeWorkflows(rows);
  const nextState = String(workflow?.state || '').trim().toLowerCase();
  const prevState = String(prev?.state || '').trim().toLowerCase();
  if (!prev && workflow?.traceId) {
    appendNetworkAuditEvent({
      traceId: workflow.traceId,
      requestId: workflow?.requestId || '',
      type: 'workflow.step',
      actorId: 'Actor:Orchestrator',
      summary: {
        step: {
          name: 'workflow_started',
          status: nextState || 'running',
          details: {
            requestId: workflow?.requestId || ''
          }
        },
        capability: workflow?.type || ''
      },
      refs: {
        workflow: `/api/workflow/${encodeURIComponent(String(workflow.traceId || '').trim())}`
      }
    });
  }
  if (workflow?.traceId && nextState && nextState !== prevState && ['unlocked', 'failed'].includes(nextState)) {
    appendNetworkAuditEvent({
      traceId: workflow.traceId,
      requestId: workflow?.requestId || '',
      type: 'decision.final',
      actorId: 'Actor:Orchestrator',
      summary: {
        status: nextState,
        resultSummary:
          nextState === 'unlocked'
            ? toAuditText(workflow?.result?.summary || 'workflow unlocked', 240)
            : toAuditText(workflow?.error || 'workflow failed', 240)
      },
      refs: {
        workflow: `/api/workflow/${encodeURIComponent(String(workflow.traceId || '').trim())}`
      }
    });
  }
  return workflow;
}

const x402ReceiptService = createX402ReceiptService({
  readX402Requests,
  readWorkflows
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

function sanitizeSessionRuntime(input = {}) {
  const aaWallet = normalizeAddress(input.aaWallet || '');
  const owner = normalizeAddress(input.owner || '');
  const sessionAddress = normalizeAddress(input.sessionAddress || '');
  const sessionPrivateKey = String(input.sessionPrivateKey || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const sessionTxHash = String(input.sessionTxHash || '').trim();
  const expiresAt = Number(input.expiresAt || 0);
  const maxPerTx = Number(input.maxPerTx || 0);
  const dailyLimit = Number(input.dailyLimit || 0);
  const gatewayRecipient = normalizeAddress(input.gatewayRecipient || '');
  const source = String(input.source || 'frontend').trim();
  const updatedAt = Number(input.updatedAt || Date.now());

  return {
    aaWallet: ethers.isAddress(aaWallet) ? aaWallet : '',
    owner: ethers.isAddress(owner) ? owner : '',
    sessionAddress: ethers.isAddress(sessionAddress) ? sessionAddress : '',
    sessionPrivateKey: /^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey) ? sessionPrivateKey : '',
    sessionId: /^0x[0-9a-fA-F]{64}$/.test(sessionId) ? sessionId : '',
    sessionTxHash: /^0x[0-9a-fA-F]{64}$/.test(sessionTxHash) ? sessionTxHash : '',
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
    maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : 0,
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : 0,
    gatewayRecipient: ethers.isAddress(gatewayRecipient) ? gatewayRecipient : '',
    source,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
  };
}

function readSessionRuntime() {
  const file = sanitizeSessionRuntime(readJsonObject(sessionRuntimePath));
  const merged = {
    ...file,
    sessionPrivateKey: file.sessionPrivateKey || (ENV_SESSION_PRIVATE_KEY || ''),
    sessionAddress: file.sessionAddress || normalizeAddress(ENV_SESSION_ADDRESS || ''),
    sessionId: file.sessionId || (ENV_SESSION_ID || '')
  };
  return sanitizeSessionRuntime(merged);
}

function writeSessionRuntime(input = {}) {
  const next = sanitizeSessionRuntime(input);
  writeJsonObject(sessionRuntimePath, next);
  return next;
}

function maskSecret(secret = '') {
  const value = String(secret || '');
  if (!value) return '';
  if (value.length <= 12) return '***';
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function getServiceProviderBytes32(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'reactive-stop-orders') {
    return ethers.encodeBytes32String('reactive-stop-orders');
  }
  if (normalized === 'btc-price-feed') {
    // Compatibility alias: some deployed AA session policies only allow legacy providers.
    const alias = String(process.env.KITE_BTC_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'risk-score-feed') {
    const alias = String(process.env.KITE_RISK_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'technical-analysis-feed') {
    const alias = String(
      process.env.KITE_TECHNICAL_SERVICE_PROVIDER_ALIAS || process.env.KITE_RISK_SERVICE_PROVIDER_ALIAS || 'kol-score'
    )
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'x-reader-feed') {
    const alias = String(process.env.KITE_XREADER_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'info-analysis-feed') {
    const alias = String(
      process.env.KITE_INFO_SERVICE_PROVIDER_ALIAS || process.env.KITE_XREADER_SERVICE_PROVIDER_ALIAS || 'kol-score'
    )
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  return ethers.encodeBytes32String('kol-score');
}

function normalizeRecipients(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((v) => v.trim());
  return arr
    .map((addr) => normalizeAddress(addr))
    .filter((addr, index, self) => addr && ethers.isAddress(addr) && self.indexOf(addr) === index);
}

function normalizeAddresses(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((v) => v.trim());
  return arr
    .map((addr) => normalizeAddress(addr))
    .filter((addr, index, self) => addr && ethers.isAddress(addr) && self.indexOf(addr) === index);
}

function getCoreAllowedRecipients() {
  return normalizeRecipients([
    MERCHANT_ADDRESS,
    KITE_AGENT2_AA_ADDRESS,
    resolveTechnicalSettlementRecipient(),
    resolveInfoSettlementRecipient()
  ]);
}

function mergeAllowedRecipients(addresses = []) {
  const merged = normalizeRecipients(addresses);
  for (const core of getCoreAllowedRecipients()) {
    if (!merged.includes(core)) merged.push(core);
  }
  return merged;
}

function sanitizePolicy(input = {}) {
  const maxPerTx = Number(input.maxPerTx);
  const dailyLimit = Number(input.dailyLimit);
  const allowedRecipients = mergeAllowedRecipients(
    normalizeRecipients(input.allowedRecipients).length > 0
      ? input.allowedRecipients
      : POLICY_ALLOWED_RECIPIENTS_DEFAULT
  );
  const revokedPayers = normalizeAddresses(input.revokedPayers);
  return {
    maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : POLICY_MAX_PER_TX_DEFAULT,
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : POLICY_DAILY_LIMIT_DEFAULT,
    allowedRecipients,
    revokedPayers
  };
}

function ensurePolicyFile() {
  if (!fs.existsSync(policyConfigPath)) {
    fs.mkdirSync(path.dirname(policyConfigPath), { recursive: true });
    const initial = sanitizePolicy({
      maxPerTx: POLICY_MAX_PER_TX_DEFAULT,
      dailyLimit: POLICY_DAILY_LIMIT_DEFAULT,
      allowedRecipients: POLICY_ALLOWED_RECIPIENTS_DEFAULT
    });
    fs.writeFileSync(policyConfigPath, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readPolicyConfig() {
  ensurePolicyFile();
  const raw = fs.readFileSync(policyConfigPath, 'utf8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  return sanitizePolicy(JSON.parse(cleaned || '{}'));
}

function writePolicyConfig(input) {
  const next = sanitizePolicy(input);
  fs.writeFileSync(policyConfigPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeAddress(address = '') {
  return String(address).trim().toLowerCase();
}

function normalizePrivateKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? normalized : '';
}

function deriveAddressFromPrivateKey(value = '') {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) return '';
  try {
    return normalizeAddress(new ethers.Wallet(privateKey).address || '');
  } catch {
    return '';
  }
}

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
function toAuditText(value = '', maxLen = 240) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function sanitizeAuditRefs(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const refs = {};
  const workflowRef = toAuditText(input.workflow, 200);
  const evidenceRef = toAuditText(input.evidence, 200);
  const requestRef = toAuditText(input.request, 200);
  if (workflowRef) refs.workflow = workflowRef;
  if (evidenceRef) refs.evidence = evidenceRef;
  if (requestRef) refs.request = requestRef;
  return Object.keys(refs).length > 0 ? refs : null;
}

function sanitizeAuditQuote(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const quote = {
    amount: toAuditText(input.amount, 80),
    tokenAddress: normalizeAddress(input.tokenAddress || ''),
    expiresAt: toAuditText(input.expiresAt, 80),
    capability: toAuditText(input.capability || input.service || '', 80),
    actorId: toAuditText(input.actorId, 80)
  };
  const hasValue = Object.values(quote).some((value) => Boolean(value));
  return hasValue ? quote : null;
}

function sanitizeAuditSla(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const timeoutMs = Number(input.timeoutMs);
  const retries = Number(input.retries);
  const maxCost = Number(input.maxCost);
  const maxLatencyMs = Number(input.maxLatencyMs);
  const sla = {};
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) sla.timeoutMs = Math.round(timeoutMs);
  if (Number.isFinite(retries) && retries >= 0) sla.retries = Math.round(retries);
  if (Number.isFinite(maxCost) && maxCost >= 0) sla.maxCost = maxCost;
  if (Number.isFinite(maxLatencyMs) && maxLatencyMs > 0) sla.maxLatencyMs = Math.round(maxLatencyMs);
  return Object.keys(sla).length > 0 ? sla : null;
}

function sanitizeAuditRationale(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const selectedActorId = toAuditText(input.selectedActorId, 80);
  const reasonCodes = Array.isArray(input.reasonCodes)
    ? input.reasonCodes.map((item) => toAuditText(item, 80)).filter(Boolean)
    : [];
  const explanation = toAuditText(input.explanation, 240);
  if (!selectedActorId && reasonCodes.length === 0 && !explanation) return null;
  return {
    selectedActorId,
    reasonCodes,
    explanation
  };
}

function sanitizeAuditStepDetails(details = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const normalized = {
    requestId: toAuditText(details.requestId, 120),
    taskId: toAuditText(details.taskId, 120),
    txHash: toAuditText(details.txHash, 120),
    userOpHash: toAuditText(details.userOpHash, 120),
    recipient: normalizeAddress(details.recipient || ''),
    amount: toAuditText(details.amount, 80),
    verified: details.verified === true ? true : details.verified === false ? false : undefined,
    result: toAuditText(details.result, 240),
    reason: toAuditText(details.reason || details.error, 240)
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== '' && value !== undefined));
}

function sanitizeAuditSummary(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const summary = {};
  const quote = sanitizeAuditQuote(input.quote);
  const sla = sanitizeAuditSla(input.sla);
  const rationale = sanitizeAuditRationale(input.rationale);
  const stepName = toAuditText(input.stepName || input.step?.name, 80);
  const stepStatus = toAuditText(input.stepStatus || input.step?.status, 40);
  const channel = toAuditText(input.channel, 40);
  const mode = toAuditText(input.mode, 40);
  const capability = toAuditText(input.capability, 80);
  const fromAgentId = toAuditText(input.fromAgentId, 80);
  const toAgentId = toAuditText(input.toAgentId, 80);
  const dispatchStatus = toAuditText(input.dispatchStatus || input.status, 40);
  const reason = toAuditText(input.reason || input.error, 240);
  const resultSummary = toAuditText(input.resultSummary || input.summary, 240);
  if (quote) summary.quote = quote;
  if (sla) summary.sla = sla;
  if (rationale) summary.rationale = rationale;
  if (stepName || stepStatus) {
    summary.step = {
      ...(stepName ? { name: stepName } : {}),
      ...(stepStatus ? { status: stepStatus } : {}),
      details: sanitizeAuditStepDetails(input.step?.details || input.details || {})
    };
  }
  if (channel) summary.channel = channel;
  if (mode) summary.mode = mode;
  if (capability) summary.capability = capability;
  if (fromAgentId) summary.fromAgentId = fromAgentId;
  if (toAgentId) summary.toAgentId = toAgentId;
  if (dispatchStatus) summary.status = dispatchStatus;
  if (reason) summary.reason = reason;
  if (resultSummary) summary.resultSummary = resultSummary;
  return summary;
}

function resolveAuditQuoteFromPaymentIntent(paymentIntent = {}, capability = '', actorId = '') {
  const intent = paymentIntent && typeof paymentIntent === 'object' && !Array.isArray(paymentIntent) ? paymentIntent : {};
  const requestId = toAuditText(intent.requestId, 120);
  const reqItem = requestId
    ? readX402Requests().find((row) => String(row?.requestId || '').trim() === requestId) || null
    : null;
  const quote = sanitizeAuditQuote({
    amount: reqItem?.amount || intent.amount || '',
    tokenAddress: reqItem?.tokenAddress || intent.tokenAddress || '',
    expiresAt: reqItem?.expiresAt ? new Date(Number(reqItem.expiresAt)).toISOString() : intent.expiresAt || '',
    capability,
    actorId
  });
  return quote;
}

function appendNetworkAuditEvent(input = {}) {
  const traceId = toAuditText(input.traceId, 120);
  if (!traceId) return null;
  const rows = readNetworkAuditEvents();
  let nextSeq = 1;
  for (const row of rows) {
    if (String(row?.traceId || '') !== traceId) continue;
    const seq = Number(row?.seq);
    if (Number.isFinite(seq) && seq >= nextSeq) nextSeq = seq + 1;
  }
  const type = toAuditText(input.type, 80) || 'workflow.step';
  const ts = new Date().toISOString();
  const event = {
    traceId,
    seq: nextSeq,
    ts,
    type,
    actorId: toAuditText(input.actorId, 80) || 'Actor:Orchestrator',
    requestId: toAuditText(input.requestId, 120),
    taskId: toAuditText(input.taskId, 120),
    summary: sanitizeAuditSummary(input.summary || {}),
    refs: sanitizeAuditRefs(input.refs || {})
  };
  rows.push(event);
  if (rows.length > KITE_NETWORK_AUDIT_MAX_EVENTS) {
    rows.splice(0, rows.length - KITE_NETWORK_AUDIT_MAX_EVENTS);
  }
  writeNetworkAuditEvents(rows);
  return event;
}

function listNetworkAuditEventsByTraceId(traceId = '') {
  const normalized = toAuditText(traceId, 120);
  if (!normalized) return [];
  return readNetworkAuditEvents()
    .filter((row) => String(row?.traceId || '') === normalized)
    .sort((a, b) => {
      const seqA = Number(a?.seq);
      const seqB = Number(b?.seq);
      if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) return seqA - seqB;
      return Date.parse(a?.ts || 0) - Date.parse(b?.ts || 0);
    });
}

function buildWorkflowFallbackAuditEvents(workflow = {}) {
  const traceId = toAuditText(workflow?.traceId, 120);
  if (!traceId) return [];
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  return steps.map((step, idx) => ({
    traceId,
    seq: idx + 1,
    ts: toAuditText(step?.at, 80) || new Date().toISOString(),
    type: 'workflow.step',
    actorId: 'Actor:Orchestrator',
    requestId: toAuditText(workflow?.requestId, 120),
    taskId: toAuditText(step?.details?.taskId || workflow?.taskId, 120),
    summary: sanitizeAuditSummary({
      step: {
        name: step?.name,
        status: step?.status,
        details: step?.details
      },
      reason: step?.details?.reason || ''
    }),
    refs: null
  }));
}

function deriveNegotiationTermsFromAuditEvents(events = []) {
  let quote = null;
  let sla = null;
  let rationale = null;
  for (const event of events) {
    const summary = event?.summary && typeof event.summary === 'object' ? event.summary : null;
    if (!summary) continue;
    const nextQuote = sanitizeAuditQuote(summary.quote);
    const nextSla = sanitizeAuditSla(summary.sla);
    const nextRationale = sanitizeAuditRationale(summary.rationale);
    if (nextQuote) quote = nextQuote;
    if (nextSla) sla = nextSla;
    if (nextRationale) rationale = nextRationale;
  }
  return { quote, sla, rationale };
}

function buildNetworkRunSummaries({ limit = 50, traceId = '', requestId = '' } = {}) {
  const maxRows = Math.max(1, Math.min(Number(limit) || 50, 300));
  const traceFilter = toAuditText(traceId, 120);
  const requestFilter = toAuditText(requestId, 120);
  const workflows = readWorkflows();
  const events = readNetworkAuditEvents();
  const byTrace = new Map();

  const ensureRow = (key) => {
    if (!byTrace.has(key)) {
      byTrace.set(key, {
        traceId: key,
        requestId: '',
        state: '',
        startedAt: '',
        latestAt: '',
        latestEventType: '',
        totalEvents: 0
      });
    }
    return byTrace.get(key);
  };

  for (const workflow of workflows) {
    const key = toAuditText(workflow?.traceId, 120);
    if (!key) continue;
    const row = ensureRow(key);
    row.requestId = row.requestId || toAuditText(workflow?.requestId, 120);
    row.state = toAuditText(workflow?.state, 40) || row.state;
    row.startedAt = row.startedAt || toAuditText(workflow?.createdAt, 80);
    row.latestAt = toAuditText(workflow?.updatedAt, 80) || row.latestAt || row.startedAt;
  }

  for (const event of events) {
    const key = toAuditText(event?.traceId, 120);
    if (!key) continue;
    const row = ensureRow(key);
    const eventTs = toAuditText(event?.ts, 80);
    row.requestId = row.requestId || toAuditText(event?.requestId, 120);
    row.totalEvents += 1;
    if (!row.startedAt || Date.parse(eventTs || 0) < Date.parse(row.startedAt || 0)) row.startedAt = eventTs;
    if (!row.latestAt || Date.parse(eventTs || 0) >= Date.parse(row.latestAt || 0)) {
      row.latestAt = eventTs;
      row.latestEventType = toAuditText(event?.type, 80);
    }
    const stepName = toAuditText(event?.summary?.step?.name, 80);
    if (stepName === 'failed') row.state = 'failed';
    if (stepName === 'unlocked' && row.state !== 'failed') row.state = 'unlocked';
  }

  return Array.from(byTrace.values())
    .filter((row) => (traceFilter ? row.traceId === traceFilter : true))
    .filter((row) => (requestFilter ? String(row.requestId || '') === requestFilter : true))
    .sort((a, b) => Date.parse(b?.latestAt || 0) - Date.parse(a?.latestAt || 0))
    .slice(0, maxRows);
}

function appendWorkflowStep(workflow, name, status, details = {}) {
  if (!workflow.steps) workflow.steps = [];
  const step = {
    name,
    status,
    at: new Date().toISOString(),
    details
  };
  workflow.steps.push(step);
  appendNetworkAuditEvent({
    traceId: workflow?.traceId || '',
    requestId: workflow?.requestId || details?.requestId || '',
    taskId: details?.taskId || '',
    type: 'workflow.step',
    actorId: details?.actorId || 'Actor:Orchestrator',
    summary: {
      step: {
        name,
        status,
        details
      },
      reason: details?.reason || ''
    },
    refs: {
      workflow: workflow?.traceId ? `/api/workflow/${encodeURIComponent(String(workflow.traceId || '').trim())}` : ''
    }
  });
}

function createX402Request(query, payer, action = 'kol-score', options = {}) {
  const now = Date.now();
  const requestId = `x402_${now}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    requestId,
    action,
    query,
    payer,
    amount: String(options.amount || X402_PRICE),
    tokenAddress: options.tokenAddress || SETTLEMENT_TOKEN,
    recipient: options.recipient || MERCHANT_ADDRESS,
    status: 'pending',
    createdAt: now,
    expiresAt: now + X402_TTL_MS,
    policy: options.policy || null,
    identity: options.identity || {
      registry: ERC8004_IDENTITY_REGISTRY || '',
      agentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : ''
    }
  };
}

function buildPaymentRequiredResponse(reqItem, reason = '') {
  return {
    error: 'payment_required',
    reason,
    x402: {
      version: '0.1-demo',
      requestId: reqItem.requestId,
      expiresAt: reqItem.expiresAt,
      accepts: [
        {
          scheme: 'kite-aa-erc20',
          network: 'kite_testnet',
          tokenAddress: reqItem.tokenAddress,
          amount: reqItem.amount,
          recipient: reqItem.recipient,
          decimals: 18
        }
      ]
    }
  };
}

function isTechnicalAnalysisAction(actionRaw = '') {
  const action = String(actionRaw || '').trim().toLowerCase();
  return action === 'technical-analysis-feed' || action === 'risk-score-feed';
}

function isInfoAnalysisAction(actionRaw = '') {
  const action = String(actionRaw || '').trim().toLowerCase();
  return action === 'info-analysis-feed' || action === 'x-reader-feed';
}

function resolveTechnicalSettlementRecipient() {
  const candidate = normalizeAddress(XMTP_RISK_AGENT_AA_ADDRESS || KITE_AGENT2_AA_ADDRESS || '');
  return ethers.isAddress(candidate) ? candidate : normalizeAddress(KITE_AGENT2_AA_ADDRESS || '');
}

function resolveInfoSettlementRecipient() {
  const candidate = normalizeAddress(XMTP_READER_AGENT_AA_ADDRESS || KITE_AGENT2_AA_ADDRESS || '');
  return ethers.isAddress(candidate) ? candidate : normalizeAddress(KITE_AGENT2_AA_ADDRESS || '');
}

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

function getActionConfig(actionRaw = '') {
  const action = String(actionRaw || 'kol-score').trim().toLowerCase();
  if (action === 'kol-score') {
    return {
      action: 'kol-score',
      amount: X402_PRICE,
      recipient: MERCHANT_ADDRESS,
      summary: 'KOL score report unlocked by x402 payment'
    };
  }
  if (action === 'reactive-stop-orders') {
    return {
      action: 'reactive-stop-orders',
      amount: X402_REACTIVE_PRICE,
      recipient: KITE_AGENT2_AA_ADDRESS,
      summary: 'Reactive contracts stop-orders signal unlocked by x402 payment'
    };
  }
  if (action === 'btc-price-feed') {
    return {
      action: 'btc-price-feed',
      amount: X402_BTC_PRICE,
      recipient: KITE_AGENT2_AA_ADDRESS,
      summary: 'BTC price quote unlocked by x402 payment'
    };
  }
  if (isTechnicalAnalysisAction(action)) {
    return {
      action: action === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed',
      amount: action === 'technical-analysis-feed' ? X402_TECHNICAL_PRICE : X402_RISK_SCORE_PRICE,
      recipient: resolveTechnicalSettlementRecipient(),
      summary:
        action === 'technical-analysis-feed'
          ? 'Technical analysis unlocked by x402 payment'
          : 'BTC risk score unlocked by x402 payment'
    };
  }
  if (isInfoAnalysisAction(action)) {
    return {
      action: 'info-analysis-feed',
      amount: X402_INFO_PRICE || X402_X_READER_PRICE,
      recipient: resolveInfoSettlementRecipient(),
      summary: 'Info analysis unlocked by x402 payment'
    };
  }
  if (action === 'hyperliquid-order-testnet') {
    return {
      action: 'hyperliquid-order-testnet',
      amount: X402_HYPERLIQUID_ORDER_PRICE,
      recipient: HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS,
      summary: 'Hyperliquid testnet order unlocked by x402 payment'
    };
  }
  return null;
}

function normalizeReactiveParams(actionParams = {}) {
  const symbol = String(actionParams.symbol || '').trim().toUpperCase();
  const takeProfitRaw = Number(actionParams.takeProfit);
  const stopLossRaw = Number(actionParams.stopLoss);
  const quantityText = String(actionParams.quantity ?? '').trim();
  const hasQuantity = quantityText !== '';
  const quantityRaw = hasQuantity ? Number(quantityText) : null;
  if (!symbol) {
    throw new Error('Reactive action requires symbol.');
  }
  if (!Number.isFinite(takeProfitRaw) || takeProfitRaw <= 0) {
    throw new Error('Reactive action requires a valid takeProfit.');
  }
  if (!Number.isFinite(stopLossRaw) || stopLossRaw <= 0) {
    throw new Error('Reactive action requires a valid stopLoss.');
  }
  if (hasQuantity && (!Number.isFinite(quantityRaw) || quantityRaw <= 0)) {
    throw new Error('Reactive action requires a valid quantity when quantity is provided.');
  }
  return {
    symbol,
    takeProfit: takeProfitRaw,
    stopLoss: stopLossRaw,
    ...(hasQuantity ? { quantity: quantityRaw } : {})
  };
}

function normalizeBtcPriceParams(input = {}) {
  const rawPair = String(input.pair || 'BTCUSDT').trim().toUpperCase();
  const rawSource = String(input.source || 'hyperliquid').trim().toLowerCase();
  const compactPair = rawPair.replace(/[-_\s]/g, '');

  const symbolBase = compactPair.startsWith('ETH') ? 'ETH' : compactPair.startsWith('BTC') ? 'BTC' : '';
  if (!symbolBase) {
    throw new Error('Price task requires pair BTC/ETH (BTCUSDT/BTCUSD/ETHUSDT/ETHUSD).');
  }
  if (!['hyperliquid', 'auto', 'binance', 'okx', 'coingecko'].includes(rawSource)) {
    throw new Error('BTC price task source must be one of hyperliquid/auto/binance/okx/coingecko.');
  }

  const normalizedPair = `${symbolBase}USDT`;
  let providers = ['hyperliquid', 'binance', 'okx'];
  if (rawSource === 'binance') providers = ['binance', 'hyperliquid', 'okx'];
  else if (rawSource === 'okx') providers = ['okx', 'hyperliquid', 'binance'];
  else if (rawSource === 'coingecko') providers = ['binance', 'okx', 'hyperliquid'];

  return {
    pair: normalizedPair,
    source: 'hyperliquid',
    sourceRequested: rawSource,
    providers
  };
}

function normalizeRiskScoreParams(input = {}) {
  const rawSymbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase();
  const symbolCompact = rawSymbol.replace(/[-_\s]/g, '');
  const symbolBase = symbolCompact.startsWith('ETH') ? 'ETH' : symbolCompact.startsWith('BTC') ? 'BTC' : '';
  if (!symbolBase) {
    throw new Error('Risk-score task requires symbol BTC/ETH (BTCUSDT/BTCUSD/ETHUSDT/ETHUSD).');
  }
  const horizonMinRaw = Number(input.horizonMin ?? input.horizonMins ?? 60);
  const horizonMin = Number.isFinite(horizonMinRaw) ? Math.max(5, Math.min(Math.round(horizonMinRaw), 240)) : 60;
  const normalizedBtc = normalizeBtcPriceParams({ source: input.source || 'hyperliquid', pair: rawSymbol });
  return {
    symbol: normalizedBtc.pair,
    horizonMin,
    source: normalizedBtc.source,
    sourceRequested: normalizedBtc.sourceRequested,
    providers: normalizedBtc.providers
  };
}

function normalizeXReaderParams(input = {}) {
  const rawInput = String(
    input.url || input.resourceUrl || input.targetUrl || input.topic || input.query || input.keyword || ''
  ).trim();
  if (!rawInput) {
    throw new Error('info-analysis task requires url or topic.');
  }
  let normalizedUrl = '';
  let topic = '';
  let inputType = 'url';
  try {
    const parsed = new URL(rawInput);
    if (!['http:', 'https:'].includes(String(parsed.protocol || '').toLowerCase())) {
      throw new Error('invalid protocol');
    }
    normalizedUrl = parsed.toString();
    const host = String(parsed.hostname || '').replace(/^www\./i, '').trim();
    topic = host ? `market sentiment for ${host}` : normalizedUrl;
    inputType = 'url';
  } catch {
    normalizedUrl = '';
    topic = rawInput;
    inputType = 'topic';
  }

  const requestedMode = String(input.mode || input.source || 'auto').trim().toLowerCase();
  const modeAliases = {
    market: 'market-data',
    marketdata: 'market-data',
    legacy: 'market-data',
    fallback: 'market-data',
    news: 'auto',
    xreader: 'auto',
    jina: 'auto',
    opennewsmcp: 'opennews',
    opennews: 'opennews',
    twitter: 'opentwitter',
    opentwittermcp: 'opentwitter',
    opentwitter: 'opentwitter',
    mcp: 'multi-provider',
    multiprovider: 'multi-provider'
  };
  const rawMode = modeAliases[requestedMode] || requestedMode;
  if (!['auto', 'market-data', 'opennews', 'opentwitter', 'multi-provider'].includes(rawMode)) {
    throw new Error('info-analysis task mode must be one of auto/market-data/opennews/opentwitter/multi-provider.');
  }
  const maxCharsRaw = Number(input.maxChars ?? input.maxLength ?? X_READER_MAX_CHARS_DEFAULT);
  const maxChars = Number.isFinite(maxCharsRaw)
    ? Math.max(200, Math.min(Math.round(maxCharsRaw), 20000))
    : X_READER_MAX_CHARS_DEFAULT;

  return {
    url: normalizedUrl,
    topic,
    inputType,
    mode: rawMode,
    maxChars
  };
}

function parseExcerptMaxChars(input, fallback = 8000) {
  const value = Number(input ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(200, Math.min(Math.round(value), 20000));
}

async function fetchJsonWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = String(options?.method || 'GET').trim().toUpperCase() || 'GET';
    const headers = options?.headers || {};
    const reqInit = {
      method,
      headers,
      signal: controller.signal
    };
    if (options?.body !== undefined) {
      reqInit.body = options.body;
    }
    const resp = await fetch(url, reqInit);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = String(options?.method || 'GET').trim().toUpperCase() || 'GET';
    const headers = options?.headers || {};
    const reqInit = {
      method,
      headers,
      signal: controller.signal
    };
    if (options?.body !== undefined) {
      reqInit.body = options.body;
    }
    const resp = await fetch(url, reqInit);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractXReaderDigest(rawText = '', maxChars = X_READER_MAX_CHARS_DEFAULT) {
  const normalized = String(rawText || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return {
      title: '',
      excerpt: ''
    };
  }
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const contentLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (lower.startsWith('url source:')) return false;
    if (lower.startsWith('markdown content:')) return false;
    return true;
  });
  const title =
    contentLines.find((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith('title:')) return false;
      if (line.length < 6) return false;
      return true;
    }) || '';
  const excerpt = contentLines.join('\n').slice(0, maxChars);
  return {
    title: String(title || '').replace(/^title:\s*/i, '').trim(),
    excerpt
  };
}

function clampNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeStringArray(values = [], limit = 12) {
  const source = Array.isArray(values)
    ? values
    : String(values || '')
        .split('\n')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit) || 12));
}

function normalizeFreshIsoTimestamp(primaryValue = '', fallbackValue = '') {
  const now = Date.now();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
  const futureSkewMs = 1000 * 60 * 10;
  const candidates = [primaryValue, fallbackValue];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) continue;
    const ageMs = now - ts;
    const tooOld = ageMs > maxAgeMs;
    const tooFuture = ts - now > futureSkewMs;
    if (tooOld || tooFuture) continue;
    return new Date(ts).toISOString();
  }
  return new Date(now).toISOString();
}

function normalizeInfoAnalysisResult(raw = {}, task = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const candidateHeadlines = normalizeStringArray(
    source.headlines || source.news || source.items || source.facts || []
  );
  const candidateFactors = normalizeStringArray(source.keyFactors || source.factors || source.signals || []);
  const summary =
    String(source.summary || source.excerpt || source.text || source.digest || '').trim() ||
    candidateFactors[0] ||
    candidateHeadlines[0] ||
    `Info analysis ready for ${String(task.url || task.topic || 'resource').trim()}`;
  const topic = String(source.topic || task.topic || task.url || '').trim() || 'market-context';
  const confidence = clampNumber(source.confidence, 0, 1, 0.5);
  const sentimentScore = clampNumber(source.sentimentScore ?? source.sentiment ?? 0, -1, 1, 0);
  return {
    provider: String(source.provider || ANALYSIS_PROVIDER).trim() || ANALYSIS_PROVIDER,
    traceId: String(source.traceId || task.traceId || '').trim(),
    topic,
    sentimentScore: Number(sentimentScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    headlines: candidateHeadlines,
    keyFactors: candidateFactors,
    summary,
    asOf: normalizeFreshIsoTimestamp(source.asOf || source.timestamp || source.fetchedAt || '')
  };
}

function normalizeTechnicalAnalysisResult(raw = {}, task = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const quoteSource = source.quote && typeof source.quote === 'object' && !Array.isArray(source.quote) ? source.quote : {};
  const symbol = String(source.symbol || source.pair || task.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const timeframe =
    String(source.timeframe || source.interval || '').trim() || `${Math.max(5, Number(task.horizonMin || 60))}m`;
  const confidence = clampNumber(source.confidence, 0, 1, 0.5);
  const defaultBias = confidence >= 0.65 ? 'bullish' : confidence <= 0.35 ? 'bearish' : 'neutral';
  const indicatorsSource =
    source.indicators && typeof source.indicators === 'object' && !Array.isArray(source.indicators)
      ? source.indicators
      : {};
  const signalsSource =
    source.signals && typeof source.signals === 'object' && !Array.isArray(source.signals)
      ? source.signals
      : {};
  const riskBandSource =
    source.riskBand && typeof source.riskBand === 'object' && !Array.isArray(source.riskBand)
      ? source.riskBand
      : {};
  const summary =
    String(source.summary || source.text || source.digest || '').trim() ||
    `Technical analysis ready for ${symbol} (${timeframe}).`;
  const riskScoreRaw = Number(source.riskScore ?? source.score ?? source?.risk?.score ?? NaN);
  const riskScore = Number.isFinite(riskScoreRaw) ? Math.max(5, Math.min(95, Math.round(riskScoreRaw))) : null;

  const quotePriceRaw = Number(quoteSource.priceUsd ?? source.priceUsd ?? source.price ?? NaN);
  const quotePair = String(quoteSource.pair || symbol).trim().toUpperCase() || symbol;
  const quoteProvider =
    String(quoteSource.provider || source.quoteProvider || source.provider || ANALYSIS_PROVIDER)
      .trim()
      .toLowerCase() || ANALYSIS_PROVIDER;
  const normalizedAsOf = normalizeFreshIsoTimestamp(
    source.asOf || source.timestamp || source.fetchedAt || '',
    quoteSource.fetchedAt || ''
  );
  const normalizedQuoteFetchedAt = normalizeFreshIsoTimestamp(
    quoteSource.fetchedAt || '',
    source.asOf || source.timestamp || source.fetchedAt || ''
  );
  const quote =
    Number.isFinite(quotePriceRaw) && quotePriceRaw > 0
      ? {
          provider: quoteProvider,
          pair: quotePair,
          priceUsd: Number(quotePriceRaw.toFixed(6)),
          fetchedAt: normalizedQuoteFetchedAt,
          sourceRequested: String(task.sourceRequested || task.source || '').trim().toLowerCase() || 'auto',
          attemptedProviders: normalizeStringArray(quoteSource.attemptedProviders || [quoteProvider], 6)
        }
      : null;

  return {
    provider: String(source.provider || ANALYSIS_PROVIDER).trim() || ANALYSIS_PROVIDER,
    traceId: String(source.traceId || task.traceId || '').trim(),
    symbol,
    timeframe,
    indicators: {
      rsi: Number.isFinite(Number(indicatorsSource.rsi)) ? Number(indicatorsSource.rsi) : null,
      macd: Number.isFinite(Number(indicatorsSource.macd)) ? Number(indicatorsSource.macd) : null,
      emaFast: Number.isFinite(Number(indicatorsSource.emaFast)) ? Number(indicatorsSource.emaFast) : null,
      emaSlow: Number.isFinite(Number(indicatorsSource.emaSlow)) ? Number(indicatorsSource.emaSlow) : null,
      atr: Number.isFinite(Number(indicatorsSource.atr)) ? Number(indicatorsSource.atr) : null
    },
    signals: {
      trend: String(signalsSource.trend || 'sideways').trim().toLowerCase() || 'sideways',
      momentum: String(signalsSource.momentum || 'neutral').trim().toLowerCase() || 'neutral',
      volatility: String(signalsSource.volatility || 'normal').trim().toLowerCase() || 'normal',
      bias: String(signalsSource.bias || defaultBias).trim().toLowerCase() || defaultBias
    },
    confidence: Number(confidence.toFixed(4)),
    riskBand: {
      stopLossPct: Number(
        clampNumber(riskBandSource.stopLossPct, 0.1, 30, Number.isFinite(Number(task.stopLossPct)) ? Number(task.stopLossPct) : 1.5).toFixed(4)
      ),
      takeProfitPct: Number(
        clampNumber(riskBandSource.takeProfitPct, 0.1, 60, Number.isFinite(Number(task.takeProfitPct)) ? Number(task.takeProfitPct) : 3).toFixed(4)
      )
    },
    riskScore,
    summary,
    asOf: normalizedAsOf,
    quote
  };
}

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

async function fetchXReaderDigest(params = {}) {
  const task = normalizeXReaderParams(params);
  const info = await runInfoAnalysis({
    ...task,
    traceId: String(params?.traceId || '').trim()
  });
  const providerRaw = String(info?.provider || ANALYSIS_PROVIDER).trim().toLowerCase() || ANALYSIS_PROVIDER;
  const attemptedProviders = providerRaw
    .split('+')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const headline = Array.isArray(info.headlines) && info.headlines.length > 0 ? info.headlines[0] : '';
  const factor = Array.isArray(info.keyFactors) && info.keyFactors.length > 0 ? info.keyFactors[0] : '';
  const excerpt = String(info.summary || factor || headline || '').trim().slice(0, task.maxChars);
  return {
    provider: info.provider || ANALYSIS_PROVIDER,
    backend: providerRaw || ANALYSIS_PROVIDER,
    url: task.url,
    topic: task.topic,
    inputType: task.inputType,
    title: String(headline || '').trim(),
    excerpt,
    contentLength: excerpt.length,
    fetchedAt: info.asOf || new Date().toISOString(),
    mode: task.mode,
    maxChars: task.maxChars,
    sourceRequested: task.mode,
    attemptedProviders: attemptedProviders.length > 0 ? attemptedProviders : [ANALYSIS_PROVIDER],
    analysis: info
  };
}

async function fetchBtcFromHyperliquid(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout('https://api.hyperliquid.xyz/info', 8000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' })
  });
  const normalizedPair = String(pair || 'BTCUSDT').trim().toUpperCase().replace(/[-_\s]/g, '');
  const symbolBase = normalizedPair.startsWith('ETH') ? 'ETH' : 'BTC';
  const price = Number(body?.[symbolBase]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcFromBinance(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, 8000);
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcFromOkx(pair = 'BTCUSDT') {
  const normalizedPair = String(pair || 'BTCUSDT').trim().toUpperCase().replace(/[-_\s]/g, '');
  const symbolBase = normalizedPair.startsWith('ETH') ? 'ETH' : 'BTC';
  const instId = `${symbolBase}-USDT`;
  const body = await fetchJsonWithTimeout(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, 8000);
  const price = Number(body?.data?.[0]?.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcPriceQuote(params = {}) {
  const { pair, sourceRequested, providers } = normalizeBtcPriceParams(params);
  const failures = [];
  const attemptedProviders = [];

  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      let price = NaN;
      if (provider === 'hyperliquid') {
        price = await fetchBtcFromHyperliquid(pair);
      } else if (provider === 'binance') {
        price = await fetchBtcFromBinance(pair);
      } else if (provider === 'okx') {
        price = await fetchBtcFromOkx(pair);
      }

      if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
      return {
        provider,
        pair,
        priceUsd: Number(price.toFixed(6)),
        fetchedAt: new Date().toISOString(),
        sourceRequested,
        attemptedProviders
      };
    } catch (error) {
      failures.push(`${provider}:${error?.message || 'failed'}`);
    }
  }

  throw new Error(`price_source_unavailable (${failures.join(', ') || 'no provider'})`);
}

async function fetchBinanceTicker24h(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, 8000);
  const lastPrice = Number(body?.lastPrice);
  const changePct = Number(body?.priceChangePercent);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) throw new Error('invalid lastPrice');
  return {
    provider: 'binance',
    pair,
    lastPrice,
    changePct: Number.isFinite(changePct) ? changePct : null,
    highPrice: Number(body?.highPrice),
    lowPrice: Number(body?.lowPrice),
    volume: Number(body?.volume),
    quoteVolume: Number(body?.quoteVolume)
  };
}

async function fetchCoinGeckoBtcSnapshot() {
  const body = await fetchJsonWithTimeout(
    'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false',
    8000
  );
  const market = body?.market_data && typeof body.market_data === 'object' ? body.market_data : {};
  const currentUsd = Number(market?.current_price?.usd);
  const change24h = Number(market?.price_change_percentage_24h);
  if (!Number.isFinite(currentUsd) || currentUsd <= 0) throw new Error('invalid coingecko current_price.usd');
  return {
    provider: 'coingecko',
    currentUsd,
    change24h: Number.isFinite(change24h) ? change24h : null,
    marketCapUsd: Number(market?.market_cap?.usd),
    totalVolumeUsd: Number(market?.total_volume?.usd),
    updatedAt: String(body?.last_updated || '').trim()
  };
}

async function fetchFearGreedIndex() {
  const body = await fetchJsonWithTimeout('https://api.alternative.me/fng/?limit=1', 8000);
  const row = Array.isArray(body?.data) ? body.data[0] || {} : {};
  const value = Number(row?.value);
  if (!Number.isFinite(value)) throw new Error('invalid fear_and_greed value');
  return {
    provider: 'alternative-me',
    value: Math.max(0, Math.min(100, value)),
    classification: String(row?.value_classification || '').trim() || 'Unknown',
    timestamp: String(row?.timestamp || '').trim()
  };
}

function averageNumbers(values = []) {
  const items = values.filter((item) => Number.isFinite(Number(item)));
  if (items.length === 0) return NaN;
  return items.reduce((sum, item) => sum + Number(item), 0) / items.length;
}

function computeEma(values = [], period = 14) {
  const list = values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (list.length < period || period < 2) return NaN;
  const k = 2 / (period + 1);
  let ema = list.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < list.length; i += 1) {
    ema = list[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRsi(values = [], period = 14) {
  const list = values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (list.length <= period) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = list[i] - list[i - 1];
    if (delta >= 0) gain += delta;
    else loss += Math.abs(delta);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < list.length; i += 1) {
    const delta = list[i] - list[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss <= 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeMacd(values = [], fast = 12, slow = 26) {
  const fastEma = computeEma(values, fast);
  const slowEma = computeEma(values, slow);
  if (!Number.isFinite(fastEma) || !Number.isFinite(slowEma)) return NaN;
  return fastEma - slowEma;
}

function computeAtr(highs = [], lows = [], closes = [], period = 14) {
  const h = highs.map((item) => Number(item));
  const l = lows.map((item) => Number(item));
  const c = closes.map((item) => Number(item));
  const len = Math.min(h.length, l.length, c.length);
  if (len <= period) return NaN;
  const trs = [];
  for (let i = 1; i < len; i += 1) {
    const high = h[i];
    const low = l[i];
    const prevClose = c[i - 1];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return NaN;
  let atr = trs.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

async function fetchBinanceKlines(pair = 'BTCUSDT', interval = '1m', limit = 180) {
  const safeLimit = Math.max(30, Math.min(Number(limit || 180), 500));
  const body = await fetchJsonWithTimeout(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${safeLimit}`,
    8000
  );
  if (!Array.isArray(body) || body.length === 0) throw new Error('empty klines');
  return body
    .map((row) => ({
      openTime: Number(row?.[0]),
      open: Number(row?.[1]),
      high: Number(row?.[2]),
      low: Number(row?.[3]),
      close: Number(row?.[4]),
      closeTime: Number(row?.[6])
    }))
    .filter(
      (item) =>
        Number.isFinite(item.openTime) &&
        Number.isFinite(item.closeTime) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.close) &&
        item.close > 0
    );
}

async function runMarketInfoAnalysis(params = {}) {
  const task = normalizeXReaderParams(params);
  const topic = String(params?.topic || task.topic || task.url || 'BTC market sentiment').trim();
  const traceId = String(params?.traceId || '').trim();
  const failures = [];

  const [binanceRes, geckoRes, fearGreedRes] = await Promise.allSettled([
    fetchBinanceTicker24h('BTCUSDT'),
    fetchCoinGeckoBtcSnapshot(),
    fetchFearGreedIndex()
  ]);

  const headlines = [];
  const keyFactors = [];
  const sentimentParts = [];

  if (binanceRes.status === 'fulfilled') {
    const changePct = Number(binanceRes.value.changePct);
    const lastPrice = Number(binanceRes.value.lastPrice);
    if (Number.isFinite(changePct)) {
      headlines.push(`Binance BTC 24h ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`);
      keyFactors.push(`Binance last ${lastPrice.toFixed(2)} USD`);
      sentimentParts.push(clampNumber(changePct / 10, -1, 1, 0));
    }
  } else {
    failures.push(`binance:${String(binanceRes.reason?.message || binanceRes.reason || 'failed').trim()}`);
  }

  if (geckoRes.status === 'fulfilled') {
    const change24h = Number(geckoRes.value.change24h);
    const currentUsd = Number(geckoRes.value.currentUsd);
    if (Number.isFinite(change24h)) {
      headlines.push(`CoinGecko BTC 24h ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`);
      keyFactors.push(`CoinGecko spot ${currentUsd.toFixed(2)} USD`);
      sentimentParts.push(clampNumber(change24h / 10, -1, 1, 0));
    }
  } else {
    failures.push(`coingecko:${String(geckoRes.reason?.message || geckoRes.reason || 'failed').trim()}`);
  }

  if (fearGreedRes.status === 'fulfilled') {
    const value = Number(fearGreedRes.value.value);
    const classification = String(fearGreedRes.value.classification || '').trim();
    if (Number.isFinite(value)) {
      headlines.push(`Fear&Greed ${Math.round(value)} (${classification || 'n/a'})`);
      keyFactors.push(`Sentiment index=${Math.round(value)} /100`);
      sentimentParts.push(clampNumber((value - 50) / 50, -1, 1, 0));
    }
  } else {
    failures.push(`feargreed:${String(fearGreedRes.reason?.message || fearGreedRes.reason || 'failed').trim()}`);
  }

  if (headlines.length === 0 && keyFactors.length === 0) {
    throw new Error(`market_info_unavailable (${failures.join('; ') || 'no data source'})`);
  }

  const sentimentScore = Number.isFinite(averageNumbers(sentimentParts))
    ? averageNumbers(sentimentParts)
    : 0;
  const confidence = clampNumber(0.35 + headlines.length * 0.12 + keyFactors.length * 0.08, 0.35, 0.92, 0.5);
  const summary = `${topic}: sentiment ${sentimentScore >= 0 ? '偏多' : '偏空'} (${sentimentScore.toFixed(2)}), confidence ${confidence.toFixed(2)}; data=binance/coingecko/feargreed`;

  return normalizeInfoAnalysisResult(
    {
      provider: 'market-data',
      traceId,
      topic,
      sentimentScore,
      confidence,
      headlines,
      keyFactors,
      summary,
      asOf: new Date().toISOString()
    },
    {
      ...task,
      traceId
    }
  );
}

function buildFallbackTechnicalFromQuote(task = {}, quote = null, reason = '') {
  const safeQuote =
    quote && Number.isFinite(Number(quote?.priceUsd)) && Number(quote.priceUsd) > 0
      ? quote
      : {
          provider: 'fallback',
          pair: String(task.symbol || 'BTCUSDT').trim().toUpperCase(),
          priceUsd: 0,
          fetchedAt: new Date().toISOString(),
          sourceRequested: String(task.sourceRequested || task.source || 'auto').trim().toLowerCase() || 'auto',
          attemptedProviders: []
        };
  const horizonPoints = Math.max(3, Math.min(Number(task.horizonMin || 60), 60));
  const series = buildDemoPriceSeries(horizonPoints).series;
  const prices = series.map((item) => Number(item.priceUsd)).filter((item) => Number.isFinite(item) && item > 0);
  const baselinePrice =
    prices.length > 0 ? averageNumbers(prices) : Number.isFinite(Number(safeQuote.priceUsd)) ? Number(safeQuote.priceUsd) : 0;
  const minPrice = prices.length > 0 ? Math.min(...prices) : baselinePrice;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : baselinePrice;
  const rangePct = baselinePrice > 0 ? ((maxPrice - minPrice) / baselinePrice) * 100 : 0;
  const deviationPct = baselinePrice > 0 ? (Math.abs(Number(safeQuote.priceUsd) - baselinePrice) / baselinePrice) * 100 : 0;
  const rawScore = 24 + rangePct * 11 + deviationPct * 8;
  const bounded = Math.max(5, Math.min(95, Math.round(rawScore)));
  const level = toRiskLevel(bounded);
  const technical = normalizeTechnicalAnalysisResult(
    {
      provider: 'market-data-fallback',
      symbol: task.symbol,
      timeframe: `${task.horizonMin}m`,
      confidence: clampNumber(1 - Math.min(0.85, rangePct / 22), 0.1, 0.9, 0.5),
      summary: buildRiskScoreSummary(bounded, level, task.symbol, safeQuote),
      riskScore: bounded,
      signals: {
        trend: deviationPct >= 1.8 ? 'directional' : 'sideways',
        momentum: deviationPct >= 1.2 ? 'active' : 'neutral',
        volatility: rangePct >= 1.8 ? 'elevated' : 'normal',
        bias: level === 'high' || level === 'elevated' ? 'defensive' : 'balanced'
      },
      indicators: {
        rsi: null,
        macd: null,
        emaFast: null,
        emaSlow: null,
        atr: Number(rangePct.toFixed(6))
      },
      riskBand: {
        stopLossPct: Number(Math.max(0.8, Math.min(3.5, 1.1 + rangePct / 3)).toFixed(4)),
        takeProfitPct: Number(Math.max(1.2, Math.min(8, 2 + rangePct * 1.8)).toFixed(4))
      },
      quote: safeQuote,
      asOf: safeQuote.fetchedAt
    },
    task
  );
  technical.rangePct = Number(rangePct.toFixed(4));
  technical.deviationPct = Number(deviationPct.toFixed(4));
  technical.sampleSize = prices.length;
  if (reason) {
    technical.summary = `${technical.summary} (fallback reason: ${String(reason).slice(0, 180)})`;
    technical.fallbackReason = String(reason).slice(0, 280);
  }
  return technical;
}

async function runMarketTechnicalAnalysis(task = {}, input = {}) {
  const traceId = String(input?.traceId || '').trim();
  const quote = await fetchBtcPriceQuote({
    pair: task.symbol,
    source: task.sourceRequested
  });
  const klines = await fetchBinanceKlines(task.symbol, '1m', Math.max(90, Number(task.horizonMin || 60) * 3));
  if (klines.length < 30) throw new Error('market_data_technical_klines_insufficient');

  const closes = klines.map((item) => Number(item.close)).filter((item) => Number.isFinite(item) && item > 0);
  const highs = klines.map((item) => Number(item.high)).filter((item) => Number.isFinite(item) && item > 0);
  const lows = klines.map((item) => Number(item.low)).filter((item) => Number.isFinite(item) && item > 0);
  if (closes.length < 30 || highs.length < 30 || lows.length < 30) {
    throw new Error('market_data_technical_series_invalid');
  }

  const rsi = computeRsi(closes, 14);
  const macd = computeMacd(closes, 12, 26);
  const emaFast = computeEma(closes, 12);
  const emaSlow = computeEma(closes, 26);
  const atr = computeAtr(highs, lows, closes, 14);
  const spot = Number.isFinite(Number(quote.priceUsd)) && Number(quote.priceUsd) > 0 ? Number(quote.priceUsd) : closes[closes.length - 1];

  const lookback = Math.max(20, Math.min(Number(task.horizonMin || 60), closes.length));
  const window = closes.slice(-lookback);
  const avgPrice = averageNumbers(window);
  const minPrice = window.length > 0 ? Math.min(...window) : spot;
  const maxPrice = window.length > 0 ? Math.max(...window) : spot;
  const rangePct = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0;
  const deviationPct = avgPrice > 0 ? (Math.abs(spot - avgPrice) / avgPrice) * 100 : 0;
  const volatilityPct = spot > 0 && Number.isFinite(atr) ? (atr / spot) * 100 : rangePct / 2;

  const trend =
    Number.isFinite(emaFast) && Number.isFinite(emaSlow)
      ? emaFast > emaSlow * 1.0005
        ? 'uptrend'
        : emaFast < emaSlow * 0.9995
          ? 'downtrend'
          : 'sideways'
      : 'sideways';
  const momentum =
    Number.isFinite(rsi) ? (rsi >= 60 ? 'bullish' : rsi <= 40 ? 'bearish' : 'neutral') : 'neutral';
  const volatility =
    volatilityPct >= 1.5 ? 'elevated' : volatilityPct <= 0.6 ? 'compressed' : 'normal';
  const bias =
    trend === 'uptrend' && momentum !== 'bearish'
      ? 'bullish'
      : trend === 'downtrend' && momentum !== 'bullish'
        ? 'bearish'
        : 'neutral';
  const confidence = clampNumber(
    0.45 +
      (Number.isFinite(rsi) ? 0.12 : 0) +
      (Number.isFinite(macd) ? 0.12 : 0) +
      (Number.isFinite(emaFast) && Number.isFinite(emaSlow) ? 0.14 : 0) +
      (Number.isFinite(atr) ? 0.09 : 0),
    0.35,
    0.92,
    0.55
  );
  const rawScore =
    20 +
    rangePct * 9 +
    deviationPct * 6 +
    (Number.isFinite(rsi) ? Math.abs(rsi - 50) * 0.45 : 8) +
    (Number.isFinite(macd) && spot > 0 ? Math.min(8, Math.abs((macd / spot) * 10000)) : 0);
  const riskScore = Math.max(5, Math.min(95, Math.round(rawScore)));
  const level = toRiskLevel(riskScore);

  const technical = normalizeTechnicalAnalysisResult(
    {
      provider: 'market-data',
      traceId,
      symbol: task.symbol,
      timeframe: `${task.horizonMin}m`,
      indicators: {
        rsi: Number.isFinite(rsi) ? Number(rsi.toFixed(4)) : null,
        macd: Number.isFinite(macd) ? Number(macd.toFixed(8)) : null,
        emaFast: Number.isFinite(emaFast) ? Number(emaFast.toFixed(6)) : null,
        emaSlow: Number.isFinite(emaSlow) ? Number(emaSlow.toFixed(6)) : null,
        atr: Number.isFinite(atr) ? Number(atr.toFixed(6)) : null
      },
      signals: {
        trend,
        momentum,
        volatility,
        bias
      },
      confidence,
      riskBand: {
        stopLossPct: Number(Math.max(0.5, Math.min(4.5, volatilityPct * 1.8)).toFixed(4)),
        takeProfitPct: Number(Math.max(1.2, Math.min(10, volatilityPct * 3.1)).toFixed(4))
      },
      riskScore,
      summary: `${task.symbol} technical risk ${riskScore}/100 (${level}), trend=${trend}, momentum=${momentum}, volatility=${volatility}`,
      asOf: new Date().toISOString(),
      quote
    },
    task
  );
  technical.rangePct = Number(rangePct.toFixed(4));
  technical.deviationPct = Number(deviationPct.toFixed(4));
  technical.sampleSize = window.length;
  return technical;
}

function toRiskLevel(score = 50) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'elevated';
  if (score >= 35) return 'medium';
  return 'low';
}

function buildRiskScoreSummary(score, level, symbol, quote) {
  return `${symbol} risk score ${score}/100 (${level}) at $${quote.priceUsd} [${quote.provider}]`;
}

async function runRiskScoreAnalysis(input = {}) {
  const task = normalizeRiskScoreParams(input);
  let technical = null;
  let fallbackReason = '';
  try {
    technical = await runMarketTechnicalAnalysis(task, input);
  } catch (error) {
    fallbackReason = String(error?.message || 'market_data_technical_unavailable').trim();
    const quote = await fetchBtcPriceQuote({
      pair: task.symbol,
      source: task.sourceRequested
    });
    technical = buildFallbackTechnicalFromQuote(task, quote, fallbackReason);
  }

  const quote =
    technical?.quote && Number.isFinite(Number(technical.quote.priceUsd)) && Number(technical.quote.priceUsd) > 0
      ? technical.quote
      : await fetchBtcPriceQuote({
          pair: task.symbol,
          source: task.sourceRequested
        });
  const scoreRaw = Number(technical?.riskScore ?? NaN);
  const bounded = Number.isFinite(scoreRaw)
    ? Math.max(5, Math.min(95, Math.round(scoreRaw)))
    : Math.max(5, Math.min(95, Math.round(Number(technical?.confidence || 0.5) * 100)));
  const level = toRiskLevel(bounded);

  return {
    summary: String(technical?.summary || buildRiskScoreSummary(bounded, level, task.symbol, quote)).trim(),
    risk: {
      symbol: task.symbol,
      score: bounded,
      level,
      horizonMin: task.horizonMin,
      rangePct: Number(
        Number.isFinite(Number(technical?.rangePct))
          ? Number(technical.rangePct)
          : Number(technical?.indicators?.atr || 0)
      ),
      deviationPct: Number(
        Number.isFinite(Number(technical?.deviationPct))
          ? Number(technical.deviationPct)
          : Number(technical?.confidence ? Math.abs(0.5 - Number(technical.confidence)) * 2.5 : 0)
      ),
      sampleSize: Number.isFinite(Number(technical?.sampleSize)) ? Number(technical.sampleSize) : 0,
      provider: String(quote?.provider || technical?.provider || 'legacy').trim().toLowerCase()
    },
    quote,
    technical: {
      ...technical,
      ...(fallbackReason && !technical?.fallbackReason ? { fallbackReason } : {})
    }
  };
}

function createServiceId() {
  return `svc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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

function isAgent001TaskSuccessful(dispatchResult = null) {
  if (!dispatchResult || !dispatchResult.ok) return false;
  const status = String(dispatchResult?.taskResult?.status || 'done').trim().toLowerCase();
  return !['failed', 'error', 'rejected'].includes(status);
}

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

async function handleRouterRuntimeTextMessage({ text = '', context = null } = {}) {
  const gate = await resolveAgent001ConversationEntry({ text });
  if (gate.handled) return gate.response;
  const rawText = gate.rawText;
  const intent = gate.intent;

  const waitMsLimit = 30_000;
  const runTrade = intent.intent === 'trade';
  if (runTrade) {
    return handleAgent001TradeIntent({
      context,
      intent,
      rawText,
      waitMsLimit
    });
  }

  return handleAgent001AnalysisIntent({
    context,
    intent,
    rawText,
    runTrade,
    waitMsLimit
  });
}

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

function upsertServiceInvocation(invocation = {}) {
  const rows = readServiceInvocations();
  const invocationId = String(invocation.invocationId || '').trim();
  if (!invocationId) return;
  const idx = rows.findIndex((item) => String(item?.invocationId || '').trim() === invocationId);
  if (idx >= 0) rows[idx] = invocation;
  else rows.unshift(invocation);
  writeServiceInvocations(rows);
}

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


