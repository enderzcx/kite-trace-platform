import { ethers } from 'ethers';
import { createCliError } from './errors.js';
import { requestJson, resolveAdminTransportApiKey, resolveAgentTransportApiKey } from './httpRuntime.js';

export function normalizeWalletAddress(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : '';
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
  const current = await readSessionSnapshot(runtime).catch(() => ({
    traceId: '',
    session: buildSessionSnapshot({})
  }));
  const currentReady = current.session.ready && sessionSnapshotMatchesWallet(current.session, wallet);

  if (sessionStrategy === 'external') {
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
    throw createCliError(
      current.session.sessionId || current.session.sessionAddress
        ? 'External session is not currently usable. Refresh it in the owning agent before retrying.'
        : 'No usable external session is available. Sync a valid session before retrying.',
      {
        code:
          current.session.sessionId || current.session.sessionAddress
            ? 'external_session_not_usable'
            : 'external_session_missing',
        data: {
          sessionStrategy,
          session: current.session
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
