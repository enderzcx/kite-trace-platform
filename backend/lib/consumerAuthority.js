function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

function normalizeArray(input = [], normalizer = normalizeText) {
  const values = Array.isArray(input)
    ? input
    : normalizeText(input)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  return Array.from(new Set(values.map((item) => normalizer(item)).filter(Boolean)));
}

function stableSerialize(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
}

export function createConsumerAuthorityHelpers({
  crypto,
  normalizeAddress,
  readPolicyConfig,
  buildPolicySnapshot,
  evaluateTransferPolicy,
  logPolicyFailure,
  markSessionPayFailure,
  readX402Requests,
  readConsumerIntents,
  writeConsumerIntents,
  readSessionRuntime,
  resolveSessionRuntime,
  writeSessionRuntime
} = {}) {
  const INTENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const AUTHORITY_ACTIVE = 'active';
  const AUTHORITY_REVOKED = 'revoked';
  const AUTHORITY_EXPIRED = 'expired';
  const DENY_REASON_CODES = Object.freeze([
    'authority_not_found',
    'authority_expired',
    'authority_revoked',
    'authority_migration_required',
    'capability_not_allowed',
    'provider_not_allowed',
    'recipient_not_allowed',
    'amount_exceeds_single_limit',
    'amount_exceeds_daily_limit',
    'intent_replayed',
    'intent_conflict'
  ]);

  function sha256Hex(value = '') {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  }

  function hashObject(value) {
    return sha256Hex(stableSerialize(value));
  }

  function capabilityAliases(value = '') {
    const normalized = normalizeLower(value);
    const aliases = new Set();
    if (normalized) {
      aliases.add(normalized);
      if (normalized.startsWith('cap-') && normalized.length > 4) aliases.add(normalized.slice(4));
      else aliases.add(`cap-${normalized}`);
      const hyphenated = normalized.replace(/_/g, '-');
      const underscored = normalized.replace(/-/g, '_');
      aliases.add(hyphenated);
      aliases.add(underscored);
      if (hyphenated.startsWith('cap-') && hyphenated.length > 4) aliases.add(hyphenated.slice(4));
      else aliases.add(`cap-${hyphenated}`);
      if (underscored.startsWith('cap_') && underscored.length > 4) aliases.add(underscored.slice(4));
      else aliases.add(`cap_${underscored}`);
    }
    if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
      aliases.add('technical-analysis-feed');
      aliases.add('risk-score-feed');
      aliases.add('volatility-snapshot');
    }
    if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
      aliases.add('info-analysis-feed');
      aliases.add('x-reader-feed');
      aliases.add('url-digest');
    }
    if (['btc-price-feed', 'market-quote'].includes(normalized)) {
      aliases.add('btc-price-feed');
      aliases.add('market-quote');
    }
    if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
      aliases.add('hyperliquid-order-testnet');
      aliases.add('trade-order-feed');
      aliases.add('execute-plan');
    }
    return Array.from(aliases).filter(Boolean);
  }

  function normalizeCapabilityList(input = []) {
    return Array.from(
      new Set(
        normalizeArray(input, normalizeLower).flatMap((item) => capabilityAliases(item))
      )
    );
  }

  function normalizeAddressList(input = []) {
    return normalizeArray(input, (item) => normalizeAddress(item || ''));
  }

  function normalizeAuthorityStatus(value = '', fallback = AUTHORITY_ACTIVE) {
    const normalized = normalizeLower(value);
    if ([AUTHORITY_ACTIVE, AUTHORITY_REVOKED, AUTHORITY_EXPIRED].includes(normalized)) return normalized;
    return fallback;
  }

  function buildAuthorityId(runtime = {}) {
    return (
      normalizeText(runtime?.authorityId) ||
      normalizeText(runtime?.authorizationId) ||
      normalizeText(runtime?.sessionId) ||
      normalizeText(runtime?.aaWallet) ||
      normalizeText(runtime?.owner)
    );
  }

  function sanitizeAuthorityState(input = {}, runtime = {}) {
    const authorityId = normalizeText(input?.authorityId || runtime?.authorityId || buildAuthorityId(runtime));
    const sessionId = normalizeText(input?.sessionId || runtime?.sessionId);
    const authorizedBy = normalizeAddress(input?.authorizedBy || runtime?.authorizedBy || runtime?.owner || '');
    const payer = normalizeAddress(input?.payer || runtime?.aaWallet || runtime?.owner || '');
    const expiresAt = Number(
      input?.expiresAt ||
        runtime?.authorityExpiresAt ||
        runtime?.authorizationExpiresAt ||
        runtime?.expiresAt ||
        0
    );
    const revokedAt = Number(input?.revokedAt || runtime?.authorityRevokedAt || 0);
    const statusFallback =
      revokedAt > 0 ? AUTHORITY_REVOKED : expiresAt > 0 && expiresAt <= Date.now() ? AUTHORITY_EXPIRED : AUTHORITY_ACTIVE;
    const createdAt = Number(input?.createdAt || runtime?.authorityCreatedAt || runtime?.updatedAt || Date.now());
    const updatedAt = Number(input?.updatedAt || runtime?.authorityUpdatedAt || runtime?.updatedAt || Date.now());
    return {
      authorityId,
      sessionId,
      authorizedBy,
      payer,
      consumerAgentLabel: normalizeText(input?.consumerAgentLabel || runtime?.consumerAgentLabel || ''),
      allowedCapabilities: normalizeCapabilityList(input?.allowedCapabilities ?? runtime?.allowedCapabilities ?? []),
      allowedProviders: normalizeArray(input?.allowedProviders ?? runtime?.allowedProviders ?? [], normalizeLower),
      allowedRecipients: normalizeAddressList(
        input?.allowedRecipients ??
          runtime?.allowedRecipients ??
          [runtime?.gatewayRecipient].filter(Boolean)
      ),
      singleLimit: toPositiveNumber(input?.singleLimit ?? runtime?.maxPerTx ?? runtime?.singleLimit, 0),
      dailyLimit: toPositiveNumber(input?.dailyLimit ?? runtime?.dailyLimit, 0),
      totalLimit: toPositiveNumber(input?.totalLimit ?? runtime?.totalLimit, 0),
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
      status: normalizeAuthorityStatus(input?.status || runtime?.authorityStatus || '', statusFallback),
      revokedAt: Number.isFinite(revokedAt) && revokedAt > 0 ? revokedAt : 0,
      revocationReason: normalizeText(input?.revocationReason || runtime?.authorityRevocationReason || ''),
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
    };
  }

  function needsAuthorityMigration(runtime = {}) {
    return !normalizeText(runtime?.authorityId);
  }

  function mergeAuthorityIntoRuntime(runtime = {}, authority = {}) {
    return {
      ...runtime,
      authorityId: authority.authorityId,
      consumerAgentLabel: authority.consumerAgentLabel,
      allowedCapabilities: authority.allowedCapabilities,
      allowedProviders: authority.allowedProviders,
      allowedRecipients: authority.allowedRecipients,
      maxPerTx: authority.singleLimit,
      dailyLimit: authority.dailyLimit,
      totalLimit: authority.totalLimit,
      authorityExpiresAt: authority.expiresAt,
      authorityStatus: authority.status,
      authorityRevokedAt: authority.revokedAt,
      authorityRevocationReason: authority.revocationReason,
      authorityCreatedAt: authority.createdAt,
      authorityUpdatedAt: authority.updatedAt
    };
  }

  function resolveRuntimeIdentity(input = {}) {
    if (input?.runtime && typeof input.runtime === 'object') {
      return input.runtime;
    }
    if (typeof resolveSessionRuntime === 'function') {
      return (
        resolveSessionRuntime({
          owner: input?.owner,
          aaWallet: input?.aaWallet,
          sessionId: input?.sessionId
        }) || readSessionRuntime?.() || {}
      );
    }
    return readSessionRuntime?.() || {};
  }

  function materializeAuthority(input = {}) {
    const runtime = resolveRuntimeIdentity(input);
    if (!runtime || typeof runtime !== 'object') {
      return {
        ok: false,
        code: 'authority_not_found',
        reason: 'No session runtime is available for authority resolution.'
      };
    }
    if (!normalizeText(runtime?.sessionId) && !normalizeText(runtime?.aaWallet) && !normalizeText(runtime?.owner)) {
      return {
        ok: false,
        code: 'authority_not_found',
        reason: 'Session runtime does not contain a usable authority anchor.'
      };
    }
    if (!toPositiveNumber(runtime?.maxPerTx, 0) || !toPositiveNumber(runtime?.dailyLimit, 0)) {
      return {
        ok: false,
        code: 'authority_migration_required',
        reason: 'Session runtime is missing authority limits required for safe execution.'
      };
    }

    const authority = sanitizeAuthorityState({}, runtime);
    const shouldPersist = needsAuthorityMigration(runtime);
    const nextRuntime =
      shouldPersist && typeof writeSessionRuntime === 'function'
        ? writeSessionRuntime({
            ...runtime,
            ...mergeAuthorityIntoRuntime(runtime, authority),
            updatedAt: Number(runtime?.updatedAt || Date.now())
          })
        : runtime;

    return {
      ok: true,
      migrated: shouldPersist,
      runtime: nextRuntime,
      authority: sanitizeAuthorityState({}, nextRuntime)
    };
  }

  function buildAuthoritySnapshot(authority = {}) {
    return {
      authorityId: normalizeText(authority?.authorityId),
      sessionId: normalizeText(authority?.sessionId),
      authorizedBy: normalizeText(authority?.authorizedBy),
      payer: normalizeText(authority?.payer),
      consumerAgentLabel: normalizeText(authority?.consumerAgentLabel),
      allowedCapabilities: normalizeCapabilityList(authority?.allowedCapabilities || []),
      allowedProviders: normalizeArray(authority?.allowedProviders || [], normalizeLower),
      allowedRecipients: normalizeAddressList(authority?.allowedRecipients || []),
      singleLimit: toPositiveNumber(authority?.singleLimit, 0),
      dailyLimit: toPositiveNumber(authority?.dailyLimit, 0),
      totalLimit: toPositiveNumber(authority?.totalLimit, 0),
      expiresAt: Number(authority?.expiresAt || 0),
      status: normalizeAuthorityStatus(authority?.status || ''),
      revokedAt: Number(authority?.revokedAt || 0),
      revocationReason: normalizeText(authority?.revocationReason),
      createdAt: Number(authority?.createdAt || 0),
      updatedAt: Number(authority?.updatedAt || 0)
    };
  }

  function buildAuthorityPublicSummary(authority = {}) {
    return {
      authorityId: normalizeText(authority?.authorityId),
      sessionId: normalizeText(authority?.sessionId),
      authorizedBy: normalizeText(authority?.authorizedBy),
      payer: normalizeText(authority?.payer),
      consumerAgentLabel: normalizeText(authority?.consumerAgentLabel),
      allowedCapabilities: normalizeCapabilityList(authority?.allowedCapabilities || []),
      allowedProviders: normalizeArray(authority?.allowedProviders || [], normalizeLower),
      singleLimit: toPositiveNumber(authority?.singleLimit, 0),
      dailyLimit: toPositiveNumber(authority?.dailyLimit, 0),
      totalLimit: toPositiveNumber(authority?.totalLimit, 0),
      expiresAt: Number(authority?.expiresAt || 0),
      status: normalizeAuthorityStatus(authority?.status || ''),
      revokedAt: Number(authority?.revokedAt || 0)
    };
  }

  function buildPolicySnapshotHash(authority = {}) {
    const snapshot = buildAuthoritySnapshot(authority);
    return `sha256:${hashObject(snapshot)}`;
  }

  function compactConsumerIntentRows(rows = [], nowMs = Date.now()) {
    const items = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
    return items
      .filter((item) => {
        const updatedAt = Number(item?.updatedAt || item?.createdAt || 0);
        if (!updatedAt) return true;
        const isTerminal = ['completed', 'failed', 'replayed', 'rejected'].includes(normalizeLower(item?.status));
        if (!isTerminal) return true;
        return nowMs - updatedAt <= INTENT_RETENTION_MS;
      })
      .sort((left, right) => Number(right?.updatedAt || right?.createdAt || 0) - Number(left?.updatedAt || left?.createdAt || 0))
      .slice(0, 5000);
  }

  function readCompactedConsumerIntents() {
    const rows = compactConsumerIntentRows(readConsumerIntents?.() || []);
    writeConsumerIntents?.(rows);
    return rows;
  }

  function writeCompactedConsumerIntents(rows = []) {
    const compacted = compactConsumerIntentRows(rows);
    writeConsumerIntents?.(compacted);
    return compacted;
  }

  function buildIntentFingerprint(input = {}) {
    const envelope = {
      actionKind: normalizeLower(input?.actionKind),
      payer: normalizeAddress(input?.payer || ''),
      provider: normalizeLower(input?.provider || ''),
      capability: normalizeLower(input?.capability || ''),
      recipient: normalizeAddress(input?.recipient || ''),
      amount: normalizeText(input?.amount || ''),
      referenceId: normalizeText(input?.referenceId || '')
    };
    return `sha256:${hashObject(envelope)}`;
  }

  function findConsumerIntent(intentId = '') {
    const normalizedIntentId = normalizeText(intentId);
    if (!normalizedIntentId) return null;
    return readCompactedConsumerIntents().find((item) => normalizeText(item?.intentId) === normalizedIntentId) || null;
  }

  function beginConsumerIntent(input = {}) {
    const intentId = normalizeText(input?.intentId || input?.idempotencyKey || '');
    if (!intentId) {
      return { ok: true, active: false, record: null };
    }
    const now = Date.now();
    const fingerprint = buildIntentFingerprint(input);
    const rows = readCompactedConsumerIntents();
    const existing = rows.find((item) => normalizeText(item?.intentId) === intentId) || null;
    if (existing) {
      const sameFingerprint = normalizeText(existing?.fingerprint) === fingerprint;
      const status = normalizeLower(existing?.status || '');
      if (!sameFingerprint) {
        return {
          ok: false,
          code: 'intent_conflict',
          reason: 'intentId is already associated with a different execution request.',
          existing
        };
      }
      if (['completed', 'failed', 'replayed', 'rejected'].includes(status)) {
        return {
          ok: false,
          code: 'intent_replayed',
          reason: 'intentId already completed and cannot be executed again.',
          existing
        };
      }
      return {
        ok: false,
        code: 'intent_conflict',
        reason: 'intentId is already in progress.',
        existing
      };
    }
    const record = {
      intentId,
      fingerprint,
      actionKind: normalizeLower(input?.actionKind),
      payer: normalizeAddress(input?.payer || ''),
      provider: normalizeLower(input?.provider || ''),
      capability: normalizeLower(input?.capability || ''),
      recipient: normalizeAddress(input?.recipient || ''),
      amount: normalizeText(input?.amount || ''),
      referenceId: normalizeText(input?.referenceId || ''),
      traceId: normalizeText(input?.traceId || ''),
      status: 'in_progress',
      createdAt: now,
      updatedAt: now
    };
    rows.unshift(record);
    writeCompactedConsumerIntents(rows);
    return { ok: true, active: true, record };
  }

  function finalizeConsumerIntent(intentId = '', patch = {}) {
    const normalizedIntentId = normalizeText(intentId);
    if (!normalizedIntentId) return null;
    const rows = readCompactedConsumerIntents();
    const nextRows = rows.map((item) =>
      normalizeText(item?.intentId) === normalizedIntentId
        ? {
            ...item,
            ...patch,
            updatedAt: Date.now()
          }
        : item
    );
    writeCompactedConsumerIntents(nextRows);
    return nextRows.find((item) => normalizeText(item?.intentId) === normalizedIntentId) || null;
  }

  function mapTransferPolicyFailure(result = {}) {
    const code = normalizeLower(result?.code || '');
    if (code === 'payer_revoked') {
      return {
        code: 'authority_revoked',
        reason: 'Payer is revoked by gateway guardrail.'
      };
    }
    if (code === 'scope_violation') {
      return {
        code: 'recipient_not_allowed',
        reason: 'Recipient is outside allowed scope.'
      };
    }
    if (code === 'over_limit_per_tx') {
      return {
        code: 'amount_exceeds_single_limit',
        reason: 'Amount exceeds per-transaction limit.'
      };
    }
    if (code === 'over_limit_daily') {
      return {
        code: 'amount_exceeds_daily_limit',
        reason: 'Amount exceeds daily budget limit.'
      };
    }
    return {
      code: normalizeText(result?.code || 'authority_validation_failed'),
      reason: normalizeText(result?.message || 'Authority validation failed.')
    };
  }

  function buildDeniedResult({
    code = '',
    reason = '',
    authority = null,
    detail = null,
    payer = '',
    actionKind = '',
    amount = '',
    traceId = ''
  } = {}) {
    const snapshot = authority ? buildAuthoritySnapshot(authority) : null;
    const result = {
      ok: false,
      allowed: false,
      code: normalizeText(code || 'authority_validation_failed'),
      reason: normalizeText(reason || 'Authority validation failed.'),
      statusCode: ['intent_replayed', 'intent_conflict'].includes(normalizeText(code))
        ? 409
        : ['authority_not_found', 'authority_migration_required', 'invalid_payer', 'invalid_amount', 'invalid_recipient'].includes(
              normalizeText(code)
            )
          ? 400
          : 403,
      authority: snapshot,
      authorityPublic: authority ? buildAuthorityPublicSummary(authority) : null,
      policySnapshotHash: authority ? buildPolicySnapshotHash(authority) : '',
      detail: detail && typeof detail === 'object' ? detail : null
    };
    if (typeof logPolicyFailure === 'function' && normalizeText(payer)) {
      logPolicyFailure({
        code: result.code,
        message: result.reason,
        action: normalizeText(actionKind),
        payer: normalizeAddress(payer || ''),
        amount: normalizeText(amount),
        evidence: detail && typeof detail === 'object' ? detail : {}
      });
    }
    if (typeof markSessionPayFailure === 'function') {
      markSessionPayFailure({
        errorCode: result.code,
        reason: result.reason,
        traceId: normalizeText(traceId)
      });
    }
    return result;
  }

  function buildAllowedResult({ authority = null, detail = null } = {}) {
    const snapshot = authority ? buildAuthoritySnapshot(authority) : null;
    return {
      ok: true,
      allowed: true,
      code: 'allowed',
      reason: 'Authority validation passed.',
      statusCode: 200,
      authority: snapshot,
      authorityPublic: authority ? buildAuthorityPublicSummary(authority) : null,
      policySnapshotHash: authority ? buildPolicySnapshotHash(authority) : '',
      detail: detail && typeof detail === 'object' ? detail : null
    };
  }

  function validateConsumerAuthority(input = {}) {
    const materialized = materializeAuthority(input);
    if (!materialized.ok) {
      return buildDeniedResult({
        code: materialized.code,
        reason: materialized.reason,
        payer: input?.payer,
        actionKind: input?.actionKind,
        amount: input?.amount,
        traceId: input?.traceId
      });
    }
    const authority = materialized.authority;
    const nowMs = Date.now();
    if (normalizeAuthorityStatus(authority?.status) === AUTHORITY_REVOKED || Number(authority?.revokedAt || 0) > 0) {
      return buildDeniedResult({
        code: 'authority_revoked',
        reason: authority?.revocationReason || 'Authority has been revoked.',
        authority,
        payer: input?.payer,
        actionKind: input?.actionKind,
        amount: input?.amount,
        traceId: input?.traceId
      });
    }
    if (Number(authority?.expiresAt || 0) > 0 && Number(authority.expiresAt) <= nowMs) {
      return buildDeniedResult({
        code: 'authority_expired',
        reason: 'Authority grant has expired.',
        authority,
        payer: input?.payer,
        actionKind: input?.actionKind,
        amount: input?.amount,
        traceId: input?.traceId
      });
    }

    const capability = normalizeLower(input?.capability || '');
    if (capability && authority.allowedCapabilities.length > 0) {
      const capabilityAllowed = capabilityAliases(capability).some((item) => authority.allowedCapabilities.includes(item));
      if (!capabilityAllowed) {
        return buildDeniedResult({
          code: 'capability_not_allowed',
          reason: `Capability ${capability} is not allowed by authority policy.`,
          authority,
          payer: input?.payer,
          actionKind: input?.actionKind,
          amount: input?.amount,
          traceId: input?.traceId,
          detail: {
            capability,
            allowedCapabilities: authority.allowedCapabilities
          }
        });
      }
    }

    const provider = normalizeLower(input?.provider || '');
    if (provider && authority.allowedProviders.length > 0 && !authority.allowedProviders.includes(provider)) {
      return buildDeniedResult({
        code: 'provider_not_allowed',
        reason: `Provider ${provider} is not allowed by authority policy.`,
        authority,
        payer: input?.payer,
        actionKind: input?.actionKind,
        amount: input?.amount,
        traceId: input?.traceId,
        detail: {
          provider,
          allowedProviders: authority.allowedProviders
        }
      });
    }

    const recipient = normalizeAddress(input?.recipient || '');
    if (recipient && authority.allowedRecipients.length > 0 && !authority.allowedRecipients.includes(recipient)) {
      return buildDeniedResult({
        code: 'recipient_not_allowed',
        reason: `Recipient ${recipient} is not allowed by authority policy.`,
        authority,
        payer: input?.payer,
        actionKind: input?.actionKind,
        amount: input?.amount,
        traceId: input?.traceId,
        detail: {
          recipient,
          allowedRecipients: authority.allowedRecipients
        }
      });
    }

    const amountNum = toPositiveNumber(input?.amount, 0);
    if (amountNum > 0 && authority.singleLimit > 0 && amountNum > authority.singleLimit) {
      return buildDeniedResult({
        code: 'amount_exceeds_single_limit',
        reason: 'Amount exceeds authority singleLimit.',
        authority,
        payer: input?.payer,
        actionKind: input?.actionKind,
        amount: input?.amount,
        traceId: input?.traceId,
        detail: {
          actualAmount: amountNum,
          singleLimit: authority.singleLimit
        }
      });
    }

    if (amountNum > 0 && recipient && typeof evaluateTransferPolicy === 'function') {
      const transfer = evaluateTransferPolicy({
        payer: input?.payer || authority.payer,
        recipient,
        amount: input?.amount,
        requests: readX402Requests?.() || []
      });
      if (!transfer?.ok) {
        const mapped = mapTransferPolicyFailure(transfer);
        return buildDeniedResult({
          code: mapped.code,
          reason: mapped.reason,
          authority,
          payer: input?.payer,
          actionKind: input?.actionKind,
          amount: input?.amount,
          traceId: input?.traceId,
          detail: transfer?.evidence || null
        });
      }
    }

    return buildAllowedResult({
      authority,
      detail: {
        provider,
        capability,
        recipient,
        amount: amountNum
      }
    });
  }

  function writeConsumerAuthorityPolicy(input = {}) {
    const materialized = materializeAuthority(input);
    if (!materialized.ok) return materialized;
    const runtime = materialized.runtime;
    const authority = sanitizeAuthorityState(
      {
        ...input,
        status: AUTHORITY_ACTIVE,
        revokedAt: 0,
        revocationReason: ''
      },
      runtime
    );
    const nextRuntime = writeSessionRuntime({
      ...runtime,
      ...mergeAuthorityIntoRuntime(runtime, authority),
      updatedAt: Date.now()
    });
    return {
      ok: true,
      runtime: nextRuntime,
      authority: sanitizeAuthorityState({}, nextRuntime)
    };
  }

  function revokeConsumerAuthorityPolicy(input = {}) {
    const materialized = materializeAuthority(input);
    if (!materialized.ok) return materialized;
    const runtime = materialized.runtime;
    const authority = sanitizeAuthorityState(
      {
        ...materialized.authority,
        status: AUTHORITY_REVOKED,
        revokedAt: Date.now(),
        revocationReason: normalizeText(input?.revocationReason || 'revoked_by_agent')
      },
      runtime
    );
    const nextRuntime = writeSessionRuntime({
      ...runtime,
      ...mergeAuthorityIntoRuntime(runtime, authority),
      updatedAt: Date.now()
    });
    return {
      ok: true,
      runtime: nextRuntime,
      authority: sanitizeAuthorityState({}, nextRuntime)
    };
  }

  return {
    AUTHORITY_ACTIVE,
    AUTHORITY_EXPIRED,
    AUTHORITY_REVOKED,
    DENY_REASON_CODES,
    INTENT_RETENTION_MS,
    beginConsumerIntent,
    buildAuthorityPublicSummary,
    buildAuthoritySnapshot,
    buildPolicySnapshotHash,
    compactConsumerIntentRows,
    finalizeConsumerIntent,
    findConsumerIntent,
    mapTransferPolicyFailure,
    materializeAuthority,
    revokeConsumerAuthorityPolicy,
    sanitizeAuthorityState,
    validateConsumerAuthority,
    writeConsumerAuthorityPolicy
  };
}
