import { ethers } from 'ethers';

export function maskSecret(secret = '') {
  const value = String(secret || '');
  if (!value) return '';
  if (value.length <= 12) return '***';
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function createSessionRuntimeHelpers({
  normalizeAddress,
  readJsonObject,
  writeJsonObject,
  readJsonArray,
  writeJsonArray,
  sessionRuntimePath,
  sessionAuthorizationsPath,
  envSessionPrivateKey,
  envSessionAddress,
  envSessionId
}) {
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
    const authorizedBy = normalizeAddress(input.authorizedBy || '');
    const authorizedAt = Number(input.authorizedAt || 0);
    const authorizationMode = String(input.authorizationMode || '').trim();
    const authorizationPayload =
      input.authorizationPayload && typeof input.authorizationPayload === 'object' && !Array.isArray(input.authorizationPayload)
        ? JSON.parse(JSON.stringify(input.authorizationPayload))
        : null;
    const authorizationPayloadHash = String(input.authorizationPayloadHash || '').trim();
    const authorizationSignature = String(input.authorizationSignature || '').trim();
    const authorizationNonce = String(input.authorizationNonce || '').trim();
    const authorizationExpiresAt = Number(input.authorizationExpiresAt || 0);
    const authorizedAgentId = String(input.authorizedAgentId || '').trim();
    const authorizedAgentWallet = normalizeAddress(input.authorizedAgentWallet || '');
    const authorizationAudience = String(input.authorizationAudience || '').trim();
    const allowedCapabilities = Array.isArray(input.allowedCapabilities)
      ? input.allowedCapabilities
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
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
      authorizedBy: ethers.isAddress(authorizedBy) ? authorizedBy : '',
      authorizedAt: Number.isFinite(authorizedAt) && authorizedAt > 0 ? authorizedAt : 0,
      authorizationMode,
      authorizationPayload,
      authorizationPayloadHash: /^0x[0-9a-fA-F]{64}$/.test(authorizationPayloadHash) ? authorizationPayloadHash : '',
      authorizationSignature: /^0x[0-9a-fA-F]+$/.test(authorizationSignature) ? authorizationSignature : '',
      authorizationNonce,
      authorizationExpiresAt:
        Number.isFinite(authorizationExpiresAt) && authorizationExpiresAt > 0 ? authorizationExpiresAt : 0,
      authorizedAgentId,
      authorizedAgentWallet: ethers.isAddress(authorizedAgentWallet) ? authorizedAgentWallet : '',
      authorizationAudience,
      allowedCapabilities: Array.from(new Set(allowedCapabilities)),
      source,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
    };
  }

  function readSessionRuntime() {
    const file = sanitizeSessionRuntime(readJsonObject(sessionRuntimePath));
    const merged = {
      ...file,
      sessionPrivateKey: file.sessionPrivateKey || (envSessionPrivateKey || ''),
      sessionAddress: file.sessionAddress || normalizeAddress(envSessionAddress || ''),
      sessionId: file.sessionId || (envSessionId || '')
    };
    return sanitizeSessionRuntime(merged);
  }

  function writeSessionRuntime(input = {}) {
    const next = sanitizeSessionRuntime(input);
    writeJsonObject(sessionRuntimePath, next);
    return next;
  }

  function sanitizeSessionAuthorizationRecord(input = {}) {
    const authorizedBy = normalizeAddress(input.authorizedBy || input.userEoa || '');
    const authorizationSignature = String(
      input.authorizationSignature || input.userSignature || ''
    ).trim();
    const authorizationPayloadHash = String(input.authorizationPayloadHash || '').trim();
    const authorizationNonce = String(input.authorizationNonce || '').trim();
    const authorizationMode = String(input.authorizationMode || '').trim();
    const status = String(input.status || 'authorized').trim();
    const traceId = String(input.traceId || '').trim();
    const authorizationPayload =
      input.authorizationPayload && typeof input.authorizationPayload === 'object' && !Array.isArray(input.authorizationPayload)
        ? JSON.parse(JSON.stringify(input.authorizationPayload))
        : null;
    const authorizedAt = Number(input.authorizedAt || 0);
    const authorizationExpiresAt = Number(input.authorizationExpiresAt || 0);
    const created = Number(input.created || 0);
    const reused = Number(input.reused || 0);
    return {
      authorizationId: String(input.authorizationId || '').trim(),
      traceId,
      authorizedBy: ethers.isAddress(authorizedBy) ? authorizedBy : '',
      authorizationSignature: /^0x[0-9a-fA-F]+$/.test(authorizationSignature) ? authorizationSignature : '',
      authorizationPayloadHash: /^0x[0-9a-fA-F]{64}$/.test(authorizationPayloadHash) ? authorizationPayloadHash : '',
      authorizationNonce,
      authorizationMode,
      authorizationPayload,
      authorizationExpiresAt:
        Number.isFinite(authorizationExpiresAt) && authorizationExpiresAt > 0 ? authorizationExpiresAt : 0,
      authorizedAt: Number.isFinite(authorizedAt) && authorizedAt > 0 ? authorizedAt : 0,
      authorizedAgentId: String(input.authorizedAgentId || '').trim(),
      authorizedAgentWallet: normalizeAddress(input.authorizedAgentWallet || ''),
      authorizationAudience: String(input.authorizationAudience || '').trim(),
      allowedCapabilities: Array.isArray(input.allowedCapabilities)
        ? Array.from(
            new Set(
              input.allowedCapabilities
                .map((item) => String(item || '').trim().toLowerCase())
                .filter(Boolean)
            )
          )
        : [],
      status,
      created: created > 0 ? created : 0,
      reused: reused > 0 ? reused : 0
    };
  }

  function readSessionAuthorizations() {
    return readJsonArray(sessionAuthorizationsPath)
      .map((item) => sanitizeSessionAuthorizationRecord(item))
      .filter((item) => item.authorizationId);
  }

  function writeSessionAuthorizations(records) {
    writeJsonArray(
      sessionAuthorizationsPath,
      Array.isArray(records)
        ? records
            .map((item) => sanitizeSessionAuthorizationRecord(item))
            .filter((item) => item.authorizationId)
        : []
    );
  }

  return {
    sanitizeSessionRuntime,
    readSessionRuntime,
    writeSessionRuntime,
    sanitizeSessionAuthorizationRecord,
    readSessionAuthorizations,
    writeSessionAuthorizations
  };
}
