import { config as loadEnv } from 'dotenv';
import { applyNodeEnvProxyPreference } from '../lib/envProxy.js';
import { ethers } from 'ethers';
import { BTC_TRADING_PLAN_V1_SCHEMA_ID } from '../lib/deliverySchemas/btcTradingPlanV1.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveAaAccountImplementation,
  resolveAaFactoryAddress
} from '../lib/aaConfig.js';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';
import {
  normalizeMcpCallResult,
  resolveAgentApiKey,
  resolveExecutorAddress,
  resolveValidatorAddress
} from './demoBtcJobHelpers.js';
import {
  envFlag,
  extractAaWalletFromReason,
  findConnectorGrantRecord,
  findX402RequestRecord,
  formatExpiry,
  loadWalletBalanceSummary,
  selectConsumerRuntimeContext
} from './mcpRuntimeContextHelpers.mjs';

loadEnv({ path: path.resolve(process.cwd(), '.env') });
applyNodeEnvProxyPreference();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizePrivateKey(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return '';
}

function normalizeAddress(value = '') {
  const raw = normalizeText(value);
  if (!raw || !ethers.isAddress(raw)) return '';
  return ethers.getAddress(raw);
}

const RPC_URL = normalizeText(process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/');
const BUNDLER_URL = normalizeText(process.env.KITEAI_BUNDLER_URL || process.env.KITEAA_BUNDLER_URL || '');
const ENTRYPOINT_ADDRESS = normalizeText(
  process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
);
const TOKEN_ADDRESS = normalizeAddress(process.env.KITE_SETTLEMENT_TOKEN || '');
const ACCOUNT_IMPLEMENTATION_ADDRESS = resolveAaAccountImplementation();
const DEFAULT_FACTORY_ADDRESS = resolveAaFactoryAddress();
const BACKEND_SIGNER_KEY = normalizePrivateKey(
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY ||
    process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    ''
);
const PROOF_TOKEN_SOURCE_KEY = normalizePrivateKey(process.env.ERC8183_PROOF_TOKEN_SOURCE_KEY || '');
const LEGACY_REQUESTER_OWNER = normalizeAddress(process.env.ERC8183_REQUESTER_ADDRESS || '');
const LEGACY_REQUESTER_OWNER_KEY = normalizePrivateKey(process.env.ERC8183_REQUESTER_PRIVATE_KEY || '');
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.KITE_RPC_TIMEOUT_MS || 120_000));
const USE_MANAGED_CONSUMER = envFlag(process.env.MCP_LIVE_USE_MANAGED_CONSUMER || '');
const TARGET_NATIVE_BALANCE = normalizeText(process.env.MCP_LIVE_REQUIRED_AA_NATIVE || (USE_MANAGED_CONSUMER ? '0.02' : '0.009'));
const TARGET_TOKEN_BALANCE = normalizeText(process.env.MCP_LIVE_REQUIRED_AA_TOKEN || '0.005');
const PAID_TOOL_TIMEOUT_MS = Math.max(45_000, Number(process.env.MCP_LIVE_PAID_TOOL_TIMEOUT_MS || 120_000) || 120_000);
const FRESH_PROBE_TIMEOUT_MS = Math.max(15_000, Number(process.env.MCP_LIVE_FRESH_PROBE_TIMEOUT_MS || 110_000) || 110_000);
const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

function createProvider() {
  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = REQUEST_TIMEOUT_MS;
  const staticNetwork = ethers.Network.from({
    chainId: 2368,
    name: 'kite_testnet'
  });
  return new ethers.JsonRpcProvider(rpcRequest, staticNetwork, { staticNetwork });
}

function buildAaSdk({ proxyAddress, ownerAddress } = {}) {
  return new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT_ADDRESS,
    accountFactoryAddress: DEFAULT_FACTORY_ADDRESS,
    accountImplementationAddress: ACCOUNT_IMPLEMENTATION_ADDRESS,
    proxyAddress,
    ownerAddress,
    bundlerRpcTimeoutMs: Number(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS || 15_000),
    bundlerRpcRetries: Number(process.env.KITE_BUNDLER_RPC_RETRIES || 3),
    bundlerRpcBackoffBaseMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_BASE_MS || 650),
    bundlerRpcBackoffMaxMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_MAX_MS || 6_000),
    bundlerRpcBackoffFactor: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_FACTOR || 2),
    bundlerRpcBackoffJitterMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_JITTER_MS || 325),
    bundlerReceiptPollIntervalMs: Number(process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS || 3_000),
    rpcTimeoutMs: REQUEST_TIMEOUT_MS
  });
}

async function ensureNativeBalance(funder, recipient, amountWei) {
  const current = await funder.provider.getBalance(recipient);
  if (current >= amountWei) {
    return { funded: false, before: current.toString(), after: current.toString(), txHash: '' };
  }
  const tx = await funder.sendTransaction({
    to: recipient,
    value: amountWei - current
  });
  await tx.wait();
  const after = await funder.provider.getBalance(recipient);
  return {
    funded: true,
    before: current.toString(),
    after: after.toString(),
    txHash: normalizeText(tx.hash)
  };
}

async function executeOwnerAaTokenTransfer({
  provider,
  sourceAaWallet,
  sourceOwner,
  sourceOwnerKey,
  target,
  amount,
  tokenAddress
} = {}) {
  const sdk = buildAaSdk({
    proxyAddress: sourceAaWallet,
    ownerAddress: sourceOwner
  });
  const ownerWallet = new ethers.Wallet(sourceOwnerKey, provider);
  const tokenInterface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const transferCallData = tokenInterface.encodeFunctionData('transfer', [target, amount]);
  return sdk.sendUserOperationAndWait(
    {
      target: tokenAddress,
      value: 0n,
      callData: transferCallData
    },
    async (userOpHash) => ownerWallet.signMessage(ethers.getBytes(userOpHash))
  );
}

async function ensureTokenBalance({
  provider,
  token,
  deployerWallet,
  target,
  amountRequired
} = {}) {
  const current = await token.balanceOf(target);
  if (current >= amountRequired) {
    return {
      funded: false,
      source: 'existing',
      before: current.toString(),
      after: current.toString(),
      txHash: '',
      userOpHash: ''
    };
  }

  const missing = amountRequired - current;
  if (deployerWallet) {
    const deployerBalance = await token.balanceOf(deployerWallet.address);
    if (deployerBalance >= missing) {
      const tx = await token.connect(deployerWallet).transfer(target, missing);
      await tx.wait();
      const after = await token.balanceOf(target);
      return {
        funded: true,
        source: 'deployer-eoa',
        before: current.toString(),
        after: after.toString(),
        txHash: normalizeText(tx.hash),
        userOpHash: ''
      };
    }
  }

  if (PROOF_TOKEN_SOURCE_KEY) {
    const sourceWallet = new ethers.Wallet(PROOF_TOKEN_SOURCE_KEY, provider);
    const sourceBalance = await token.balanceOf(sourceWallet.address);
    if (sourceBalance >= missing) {
      const tx = await token.connect(sourceWallet).transfer(target, missing);
      await tx.wait();
      const after = await token.balanceOf(target);
      return {
        funded: true,
        source: 'proof-source-eoa',
        before: current.toString(),
        after: after.toString(),
        txHash: normalizeText(tx.hash),
        userOpHash: ''
      };
    }
  }

  if (LEGACY_REQUESTER_OWNER && LEGACY_REQUESTER_OWNER_KEY) {
    const runtime = findRuntime({ owner: LEGACY_REQUESTER_OWNER });
    if (runtime?.aaWallet) {
      const transfer = await executeOwnerAaTokenTransfer({
        provider,
        sourceAaWallet: runtime.aaWallet,
        sourceOwner: LEGACY_REQUESTER_OWNER,
        sourceOwnerKey: LEGACY_REQUESTER_OWNER_KEY,
        target,
        amount: missing,
        tokenAddress: await token.getAddress()
      });
      const after = await token.balanceOf(target);
      return {
        funded: true,
        source: 'legacy-requester-aa',
        before: current.toString(),
        after: after.toString(),
        txHash: normalizeText(transfer?.transactionHash || ''),
        userOpHash: normalizeText(transfer?.userOpHash || '')
      };
    }
  }

  throw new Error(`Unable to fund MCP live AA with settlement token. missing=${missing.toString()} target=${target}`);
}

async function ensureManagedConsumerBalances(aaWallet = '') {
  const targetAaWallet = normalizeAddress(aaWallet);
  if (!targetAaWallet) {
    throw new Error('Managed consumer AA wallet is missing for balance top-up.');
  }
  if (!BACKEND_SIGNER_KEY) {
    throw new Error('Missing backend signer private key for MCP live verifier funding.');
  }
  if (!TOKEN_ADDRESS) {
    throw new Error('Missing settlement token address for MCP live verifier funding.');
  }
  const provider = createProvider();
  const funderWallet = new ethers.Wallet(BACKEND_SIGNER_KEY, provider);
  const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);
  const decimals = Number(await token.decimals().catch(() => 6));
  const nativeTargetWei = ethers.parseEther(TARGET_NATIVE_BALANCE);
  const tokenTargetAtomic = ethers.parseUnits(TARGET_TOKEN_BALANCE, decimals);
  const nativeFunding = await ensureNativeBalance(funderWallet, targetAaWallet, nativeTargetWei);
  const tokenFunding = await ensureTokenBalance({
    provider,
    token,
    deployerWallet: funderWallet,
    target: targetAaWallet,
    amountRequired: tokenTargetAtomic
  });
  const nativeAfter = await provider.getBalance(targetAaWallet);
  const tokenAfter = await token.balanceOf(targetAaWallet);
  return {
    nativeFunding,
    tokenFunding,
    balances: {
      native: ethers.formatEther(nativeAfter),
      token: ethers.formatUnits(tokenAfter, decimals),
      tokenDecimals: decimals
    }
  };
}

async function requestJsonAt(baseUrl, pathname, {
  method = 'GET',
  body = null,
  apiKey = '',
  timeoutMs = 120000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: buildHeaders(apiKey),
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    const rawText = await response.text();
    const payload = rawText ? JSON.parse(rawText) : {};
    if (!response.ok || payload?.ok === false) {
      const reason = normalizeText(payload?.reason || payload?.message || payload?.error?.message || rawText || `HTTP ${response.status}`);
      const error = new Error(reason);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function readLocalSessionRuntimeFallback() {
  const runtimePath = path.resolve(process.cwd(), 'data', 'session_runtime.json');
  if (!fs.existsSync(runtimePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  } catch {
    return {};
  }
}

function readSessionRuntimeIndexFallback() {
  const runtimePath = path.resolve(process.cwd(), 'data', 'session_runtimes.json');
  if (!fs.existsSync(runtimePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  } catch {
    return {};
  }
}

function pickManagedConsumerRuntimeFallback() {
  const index = readSessionRuntimeIndexFallback();
  const runtimes =
    index && typeof index === 'object' && index.runtimes && typeof index.runtimes === 'object'
      ? Object.values(index.runtimes)
      : [];
  return (
    runtimes.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        normalizeText(item.runtimePurpose || '') === 'consumer' &&
        normalizeText(item.source || '') !== 'self_serve_wallet' &&
        normalizeText(item.aaWallet || '') &&
        normalizeText(item.owner || '') &&
        normalizeText(item.sessionId || '') &&
        normalizeText(item.sessionAddress || '') &&
        normalizeText(item.sessionPrivateKey || '')
    ) || {}
  );
}

function resolveManagedRoleAaWallet(ownerAddress = '', fallbackAddress = '') {
  const index = readSessionRuntimeIndexFallback();
  const runtimes = index && typeof index === 'object' && index.runtimes && typeof index.runtimes === 'object'
    ? index.runtimes
    : {};
  const entry = runtimes[normalizeText(ownerAddress).toLowerCase()] || runtimes[normalizeText(ownerAddress)] || null;
  return normalizeText(entry?.aaWallet || fallbackAddress || '');
}

function buildHeaders(apiKey = '') {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {})
  };
}

function parseSsePayload(rawText = '') {
  const dataLines = String(rawText || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return dataLines.length > 0 ? JSON.parse(dataLines.join('\n')) : {};
}

function normalizeToolName(capabilityId = '') {
  return `ktrace__${normalizeText(capabilityId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function buildTradingPlanFromResult(mcpResult = {}, capability = {}) {
  const resultPayload = mcpResult?.result && typeof mcpResult.result === 'object' ? mcpResult.result : {};
  const summary = normalizeText(mcpResult.summary || resultPayload?.summary || 'BTC intraday plan assembled from ktrace market data.');
  const fallbackPrice = Number(process.env.MCP_LIVE_BTC_PRICE_FALLBACK || 68000);
  const price = Number(resultPayload?.price || resultPayload?.markPrice || resultPayload?.lastPrice || fallbackPrice);
  const volume24h = Number(resultPayload?.volume24h || resultPayload?.volume || 1250000000);
  const dominance = Number(resultPayload?.dominance || 52.5);
  const lowerEntry = Number((price * 0.995).toFixed(2));
  const upperEntry = Number((price * 1.005).toFixed(2));
  const tp1 = Number((price * 1.015).toFixed(2));
  const tp2 = Number((price * 1.03).toFixed(2));
  const stopLoss = Number((price * 0.99).toFixed(2));
  const riskRewardRatio = Number((((((tp1 + tp2) / 2) - price) / (price - stopLoss || 1))).toFixed(2));
  const bias = /bearish|short/i.test(summary) ? 'short' : /neutral/i.test(summary) ? 'neutral' : 'long';
  const sentiment = bias === 'short' ? 'bearish' : bias === 'neutral' ? 'neutral' : 'bullish';

  return {
    schema: BTC_TRADING_PLAN_V1_SCHEMA_ID,
    asset: 'BTC/USDT',
    generatedAt: new Date().toISOString(),
    marketSnapshot: {
      price,
      priceSource: normalizeText(capability?.capabilityId || capability?.id || capability?.name || 'ktrace-mcp-tool'),
      volume24h,
      dominance
    },
    tradingPlan: {
      bias,
      timeframe: '1D',
      entry: {
        price,
        zone: [lowerEntry, upperEntry]
      },
      takeProfit: [
        {
          target: 1,
          price: tp1,
          rationale: 'First scale-out near the initial breakout extension.'
        },
        {
          target: 2,
          price: tp2,
          rationale: 'Second target captures a stronger continuation move if momentum persists.'
        }
      ],
      stopLoss: {
        price: stopLoss,
        rationale: 'Invalidates the intraday setup if price loses the entry structure.'
      },
      riskRewardRatio
    },
    analysis: {
      summary,
      keyLevels: [lowerEntry, price, tp1, tp2, stopLoss],
      sentiment
    },
    evidence: {
      primaryTraceId: normalizeText(mcpResult.traceId),
      primaryEvidenceRef: normalizeText(mcpResult.evidenceRef),
      paymentRequestId: normalizeText(mcpResult.requestId),
      paymentTxHash: normalizeText(mcpResult.txHash),
      dataSourceTraceIds: [normalizeText(mcpResult.traceId)].filter(Boolean),
      receiptRefs: [normalizeText(mcpResult.receiptRef)].filter(Boolean),
      deliveredAt: new Date().toISOString()
    }
  };
}

function pickPaidCapability(capabilities = []) {
  const preferred = [
    'cap-market-price-feed',
    'cap-weather-context',
    'cap-tech-buzz-signal',
    'cap-market-price-feed',
    'svc_btcusd_minute',
    'svc-live-btc-feed',
    'svc-compare-btc',
    'cap-dex-market'
  ];
  const items = Array.isArray(capabilities) ? capabilities : [];
  const activePaid = items.filter((item) => item?.active !== false && Number(item?.pricing?.amount || item?.price || 0) > 0);
  for (const capabilityId of preferred) {
    const match = activePaid.find((item) => normalizeText(item?.capabilityId || item?.id || item?.serviceId || '') === capabilityId);
    if (match) return match;
  }
  return activePaid[0] || null;
}

function sortPaidCapabilities(capabilities = []) {
  // Prefer svc_btcusd_minute (Hyperliquid) first — reliable in CN; CoinGecko-based cap-market-price-feed
  // is consistently unreachable even through proxy, so move it to the end of the preferred list.
  const preferred = [
    'svc_btcusd_minute',
    'svc-live-btc-feed',
    'svc-compare-btc',
    'cap-weather-context',
    'cap-tech-buzz-signal',
    'cap-dex-market',
    'cap-market-price-feed'
  ];
  const rank = new Map(preferred.map((item, index) => [item, index]));
  return [...(Array.isArray(capabilities) ? capabilities : [])].sort((left, right) => {
    const leftId = normalizeText(left?.capabilityId || left?.id || left?.serviceId || '');
    const rightId = normalizeText(right?.capabilityId || right?.id || right?.serviceId || '');
    const leftRank = rank.has(leftId) ? rank.get(leftId) : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(rightId) ? rank.get(rightId) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return leftId.localeCompare(rightId);
  });
}

async function postJsonRpcToPath(baseUrl, pathname, body, { timeoutMs = 120000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawText = await response.text();
    const contentType = normalizeText(response.headers.get('content-type') || '').toLowerCase();
    const payload = contentType.includes('text/event-stream')
      ? parseSsePayload(rawText)
      : rawText
        ? JSON.parse(rawText)
        : {};
    return {
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callTool(baseUrl, connectPath, name, args, { timeoutMs = 120000, apiKey = '' } = {}) {
  const response = await postJsonRpcToPath(
    baseUrl,
    connectPath,
    {
      jsonrpc: '2.0',
      id: `${name}_${Date.now()}`,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    },
    {
      timeoutMs,
      headers: apiKey ? { 'x-api-key': apiKey } : {}
    }
  );
  assert(response.status === 200, `${name} transport failed with status ${response.status}`);
  assert(response.payload?.result?.isError !== true, normalizeText(response.payload?.result?.content?.[0]?.text || response.payload?.result?.structuredContent?.reason || `${name} returned MCP tool error`));
  return response.payload?.result || {};
}

async function callToolAllowError(baseUrl, connectPath, name, args, { timeoutMs = 120000, apiKey = '' } = {}) {
  const response = await postJsonRpcToPath(
    baseUrl,
    connectPath,
    {
      jsonrpc: '2.0',
      id: `${name}_${Date.now()}`,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    },
    {
      timeoutMs,
      headers: apiKey ? { 'x-api-key': apiKey } : {}
    }
  );
  assert(response.status === 200, `${name} transport failed with status ${response.status}`);
  return response.payload?.result || {};
}

async function listTools(baseUrl, connectPath, { apiKey = '' } = {}) {
  const response = await postJsonRpcToPath(
    baseUrl,
    connectPath,
    {
      jsonrpc: '2.0',
      id: `tools_list_${Date.now()}`,
      method: 'tools/list',
      params: {}
    },
    {
      headers: apiKey ? { 'x-api-key': apiKey } : {}
    }
  );
  assert(response.status === 200, `tools/list failed with status ${response.status}`);
  return Array.isArray(response.payload?.result?.tools) ? response.payload.result.tools : [];
}

async function loadCapabilitiesAt(baseUrl, apiKey) {
  const payload = await requestJsonAt(baseUrl, '/api/v1/capabilities?limit=100', { apiKey });
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function loadSessionRuntimeAt(baseUrl, apiKey) {
  return requestJsonAt(baseUrl, '/api/session/runtime', { apiKey });
}

async function pollJobState(baseUrl, connectPath, jobId, targetStates, { timeoutMs = 300000, intervalMs = 3000 } = {}) {
  const targets = new Set((Array.isArray(targetStates) ? targetStates : [targetStates]).map((item) => normalizeText(item).toLowerCase()));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await callTool(baseUrl, connectPath, 'ktrace__job_show', { jobId }, { timeoutMs: 45000 });
    const state = normalizeText(result?.structuredContent?.job?.state || '').toLowerCase();
    if (targets.has(state)) return result;
    if (['funding_failed', 'failed', 'rejected', 'expired'].includes(state) && !targets.has(state)) {
      throw new Error(`job ${jobId} entered unexpected state ${state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`job ${jobId} did not reach ${Array.from(targets).join(', ')} within ${timeoutMs}ms`);
}

const apiKey = resolveAgentApiKey();
const defaultPort = 34990 + Math.floor(Math.random() * 100);
process.env.PORT = normalizeText(process.env.MCP_LIVE_PORT || '') || String(defaultPort);
process.env.BACKEND_PUBLIC_URL = `http://127.0.0.1:${process.env.PORT}`;

const { startServer, shutdownServer } = await import('../app.js');

let started = false;
let exitCode = 0;
try {
  await startServer();
  started = true;

  const baseUrl = `http://127.0.0.1:${process.env.PORT}`;
  const runtimeContext = selectConsumerRuntimeContext({
    cwd: process.cwd(),
    env: process.env,
    envPrefix: 'MCP_LIVE',
    fallbackAgentId: '1',
    fallbackIdentityRegistry: normalizeText(process.env.ERC8004_IDENTITY_REGISTRY || '0x60BF18964FCB1B2E987732B0477E51594B3659B1'),
    preferManagedConsumer: USE_MANAGED_CONSUMER
  });
  const runtime = runtimeContext.runtime || {};
  const ownerEoa = normalizeText(runtimeContext.ownerEoa || runtime?.owner || '');
  const aaWallet = normalizeText(runtimeContext.aaWallet || runtime?.aaWallet || '');
  const consumerAgentId = normalizeText(
    process.env.MCP_LIVE_AGENT_ID ||
      runtimeContext.agentId ||
      runtime?.authorizedAgentId ||
      runtime?.authorizationPayload?.agentId ||
      ''
  );
  const consumerIdentityRegistry = normalizeAddress(
    process.env.MCP_LIVE_IDENTITY_REGISTRY ||
      runtimeContext.identityRegistry ||
      runtime?.authorizationPayload?.identityRegistry ||
      ''
  );
  const executor = resolveManagedRoleAaWallet(
    process.env.ERC8183_EXECUTOR_ADDRESS || '',
    resolveExecutorAddress()
  );
  const validator = resolveManagedRoleAaWallet(
    process.env.ERC8183_VALIDATOR_ADDRESS || '',
    resolveValidatorAddress()
  );
  const budget = normalizeText(process.env.MCP_LIVE_JOB_BUDGET || '0.00015');
  const client = 'inspector';
  const traceId = `mcp_ktrace_live_${Date.now()}`;
  const clientId = `ktrace-live-proof-${Date.now()}`;

  assert(apiKey, 'Missing internal agent API key for MCP live verifier.');
  assert(ownerEoa, 'Session runtime ownerEoa is missing.');
  assert(aaWallet, 'Session runtime aaWallet is missing.');
  assert(consumerAgentId, 'Session runtime consumer agentId is missing.');
  assert(consumerIdentityRegistry, 'Session runtime consumer identityRegistry is missing.');
  assert(executor, 'Missing executor AA address for MCP live verifier.');
  assert(validator, 'Missing validator AA address for MCP live verifier.');
  assert(normalizeText(runtime?.sessionId || ''), 'Session runtime sessionId is missing.');
  assert(normalizeText(runtime?.sessionAddress || ''), 'Session runtime sessionAddress is missing.');

  const preflightBalances = await loadWalletBalanceSummary({
    provider: createProvider(),
    tokenAddress: TOKEN_ADDRESS,
    wallet: aaWallet
  });
  console.log(
    JSON.stringify(
      {
        event: 'mcp_live_preflight',
        baseUrl,
        useManagedConsumer: USE_MANAGED_CONSUMER,
        runtimeSelection: runtimeContext.selection,
        currentOwner: normalizeText(runtimeContext.currentOwner || ''),
        ownerEoa,
        aaWallet,
        sessionId: normalizeText(runtime?.sessionId || ''),
        sessionAddress: normalizeText(runtime?.sessionAddress || ''),
        runtimeSource: normalizeText(runtime?.source || ''),
        authorizationMode: normalizeText(runtime?.authorizationMode || ''),
        authorityId: normalizeText(runtime?.authorityId || ''),
        authorityStatus: normalizeText(runtime?.authorityStatus || ''),
        sessionExpiresAt: formatExpiry(runtime?.expiresAt || 0),
        authorityExpiresAt: formatExpiry(runtime?.authorityExpiresAt || 0),
        authorizationExpiresAt: formatExpiry(runtime?.authorizationExpiresAt || 0),
        balances: preflightBalances,
        executor,
        validator
      },
      null,
      2
    )
  );

  const balancePrep = await ensureManagedConsumerBalances(aaWallet);
  console.log(
    `[mcp-live] consumer balances ready: native=${balancePrep.balances.native} token=${balancePrep.balances.token}`
  );

  const statusBefore = await requestJsonAt(
    baseUrl,
    `/api/connector/agent/status?owner=${encodeURIComponent(ownerEoa)}&client=${encodeURIComponent(client)}&clientId=${encodeURIComponent(clientId)}`,
    { apiKey }
  );
  const statusRuntime = statusBefore?.setup?.runtime || {};
  assert(
    normalizeAddress(statusRuntime?.owner || '') === normalizeAddress(ownerEoa),
    `connector status resolved owner ${normalizeText(statusRuntime?.owner || '') || '-'} instead of ${ownerEoa}`
  );
  assert(
    normalizeAddress(statusRuntime?.aaWallet || '') === normalizeAddress(aaWallet),
    `connector status resolved aaWallet ${normalizeText(statusRuntime?.aaWallet || '') || '-'} instead of ${aaWallet}`
  );

  await requestJsonAt(baseUrl, '/api/session/policy', {
    method: 'POST',
    apiKey,
    body: {
      ownerEoa,
      consumerAgentLabel: 'mcp-live-proof',
      allowedCapabilities: [],
      singleLimit: '0.05',
      dailyLimit: '0.50',
      totalLimit: '2.00'
    }
  });

  const bootstrap = await requestJsonAt(baseUrl, '/api/connector/agent/bootstrap', {
    method: 'POST',
    apiKey,
    body: {
      ownerEoa,
      client,
      clientId,
      agentId: consumerAgentId,
      identityRegistry: consumerIdentityRegistry,
      allowedBuiltinTools: [
        'artifact_receipt',
        'artifact_evidence',
        'flow_history',
        'flow_show',
        'job_create',
        'job_show',
        'job_audit'
      ]
    }
  });

  const connector = bootstrap?.connector || {};
  const connectorUrl = normalizeText(connector?.connectorUrl || '');
  const token = decodeURIComponent(connectorUrl.split('/mcp/connect/')[1] || '');
  assert(token.startsWith('ktrace_cc_'), 'Connector bootstrap did not return an install code token.');
  console.log('[mcp-live] connector bootstrap ok');

  const connectPath = `/mcp/connect/${encodeURIComponent(token)}`;
  const internalMcpPath = '/mcp';
  const tools = await listTools(baseUrl, connectPath);
  const internalTools = await listTools(baseUrl, internalMcpPath, { apiKey });
  const connectorGrant = findConnectorGrantRecord({
    cwd: process.cwd(),
    ownerEoa,
    client,
    clientId,
    agentId: consumerAgentId,
    identityRegistry: consumerIdentityRegistry
  });
  assert(connectorGrant, 'Connector grant was not persisted after tools/list.');
  assert(
    normalizeAddress(connectorGrant?.aaWallet || '') === normalizeAddress(aaWallet),
    `connector grant bound aaWallet ${normalizeText(connectorGrant?.aaWallet || '') || '-'} instead of ${aaWallet}`
  );
  console.log(`[mcp-live] connector tools listed: ${tools.length}`);
  console.log(`[mcp-live] internal tools listed: ${internalTools.length}`);
  const toolNames = new Set(tools.map((tool) => normalizeText(tool?.name)));
  const internalToolNames = new Set(internalTools.map((tool) => normalizeText(tool?.name)));
  for (const requiredTool of [
  'ktrace__flow_history',
  'ktrace__flow_show',
  'ktrace__artifact_receipt',
  'ktrace__artifact_evidence',
  'ktrace__job_create',
  'ktrace__job_show',
  'ktrace__job_audit'
  ]) {
    assert(toolNames.has(requiredTool), `Required MCP tool missing: ${requiredTool}`);
  }
  for (const requiredTool of [
    'ktrace__job_prepare_funding',
    'ktrace__job_fund',
    'ktrace__job_accept',
    'ktrace__job_submit',
    'ktrace__job_validate'
  ]) {
    assert(internalToolNames.has(requiredTool), `Required internal MCP tool missing: ${requiredTool}`);
  }

  const capabilities = await loadCapabilitiesAt(baseUrl, apiKey);
  const paidCandidates = sortPaidCapabilities(
    capabilities.filter((item) => item?.active !== false && Number(item?.pricing?.amount || item?.price || 0) > 0)
  );
  assert(paidCandidates.length > 0, 'No paid capability available for MCP live proof.');

  let paidCapability = null;
  let paidToolName = '';
  let paidCall = null;
  let paidError = null;
  let paidSource = 'fresh';
  const maxFreshPaidAttempts = Math.max(1, Number(process.env.MCP_LIVE_MAX_PAID_ATTEMPTS || 1) || 1);
  console.log(`[mcp-live] fresh paid probe: maxAttempts=${maxFreshPaidAttempts} probeTimeout=${FRESH_PROBE_TIMEOUT_MS}ms fullTimeout=${PAID_TOOL_TIMEOUT_MS}ms`);
  for (const candidate of paidCandidates.slice(0, maxFreshPaidAttempts)) {
    const candidateToolName = normalizeToolName(candidate?.capabilityId || candidate?.id || candidate?.serviceId || '');
    if (!toolNames.has(candidateToolName)) continue;
    console.log(`[mcp-live] trying paid tool: ${candidateToolName}`);
    const candidateTraceId = `${traceId}_${normalizeText(candidate?.capabilityId || candidate?.id || candidate?.serviceId || '')}`;
    // Use shorter probe timeout for first attempt; fallback happens immediately if it fails.
    const effectiveTimeout = FRESH_PROBE_TIMEOUT_MS;
    try {
      const candidateCall = await callToolAllowError(
        baseUrl,
        connectPath,
        candidateToolName,
        {
          ...(candidate?.exampleInput && typeof candidate.exampleInput === 'object' ? candidate.exampleInput : {}),
          payer: normalizeText(process.env.MCP_LIVE_PAYER_AA_OVERRIDE || '') || aaWallet,
          _meta: {
            traceId: candidateTraceId
          }
        },
        { timeoutMs: effectiveTimeout }
      );
      if (candidateCall?.isError === true) {
        const structured = candidateCall?.structuredContent && typeof candidateCall.structuredContent === 'object'
          ? candidateCall.structuredContent
          : {};
        const requestId = normalizeText(structured?.requestId || '');
        const traceIdForError = normalizeText(structured?.traceId || candidateTraceId);
        const reason = normalizeText(candidateCall?.content?.[0]?.text || structured?.reason || structured?.error || 'unknown_error');
        const x402Request = findX402RequestRecord({
          cwd: process.cwd(),
          requestId,
          traceId: traceIdForError
        });
        const observedPayer = normalizeAddress(x402Request?.payer || '');
        const routedAaWallet = observedPayer || extractAaWalletFromReason(reason);
        const failureLabel =
          routedAaWallet && normalizeAddress(routedAaWallet) !== normalizeAddress(aaWallet)
            ? `runtime_routing_bug via ${routedAaWallet}`
            : 'tool_error';
        paidError = new Error(reason || 'unknown_error');
        console.warn(
          `[mcp-live] paid tool failed: ${candidateToolName} :: ${failureLabel} :: requestId=${requestId || '-'} traceId=${traceIdForError || '-'} observedPayer=${observedPayer || '-'} reason=${reason || '-'}`
        );
        continue;
      }
      paidCall = candidateCall;
      paidCapability = candidate;
      paidToolName = candidateToolName;
      break;
    } catch (error) {
      paidError = error;
      console.warn(`[mcp-live] paid tool failed: ${candidateToolName} :: ${normalizeText(error?.message || 'unknown_error')}`);
    }
  }
  if (!paidCapability || !paidCall) {
    console.warn('[mcp-live] no fresh paid tool succeeded, falling back to existing local flow history');
    const fallbackInvocations = await requestJsonAt(baseUrl, '/api/service-invocations?limit=20', { apiKey });
    const fallbackItems = Array.isArray(fallbackInvocations?.items) ? fallbackInvocations.items : [];
    const fallbackInvocation = fallbackItems.find((item) => normalizeText(item?.traceId) && normalizeText(item?.requestId));
    assert(fallbackInvocation, paidError?.message || 'No paid MCP capability succeeded and no prior paid invocation was available.');
    paidCapability = paidCandidates[0] || null;
    paidToolName = '';
    paidCall = {
      structuredContent: {
        traceId: normalizeText(fallbackInvocation?.traceId),
        requestId: normalizeText(fallbackInvocation?.requestId),
        txHash: normalizeText(fallbackInvocation?.txHash),
        receipt: fallbackInvocation?.receipt || null,
        summary: normalizeText(fallbackInvocation?.summary || 'Loaded prior paid invocation.'),
        evidenceRef: `/api/evidence/export?traceId=${encodeURIComponent(normalizeText(fallbackInvocation?.traceId))}`,
        result: null
      }
    };
    paidSource = 'existing-history';
  }
  console.log(`[mcp-live] paid source selected: ${paidSource}${paidToolName ? ` (${paidToolName})` : ''}`);
  console.log('[mcp-live] paid tool call ok');

  const paidStructured = normalizeMcpCallResult({
    ...(paidCall?.structuredContent || {}),
    result: paidCall?.structuredContent?.result || null,
    summary: paidCall?.structuredContent?.summary || '',
    receipt: paidCall?.structuredContent?.receipt || null
  });
  assert(paidStructured.traceId, 'Paid MCP call did not return traceId.');
  assert(paidStructured.requestId, 'Paid MCP call did not return requestId.');
  assert(paidStructured.evidenceRef, 'Paid MCP call did not return evidenceRef.');

  const receiptTool = await callTool(baseUrl, connectPath, 'ktrace__artifact_receipt', {
    requestId: paidStructured.requestId
  });
  const evidenceTool = await callTool(baseUrl, connectPath, 'ktrace__artifact_evidence', {
    traceId: paidStructured.traceId
  });
  console.log('[mcp-live] receipt/evidence tools ok');
  const flowHistoryTool = await callTool(baseUrl, connectPath, 'ktrace__flow_history', {
    limit: 10
  });
  const flowShowTool = await callTool(baseUrl, connectPath, 'ktrace__flow_show', {
    traceId: paidStructured.traceId
  });
  console.log('[mcp-live] flow tools ok');

  const history = Array.isArray(flowHistoryTool?.structuredContent?.history) ? flowHistoryTool.structuredContent.history : [];
  assert(history.some((item) => normalizeText(item?.traceId) === paidStructured.traceId), 'flow_history did not include paid trace.');

  const jobCreate = await callTool(baseUrl, connectPath, 'ktrace__job_create', {
    provider: normalizeText(paidCapability?.providerId || paidCapability?.providerAgentId || 'fundamental-agent-real'),
    capability: normalizeText(paidCapability?.action || paidCapability?.capabilityId || paidCapability?.id || 'btc-price-feed'),
    budget,
    escrowAmount: budget,
    executor,
    validator,
    input: {
      task: 'Provide a BTC/USDT trading plan for today with market snapshot, bias, entry, take-profit levels, stop-loss, risk/reward ratio, and summary.',
      schema: BTC_TRADING_PLAN_V1_SCHEMA_ID,
      asset: 'BTC/USDT'
    }
  });
  const createdJob = jobCreate?.structuredContent?.job || {};
  const jobId = normalizeText(createdJob?.jobId || '');
  assert(jobId, 'job_create did not return jobId.');
  console.log(`[mcp-live] job created: ${jobId}`);

  await callTool(baseUrl, internalMcpPath, 'ktrace__job_prepare_funding', {
    jobId
  }, { timeoutMs: 180000, apiKey });
  console.log('[mcp-live] job funding prepared');

  await callTool(baseUrl, internalMcpPath, 'ktrace__job_fund', {
    jobId
  }, { timeoutMs: 360000, apiKey });
  await pollJobState(baseUrl, connectPath, jobId, 'funded');
  console.log('[mcp-live] job funded');

  await callTool(baseUrl, internalMcpPath, 'ktrace__job_accept', {
    jobId
  }, { apiKey });
  await pollJobState(baseUrl, connectPath, jobId, 'accepted');
  console.log('[mcp-live] job accepted');

  const delivery = buildTradingPlanFromResult(
    {
      ...paidStructured,
      result: paidCall?.structuredContent?.result || null,
      summary: paidCall?.structuredContent?.summary || ''
    },
    paidCapability
  );

  await callTool(baseUrl, internalMcpPath, 'ktrace__job_submit', {
    jobId,
    delivery,
    primaryTraceId: delivery.evidence.primaryTraceId,
    paymentRequestId: delivery.evidence.paymentRequestId,
    paymentTxHash: delivery.evidence.paymentTxHash,
    evidenceRef: delivery.evidence.primaryEvidenceRef,
    receiptRefs: delivery.evidence.receiptRefs,
    dataSourceTraceIds: delivery.evidence.dataSourceTraceIds,
    summary: delivery.analysis.summary
  }, { timeoutMs: 180000, apiKey });
  await pollJobState(baseUrl, connectPath, jobId, 'submitted');
  console.log('[mcp-live] job submitted');

  await callTool(baseUrl, internalMcpPath, 'ktrace__job_validate', {
    jobId,
    approved: true,
    summary: 'Validator approved the MCP live proof delivery.',
    validatorAddress: validator
  }, { timeoutMs: 180000, apiKey });
  const finalJob = await pollJobState(baseUrl, connectPath, jobId, 'completed');
  console.log('[mcp-live] job validated/completed');

  const jobShow = await callTool(baseUrl, connectPath, 'ktrace__job_show', {
    jobId
  });
  const jobAudit = await callTool(baseUrl, connectPath, 'ktrace__job_audit', {
    jobId
  });

  const statusAfter = await requestJsonAt(
    baseUrl,
    `/api/connector/agent/status?owner=${encodeURIComponent(ownerEoa)}&client=${encodeURIComponent(client)}&clientId=${encodeURIComponent(clientId)}`,
    { apiKey }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          baseUrl,
          ownerEoa,
          aaWallet,
          client,
          clientId,
          statusBefore: normalizeText(statusBefore?.connector?.state || ''),
          connectorState: normalizeText(statusAfter?.connector?.state || ''),
          connectorGrantId: normalizeText(connectorGrant?.grantId || ''),
          connectorGrantAaWallet: normalizeText(connectorGrant?.aaWallet || ''),
          paidSource,
          freshPaidSuccess: paidSource === 'fresh',
          paidToolName,
          paidTraceId: paidStructured.traceId,
          requestId: paidStructured.requestId,
          receiptLoaded: Boolean(receiptTool?.structuredContent?.receipt),
          evidenceLoaded: Boolean(evidenceTool?.structuredContent?.evidence),
          flowLoaded: Boolean(flowShowTool?.structuredContent?.workflow || flowShowTool?.structuredContent?.job || flowShowTool?.structuredContent?.purchase || flowShowTool?.structuredContent?.invocation),
          jobId,
          finalJobState: normalizeText(finalJob?.structuredContent?.job?.state || jobShow?.structuredContent?.job?.state || ''),
          auditLoaded: Boolean(jobAudit?.structuredContent?.audit)
        }
      },
      null,
      2
    )
  );
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  if (started) {
    await shutdownServer().catch(() => {});
  }
  setTimeout(() => process.exit(exitCode), 0);
}
