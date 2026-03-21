import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

export function normalizeText(value = '') {
  return String(value ?? '').trim();
}

export function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

export function normalizeAddress(value = '') {
  const raw = normalizeText(value);
  if (!raw || !ethers.isAddress(raw)) return '';
  return ethers.getAddress(raw);
}

export function parseJson(rawText = '') {
  return rawText ? JSON.parse(rawText) : {};
}

export function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseJson(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readJsonArraySafe(filePath) {
  const payload = readJsonFileSafe(filePath);
  return Array.isArray(payload) ? payload : [];
}

function dataPath(cwd, filename) {
  return path.resolve(cwd || process.cwd(), 'data', filename);
}

function listConsumerRuntimes(runtimeMap = {}) {
  return Object.values(runtimeMap).filter(
    (item) => item && typeof item === 'object' && normalizeLower(item.runtimePurpose || '') === 'consumer'
  );
}

function findRuntimeByAaWallet(runtimeMap = {}, aaWallet = '') {
  const normalizedAaWallet = normalizeAddress(aaWallet);
  if (!normalizedAaWallet) return null;
  return (
    Object.values(runtimeMap).find(
      (item) => normalizeAddress(item?.aaWallet || '') === normalizedAaWallet
    ) || null
  );
}

function pickCurrentOwnerRuntime(runtimeMap = {}, currentOwner = '') {
  const normalizedOwner = normalizeAddress(currentOwner);
  if (!normalizedOwner) return null;
  return runtimeMap[normalizedOwner] || runtimeMap[normalizedOwner.toLowerCase()] || null;
}

function matchesManagedPreference(runtime = {}, preferManagedConsumer = false) {
  const source = normalizeLower(runtime?.source || '');
  return preferManagedConsumer ? source !== 'self_serve_wallet' : source === 'self_serve_wallet';
}

function pickPreferredConsumerRuntime({
  runtimeMap = {},
  currentOwner = '',
  sessionRuntime = {},
  preferManagedConsumer = false
} = {}) {
  const currentRuntime = pickCurrentOwnerRuntime(runtimeMap, currentOwner);
  if (
    currentRuntime &&
    normalizeLower(currentRuntime?.runtimePurpose || '') === 'consumer' &&
    matchesManagedPreference(currentRuntime, preferManagedConsumer)
  ) {
    return { runtime: currentRuntime, selection: 'current_owner' };
  }

  const currentSessionRuntime =
    sessionRuntime &&
    typeof sessionRuntime === 'object' &&
    normalizeLower(sessionRuntime.runtimePurpose || '') === 'consumer' &&
    matchesManagedPreference(sessionRuntime, preferManagedConsumer)
      ? sessionRuntime
      : null;
  if (currentSessionRuntime) {
    return { runtime: currentSessionRuntime, selection: 'session_runtime' };
  }

  const consumers = listConsumerRuntimes(runtimeMap);
  const preferredRuntime = consumers.find((item) => matchesManagedPreference(item, preferManagedConsumer));
  if (preferredRuntime) {
    return { runtime: preferredRuntime, selection: preferManagedConsumer ? 'first_managed_consumer' : 'first_self_serve_consumer' };
  }

  const fallbackRuntime = consumers[0] || {};
  return { runtime: fallbackRuntime, selection: 'first_consumer' };
}

export function selectConsumerRuntimeContext({
  cwd = process.cwd(),
  env = process.env,
  envPrefix = 'MCP_SWEEP',
  fallbackAgentId = '1',
  fallbackIdentityRegistry = '',
  preferManagedConsumer = false
} = {}) {
  const sessionRuntime = readJsonFileSafe(dataPath(cwd, 'session_runtime.json')) || {};
  const sessionIndex = readJsonFileSafe(dataPath(cwd, 'session_runtimes.json')) || {};
  const runtimeMap =
    sessionIndex &&
    typeof sessionIndex === 'object' &&
    sessionIndex.runtimes &&
    typeof sessionIndex.runtimes === 'object'
      ? sessionIndex.runtimes
      : {};

  const explicitOwner = normalizeAddress(env[`${envPrefix}_OWNER_EOA`] || env[`${envPrefix}_OWNER`] || '');
  const explicitAaWallet = normalizeAddress(env[`${envPrefix}_AA_WALLET`] || '');
  const explicitAgentId = normalizeText(env[`${envPrefix}_AGENT_ID`] || '');
  const explicitIdentityRegistry = normalizeAddress(env[`${envPrefix}_IDENTITY_REGISTRY`] || '');

  let selectedRuntime = null;
  let selection = '';

  if (explicitOwner) {
    const ownerRuntime = pickCurrentOwnerRuntime(runtimeMap, explicitOwner);
    if (ownerRuntime && normalizeLower(ownerRuntime.runtimePurpose || '') === 'consumer') {
      selectedRuntime = ownerRuntime;
      selection = 'explicit_owner';
    }
  }

  if (!selectedRuntime && explicitAaWallet) {
    const aaRuntime = findRuntimeByAaWallet(runtimeMap, explicitAaWallet);
    if (aaRuntime && normalizeLower(aaRuntime.runtimePurpose || '') === 'consumer') {
      selectedRuntime = aaRuntime;
      selection = 'explicit_aa_wallet';
    }
  }

  if (!selectedRuntime) {
    const preferred = pickPreferredConsumerRuntime({
      runtimeMap,
      currentOwner: sessionIndex.currentOwner || '',
      sessionRuntime,
      preferManagedConsumer
    });
    selectedRuntime = preferred.runtime || {};
    selection = preferred.selection || 'fallback';
  }

  const ownerEoa = explicitOwner || normalizeAddress(selectedRuntime?.owner || '') || normalizeAddress(sessionRuntime?.owner || '');
  const aaWallet = explicitAaWallet || normalizeAddress(selectedRuntime?.aaWallet || '') || normalizeAddress(sessionRuntime?.aaWallet || '');
  const authorizationPayload =
    selectedRuntime?.authorizationPayload && typeof selectedRuntime.authorizationPayload === 'object'
      ? selectedRuntime.authorizationPayload
      : sessionRuntime?.authorizationPayload && typeof sessionRuntime.authorizationPayload === 'object'
        ? sessionRuntime.authorizationPayload
        : {};

  return {
    runtime: selectedRuntime && typeof selectedRuntime === 'object' ? selectedRuntime : {},
    ownerEoa,
    aaWallet,
    sessionId: normalizeText(selectedRuntime?.sessionId || sessionRuntime?.sessionId || ''),
    sessionAddress: normalizeText(selectedRuntime?.sessionAddress || sessionRuntime?.sessionAddress || ''),
    agentId:
      explicitAgentId ||
      normalizeText(selectedRuntime?.authorizedAgentId || authorizationPayload?.agentId || '') ||
      normalizeText(fallbackAgentId || ''),
    identityRegistry:
      explicitIdentityRegistry ||
      normalizeAddress(selectedRuntime?.authorizationPayload?.identityRegistry || authorizationPayload?.identityRegistry || '') ||
      normalizeAddress(fallbackIdentityRegistry || ''),
    source: normalizeText(selectedRuntime?.source || sessionRuntime?.source || ''),
    authorizationMode: normalizeText(selectedRuntime?.authorizationMode || sessionRuntime?.authorizationMode || ''),
    authorityId: normalizeText(selectedRuntime?.authorityId || sessionRuntime?.authorityId || ''),
    authorityStatus: normalizeText(selectedRuntime?.authorityStatus || sessionRuntime?.authorityStatus || ''),
    sessionExpiresAt: Number(selectedRuntime?.expiresAt || sessionRuntime?.expiresAt || 0),
    authorityExpiresAt: Number(selectedRuntime?.authorityExpiresAt || sessionRuntime?.authorityExpiresAt || 0),
    authorizationExpiresAt: Number(selectedRuntime?.authorizationExpiresAt || sessionRuntime?.authorizationExpiresAt || 0),
    selection,
    currentOwner: normalizeAddress(sessionIndex.currentOwner || ''),
    sessionRuntime,
    sessionIndex
  };
}

export function createKiteProvider({
  rpcUrl = '',
  timeoutMs = 120000
} = {}) {
  const rpcRequest = new ethers.FetchRequest(normalizeText(rpcUrl || 'https://rpc-testnet.gokite.ai/'));
  rpcRequest.timeout = Math.max(10000, Number(timeoutMs || 120000));
  const staticNetwork = ethers.Network.from({
    chainId: 2368,
    name: 'kite_testnet'
  });
  return new ethers.JsonRpcProvider(rpcRequest, staticNetwork, { staticNetwork });
}

export async function loadWalletBalanceSummary({
  provider,
  tokenAddress = '',
  wallet = ''
} = {}) {
  const normalizedWallet = normalizeAddress(wallet);
  if (!provider || !normalizedWallet) {
    return {
      native: '',
      token: '',
      tokenDecimals: 0,
      tokenAddress: normalizeAddress(tokenAddress),
      wallet: normalizedWallet
    };
  }
  const nativeBalance = await provider.getBalance(normalizedWallet);
  const normalizedTokenAddress = normalizeAddress(tokenAddress);
  if (!normalizedTokenAddress) {
    return {
      native: ethers.formatEther(nativeBalance),
      token: '',
      tokenDecimals: 0,
      tokenAddress: '',
      wallet: normalizedWallet
    };
  }
  const token = new ethers.Contract(
    normalizedTokenAddress,
    ['function balanceOf(address account) view returns (uint256)', 'function decimals() view returns (uint8)'],
    provider
  );
  const decimals = Number(await token.decimals().catch(() => 6));
  const tokenBalance = await token.balanceOf(normalizedWallet);
  return {
    native: ethers.formatEther(nativeBalance),
    token: ethers.formatUnits(tokenBalance, decimals),
    tokenDecimals: decimals,
    tokenAddress: normalizedTokenAddress,
    wallet: normalizedWallet
  };
}

export function formatExpiry(value = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return new Date(numeric).toISOString();
}

export function findConnectorGrantRecord({
  cwd = process.cwd(),
  ownerEoa = '',
  client = '',
  clientId = '',
  agentId = '',
  identityRegistry = ''
} = {}) {
  const rows = readJsonArraySafe(dataPath(cwd, 'connector_grants.json'));
  const normalizedOwner = normalizeAddress(ownerEoa);
  const normalizedClient = normalizeText(client);
  const normalizedClientId = normalizeText(clientId);
  const normalizedAgentId = normalizeText(agentId);
  const normalizedRegistry = normalizeAddress(identityRegistry);
  return (
    rows.find(
      (row) =>
        normalizeAddress(row?.ownerEoa || '') === normalizedOwner &&
        normalizeText(row?.client || '') === normalizedClient &&
        normalizeText(row?.clientId || '') === normalizedClientId &&
        normalizeText(row?.agentId || '') === normalizedAgentId &&
        normalizeAddress(row?.identityRegistry || '') === normalizedRegistry &&
        Number(row?.revokedAt || 0) === 0
    ) || null
  );
}

export function findX402RequestRecord({
  cwd = process.cwd(),
  requestId = '',
  traceId = ''
} = {}) {
  const rows = readJsonArraySafe(dataPath(cwd, 'x402_requests.json'));
  const normalizedRequestId = normalizeText(requestId);
  const normalizedTraceId = normalizeText(traceId);
  return (
    rows.find(
      (row) =>
        (normalizedRequestId && normalizeText(row?.requestId || '') === normalizedRequestId) ||
        (normalizedTraceId && normalizeText(row?.traceId || '') === normalizedTraceId)
    ) || null
  );
}

export function extractAaWalletFromReason(reason = '') {
  const match = normalizeText(reason).match(/AA wallet\s+(0x[a-fA-F0-9]{40})/);
  return match ? normalizeAddress(match[1]) : '';
}

export function envFlag(value = '') {
  return /^(1|true|yes|on)$/i.test(normalizeText(value));
}
