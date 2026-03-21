import { ethers } from 'ethers';
import { deriveAaAccountCapabilities } from './aaConfig.js';

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
  sessionRuntimeIndexPath,
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
    const tokenAddress = normalizeAddress(input.tokenAddress || '');
    const expiresAt = Number(input.expiresAt || 0);
    const maxPerTx = Number(input.maxPerTx || 0);
    const dailyLimit = Number(input.dailyLimit || 0);
    const gatewayRecipient = normalizeAddress(input.gatewayRecipient || '');
    const accountVersion = String(input.accountVersion || '').trim();
    const accountVersionTag = String(input.accountVersionTag || '').trim();
    const accountFactoryAddress = normalizeAddress(input.accountFactoryAddress || '');
    const accountImplementationAddress = normalizeAddress(input.accountImplementationAddress || '');
    const explicitAccountCapabilities =
      input.accountCapabilities && typeof input.accountCapabilities === 'object' && !Array.isArray(input.accountCapabilities)
        ? input.accountCapabilities
        : {};
    const requiredForJobLane = String(input.requiredForJobLane || '').trim();
    const runtimeHealth = String(input.runtimeHealth || '').trim().toLowerCase();
    const explicitAuthorizedBy = normalizeAddress(input.authorizedBy || '');
    const authorizedBy = explicitAuthorizedBy || owner;
    const updatedAt = Number(input.updatedAt || Date.now());
    const explicitAuthorizedAt = Number(input.authorizedAt || 0);
    const authorizedAt =
      Number.isFinite(explicitAuthorizedAt) && explicitAuthorizedAt > 0
        ? explicitAuthorizedAt
        : authorizedBy
          ? updatedAt
          : 0;
    const authorizationMode = String(
      input.authorizationMode || (authorizedBy ? 'owner_runtime_sync' : '')
    ).trim();
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
    const agentId = String(input.agentId || '').trim();
    const agentWallet = normalizeAddress(input.agentWallet || '');
    const identityRegistry = normalizeAddress(input.identityRegistry || '');
    const identityRegisterTxHash = String(input.identityRegisterTxHash || '').trim();
    const identityBindTxHash = String(input.identityBindTxHash || '').trim();
    const allowedCapabilities = Array.isArray(input.allowedCapabilities)
      ? input.allowedCapabilities
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const allowedProviders = Array.isArray(input.allowedProviders)
      ? input.allowedProviders
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const allowedRecipients = Array.isArray(input.allowedRecipients)
      ? input.allowedRecipients
          .map((item) => normalizeAddress(item || ''))
          .filter(Boolean)
      : [];
    const totalLimit = Number(input.totalLimit || 0);
    const authorityId = String(input.authorityId || '').trim();
    const consumerAgentLabel = String(input.consumerAgentLabel || '').trim();
    const authorityExpiresAt = Number(input.authorityExpiresAt || 0);
    const authorityStatus = String(input.authorityStatus || '').trim().toLowerCase();
    const authorityRevokedAt = Number(input.authorityRevokedAt || 0);
    const authorityRevocationReason = String(input.authorityRevocationReason || '').trim();
    const authorityCreatedAt = Number(input.authorityCreatedAt || 0);
    const authorityUpdatedAt = Number(input.authorityUpdatedAt || 0);
    const runtimePurpose = String(input.runtimePurpose || input.purpose || '').trim().toLowerCase();
    const source = String(input.source || 'frontend').trim();
    const aaCapabilitySnapshot = deriveAaAccountCapabilities({
      accountVersion,
      accountVersionTag,
      accountCapabilities: explicitAccountCapabilities,
      requiredForJobLane
    });

    return {
      aaWallet: ethers.isAddress(aaWallet) ? aaWallet : '',
      owner: ethers.isAddress(owner) ? owner : '',
      sessionAddress: ethers.isAddress(sessionAddress) ? sessionAddress : '',
      sessionPrivateKey: /^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey) ? sessionPrivateKey : '',
      sessionId: /^0x[0-9a-fA-F]{64}$/.test(sessionId) ? sessionId : '',
      sessionTxHash: /^0x[0-9a-fA-F]{64}$/.test(sessionTxHash) ? sessionTxHash : '',
      tokenAddress: ethers.isAddress(tokenAddress) ? tokenAddress : '',
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
      maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : 0,
      dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : 0,
      gatewayRecipient: ethers.isAddress(gatewayRecipient) ? gatewayRecipient : '',
      accountVersion,
      accountVersionTag: aaCapabilitySnapshot.accountVersionTag || accountVersion,
      accountFactoryAddress: ethers.isAddress(accountFactoryAddress) ? accountFactoryAddress : '',
      accountImplementationAddress: ethers.isAddress(accountImplementationAddress)
        ? accountImplementationAddress
        : '',
      accountCapabilities: aaCapabilitySnapshot.accountCapabilities,
      requiredForJobLane: aaCapabilitySnapshot.requiredForJobLane,
      runtimeHealth,
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
      agentId,
      agentWallet: ethers.isAddress(agentWallet) ? agentWallet : '',
      identityRegistry: ethers.isAddress(identityRegistry) ? identityRegistry : '',
      identityRegisterTxHash: /^0x[0-9a-fA-F]{64}$/.test(identityRegisterTxHash) ? identityRegisterTxHash : '',
      identityBindTxHash: /^0x[0-9a-fA-F]{64}$/.test(identityBindTxHash) ? identityBindTxHash : '',
      allowedCapabilities: Array.from(new Set(allowedCapabilities)),
      allowedProviders: Array.from(new Set(allowedProviders)),
      allowedRecipients: Array.from(new Set(allowedRecipients)),
      totalLimit: Number.isFinite(totalLimit) && totalLimit > 0 ? totalLimit : 0,
      authorityId,
      consumerAgentLabel,
      authorityExpiresAt: Number.isFinite(authorityExpiresAt) && authorityExpiresAt > 0 ? authorityExpiresAt : 0,
      authorityStatus,
      authorityRevokedAt: Number.isFinite(authorityRevokedAt) && authorityRevokedAt > 0 ? authorityRevokedAt : 0,
      authorityRevocationReason,
      authorityCreatedAt: Number.isFinite(authorityCreatedAt) && authorityCreatedAt > 0 ? authorityCreatedAt : 0,
      authorityUpdatedAt: Number.isFinite(authorityUpdatedAt) && authorityUpdatedAt > 0 ? authorityUpdatedAt : 0,
      runtimePurpose,
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

  function readSessionRuntimeIndex() {
    const payload = readJsonObject(sessionRuntimeIndexPath);
    const runtimes =
      payload?.runtimes && typeof payload.runtimes === 'object' && !Array.isArray(payload.runtimes)
        ? payload.runtimes
        : {};
    const normalizedRuntimes = {};
    for (const [owner, runtime] of Object.entries(runtimes)) {
      const normalizedOwner = normalizeAddress(owner || '');
      const sanitized = sanitizeSessionRuntime(runtime);
      if (!normalizedOwner || !sanitized.owner || normalizedOwner !== sanitized.owner) continue;
      normalizedRuntimes[normalizedOwner] = sanitized;
    }
    return {
      currentOwner: normalizeAddress(payload?.currentOwner || ''),
      runtimes: normalizedRuntimes
    };
  }

  function writeSessionRuntimeIndex(index = {}) {
    const runtimes =
      index?.runtimes && typeof index.runtimes === 'object' && !Array.isArray(index.runtimes)
        ? index.runtimes
        : {};
    const normalizedRuntimes = {};
    for (const [owner, runtime] of Object.entries(runtimes)) {
      const normalizedOwner = normalizeAddress(owner || '');
      const sanitized = sanitizeSessionRuntime(runtime);
      if (!normalizedOwner || !sanitized.owner || normalizedOwner !== sanitized.owner) continue;
      normalizedRuntimes[normalizedOwner] = sanitized;
    }
    const next = {
      currentOwner: normalizeAddress(index?.currentOwner || ''),
      runtimes: normalizedRuntimes
    };
    writeJsonObject(sessionRuntimeIndexPath, next);
    return next;
  }

  function readSessionRuntimeByOwner(owner = '') {
    const normalizedOwner = normalizeAddress(owner || '');
    if (!normalizedOwner) return sanitizeSessionRuntime({});
    const current = readSessionRuntime();
    if (current.owner && current.owner === normalizedOwner) {
      return current;
    }
    const index = readSessionRuntimeIndex();
    return sanitizeSessionRuntime(index?.runtimes?.[normalizedOwner] || {});
  }

  function listSessionRuntimes() {
    const current = readSessionRuntime();
    const index = readSessionRuntimeIndex();
    const byOwner = new Map();
    if (current.owner) {
      byOwner.set(current.owner, current);
    }
    for (const runtime of Object.values(index.runtimes || {})) {
      const sanitized = sanitizeSessionRuntime(runtime);
      if (!sanitized.owner) continue;
      byOwner.set(sanitized.owner, sanitized);
    }
    return Array.from(byOwner.values());
  }

  function resolveSessionRuntime({
    owner = '',
    aaWallet = '',
    sessionId = '',
    runtimePurpose = '',
    strictOwnerMatch = false
  } = {}) {
    const normalizedOwner = normalizeAddress(owner || '');
    const normalizedAaWallet = normalizeAddress(aaWallet || '');
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedRuntimePurpose = String(runtimePurpose || '').trim().toLowerCase();
    const requireStrictOwnerMatch = Boolean(strictOwnerMatch);
    if (normalizedOwner) {
      const runtimeByOwner = readSessionRuntimeByOwner(normalizedOwner);
      if (
        runtimeByOwner.owner &&
        (!normalizedAaWallet || normalizeAddress(runtimeByOwner.aaWallet || '') === normalizedAaWallet) &&
        (!normalizedRuntimePurpose || String(runtimeByOwner.runtimePurpose || '').trim().toLowerCase() === normalizedRuntimePurpose)
      ) {
        return runtimeByOwner;
      }
      if (requireStrictOwnerMatch && !normalizedAaWallet) {
        return sanitizeSessionRuntime({});
      }
    }
    const current = readSessionRuntime();
    if (
      (
        (normalizedAaWallet && current.aaWallet === normalizedAaWallet) ||
        (normalizedSessionId && current.sessionId === normalizedSessionId)
      ) &&
      (!normalizedRuntimePurpose || String(current.runtimePurpose || '').trim().toLowerCase() === normalizedRuntimePurpose)
    ) {
      return current;
    }
    for (const runtime of listSessionRuntimes()) {
      if (
        (
          (normalizedAaWallet && runtime.aaWallet === normalizedAaWallet) ||
          (normalizedSessionId && runtime.sessionId === normalizedSessionId)
        ) &&
        (!normalizedRuntimePurpose || String(runtime.runtimePurpose || '').trim().toLowerCase() === normalizedRuntimePurpose)
      ) {
        return runtime;
      }
    }
    return current;
  }

  function writeSessionRuntime(input = {}, options = {}) {
    const existing =
      (input?.owner
        ? resolveSessionRuntime({
            owner: input.owner,
            strictOwnerMatch: true
          })
        : resolveSessionRuntime({
            aaWallet: input?.aaWallet,
            sessionId: input?.sessionId
          })) || {};
    const merged =
      existing && typeof existing === 'object'
        ? {
            ...existing,
            ...input
          }
        : { ...input };
    const next = sanitizeSessionRuntime(merged);
    const setCurrent = options?.setCurrent !== false;
    const index = readSessionRuntimeIndex();
    const nextIndex = {
      ...index,
      currentOwner: setCurrent ? next.owner || index.currentOwner || '' : index.currentOwner || '',
      runtimes: {
        ...(index.runtimes || {}),
        ...(next.owner ? { [next.owner]: next } : {})
      }
    };
    writeSessionRuntimeIndex(nextIndex);
    if (setCurrent) {
      writeJsonObject(sessionRuntimePath, next);
    }
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
    readSessionRuntimeByOwner,
    readSessionRuntimeIndex,
    writeSessionRuntimeIndex,
    listSessionRuntimes,
    resolveSessionRuntime,
    writeSessionRuntime,
    sanitizeSessionAuthorizationRecord,
    readSessionAuthorizations,
    writeSessionAuthorizations
  };
}
