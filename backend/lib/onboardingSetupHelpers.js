import crypto from 'crypto';
import { ethers } from 'ethers';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function normalizePositiveInt(value, fallbackValue = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
  const fallback = Number(fallbackValue);
  return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 0;
}

function createBase58Value(buffer) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  let value = BigInt(`0x${buffer.toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = `${alphabet[remainder]}${encoded}`;
    value /= 58n;
  }
  let leadingZeros = 0;
  for (const byte of buffer) {
    if (byte !== 0) break;
    leadingZeros += 1;
  }
  return `${'1'.repeat(leadingZeros)}${encoded || '1'}`;
}

function encodeBase64UrlJson(payload = {}) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeBase64UrlJson(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  try {
    return JSON.parse(Buffer.from(normalized, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function sanitizeChallengeRow(normalizeAddress, row = {}) {
  const ownerEoa = normalizeAddress(row.ownerEoa || '');
  const challengeId = normalizeText(row.challengeId || '');
  const chainId = normalizeText(row.chainId || '');
  const nonce = normalizeText(row.nonce || '');
  const message = normalizeText(row.message || '');
  const traceId = normalizeText(row.traceId || '');
  const status = normalizeLower(row.status || 'pending') || 'pending';
  const issuedAt = normalizePositiveInt(row.issuedAt);
  const expiresAt = normalizePositiveInt(row.expiresAt);
  const usedAt = normalizePositiveInt(row.usedAt);
  const verifiedAt = normalizePositiveInt(row.verifiedAt);
  return {
    challengeId,
    ownerEoa: ethers.isAddress(ownerEoa) ? ownerEoa : '',
    chainId,
    nonce,
    message,
    traceId,
    status,
    issuedAt,
    expiresAt,
    usedAt,
    verifiedAt
  };
}

function sanitizeAccountApiKeyRow(normalizeAddress, row = {}) {
  const keyId = normalizeText(row.keyId || '');
  const ownerEoa = normalizeAddress(row.ownerEoa || '');
  const role = normalizeLower(row.role || 'agent') || 'agent';
  const keyHash = normalizeText(row.keyHash || '');
  const prefix = normalizeText(row.prefix || '');
  const maskedPreview = normalizeText(row.maskedPreview || '');
  const label = normalizeText(row.label || '');
  const createdAt = normalizePositiveInt(row.createdAt);
  const lastUsedAt = normalizePositiveInt(row.lastUsedAt);
  const revokedAt = normalizePositiveInt(row.revokedAt);
  const revokedReason = normalizeText(row.revokedReason || '');
  const createdBy = normalizeText(row.createdBy || '');
  return {
    keyId,
    ownerEoa: ethers.isAddress(ownerEoa) ? ownerEoa : '',
    role,
    keyHash: /^[0-9a-f]{64}$/i.test(keyHash) ? keyHash.toLowerCase() : '',
    prefix,
    maskedPreview,
    label,
    createdAt,
    lastUsedAt,
    revokedAt,
    revokedReason,
    createdBy
  };
}

function sanitizeCookiePayload(normalizeAddress, payload = {}) {
  const ownerEoa = normalizeAddress(payload.ownerEoa || '');
  const chainId = normalizeText(payload.chainId || '');
  const issuedAt = normalizePositiveInt(payload.iat);
  const expiresAt = normalizePositiveInt(payload.exp);
  const sessionId = normalizeText(payload.sid || '');
  if (!ethers.isAddress(ownerEoa) || !expiresAt || !sessionId) return null;
  return {
    ownerEoa,
    chainId,
    iat: issuedAt,
    exp: expiresAt,
    sid: sessionId
  };
}

export function createOnboardingSetupHelpers({
  ONBOARDING_COOKIE_NAME = 'ktrace_onboard',
  ONBOARDING_COOKIE_SECRET = '',
  ONBOARDING_COOKIE_TTL_MS = 30 * 60 * 1000,
  ONBOARDING_CHALLENGE_TTL_MS = 10 * 60 * 1000,
  ONBOARDING_CHALLENGE_MAX_ROWS = 500,
  NODE_ENV = '',
  createTraceId,
  normalizeAddress,
  readOnboardingChallenges,
  writeOnboardingChallenges,
  readAccountApiKeys,
  writeAccountApiKeys
} = {}) {
  const cookieSecret = normalizeText(ONBOARDING_COOKIE_SECRET || '');
  const cookieName = normalizeText(ONBOARDING_COOKIE_NAME || 'ktrace_onboard') || 'ktrace_onboard';
  const cookieTtlMs = normalizePositiveInt(ONBOARDING_COOKIE_TTL_MS, 30 * 60 * 1000);
  const challengeTtlMs = normalizePositiveInt(ONBOARDING_CHALLENGE_TTL_MS, 10 * 60 * 1000);
  const challengeMaxRows = normalizePositiveInt(ONBOARDING_CHALLENGE_MAX_ROWS, 500);
  const cookieSecure = normalizeLower(NODE_ENV) === 'production';

  function buildOnboardingCookieOptions(expiresAt = Date.now() + cookieTtlMs) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      expires: new Date(expiresAt),
      path: '/'
    };
  }

  function signTokenPayload(payload = {}) {
    if (!cookieSecret) {
      throw new Error('onboarding_cookie_secret_missing');
    }
    const encodedPayload = encodeBase64UrlJson(payload);
    const signature = crypto
      .createHmac('sha256', cookieSecret)
      .update(encodedPayload)
      .digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  function verifySignedToken(token = '') {
    if (!cookieSecret) return null;
    const normalized = normalizeText(token);
    if (!normalized.includes('.')) return null;
    const [encodedPayload, providedSignature] = normalized.split('.', 2);
    if (!encodedPayload || !providedSignature) return null;
    const expectedSignature = crypto
      .createHmac('sha256', cookieSecret)
      .update(encodedPayload)
      .digest('base64url');
    const providedBuffer = Buffer.from(providedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return null;
    }
    return decodeBase64UrlJson(encodedPayload);
  }

  function createOnboardingChallengeMessage({
    ownerEoa = '',
    chainId = '',
    nonce = '',
    challengeId = '',
    issuedAt = 0,
    expiresAt = 0
  } = {}) {
    return [
      'KTRACE Onboarding Login',
      'schema: ktrace-onboarding-login-v1',
      `ownerEoa: ${normalizeAddress(ownerEoa || '')}`,
      `chainId: ${normalizeText(chainId || '')}`,
      `challengeId: ${normalizeText(challengeId || '')}`,
      `nonce: ${normalizeText(nonce || '')}`,
      `issuedAt: ${new Date(Number(issuedAt || 0)).toISOString()}`,
      `expiresAt: ${new Date(Number(expiresAt || 0)).toISOString()}`
    ].join('\n');
  }

  function listOnboardingChallenges() {
    const now = Date.now();
    const rows = Array.isArray(readOnboardingChallenges?.()) ? readOnboardingChallenges() : [];
    const normalized = rows
      .map((row) => sanitizeChallengeRow(normalizeAddress, row))
      .filter((row) => row.challengeId && row.ownerEoa && row.expiresAt)
      .filter((row) => {
        if (row.usedAt) return now - row.usedAt <= 24 * 60 * 60 * 1000;
        return row.expiresAt >= now - challengeTtlMs;
      })
      .sort((left, right) => Number(right.issuedAt || 0) - Number(left.issuedAt || 0))
      .slice(0, challengeMaxRows);
    writeOnboardingChallenges?.(normalized);
    return normalized;
  }

  function writeNormalizedOnboardingChallenges(rows = []) {
    const normalized = Array.isArray(rows)
      ? rows
          .map((row) => sanitizeChallengeRow(normalizeAddress, row))
          .filter((row) => row.challengeId && row.ownerEoa && row.expiresAt)
      : [];
    writeOnboardingChallenges?.(normalized);
    return normalized;
  }

  function issueOnboardingAuthChallenge({ ownerEoa = '', chainId = '', traceId = '' } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    if (!ethers.isAddress(normalizedOwner)) {
      return {
        ok: false,
        statusCode: 400,
        code: 'onboarding_owner_invalid',
        reason: 'A valid ownerEoa is required.'
      };
    }
    const normalizedChainId = normalizeText(chainId || '') || 'kite-testnet';
    const issuedAt = Date.now();
    const expiresAt = issuedAt + challengeTtlMs;
    const challengeId = createTraceId?.('onb') || `onb_${issuedAt}`;
    const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
    const message = createOnboardingChallengeMessage({
      ownerEoa: normalizedOwner,
      chainId: normalizedChainId,
      nonce,
      challengeId,
      issuedAt,
      expiresAt
    });

    const nextRows = listOnboardingChallenges().filter(
      (row) => !(row.ownerEoa === normalizedOwner && row.status === 'pending')
    );
    nextRows.unshift({
      challengeId,
      ownerEoa: normalizedOwner,
      chainId: normalizedChainId,
      nonce,
      message,
      traceId: normalizeText(traceId || ''),
      status: 'pending',
      issuedAt,
      expiresAt,
      usedAt: 0,
      verifiedAt: 0
    });
    writeNormalizedOnboardingChallenges(nextRows);
    return {
      ok: true,
      challenge: {
        challengeId,
        ownerEoa: normalizedOwner,
        chainId: normalizedChainId,
        nonce,
        message,
        issuedAt,
        expiresAt
      }
    };
  }

  function verifyOnboardingAuthChallenge({
    challengeId = '',
    ownerEoa = '',
    chainId = '',
    signature = '',
    traceId = ''
  } = {}) {
    const normalizedChallengeId = normalizeText(challengeId || '');
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    const normalizedChainId = normalizeText(chainId || '');
    const normalizedSignature = normalizeText(signature || '');
    if (!normalizedChallengeId || !ethers.isAddress(normalizedOwner) || !normalizedSignature) {
      return {
        ok: false,
        statusCode: 400,
        code: 'onboarding_verify_invalid',
        reason: 'challengeId, ownerEoa, and signature are required.'
      };
    }

    const rows = listOnboardingChallenges();
    const row = rows.find((item) => item.challengeId === normalizedChallengeId) || null;
    if (!row) {
      return {
        ok: false,
        statusCode: 404,
        code: 'onboarding_challenge_not_found',
        reason: 'Onboarding challenge was not found.'
      };
    }
    if (row.usedAt || row.status !== 'pending') {
      return {
        ok: false,
        statusCode: 409,
        code: 'onboarding_challenge_used',
        reason: 'Onboarding challenge has already been used.'
      };
    }
    if (row.expiresAt <= Date.now()) {
      return {
        ok: false,
        statusCode: 410,
        code: 'onboarding_challenge_expired',
        reason: 'Onboarding challenge has expired.'
      };
    }
    if (row.ownerEoa !== normalizedOwner) {
      return {
        ok: false,
        statusCode: 403,
        code: 'onboarding_owner_mismatch',
        reason: 'Onboarding challenge does not belong to the supplied ownerEoa.'
      };
    }
    if (normalizedChainId && row.chainId && row.chainId !== normalizedChainId) {
      return {
        ok: false,
        statusCode: 403,
        code: 'onboarding_chain_mismatch',
        reason: 'Onboarding challenge chainId mismatch.'
      };
    }

    let recoveredAddress = '';
    try {
      recoveredAddress = normalizeAddress(ethers.verifyMessage(row.message, normalizedSignature));
    } catch {
      recoveredAddress = '';
    }
    if (!recoveredAddress || recoveredAddress !== normalizedOwner) {
      return {
        ok: false,
        statusCode: 400,
        code: 'onboarding_signature_invalid',
        reason: 'Wallet signature does not match ownerEoa.'
      };
    }

    const verifiedAt = Date.now();
    const expiresAt = verifiedAt + cookieTtlMs;
    const payload = sanitizeCookiePayload(normalizeAddress, {
      ownerEoa: normalizedOwner,
      chainId: row.chainId,
      iat: verifiedAt,
      exp: expiresAt,
      sid: createTraceId?.('onb_sess') || `onb_sess_${verifiedAt}`
    });
    const cookieValue = signTokenPayload(payload);
    const nextRows = rows.map((item) =>
      item.challengeId === normalizedChallengeId
        ? {
            ...item,
            status: 'verified',
            usedAt: verifiedAt,
            verifiedAt,
            traceId: normalizeText(traceId || item.traceId || '')
          }
        : item
    );
    writeNormalizedOnboardingChallenges(nextRows);
    return {
      ok: true,
      ownerEoa: normalizedOwner,
      chainId: row.chainId,
      cookieValue,
      cookieExpiresAt: expiresAt,
      authContext: {
        role: 'agent',
        ownerEoa: normalizedOwner,
        chainId: row.chainId,
        authSource: 'onboarding-cookie'
      }
    };
  }

  function resolveOnboardingCookie(token = '') {
    const payload = sanitizeCookiePayload(normalizeAddress, verifySignedToken(token));
    if (!payload || payload.exp <= Date.now()) return null;
    return {
      role: 'agent',
      ownerEoa: payload.ownerEoa,
      chainId: payload.chainId,
      authSource: 'onboarding-cookie',
      sessionId: payload.sid
    };
  }

  function writeOnboardingAuthCookie(res, { ownerEoa = '', chainId = '' } = {}) {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + cookieTtlMs;
    const payload = sanitizeCookiePayload(normalizeAddress, {
      ownerEoa,
      chainId,
      iat: issuedAt,
      exp: expiresAt,
      sid: createTraceId?.('onb_sess') || `onb_sess_${issuedAt}`
    });
    const cookieValue = signTokenPayload(payload);
    res.cookie(cookieName, cookieValue, buildOnboardingCookieOptions(expiresAt));
    return {
      cookieValue,
      expiresAt
    };
  }

  function clearOnboardingAuthCookie(res) {
    res.clearCookie(cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      path: '/'
    });
  }

  function listAccountApiKeys() {
    const rows = Array.isArray(readAccountApiKeys?.()) ? readAccountApiKeys() : [];
    const normalized = rows
      .map((row) => sanitizeAccountApiKeyRow(normalizeAddress, row))
      .filter((row) => row.keyId && row.ownerEoa && row.keyHash);
    writeAccountApiKeys?.(normalized);
    return normalized;
  }

  function writeNormalizedAccountApiKeys(rows = []) {
    const normalized = Array.isArray(rows)
      ? rows
          .map((row) => sanitizeAccountApiKeyRow(normalizeAddress, row))
          .filter((row) => row.keyId && row.ownerEoa && row.keyHash)
      : [];
    writeAccountApiKeys?.(normalized);
    return normalized;
  }

  function hashApiKey(secret = '') {
    return crypto.createHash('sha256').update(normalizeText(secret || '')).digest('hex');
  }

  function buildMaskedPreview(secret = '') {
    const normalized = normalizeText(secret);
    if (!normalized) return '';
    if (normalized.length <= 18) return `${normalized.slice(0, 6)}***`;
    return `${normalized.slice(0, 14)}...${normalized.slice(-4)}`;
  }

  function buildAccountApiKeyPublicRecord(row = {}) {
    return {
      keyId: normalizeText(row.keyId || ''),
      prefix: normalizeText(row.prefix || ''),
      maskedPreview: normalizeText(row.maskedPreview || ''),
      role: normalizeLower(row.role || 'agent') || 'agent',
      createdAt: normalizePositiveInt(row.createdAt),
      lastUsedAt: normalizePositiveInt(row.lastUsedAt),
      revokedAt: normalizePositiveInt(row.revokedAt)
    };
  }

  function findActiveAccountApiKey(ownerEoa = '') {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    if (!ethers.isAddress(normalizedOwner)) return null;
    return (
      listAccountApiKeys()
        .filter((row) => row.ownerEoa === normalizedOwner && !row.revokedAt)
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0] || null
    );
  }

  function generateAccountApiKey({
    ownerEoa = '',
    role = 'agent',
    label = '',
    createdBy = '',
    traceId = ''
  } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    if (!ethers.isAddress(normalizedOwner)) {
      return {
        ok: false,
        statusCode: 400,
        code: 'account_api_key_owner_invalid',
        reason: 'A valid ownerEoa is required to generate an account API key.'
      };
    }
    const now = Date.now();
    const rows = listAccountApiKeys().map((row) =>
      row.ownerEoa === normalizedOwner && !row.revokedAt
        ? {
            ...row,
            revokedAt: now,
            revokedReason: row.revokedReason || 'rotated'
          }
        : row
    );
    const secret = `ktrace_sk_${createBase58Value(crypto.randomBytes(32))}`;
    const record = sanitizeAccountApiKeyRow(normalizeAddress, {
      keyId: createTraceId?.('ak') || `ak_${now}`,
      ownerEoa: normalizedOwner,
      role: normalizeLower(role || 'agent') || 'agent',
      keyHash: hashApiKey(secret),
      prefix: secret.slice(0, Math.min(secret.length, 18)),
      maskedPreview: buildMaskedPreview(secret),
      label,
      createdAt: now,
      lastUsedAt: 0,
      revokedAt: 0,
      revokedReason: '',
      createdBy: normalizeText(createdBy || traceId || '')
    });
    rows.unshift(record);
    writeNormalizedAccountApiKeys(rows);
    return {
      ok: true,
      key: secret,
      record,
      publicRecord: buildAccountApiKeyPublicRecord(record)
    };
  }

  function revokeAccountApiKey({ ownerEoa = '', keyId = '', reason = '' } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    const normalizedKeyId = normalizeText(keyId || '');
    const now = Date.now();
    let revoked = null;
    const rows = listAccountApiKeys().map((row) => {
      const shouldRevoke =
        (!normalizedKeyId && normalizedOwner && row.ownerEoa === normalizedOwner && !row.revokedAt) ||
        (normalizedKeyId && row.keyId === normalizedKeyId);
      if (!shouldRevoke) return row;
      revoked = {
        ...row,
        revokedAt: row.revokedAt || now,
        revokedReason: normalizeText(reason || row.revokedReason || 'revoked')
      };
      return revoked;
    });
    if (!revoked) {
      return {
        ok: false,
        statusCode: 404,
        code: 'account_api_key_not_found',
        reason: 'No active account API key was found.'
      };
    }
    writeNormalizedAccountApiKeys(rows);
    return {
      ok: true,
      record: revoked,
      publicRecord: buildAccountApiKeyPublicRecord(revoked)
    };
  }

  function resolveAccountApiKey(secret = '') {
    const normalizedSecret = normalizeText(secret || '');
    if (!normalizedSecret || !normalizedSecret.startsWith('ktrace_sk_')) return null;
    const keyHash = hashApiKey(normalizedSecret);
    const record = listAccountApiKeys().find((row) => !row.revokedAt && row.keyHash === keyHash) || null;
    if (!record) return null;
    return {
      role: normalizeLower(record.role || 'agent') || 'agent',
      ownerEoa: record.ownerEoa,
      authSource: 'account-api-key',
      keyId: record.keyId,
      prefix: record.prefix,
      maskedPreview: record.maskedPreview
    };
  }

  function touchAccountApiKeyUsage(recordOrKeyId = '') {
    const keyId =
      typeof recordOrKeyId === 'string'
        ? normalizeText(recordOrKeyId)
        : normalizeText(recordOrKeyId?.keyId || '');
    if (!keyId) return null;
    const now = Date.now();
    let updated = null;
    const rows = listAccountApiKeys().map((row) => {
      if (row.keyId !== keyId) return row;
      updated = {
        ...row,
        lastUsedAt: now
      };
      return updated;
    });
    if (updated) {
      writeNormalizedAccountApiKeys(rows);
    }
    return updated;
  }

  return {
    cookieName,
    cookieSecure,
    cookieTtlMs,
    challengeTtlMs,
    createOnboardingChallengeMessage,
    issueOnboardingAuthChallenge,
    verifyOnboardingAuthChallenge,
    resolveOnboardingCookie,
    writeOnboardingAuthCookie,
    clearOnboardingAuthCookie,
    listOnboardingChallenges,
    listAccountApiKeys,
    findActiveAccountApiKey,
    generateAccountApiKey,
    revokeAccountApiKey,
    resolveAccountApiKey,
    touchAccountApiKeyUsage,
    buildAccountApiKeyPublicRecord,
    buildOnboardingCookieOptions
  };
}
