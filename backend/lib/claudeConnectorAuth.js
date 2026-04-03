import crypto from 'crypto';

import { ethers } from 'ethers';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function normalizeClient(value = '') {
  return normalizeLower(value || 'agent') || 'agent';
}

function normalizeClientId(value = '') {
  return normalizeText(value);
}

function normalizePositiveInt(value, fallbackValue = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
  const fallback = Number(fallbackValue);
  return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 0;
}

function normalizeBuiltinToolId(value = '') {
  const normalized = normalizeLower(value);
  if (!normalized) return '';
  if (normalized.startsWith('ktrace__')) return normalized.slice('ktrace__'.length);
  return normalized.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeBuiltinToolList(value = []) {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  return Array.from(new Set(items.map((item) => normalizeBuiltinToolId(item)).filter(Boolean)));
}

function normalizeAgentId(value = '') {
  return normalizeText(value);
}

function isLegacyCredentialRow(row = {}) {
  return !normalizeAgentId(row?.agentId) || !normalizeText(row?.identityRegistry);
}

const DEFAULT_CONNECTOR_BUILTIN_TOOLS = Object.freeze([
  'artifact_receipt',
  'artifact_evidence',
  'flow_history',
  'flow_show'
]);

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

function hashToken(secret = '') {
  return crypto.createHash('sha256').update(normalizeText(secret || '')).digest('hex');
}

function buildMaskedPreview(secret = '') {
  const normalized = normalizeText(secret);
  if (!normalized) return '';
  if (normalized.length <= 18) return `${normalized.slice(0, 6)}***`;
  return `${normalized.slice(0, 16)}...${normalized.slice(-4)}`;
}

function sanitizeInstallCodeRow(normalizeAddress, row = {}) {
  const installCodeId = normalizeText(row.installCodeId || '');
  const ownerEoa = normalizeAddress(row.ownerEoa || '');
  const aaWallet = normalizeAddress(row.aaWallet || '');
  const authorityId = normalizeText(row.authorityId || '');
  const policySnapshotHash = normalizeText(row.policySnapshotHash || '');
  const tokenHash = normalizeText(row.tokenHash || '');
  const prefix = normalizeText(row.prefix || '');
  const maskedPreview = normalizeText(row.maskedPreview || '');
  const client = normalizeClient(row.client || 'agent');
  const clientId = normalizeClientId(row.clientId || '');
  const agentId = normalizeAgentId(row.agentId || '');
  const identityRegistry = normalizeAddress(row.identityRegistry || '');
  const allowedBuiltinTools = normalizeBuiltinToolList(row.allowedBuiltinTools || []);
  const createdAt = normalizePositiveInt(row.createdAt);
  const expiresAt = normalizePositiveInt(row.expiresAt);
  const claimedAt = normalizePositiveInt(row.claimedAt);
  const revokedAt = normalizePositiveInt(row.revokedAt);
  return {
    installCodeId,
    ownerEoa: ethers.isAddress(ownerEoa) ? ownerEoa : '',
    aaWallet: ethers.isAddress(aaWallet) ? aaWallet : '',
    authorityId,
    policySnapshotHash,
    tokenHash: /^[0-9a-f]{64}$/i.test(tokenHash) ? tokenHash.toLowerCase() : '',
    prefix,
    maskedPreview,
    client,
    clientId,
    agentId,
    identityRegistry: ethers.isAddress(identityRegistry) ? identityRegistry : '',
    allowedBuiltinTools,
    createdAt,
    expiresAt,
    claimedAt,
    revokedAt
  };
}

function sanitizeGrantRow(normalizeAddress, row = {}) {
  const grantId = normalizeText(row.grantId || '');
  const installCodeId = normalizeText(row.installCodeId || '');
  const ownerEoa = normalizeAddress(row.ownerEoa || '');
  const aaWallet = normalizeAddress(row.aaWallet || '');
  const authorityId = normalizeText(row.authorityId || '');
  const policySnapshotHash = normalizeText(row.policySnapshotHash || '');
  const tokenHash = normalizeText(row.tokenHash || '');
  const prefix = normalizeText(row.prefix || '');
  const maskedPreview = normalizeText(row.maskedPreview || '');
  const client = normalizeClient(row.client || 'agent');
  const clientId = normalizeClientId(row.clientId || '');
  const agentId = normalizeAgentId(row.agentId || '');
  const identityRegistry = normalizeAddress(row.identityRegistry || '');
  const allowedBuiltinTools = normalizeBuiltinToolList(row.allowedBuiltinTools || []);
  const createdAt = normalizePositiveInt(row.createdAt);
  const claimedAt = normalizePositiveInt(row.claimedAt);
  const lastUsedAt = normalizePositiveInt(row.lastUsedAt);
  const expiresAt = normalizePositiveInt(row.expiresAt);
  const revokedAt = normalizePositiveInt(row.revokedAt);
  const revocationReason = normalizeText(row.revocationReason || '');
  return {
    grantId,
    installCodeId,
    ownerEoa: ethers.isAddress(ownerEoa) ? ownerEoa : '',
    aaWallet: ethers.isAddress(aaWallet) ? aaWallet : '',
    authorityId,
    policySnapshotHash,
    tokenHash: /^[0-9a-f]{64}$/i.test(tokenHash) ? tokenHash.toLowerCase() : '',
    prefix,
    maskedPreview,
    client,
    clientId,
    agentId,
    identityRegistry: ethers.isAddress(identityRegistry) ? identityRegistry : '',
    allowedBuiltinTools,
    createdAt,
    claimedAt,
    lastUsedAt,
    expiresAt,
    revokedAt,
    revocationReason
  };
}

function buildInstallCodePublicRecord(row = {}) {
  return {
    installCodeId: normalizeText(row.installCodeId || ''),
    client: normalizeClient(row.client || 'agent'),
    clientId: normalizeClientId(row.clientId || ''),
    agentId: normalizeAgentId(row.agentId || ''),
    identityRegistry: normalizeText(row.identityRegistry || ''),
    allowedBuiltinTools: normalizeBuiltinToolList(row.allowedBuiltinTools || []),
    maskedPreview: normalizeText(row.maskedPreview || ''),
    createdAt: normalizePositiveInt(row.createdAt),
    expiresAt: normalizePositiveInt(row.expiresAt),
    claimedAt: normalizePositiveInt(row.claimedAt),
    revokedAt: normalizePositiveInt(row.revokedAt)
  };
}

function buildGrantPublicRecord(row = {}) {
  return {
    grantId: normalizeText(row.grantId || ''),
    installCodeId: normalizeText(row.installCodeId || ''),
    client: normalizeClient(row.client || 'agent'),
    clientId: normalizeClientId(row.clientId || ''),
    agentId: normalizeAgentId(row.agentId || ''),
    identityRegistry: normalizeText(row.identityRegistry || ''),
    allowedBuiltinTools: normalizeBuiltinToolList(row.allowedBuiltinTools || []),
    maskedPreview: normalizeText(row.maskedPreview || ''),
    createdAt: normalizePositiveInt(row.createdAt),
    claimedAt: normalizePositiveInt(row.claimedAt),
    lastUsedAt: normalizePositiveInt(row.lastUsedAt),
    expiresAt: normalizePositiveInt(row.expiresAt),
    revokedAt: normalizePositiveInt(row.revokedAt),
    revocationReason: normalizeText(row.revocationReason || '')
  };
}

export function createClaudeConnectorAuthHelpers({
  CONNECTOR_INSTALL_CODE_TTL_MS = 15 * 60 * 1000,
  CONNECTOR_GRANT_TTL_MS = 24 * 60 * 60 * 1000,
  CONNECTOR_INSTALL_CODE_MAX_ROWS = 500,
  CONNECTOR_GRANT_MAX_ROWS = 1000,
  DEFAULT_CONNECTOR_IDENTITY_REGISTRY = '',
  DEFAULT_CONNECTOR_BUILTIN_TOOL_IDS = DEFAULT_CONNECTOR_BUILTIN_TOOLS,
  createTraceId,
  normalizeAddress,
  readConnectorInstallCodes,
  writeConnectorInstallCodes,
  readConnectorGrants,
  writeConnectorGrants
} = {}) {
  const installCodeTtlMs = normalizePositiveInt(CONNECTOR_INSTALL_CODE_TTL_MS, 15 * 60 * 1000);
  const grantTtlMs = normalizePositiveInt(CONNECTOR_GRANT_TTL_MS, 24 * 60 * 60 * 1000);
  const installCodeMaxRows = normalizePositiveInt(CONNECTOR_INSTALL_CODE_MAX_ROWS, 500);
  const grantMaxRows = normalizePositiveInt(CONNECTOR_GRANT_MAX_ROWS, 1000);
  const defaultIdentityRegistry = normalizeAddress(DEFAULT_CONNECTOR_IDENTITY_REGISTRY || '');
  const defaultBuiltinTools = normalizeBuiltinToolList(DEFAULT_CONNECTOR_BUILTIN_TOOL_IDS || []);

  function listInstallCodes() {
    const now = Date.now();
    const rows = Array.isArray(readConnectorInstallCodes?.()) ? readConnectorInstallCodes() : [];
    const normalized = rows
      .map((row) => sanitizeInstallCodeRow(normalizeAddress, row))
      .filter((row) => row.installCodeId && row.ownerEoa && row.tokenHash && row.expiresAt)
      .filter((row) => {
        if (row.revokedAt) return now - row.revokedAt <= 24 * 60 * 60 * 1000;
        if (row.claimedAt) return now - row.claimedAt <= 24 * 60 * 60 * 1000;
        return row.expiresAt >= now - installCodeTtlMs;
      })
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, installCodeMaxRows);
    writeConnectorInstallCodes?.(normalized);
    return normalized;
  }

  function listGrants() {
    const now = Date.now();
    const rows = Array.isArray(readConnectorGrants?.()) ? readConnectorGrants() : [];
    const normalized = rows
      .map((row) => sanitizeGrantRow(normalizeAddress, row))
      .filter((row) => row.grantId && row.ownerEoa && row.tokenHash)
      .filter((row) => {
        if (row.revokedAt) return now - row.revokedAt <= 24 * 60 * 60 * 1000;
        if (row.expiresAt) return row.expiresAt >= now - grantTtlMs;
        return true;
      })
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, grantMaxRows);
    writeConnectorGrants?.(normalized);
    return normalized;
  }

  function writeNormalizedInstallCodes(rows = []) {
    const normalized = Array.isArray(rows)
      ? rows
          .map((row) => sanitizeInstallCodeRow(normalizeAddress, row))
          .filter((row) => row.installCodeId && row.ownerEoa && row.tokenHash && row.expiresAt)
      : [];
    writeConnectorInstallCodes?.(normalized);
    return normalized;
  }

  function writeNormalizedGrants(rows = []) {
    const normalized = Array.isArray(rows)
      ? rows
          .map((row) => sanitizeGrantRow(normalizeAddress, row))
          .filter((row) => row.grantId && row.ownerEoa && row.tokenHash)
      : [];
    writeConnectorGrants?.(normalized);
    return normalized;
  }

  function findPendingInstallCodeByOwner(ownerEoa = '', { client = '', clientId = '', agentId = '', identityRegistry = '' } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    if (!ethers.isAddress(normalizedOwner)) return null;
    const now = Date.now();
    const normalizedClient = normalizeClient(client || 'agent');
    const normalizedClientId = normalizeClientId(clientId || '');
    const normalizedAgentId = normalizeAgentId(agentId || '');
    const normalizedIdentityRegistry = normalizeAddress(identityRegistry || '');
    return (
      listInstallCodes().find(
        (row) =>
          row.ownerEoa === normalizedOwner &&
          row.client === normalizedClient &&
          (!normalizedClientId || row.clientId === normalizedClientId) &&
          (!normalizedAgentId || row.agentId === normalizedAgentId) &&
          (!normalizedIdentityRegistry || row.identityRegistry === normalizedIdentityRegistry) &&
          !isLegacyCredentialRow(row) &&
          !row.revokedAt &&
          !row.claimedAt &&
          row.expiresAt > now
      ) || null
    );
  }

  function findActiveGrantByOwner(ownerEoa = '', { client = '', clientId = '', agentId = '', identityRegistry = '' } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    if (!ethers.isAddress(normalizedOwner)) return null;
    const normalizedClient = normalizeClient(client || 'agent');
    const normalizedClientId = normalizeClientId(clientId || '');
    const normalizedAgentId = normalizeAgentId(agentId || '');
    const normalizedIdentityRegistry = normalizeAddress(identityRegistry || '');
    const now = Date.now();
    return (
      listGrants().find(
        (row) =>
          row.ownerEoa === normalizedOwner &&
          row.client === normalizedClient &&
          (!normalizedClientId || row.clientId === normalizedClientId) &&
          (!normalizedAgentId || row.agentId === normalizedAgentId) &&
          (!normalizedIdentityRegistry || row.identityRegistry === normalizedIdentityRegistry) &&
          !isLegacyCredentialRow(row) &&
          !row.revokedAt &&
          (!row.expiresAt || row.expiresAt > now)
      ) || null
    );
  }

  function issueInstallCode({
    ownerEoa = '',
    aaWallet = '',
    authorityId = '',
    policySnapshotHash = '',
    client = 'agent',
    clientId = '',
    agentId = '',
    identityRegistry = '',
    allowedBuiltinTools = []
  } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    const normalizedAaWallet = normalizeAddress(aaWallet || '');
    const normalizedClient = normalizeClient(client || 'agent');
    const normalizedClientId = normalizeClientId(clientId || '');
    const normalizedAgentId = normalizeAgentId(agentId || '');
    const normalizedIdentityRegistry = normalizeAddress(identityRegistry || defaultIdentityRegistry || '');
    const normalizedAllowedBuiltinTools = normalizeBuiltinToolList(
      Array.isArray(allowedBuiltinTools) && allowedBuiltinTools.length > 0
        ? allowedBuiltinTools
        : defaultBuiltinTools
    );
    if (!ethers.isAddress(normalizedOwner)) {
      return {
        ok: false,
        statusCode: 400,
        code: 'connector_setup_incomplete',
        reason: 'A valid ownerEoa is required to issue a connector credential.'
      };
    }
    if (!normalizedAgentId) {
      return {
        ok: false,
        statusCode: 409,
        code: 'connector_identity_required',
        reason: 'agentId is required to issue a connector credential.'
      };
    }
    if (!ethers.isAddress(normalizedIdentityRegistry)) {
      return {
        ok: false,
        statusCode: 409,
        code: 'connector_identity_registry_required',
        reason: 'identityRegistry is required to issue a connector credential.'
      };
    }
    const activeGrant = findActiveGrantByOwner(normalizedOwner, {
      client: normalizedClient,
      clientId: normalizedClientId,
      agentId: normalizedAgentId,
      identityRegistry: normalizedIdentityRegistry
    });
    if (activeGrant) {
      return {
        ok: false,
        statusCode: 409,
        code: 'connector_grant_active',
        reason: 'An active connector grant already exists for this owner and client.',
        grant: buildGrantPublicRecord(activeGrant)
      };
    }

    const now = Date.now();
    const secret = `ktrace_cc_${createBase58Value(crypto.randomBytes(32))}`;
    const record = sanitizeInstallCodeRow(normalizeAddress, {
      installCodeId: createTraceId?.('cc_install') || `cc_install_${now}`,
      ownerEoa: normalizedOwner,
      aaWallet: normalizedAaWallet,
      authorityId: normalizeText(authorityId || ''),
      policySnapshotHash: normalizeText(policySnapshotHash || ''),
      tokenHash: hashToken(secret),
      prefix: secret.slice(0, Math.min(secret.length, 20)),
      maskedPreview: buildMaskedPreview(secret),
      client: normalizedClient,
      clientId: normalizedClientId,
      agentId: normalizedAgentId,
      identityRegistry: normalizedIdentityRegistry,
      allowedBuiltinTools: normalizedAllowedBuiltinTools,
      createdAt: now,
      expiresAt: now + installCodeTtlMs,
      claimedAt: 0,
      revokedAt: 0
    });

    const nextRows = listInstallCodes().map((row) =>
      row.ownerEoa === normalizedOwner &&
      row.client === normalizedClient &&
      row.clientId === normalizedClientId &&
      row.agentId === normalizedAgentId &&
      row.identityRegistry === normalizedIdentityRegistry &&
      !row.revokedAt &&
      !row.claimedAt
        ? {
            ...row,
            revokedAt: row.revokedAt || now
          }
        : row
    );
    nextRows.unshift(record);
    writeNormalizedInstallCodes(nextRows);
    return {
      ok: true,
      token: secret,
      record,
      publicRecord: buildInstallCodePublicRecord(record)
    };
  }

  function revokeGrant({
    ownerEoa = '',
    reason = '',
    revokePending = true,
    client = '',
    clientId = '',
    agentId = '',
    identityRegistry = ''
  } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    if (!ethers.isAddress(normalizedOwner)) {
      return {
        ok: false,
        statusCode: 400,
        code: 'connector_not_found',
        reason: 'A valid ownerEoa is required to revoke a Claude connector.'
      };
    }
    const now = Date.now();
    const normalizedClient = normalizeClient(client || 'agent');
    const normalizedClientId = normalizeClientId(clientId || '');
    const normalizedAgentId = normalizeAgentId(agentId || '');
    const normalizedIdentityRegistry = normalizeAddress(identityRegistry || '');
    let revokedGrant = null;
    const nextGrants = listGrants().map((row) => {
      if (
        row.ownerEoa !== normalizedOwner ||
        row.client !== normalizedClient ||
        (normalizedClientId && row.clientId !== normalizedClientId) ||
        (normalizedAgentId && row.agentId !== normalizedAgentId) ||
        (normalizedIdentityRegistry && row.identityRegistry !== normalizedIdentityRegistry) ||
        row.revokedAt
      ) {
        return row;
      }
      revokedGrant = {
        ...row,
        revokedAt: now,
        revocationReason: normalizeText(reason || row.revocationReason || 'revoked')
      };
      return revokedGrant;
    });
    writeNormalizedGrants(nextGrants);

    let revokedInstallCode = null;
    if (revokePending) {
      const nextInstallCodes = listInstallCodes().map((row) => {
        if (
          row.ownerEoa !== normalizedOwner ||
          row.client !== normalizedClient ||
          (normalizedClientId && row.clientId !== normalizedClientId) ||
          (normalizedAgentId && row.agentId !== normalizedAgentId) ||
          (normalizedIdentityRegistry && row.identityRegistry !== normalizedIdentityRegistry) ||
          row.revokedAt ||
          row.claimedAt
        ) {
          return row;
        }
        revokedInstallCode = {
          ...row,
          revokedAt: now
        };
        return revokedInstallCode;
      });
      writeNormalizedInstallCodes(nextInstallCodes);
    }

    if (!revokedGrant && !revokedInstallCode) {
      return {
        ok: false,
        statusCode: 404,
        code: 'connector_not_found',
        reason: 'No Claude connector grant or pending install code was found.'
      };
    }

    return {
      ok: true,
      grant: revokedGrant ? buildGrantPublicRecord(revokedGrant) : null,
      pendingInstallCode: revokedInstallCode ? buildInstallCodePublicRecord(revokedInstallCode) : null
    };
  }

  function claimInstallCode(token = '') {
    const normalizedToken = normalizeText(token || '');
    if (!normalizedToken.startsWith('ktrace_cc_')) return null;
    const tokenHash = hashToken(normalizedToken);
    const now = Date.now();

    const existingGrant = listGrants().find(
      (row) => row.tokenHash === tokenHash && !row.revokedAt
    );
    if (existingGrant) {
      if (isLegacyCredentialRow(existingGrant)) {
        return {
          ok: false,
          statusCode: 409,
          code: 'connector_reconnect_required',
          reason: 'Legacy connector grants must reconnect to bind an agentId.'
        };
      }
      return {
        ok: true,
        claimed: false,
        grant: existingGrant
      };
    }

    const installCodes = listInstallCodes();
    const installCode = installCodes.find(
      (row) => row.tokenHash === tokenHash && !row.revokedAt
    );
    if (!installCode || installCode.claimedAt || installCode.expiresAt <= now) {
      return null;
    }
    if (isLegacyCredentialRow(installCode)) {
      return {
        ok: false,
        statusCode: 409,
        code: 'connector_reconnect_required',
        reason: 'Legacy connector install codes must reconnect to bind an agentId.'
      };
    }

    const grant = sanitizeGrantRow(normalizeAddress, {
      grantId: createTraceId?.('cc_grant') || `cc_grant_${now}`,
      installCodeId: installCode.installCodeId,
      ownerEoa: installCode.ownerEoa,
      aaWallet: installCode.aaWallet,
      authorityId: installCode.authorityId,
      policySnapshotHash: installCode.policySnapshotHash,
      tokenHash: installCode.tokenHash,
      prefix: installCode.prefix,
      maskedPreview: installCode.maskedPreview,
      client: installCode.client,
      clientId: installCode.clientId,
      agentId: installCode.agentId,
      identityRegistry: installCode.identityRegistry,
      allowedBuiltinTools: installCode.allowedBuiltinTools,
      createdAt: now,
      claimedAt: now,
      lastUsedAt: 0,
      expiresAt: now + grantTtlMs,
      revokedAt: 0,
      revocationReason: ''
    });

    const nextInstallCodes = installCodes.map((row) =>
      row.installCodeId === installCode.installCodeId
        ? {
            ...row,
            claimedAt: now
          }
        : row
    );
    const nextGrants = listGrants();
    nextGrants.unshift(grant);
    writeNormalizedInstallCodes(nextInstallCodes);
    writeNormalizedGrants(nextGrants);

    return {
      ok: true,
      claimed: true,
      grant
    };
  }

  function resolveConnectorToken(token = '') {
    const normalizedToken = normalizeText(token || '');
    if (!normalizedToken.startsWith('ktrace_cc_')) return null;
    const tokenHash = hashToken(normalizedToken);
    const activeGrant = listGrants().find(
      (row) => row.tokenHash === tokenHash && !row.revokedAt
    );
    if (activeGrant) {
      if (isLegacyCredentialRow(activeGrant)) {
        return {
          type: 'legacy_grant',
          grant: activeGrant,
          statusCode: 401,
          code: 'connector_reconnect_required',
          reason: 'Legacy connector grants must reconnect to bind an agentId.'
        };
      }
      return {
        type: 'grant',
        grant: activeGrant
      };
    }
    const now = Date.now();
    const installCode = listInstallCodes().find(
      (row) =>
        row.tokenHash === tokenHash &&
        !row.revokedAt &&
        !row.claimedAt &&
        row.expiresAt > now
    );
    if (installCode) {
      if (isLegacyCredentialRow(installCode)) {
        return {
          type: 'legacy_install_code',
          installCode,
          statusCode: 401,
          code: 'connector_reconnect_required',
          reason: 'Legacy connector install codes must reconnect to bind an agentId.'
        };
      }
      return {
        type: 'install_code',
        installCode
      };
    }
    return null;
  }

  function touchGrantUsage(grantOrGrantId = '') {
    const grantId =
      typeof grantOrGrantId === 'string'
        ? normalizeText(grantOrGrantId)
        : normalizeText(grantOrGrantId?.grantId || '');
    if (!grantId) return null;
    const now = Date.now();
    let updated = null;
    const nextRows = listGrants().map((row) => {
      if (row.grantId !== grantId) return row;
      updated = {
        ...row,
        lastUsedAt: now
      };
      return updated;
    });
    if (updated) writeNormalizedGrants(nextRows);
    return updated;
  }

  // Issues a persistent grant directly (no install-code flow).
  // Used for self-custodial connectors where session key ownership is verified externally.
  function issueSelfCustodialGrant({
    ownerEoa = '',
    aaWallet = '',
    sessionId = '',
    agentId = '',
    identityRegistry = '',
    allowedBuiltinTools = [],
    client = 'claude',
    clientId = ''
  } = {}) {
    const normalizedOwner = normalizeAddress(ownerEoa || '');
    const normalizedAaWallet = normalizeAddress(aaWallet || '');
    const normalizedClient = normalizeClient(client || 'claude');
    const normalizedClientId = normalizeClientId(clientId || '');
    const normalizedAgentId = normalizeAgentId(agentId || '');
    const normalizedIdentityRegistry = normalizeAddress(identityRegistry || defaultIdentityRegistry || '');
    const normalizedAllowedBuiltinTools = normalizeBuiltinToolList(
      Array.isArray(allowedBuiltinTools) && allowedBuiltinTools.length > 0
        ? allowedBuiltinTools
        : defaultBuiltinTools
    );
    if (!ethers.isAddress(normalizedOwner)) {
      return { ok: false, statusCode: 400, code: 'connector_setup_incomplete', reason: 'A valid ownerEoa is required.' };
    }
    if (!normalizedAgentId) {
      return { ok: false, statusCode: 409, code: 'connector_identity_required', reason: 'agentId is required.' };
    }
    if (!ethers.isAddress(normalizedIdentityRegistry)) {
      return { ok: false, statusCode: 409, code: 'connector_identity_registry_required', reason: 'identityRegistry is required.' };
    }

    // Revoke any existing active grant for this owner+client combo first
    const existing = findActiveGrantByOwner(normalizedOwner, {
      client: normalizedClient, clientId: normalizedClientId,
      agentId: normalizedAgentId, identityRegistry: normalizedIdentityRegistry
    });
    if (existing) {
      const now2 = Date.now();
      writeNormalizedGrants(listGrants().map(row =>
        row.grantId === existing.grantId ? { ...row, revokedAt: now2, revocationReason: 'self_custodial_reissue' } : row
      ));
    }

    const now = Date.now();
    const secret = `ktrace_cc_${createBase58Value(crypto.randomBytes(32))}`;
    const grant = sanitizeGrantRow(normalizeAddress, {
      grantId: createTraceId?.('cc_grant') || `cc_grant_${now}`,
      ownerEoa: normalizedOwner,
      aaWallet: normalizedAaWallet,
      sessionId: normalizeText(sessionId || ''),
      tokenHash: hashToken(secret),
      prefix: secret.slice(0, Math.min(secret.length, 20)),
      maskedPreview: buildMaskedPreview(secret),
      client: normalizedClient,
      clientId: normalizedClientId,
      agentId: normalizedAgentId,
      identityRegistry: normalizedIdentityRegistry,
      allowedBuiltinTools: normalizedAllowedBuiltinTools,
      authType: 'user_grant_self_custodial',
      createdAt: now,
      claimedAt: now,
      lastUsedAt: 0,
      expiresAt: now + grantTtlMs,
      revokedAt: 0,
      revocationReason: ''
    });

    const nextGrants = listGrants();
    nextGrants.unshift(grant);
    writeNormalizedGrants(nextGrants);

    return { ok: true, token: secret, grant, publicRecord: buildGrantPublicRecord(grant) };
  }

  return {
    installCodeTtlMs,
    listInstallCodes,
    listGrants,
    findPendingInstallCodeByOwner,
    findActiveGrantByOwner,
    issueInstallCode,
    issueSessionConnector: issueInstallCode,
    issueSelfCustodialGrant,
    revokeGrant,
    claimInstallCode,
    resolveConnectorToken,
    resolveAgentConnectorToken: resolveConnectorToken,
    touchGrantUsage,
    buildInstallCodePublicRecord,
    buildGrantPublicRecord
  };
}
