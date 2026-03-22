import { ethers } from 'ethers';
import { GokiteAASDK } from '../../lib/gokite-aa-sdk.js';
import {
  resolveAaAccountImplementation,
  resolveAaFactoryAddress,
  resolveAaRequiredVersion
} from '../../lib/aaConfig.js';
import { getServiceProviderBytes32 } from '../../lib/addressPolicyHelpers.js';
import { applyNodeEnvProxyPreference } from '../../lib/envProxy.js';
import { createCliError } from './errors.js';
import { requestJson, resolveAdminTransportApiKey, resolveAgentTransportApiKey } from './httpRuntime.js';

const KITE_TESTNET_CHAIN_ID = 2368;

function resolveRpcTimeoutMs() {
  const configured = Number(
    process.env.KITE_RPC_TIMEOUT_MS ||
      process.env.KITE_PROVIDER_RPC_TIMEOUT_MS ||
      process.env.KITE_SESSION_RPC_TIMEOUT_MS ||
      60_000
  );
  if (!Number.isFinite(configured)) return 60_000;
  return Math.max(5_000, Math.min(Math.round(configured), 300_000));
}

function createKiteRpcProvider(rpcUrl = '') {
  applyNodeEnvProxyPreference();
  const request = new ethers.FetchRequest(String(rpcUrl || '').trim());
  request.timeout = resolveRpcTimeoutMs();
  const staticNetwork = ethers.Network.from({
    chainId: KITE_TESTNET_CHAIN_ID,
    name: 'kite_testnet'
  });
  return new ethers.JsonRpcProvider(request, staticNetwork, { staticNetwork });
}

export function normalizeWalletAddress(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? ethers.getAddress(raw) : '';
}

export function normalizeSessionStrategy(value = '', fallback = 'managed') {
  const raw = String(value || fallback || '').trim().toLowerCase();
  return raw === 'external' ? 'external' : 'managed';
}

export function normalizeSessionGrantText(value = '', fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function normalizeSessionGrantAddress(value = '') {
  const raw = normalizeSessionGrantText(value);
  if (!raw || !ethers.isAddress(raw)) return '';
  return ethers.getAddress(raw);
}

export function normalizeSessionGrantAmount(value, fallback = '') {
  const text = normalizeSessionGrantText(value, fallback);
  const numeric = Number(text);
  if (!text || !Number.isFinite(numeric) || numeric <= 0) return '';
  return text;
}

export function normalizeSessionGrantTimestamp(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return Number(fallback || 0);
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  const text = normalizeSessionGrantText(value);
  if (!text) return Number(fallback || 0);
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Number(fallback || 0);
}

export function normalizeAllowedCapabilities(value = '') {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
    ).sort();
  }
  return Array.from(
    new Set(
      normalizeSessionGrantText(value)
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
}

export function normalizeSessionGrantPayload(input = {}, fallback = {}) {
  const issuedAt = normalizeSessionGrantTimestamp(input.issuedAt, fallback.issuedAt || Date.now());
  const expiresAt = normalizeSessionGrantTimestamp(input.expiresAt, fallback.expiresAt || 0);
  return {
    schema: 'kite-session-grant-v1',
    agentId: normalizeSessionGrantText(input.agentId, fallback.agentId || ''),
    agentWallet: normalizeSessionGrantAddress(input.agentWallet || fallback.agentWallet || ''),
    identityRegistry: normalizeSessionGrantAddress(
      input.identityRegistry || fallback.identityRegistry || ''
    ),
    chainId: normalizeSessionGrantText(input.chainId, fallback.chainId || ''),
    payerAaWallet: normalizeSessionGrantAddress(input.payerAaWallet || fallback.payerAaWallet || ''),
    tokenAddress: normalizeSessionGrantAddress(input.tokenAddress || fallback.tokenAddress || ''),
    gatewayRecipient: normalizeSessionGrantAddress(
      input.gatewayRecipient || fallback.gatewayRecipient || ''
    ),
    audience: normalizeSessionGrantText(input.audience, fallback.audience || ''),
    singleLimit: normalizeSessionGrantAmount(input.singleLimit, fallback.singleLimit || ''),
    dailyLimit: normalizeSessionGrantAmount(input.dailyLimit, fallback.dailyLimit || ''),
    allowedCapabilities: normalizeAllowedCapabilities(
      input.allowedCapabilities ?? fallback.allowedCapabilities ?? []
    ),
    nonce: normalizeSessionGrantText(input.nonce, fallback.nonce || ''),
    issuedAt,
    expiresAt
  };
}

export function buildSessionGrantMessage(payloadInput = {}) {
  const payload = normalizeSessionGrantPayload(payloadInput);
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
    `issuedAt: ${new Date(payload.issuedAt || 0).toISOString()}`,
    `expiresAt: ${new Date(payload.expiresAt || 0).toISOString()}`
  ].join('\n');
}

export function createSessionAuthorizationMessage({ payload = {}, userEoa = '' } = {}) {
  return [
    buildSessionGrantMessage(payload),
    `userEoa: ${normalizeSessionGrantAddress(userEoa || '')}`
  ].join('\n');
}

export function buildSessionSnapshot(raw = {}) {
  const owner = normalizeWalletAddress(raw?.owner || '');
  const aaWallet = normalizeWalletAddress(raw?.aaWallet || '');
  const sessionAddress = normalizeWalletAddress(raw?.sessionAddress || raw?.address || '');
  const sessionId = String(raw?.sessionId || raw?.id || '').trim();
  const sessionTxHash = String(raw?.sessionTxHash || raw?.txHash || '').trim();
  const hasSessionPrivateKey = Boolean(raw?.hasSessionPrivateKey);
  const ready = Boolean(aaWallet && sessionAddress && sessionId && hasSessionPrivateKey);

  return {
    owner,
    aaWallet,
    sessionAddress,
    sessionId,
    sessionTxHash,
    maxPerTx: Number(raw?.maxPerTx || 0),
    dailyLimit: Number(raw?.dailyLimit || 0),
    gatewayRecipient: String(raw?.gatewayRecipient || '').trim(),
    tokenAddress: normalizeWalletAddress(raw?.tokenAddress || ''),
    sessionPrivateKeyMasked: String(raw?.sessionPrivateKeyMasked || '').trim(),
    hasSessionPrivateKey,
    authorizedBy: normalizeWalletAddress(raw?.authorizedBy || ''),
    authorizedAt: Number(raw?.authorizedAt || 0),
    authorizationMode: String(raw?.authorizationMode || '').trim(),
    authorizationPayload: raw?.authorizationPayload && typeof raw.authorizationPayload === 'object' ? raw.authorizationPayload : null,
    authorizationPayloadHash: String(raw?.authorizationPayloadHash || '').trim(),
    authorizationSignatureMasked: String(raw?.authorizationSignatureMasked || '').trim(),
    hasAuthorizationSignature: Boolean(raw?.hasAuthorizationSignature),
    authorizationNonce: String(raw?.authorizationNonce || '').trim(),
    authorizationExpiresAt: Number(raw?.authorizationExpiresAt || 0),
    authorizedAgentId: String(raw?.authorizedAgentId || '').trim(),
    authorizedAgentWallet: normalizeWalletAddress(raw?.authorizedAgentWallet || ''),
    authorizationAudience: String(raw?.authorizationAudience || '').trim(),
    allowedCapabilities: normalizeAllowedCapabilities(raw?.allowedCapabilities || []),
    source: String(raw?.source || '').trim(),
    updatedAt: Number(raw?.updatedAt || 0),
    ready
  };
}

export function buildLocalSessionRuntime(raw = {}) {
  const snapshot = buildSessionSnapshot({
    ...raw,
    hasSessionPrivateKey: /^0x[0-9a-fA-F]{64}$/.test(String(raw?.sessionPrivateKey || '').trim())
  });
  const sessionPrivateKey = normalizePrivateKey(raw?.sessionPrivateKey || '');
  return {
    ...snapshot,
    sessionPrivateKey: /^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey) ? sessionPrivateKey : '',
    ready: Boolean(snapshot.aaWallet && snapshot.sessionAddress && snapshot.sessionId && /^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey))
  };
}

export function readLocalSessionRuntime(runtime = {}) {
  return buildLocalSessionRuntime(runtime?.localSessionRuntime || {});
}

export function sessionSnapshotMatchesWallet(session = {}, wallet = '') {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet) return true;
  const owner = normalizeWalletAddress(session?.owner || '');
  return !owner || owner === normalizedWallet;
}

export async function readSessionSnapshot(runtime = {}) {
  const payload = await requestJson(runtime, {
    pathname: '/api/session/runtime',
    apiKey: resolveAgentTransportApiKey(runtime) || resolveAdminTransportApiKey(runtime)
  });
  return {
    traceId: String(payload?.traceId || '').trim(),
    session: buildSessionSnapshot(payload?.runtime || {})
  };
}

export async function readCurrentIdentityProfile(runtime = {}) {
  const payload = await requestJson(runtime, {
    pathname: '/api/identity/current',
    apiKey: resolveAgentTransportApiKey(runtime) || resolveAdminTransportApiKey(runtime)
  });
  return payload?.profile && typeof payload.profile === 'object' ? payload.profile : {};
}

export async function ensureUsableSession(
  runtime = {},
  {
    wallet = '',
    strategy = runtime?.sessionStrategy,
    singleLimit = '',
    dailyLimit = '',
    tokenAddress = '',
    gatewayRecipient = '',
    forceNewSession = false
  } = {}
) {
  const sessionStrategy = normalizeSessionStrategy(strategy, runtime?.sessionStrategy || 'managed');
  const localRuntime = readLocalSessionRuntime(runtime);
  const current = await readSessionSnapshot(runtime).catch(() => ({
    traceId: '',
    session: buildSessionSnapshot({})
  }));
  const currentReady = current.session.ready && sessionSnapshotMatchesWallet(current.session, wallet);
  const localReady = localRuntime.ready && sessionSnapshotMatchesWallet(localRuntime, wallet);

  if (sessionStrategy === 'external') {
    if (localReady && !forceNewSession) {
      return {
        checked: true,
        created: false,
        reused: true,
        renewed: false,
        sessionStrategy,
        traceId: current.traceId,
        session: localRuntime,
        local: true
      };
    }
    if (currentReady && !forceNewSession) {
      return {
        checked: true,
        created: false,
        reused: true,
        renewed: false,
        sessionStrategy,
        traceId: current.traceId,
        session: current.session,
        local: false
      };
    }
    throw createCliError(
      localRuntime.sessionId || localRuntime.sessionAddress
        ? 'Local external session is not currently usable. Re-authorize or recreate it in the owning agent.'
        : current.session.sessionId || current.session.sessionAddress
          ? 'External session exists on the backend but no local session key is available. Re-authorize on this agent.'
          : 'No usable external session is available. Authorize a local session before retrying.',
      {
        code:
          localRuntime.sessionId || localRuntime.sessionAddress || current.session.sessionId || current.session.sessionAddress
            ? 'external_session_not_usable'
            : 'external_session_missing',
        data: {
          sessionStrategy,
          session: current.session,
          localSession: localRuntime
        }
      }
    );
  }

  if (currentReady && !forceNewSession) {
    return {
      checked: true,
      created: false,
      reused: true,
      renewed: false,
      sessionStrategy,
      traceId: current.traceId,
      session: current.session
    };
  }

  const payload = await requestJson(runtime, {
    method: 'POST',
    pathname: '/api/session/runtime/ensure',
    apiKey: resolveAgentTransportApiKey(runtime) || resolveAdminTransportApiKey(runtime),
    timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 90_000),
    body: {
      ...(wallet ? { owner: wallet } : {}),
      ...(singleLimit ? { singleLimit } : {}),
      ...(dailyLimit ? { dailyLimit } : {}),
      ...(tokenAddress ? { tokenAddress } : {}),
      ...(gatewayRecipient ? { gatewayRecipient } : {}),
      ...(forceNewSession ? { forceNewSession: true } : {})
    }
  });
  const session = buildSessionSnapshot({
    ...(payload?.runtime || {}),
    owner: payload?.owner || payload?.runtime?.owner || '',
    aaWallet: payload?.aaWallet || payload?.runtime?.aaWallet || '',
    sessionAddress: payload?.session?.address || payload?.runtime?.sessionAddress || '',
    sessionId: payload?.session?.id || payload?.runtime?.sessionId || '',
    sessionTxHash: payload?.session?.txHash || payload?.runtime?.sessionTxHash || '',
    maxPerTx: payload?.session?.maxPerTx ?? payload?.runtime?.maxPerTx,
    dailyLimit: payload?.session?.dailyLimit ?? payload?.runtime?.dailyLimit,
    gatewayRecipient: payload?.session?.gatewayRecipient || payload?.runtime?.gatewayRecipient || '',
    tokenAddress: payload?.session?.tokenAddress || payload?.runtime?.tokenAddress || ''
  });

  return {
    checked: true,
    created: Boolean(payload?.created),
    reused: Boolean(payload?.reused),
    renewed: Boolean(payload?.created),
    sessionStrategy,
    traceId: String(payload?.traceId || '').trim(),
    session
  };
}

export function normalizePrivateKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

export async function createSelfCustodialSession(
  runtime = {},
  {
    ownerPrivateKey = '',
    sessionPrivateKey = '',
    sessionAddress = '',
    singleLimit = '',
    dailyLimit = '',
    tokenAddress = '',
    gatewayRecipient = '',
    forceNewSession = false
  } = {}
) {
  const normalizedOwnerKey = normalizePrivateKey(ownerPrivateKey);
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedOwnerKey)) {
    throw createCliError('A valid owner private key is required for self-custodial AA setup.', {
      code: 'self_custodial_owner_key_required'
    });
  }
  const normalizedSingleLimit = normalizeSessionGrantAmount(singleLimit);
  const normalizedDailyLimit = normalizeSessionGrantAmount(dailyLimit);
  if (!normalizedSingleLimit || !normalizedDailyLimit) {
    throw createCliError('Self-custodial session creation requires positive single/daily limits.', {
      code: 'self_custodial_limits_required'
    });
  }
  const normalizedTokenAddress = normalizeSessionGrantAddress(tokenAddress);
  if (!normalizedTokenAddress) {
    throw createCliError('A valid token address is required for self-custodial session creation.', {
      code: 'self_custodial_token_required'
    });
  }
  const normalizedGatewayRecipient = normalizeSessionGrantAddress(gatewayRecipient);
  if (!normalizedGatewayRecipient) {
    throw createCliError('A valid gateway recipient is required for self-custodial session creation.', {
      code: 'self_custodial_gateway_required'
    });
  }

  const rpcUrl = String(process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/').trim();
  const bundlerUrl = String(
    process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/'
  ).trim();
  const entryPointAddress = String(
    process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
  ).trim();
  const requiredAaVersion = String(
    resolveAaRequiredVersion()
  ).trim();
  const accountFactoryAddress = resolveAaFactoryAddress();
  const accountImplementationAddress = resolveAaAccountImplementation();
  const saltRaw = String(process.env.KITECLAW_AA_SALT || '0').trim() || '0';

  let salt = 0n;
  try {
    salt = BigInt(saltRaw);
  } catch {
    throw createCliError(`Invalid KITECLAW_AA_SALT value: ${saltRaw}`, {
      code: 'self_custodial_invalid_salt'
    });
  }

  const provider = createKiteRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(normalizedOwnerKey, provider);
  const owner = normalizeSessionGrantAddress(ownerWallet.address || '');
  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl,
    bundlerUrl,
    entryPointAddress,
    accountFactoryAddress,
    accountImplementationAddress
  });
  const aaWallet = await sdk.resolveAccountAddress(owner, salt);
  const beforeCode = await provider.getCode(aaWallet);
  if (!beforeCode || beforeCode === '0x') {
    const factory = new ethers.Contract(
      accountFactoryAddress,
      ['function createAccount(address owner, uint256 salt) returns (address)'],
      ownerWallet
    );
    const deployTx = await factory.createAccount(owner, salt);
    await deployTx.wait();
    const afterCode = await provider.getCode(aaWallet);
    if (!afterCode || afterCode === '0x') {
      throw createCliError(
        `AA deployment did not produce contract code at ${aaWallet}.`,
        {
          code: 'self_custodial_aa_deploy_failed',
          data: {
            owner,
            aaWallet,
            salt: salt.toString(),
            txHash: String(deployTx.hash || '').trim()
          }
        }
      );
    }
  }

  const account = new ethers.Contract(
    aaWallet,
    [
      'function addSupportedToken(address token) external',
      'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
      'function sessionExists(bytes32 sessionId) view returns (bool)',
      'function getSessionAgent(bytes32 sessionId) view returns (address)',
      'function owner() view returns (address)',
      'function version() view returns (string)'
    ],
    ownerWallet
  );

  const onchainOwner = normalizeSessionGrantAddress(await account.owner().catch(() => ''));
  if (onchainOwner && onchainOwner !== owner) {
    throw createCliError(`AA owner mismatch. onchain=${onchainOwner}, local=${owner}`, {
      code: 'self_custodial_owner_mismatch'
    });
  }
  const aaVersion = String(await account.version().catch(() => '')).trim();
  if (requiredAaVersion && aaVersion !== requiredAaVersion) {
    throw createCliError(
      `AA version mismatch for session payments. required=${requiredAaVersion}, current=${aaVersion || 'unknown_or_legacy'}`,
      { code: 'self_custodial_aa_version_mismatch' }
    );
  }

  try {
    const tokenTx = await account.addSupportedToken(normalizedTokenAddress);
    await tokenTx.wait();
  } catch {
    // addSupportedToken may already be configured.
  }

  const latestBlock = await provider.getBlock('latest');
  const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
  const rules = [
    {
      timeWindow: 0n,
      budget: ethers.parseUnits(normalizedSingleLimit, 18),
      initialWindowStartTime: 0,
      targetProviders: []
    },
    {
      timeWindow: 86400n,
      budget: ethers.parseUnits(normalizedDailyLimit, 18),
      initialWindowStartTime: Math.max(0, nowTs - 1),
      targetProviders: []
    }
  ];

  const normalizedSessionPrivateKey = normalizePrivateKey(sessionPrivateKey);
  const requestedSessionAddress = normalizeSessionGrantAddress(sessionAddress);
  const hasSessionPrivateKey = /^0x[0-9a-fA-F]{64}$/.test(normalizedSessionPrivateKey);
  const sessionSigner = hasSessionPrivateKey ? new ethers.Wallet(normalizedSessionPrivateKey) : null;
  const resolvedSessionAddress = normalizeSessionGrantAddress(sessionSigner?.address || requestedSessionAddress || '');
  if (!resolvedSessionAddress) {
    throw createCliError(
      'A valid session private key or session address is required for self-custodial session creation.',
      {
        code: 'self_custodial_session_address_required'
      }
    );
  }
  if (sessionSigner && requestedSessionAddress && requestedSessionAddress !== resolvedSessionAddress) {
    throw createCliError('The supplied session key does not match the requested session address.', {
      code: 'self_custodial_session_address_mismatch'
    });
  }
  const sessionId = ethers.keccak256(
    ethers.toUtf8Bytes(`${resolvedSessionAddress}-${Date.now()}-${Math.random()}`)
  );
  const sessionTx = await account.createSession(sessionId, resolvedSessionAddress, rules);
  await sessionTx.wait();

  const [exists, onchainAgent] = await Promise.all([
    account.sessionExists(sessionId),
    account.getSessionAgent(sessionId)
  ]);
  if (!exists) {
    throw createCliError(`Session not found on-chain after tx: ${sessionId}`, {
      code: 'self_custodial_session_missing'
    });
  }
  if (normalizeSessionGrantAddress(onchainAgent || '') !== resolvedSessionAddress) {
    throw createCliError(
      `On-chain session agent mismatch. expected=${normalizeSessionGrantAddress(onchainAgent || '')}, local=${resolvedSessionAddress}`,
      { code: 'self_custodial_session_agent_mismatch' }
    );
  }

  return {
    owner,
    aaWallet,
    sessionAddress: resolvedSessionAddress,
    sessionPrivateKey: sessionSigner?.privateKey || '',
    sessionId,
    sessionTxHash: String(sessionTx.hash || '').trim(),
    accountCreatedNow: false,
    accountTxHash: '',
    maxPerTx: Number(normalizedSingleLimit),
    dailyLimit: Number(normalizedDailyLimit),
    gatewayRecipient: normalizedGatewayRecipient,
    source: forceNewSession ? 'cli-self-custodial-force-new' : 'cli-self-custodial',
    ready: true
  };
}

export async function sendLocalSessionPayment(
  runtime = {},
  {
    tokenAddress = '',
    recipient = '',
    amount = '',
    requestId = '',
    action = '',
    query = ''
  } = {}
) {
  const localRuntime = readLocalSessionRuntime(runtime);
  if (!localRuntime.ready || !localRuntime.sessionPrivateKey) {
    throw createCliError('No usable local external session is available for agent-first payment.', {
      code: 'local_session_missing',
      data: {
        session: localRuntime
      }
    });
  }

  const normalizedTokenAddress = normalizeSessionGrantAddress(tokenAddress);
  const normalizedRecipient = normalizeSessionGrantAddress(recipient);
  if (!normalizedTokenAddress) {
    throw createCliError('A valid token address is required for local session payment.', {
      code: 'local_payment_token_required'
    });
  }
  if (!normalizedRecipient) {
    throw createCliError('A valid recipient is required for local session payment.', {
      code: 'local_payment_recipient_required'
    });
  }
  const amountText = normalizeSessionGrantAmount(amount);
  if (!amountText) {
    throw createCliError('A positive amount is required for local session payment.', {
      code: 'local_payment_amount_required'
    });
  }

  const rpcUrl = String(process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/').trim();
  const bundlerUrl = String(
    process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/'
  ).trim();
  const entryPointAddress = String(
    process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
  ).trim();
  const requiredAaVersion = String(
    resolveAaRequiredVersion()
  ).trim();
  const accountFactoryAddress = resolveAaFactoryAddress();
  const accountImplementationAddress = resolveAaAccountImplementation();

  const provider = createKiteRpcProvider(rpcUrl);
  const sessionWallet = new ethers.Wallet(localRuntime.sessionPrivateKey, provider);
  const sessionSignerAddress = normalizeSessionGrantAddress(await sessionWallet.getAddress());
  const accountCode = await provider.getCode(localRuntime.aaWallet);
  if (!accountCode || accountCode === '0x') {
    throw createCliError(`No contract code found at local aaWallet: ${localRuntime.aaWallet}`, {
      code: 'local_payment_aa_missing'
    });
  }

  const versionReadAbi = ['function version() view returns (string)'];
  let aaVersion = '';
  try {
    const versionContract = new ethers.Contract(localRuntime.aaWallet, versionReadAbi, provider);
    aaVersion = String(await versionContract.version()).trim();
  } catch {
    aaVersion = '';
  }
  if (requiredAaVersion && aaVersion !== requiredAaVersion) {
    throw createCliError(
      `AA version mismatch for session payments. required=${requiredAaVersion}, current=${aaVersion || 'unknown_or_legacy'}`,
      {
        code: 'local_payment_aa_version_mismatch'
      }
    );
  }

  const tokenContract = new ethers.Contract(
    normalizedTokenAddress,
    [
      'function balanceOf(address account) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ],
    provider
  );
  const decimalsRaw = await tokenContract.decimals().catch(() => 18);
  const decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : 18;
  const amountRaw = ethers.parseUnits(amountText, decimals);

  const sessionReadAbi = [
    'function sessionExists(bytes32 sessionId) view returns (bool)',
    'function getSessionAgent(bytes32 sessionId) view returns (address)',
    'function checkSpendingRules(bytes32 sessionId, uint256 normalizedAmount, bytes32 serviceProvider) view returns (bool)'
  ];
  const account = new ethers.Contract(localRuntime.aaWallet, sessionReadAbi, provider);
  const serviceProvider = getServiceProviderBytes32(action);
  const [exists, agentAddr, rulePass, aaBalance] = await Promise.all([
    account.sessionExists(localRuntime.sessionId),
    account.getSessionAgent(localRuntime.sessionId),
    account.checkSpendingRules(localRuntime.sessionId, amountRaw, serviceProvider),
    tokenContract.balanceOf(localRuntime.aaWallet)
  ]);
  if (!exists) {
    throw createCliError(`Session not found on-chain: ${localRuntime.sessionId}`, {
      code: 'local_payment_session_missing'
    });
  }
  if (normalizeSessionGrantAddress(agentAddr || '') !== sessionSignerAddress) {
    throw createCliError(
      `On-chain session agent mismatch. expected=${normalizeSessionGrantAddress(agentAddr || '')}, local=${sessionSignerAddress}`,
      {
        code: 'local_payment_session_agent_mismatch'
      }
    );
  }
  if (!rulePass) {
    throw createCliError('Session spending rule precheck failed (amount/provider out of scope).', {
      code: 'local_payment_rule_failed'
    });
  }
  if (aaBalance < amountRaw) {
    throw createCliError(`AA wallet ${localRuntime.aaWallet} has insufficient token balance.`, {
      code: 'local_payment_insufficient_funds',
      data: {
        balance: ethers.formatUnits(aaBalance, decimals),
        required: amountText
      }
    });
  }

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl,
    bundlerUrl,
    entryPointAddress,
    accountFactoryAddress,
    accountImplementationAddress,
    proxyAddress: localRuntime.aaWallet,
    bundlerRpcTimeoutMs: Number(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS || 15000),
    bundlerRpcRetries: Number(process.env.KITE_BUNDLER_RPC_RETRIES || 3),
    bundlerRpcBackoffBaseMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_BASE_MS || 650),
    bundlerRpcBackoffMaxMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_MAX_MS || 6000),
    bundlerRpcBackoffFactor: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_FACTOR || 2),
    bundlerRpcBackoffJitterMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_JITTER_MS || 250),
    bundlerReceiptPollIntervalMs: Number(process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS || 1000)
  });
  if (localRuntime.owner) {
    sdk.config.ownerAddress = localRuntime.owner;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const authPayload = {
    from: localRuntime.aaWallet,
    to: normalizedRecipient,
    token: normalizedTokenAddress,
    value: amountRaw,
    validAfter: BigInt(Math.max(0, nowSec - 30)),
    validBefore: BigInt(nowSec + 10 * 60),
    nonce: ethers.hexlify(ethers.randomBytes(32))
  };
  const authSignature = await sdk.buildTransferAuthorizationSignature(sessionWallet, authPayload);
  const metadata = ethers.hexlify(
    ethers.toUtf8Bytes(
      JSON.stringify({
        requestId: String(requestId || '').trim(),
        action: String(action || '').trim(),
        query: String(query || '').trim()
      })
    )
  );
  const signFunction = async (userOpHash) => sessionWallet.signMessage(ethers.getBytes(userOpHash));
  const result = await sdk.sendSessionTransferWithAuthorizationAndProvider(
    {
      sessionId: localRuntime.sessionId,
      auth: authPayload,
      authSignature,
      serviceProvider,
      metadata
    },
    signFunction,
    {
      callGasLimit: 320000n,
      verificationGasLimit: 450000n,
      preVerificationGas: 120000n
    }
  );
  if (!result || result.status !== 'success' || !result.transactionHash) {
    throw createCliError(String(result?.reason || 'local session payment failed').trim(), {
      code: 'local_payment_failed',
      data: {
        result
      }
    });
  }

  return {
    status: 'paid',
    payment: {
      requestId: String(requestId || '').trim(),
      tokenAddress: normalizedTokenAddress,
      recipient: normalizedRecipient,
      amount: amountText,
      amountWei: amountRaw.toString(),
      aaWallet: localRuntime.aaWallet,
      sessionAddress: localRuntime.sessionAddress,
      sessionId: localRuntime.sessionId,
      txHash: String(result.transactionHash || '').trim(),
      userOpHash: String(result.userOpHash || '').trim(),
      aaVersion
    },
    paymentProof: {
      requestId: String(requestId || '').trim(),
      txHash: String(result.transactionHash || '').trim(),
      payer: localRuntime.aaWallet,
      tokenAddress: normalizedTokenAddress,
      recipient: normalizedRecipient,
      amount: amountText
    }
  };
}
