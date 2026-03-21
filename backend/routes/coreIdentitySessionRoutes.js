export function registerCoreIdentitySessionRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    PORT,
    createTraceId,
    crypto,
    createOnboardingChallengeMessage,
    ensureAAAccountDeployment,
    BACKEND_PUBLIC_URL,
    buildAccountApiKeyPublicRecord,
    buildClaudeConnectorGrantPublicRecord,
    buildClaudeConnectorInstallCodePublicRecord,
    clearOnboardingAuthCookie,
    findActiveClaudeConnectorGrant,
    findActiveAccountApiKey,
    findPendingClaudeConnectorInstallCode,
    generateAccountApiKey,
    issueClaudeConnectorInstallCode,
    issueOnboardingAuthChallenge,
    maskSecret,
    readRecords,
    readSessionRuntime,
    requireRole,
    revokeClaudeConnectorGrant,
    revokeAccountApiKey,
    sessionPayConfigSnapshot,
    sessionPayMetrics,
    sessionRuntimePath,
    materializeAuthority,
    revokeConsumerAuthorityPolicy,
    validateConsumerAuthority,
    verifyOnboardingAuthChallenge,
    writeConsumerAuthorityPolicy,
    writeOnboardingAuthCookie,
    writeJsonObject,
    writeRecords,
    writeSessionRuntime
  } = deps;
  const {
    appendSessionApprovalRequest,
    buildApprovalRequestToken,
    buildSessionApprovalRequestPayload,
    buildSessionRuntimePayload,
    ensureBackendSessionRuntime,
    finalizeSelfServeSessionRuntime,
    finalizeSessionAuthorization,
    getBackendSignerState,
    listSessionApprovalRequests,
    normalizeSessionGrantAddress,
    normalizeSessionGrantPayload,
    normalizeSessionGrantText,
    prepareSelfServeSessionRuntime
  } = helpers;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  const SELF_SERVE_VIEW_AUTH = {
    allowEnvApiKey: false,
    allowAccountApiKey: true,
    allowOnboardingCookie: true,
    unauthorizedCode: 'sign_in_required',
    unauthorizedMessage: 'Sign-in required. Complete wallet onboarding or use a compatible account credential.'
  };

  const SELF_SERVE_MUTATION_AUTH = {
    allowEnvApiKey: false,
    allowAccountApiKey: false,
    allowOnboardingCookie: true,
    unauthorizedCode: 'sign_in_required',
    unauthorizedMessage: 'Sign-in required. Complete wallet onboarding to continue.'
  };

  const CONNECTOR_COMPAT_AUTH = {
    ...SELF_SERVE_MUTATION_AUTH,
    allowEnvApiKey: true
  };

  function getScopedOwnerFromAuth(req) {
    return normalizeSessionGrantAddress(req?.authOwnerEoa || req?.accountCtx?.ownerEoa || '');
  }

  function normalizeOwnerInput(value = '') {
    return normalizeSessionGrantAddress(value || '');
  }

  function buildSetupRouteBody(req, body = {}, { includeUserEoa = false } = {}) {
    const scopedOwner = getScopedOwnerFromAuth(req);
    if (!scopedOwner || normalizeText(req?.authSource || '') !== 'onboarding-cookie') {
      return {
        ...body
      };
    }
    const requestedOwner = normalizeOwnerInput(body.owner || body.ownerEoa || body.userEoa || '');
    const requestedRuntimeOwner = normalizeOwnerInput(body?.runtime?.owner || '');
    if (
      (requestedOwner && requestedOwner !== scopedOwner) ||
      (requestedRuntimeOwner && requestedRuntimeOwner !== scopedOwner)
    ) {
      return {
        error: {
          statusCode: 403,
          code: 'onboarding_owner_mismatch',
          reason: 'Setup routes infer ownerEoa from the onboarding cookie.'
        }
      };
    }
    return {
      ...body,
      owner: scopedOwner,
      ownerEoa: scopedOwner,
      ...(includeUserEoa ? { userEoa: scopedOwner } : {}),
      runtime:
        body?.runtime && typeof body.runtime === 'object' && !Array.isArray(body.runtime)
          ? {
              ...body.runtime,
              owner: scopedOwner
            }
          : body?.runtime
    };
  }

  function resolveAccountOwner(req, body = {}) {
    const scopedOwner = getScopedOwnerFromAuth(req);
    if (scopedOwner) return scopedOwner;
    return normalizeOwnerInput(
      body.owner || body.ownerEoa || req.query.owner || req.query.ownerEoa || ''
    );
  }

  function buildRuntimeLookup(req) {
    const scopedOwner = getScopedOwnerFromAuth(req);
    return {
      owner: scopedOwner || req.query.owner,
      aaWallet: req.query.aaWallet,
      sessionId: req.query.sessionId,
      runtimePurpose: req.query.runtimePurpose
    };
  }

  function sendRouteFailure(req, res, failure = {}) {
    return res.status(Number(failure?.statusCode || 400)).json({
      ok: false,
      error: normalizeText(failure?.code || 'request_failed') || 'request_failed',
      reason: normalizeText(failure?.reason || 'request failed') || 'request failed',
      traceId: req.traceId || ''
    });
  }

  function buildPublicBaseUrl(req) {
    const configured = normalizeText(BACKEND_PUBLIC_URL || '');
    if (configured) return configured.replace(/\/+$/, '');
    const forwardedProto = normalizeText(req.headers['x-forwarded-proto'] || '');
    const forwardedHost = normalizeText(req.headers['x-forwarded-host'] || '');
    const protocol = forwardedProto || req.protocol || 'http';
    const host = forwardedHost || req.get('host') || `127.0.0.1:${normalizeText(PORT || '3001') || '3001'}`;
    return `${protocol}://${host}`.replace(/\/+$/, '');
  }

  function normalizeConnectorClient(value = '') {
    const normalized = normalizeText(value || '').toLowerCase();
    return normalized || 'agent';
  }

  function normalizeConnectorClientId(value = '') {
    return normalizeText(value || '');
  }

  function normalizeConnectorBuiltinToolId(value = '') {
    const normalized = normalizeText(value || '').toLowerCase();
    if (!normalized) return '';
    if (normalized.startsWith('ktrace__')) return normalized.slice('ktrace__'.length);
    return normalized.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function normalizeConnectorBuiltinToolList(value = []) {
    const rawItems = Array.isArray(value)
      ? value
      : normalizeText(value)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    return Array.from(new Set(rawItems.map((item) => normalizeConnectorBuiltinToolId(item)).filter(Boolean)));
  }

  function resolveConnectorIdentity(body = {}, setup = null) {
    const runtime = setup?.runtime && typeof setup.runtime === 'object' ? setup.runtime : {};
    const agentId = normalizeText(body.agentId || runtime.authorizedAgentId || '');
    const identityRegistry = normalizeSessionGrantAddress(
      body.identityRegistry || body.registry || ERC8004_IDENTITY_REGISTRY || ''
    );
    return {
      agentId,
      identityRegistry
    };
  }

  function evaluateAgentConnectorSetup(ownerEoa = '') {
    const normalizedOwner = normalizeOwnerInput(ownerEoa || '');
    const missing = [];
    if (!normalizedOwner) {
      return {
        ready: false,
        missing: ['owner_eoa_missing'],
        runtime: null,
        authority: null
      };
    }

    const runtime = deps.resolveSessionRuntime({
      owner: normalizedOwner,
      strictOwnerMatch: true
    });
    const runtimeSource = normalizeText(runtime?.source || '').toLowerCase();
    const authorizationMode = normalizeText(runtime?.authorizationMode || '').toLowerCase();
    const supportsManagedConnectorCompat =
      authorizationMode === 'owner_runtime_sync' ||
      runtimeSource === 'api-session-runtime-ensure' ||
      runtimeSource.startsWith('backend-managed');
    if (!runtime?.owner || normalizeOwnerInput(runtime.owner) !== normalizedOwner) {
      missing.push('runtime_owner_missing');
    }
    if (!normalizeText(runtime?.aaWallet || '')) missing.push('aa_wallet_missing');
    if (!normalizeText(runtime?.sessionAddress || '')) missing.push('session_address_missing');
    if (!normalizeText(runtime?.sessionId || '')) missing.push('session_id_missing');
    if (!supportsManagedConnectorCompat && !normalizeText(runtime?.authorizationSignature || '')) {
      missing.push('authorization_signature_missing');
    }
    if (!supportsManagedConnectorCompat && !normalizeText(runtime?.authorizationPayloadHash || '')) {
      missing.push('authorization_payload_hash_missing');
    }

    const authorityResult = materializeAuthority?.({
      owner: normalizedOwner
    });
    if (!authorityResult?.ok || !authorityResult?.authority) {
      missing.push('authority_missing');
      return {
        ready: false,
        missing,
        runtime,
        authority: null,
        authorityResult
      };
    }

    const authority = authorityResult.authority;
    const now = Date.now();
    if (normalizeText(authority?.status || '').toLowerCase() !== 'active') {
      missing.push('authority_inactive');
    }
    if (Number(authority?.revokedAt || 0) > 0) {
      missing.push('authority_revoked');
    }
    if (Number(authority?.expiresAt || 0) > 0 && Number(authority.expiresAt) <= now) {
      missing.push('authority_expired');
    }

    return {
      ready: missing.length === 0,
      missing,
      runtime: authorityResult?.runtime || runtime,
      authority,
      authorityResult
    };
  }

  function buildAgentConnectorStatus(ownerEoa = '', req, { client = 'agent', clientId = '', agentId = '', identityRegistry = '' } = {}) {
    const normalizedClient = normalizeConnectorClient(client);
    const normalizedClientId = normalizeConnectorClientId(clientId);
    const setup = evaluateAgentConnectorSetup(ownerEoa);
    const identity = resolveConnectorIdentity(
      {
        agentId,
        identityRegistry
      },
      setup
    );
    const pendingInstallCode =
      findPendingClaudeConnectorInstallCode?.(ownerEoa, {
        client: normalizedClient,
        clientId: normalizedClientId,
        agentId: identity.agentId,
        identityRegistry: identity.identityRegistry
      }) || null;
    const activeGrant =
      findActiveClaudeConnectorGrant?.(ownerEoa, {
        client: normalizedClient,
        clientId: normalizedClientId,
        agentId: identity.agentId,
        identityRegistry: identity.identityRegistry
      }) || null;
    let state = 'not_connected';
    if (!setup.ready) state = 'not_ready';
    else if (activeGrant) state = 'connected';
    else if (pendingInstallCode) state = 'install_code_issued';
    return {
      ok: true,
      traceId: req?.traceId || '',
      ownerEoa: normalizeOwnerInput(ownerEoa || ''),
      setup: {
        ready: setup.ready,
        missing: setup.missing,
        runtime: buildSessionRuntimePayload(setup.runtime || {})
      },
      connector: {
        client: normalizedClient,
        clientId: normalizedClientId,
        agentId: identity.agentId,
        identityRegistry: identity.identityRegistry,
        state,
        pendingInstallCode: pendingInstallCode
          ? buildClaudeConnectorInstallCodePublicRecord?.(pendingInstallCode) || null
          : null,
        activeGrant: activeGrant
          ? buildClaudeConnectorGrantPublicRecord?.(activeGrant) || null
          : null
      }
    };
  }

  function buildClaudeConnectorStatus(ownerEoa = '', req) {
    return buildAgentConnectorStatus(ownerEoa, req, { client: 'claude' });
  }

  function normalizePolicyExpiry(value = 0) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const raw = normalizeText(value);
    if (!raw) return 0;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

  function buildAuthorityPolicySnapshotHash(authority = null) {
    const snapshot = authority && typeof authority === 'object' ? authority : {};
    return `sha256:${crypto.createHash('sha256').update(stableSerialize(snapshot), 'utf8').digest('hex')}`;
  }

  function buildAuthorityRouteInput(req, body = {}) {
    return {
      owner: body.owner || req.query.owner,
      aaWallet: body.aaWallet || req.query.aaWallet,
      sessionId: body.sessionId || req.query.sessionId,
      consumerAgentLabel: body.consumerAgentLabel,
      allowedCapabilities: body.allowedCapabilities,
      allowedProviders: body.allowedProviders,
      allowedRecipients: body.allowedRecipients,
      singleLimit: body.singleLimit,
      dailyLimit: body.dailyLimit,
      totalLimit: body.totalLimit,
      expiresAt: normalizePolicyExpiry(body.expiresAt),
      revocationReason: body.revocationReason
    };
  }

  function sendAuthorityFailure(req, res, result = {}) {
    return res.status(Number(result?.statusCode || 400)).json({
      ok: false,
      error: String(result?.code || 'authority_validation_failed').trim(),
      reason: String(result?.reason || 'authority validation failed').trim(),
      traceId: req.traceId || '',
      authority: result?.authorityPublic || null,
      ...(result?.detail && typeof result.detail === 'object' ? { detail: result.detail } : {})
    });
  }

  app.get('/api/records', requireRole('viewer'), (req, res) => {
    res.json(readRecords());
  });

  app.post('/api/records', requireRole('agent'), (req, res) => {
    const record = req.body || {};
    const records = readRecords();
    const normalized = {
      time: record.time || new Date().toISOString(),
      type: record.type || 'unknown',
      amount: record.amount || '',
      token: record.token || '',
      recipient: record.recipient || '',
      txHash: record.txHash || '',
      status: record.status || 'unknown',
      requestId: record.requestId || '',
      signerMode: record.signerMode || '',
      agentId:
        record.agentId ||
        (ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : ''),
      identityRegistry: record.identityRegistry || ERC8004_IDENTITY_REGISTRY || ''
    };
    records.unshift(normalized);
    writeRecords(records);
    res.json({ ok: true });
  });

  app.get('/api/signer/info', requireRole('viewer'), (req, res) => {
    res.json(getBackendSignerState());
  });

  app.post('/api/onboarding/auth/challenge', (req, res) => {
    try {
      const body = req.body || {};
      const result = issueOnboardingAuthChallenge?.({
        ownerEoa: body.ownerEoa || body.owner || '',
        chainId: body.chainId || '',
        traceId: req.traceId || ''
      });
      if (!result?.ok) {
        return sendRouteFailure(req, res, result);
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        challenge: {
          challengeId: result.challenge.challengeId,
          ownerEoa: result.challenge.ownerEoa,
          chainId: result.challenge.chainId,
          issuedAt: result.challenge.issuedAt,
          expiresAt: result.challenge.expiresAt,
          message: result.challenge.message
        }
      });
    } catch (error) {
      return sendRouteFailure(req, res, {
        statusCode: 500,
        code: 'onboarding_challenge_internal_error',
        reason: normalizeText(error?.message || 'onboarding challenge failed') || 'onboarding challenge failed'
      });
    }
  });

  app.post('/api/onboarding/auth/verify', (req, res) => {
    try {
      const body = req.body || {};
      const result = verifyOnboardingAuthChallenge?.({
        challengeId: body.challengeId || '',
        ownerEoa: body.ownerEoa || body.owner || '',
        chainId: body.chainId || '',
        signature: body.signature || body.userSignature || '',
        traceId: req.traceId || ''
      });
      if (!result?.ok) {
        return sendRouteFailure(req, res, result);
      }
      writeOnboardingAuthCookie?.(res, {
        ownerEoa: result.ownerEoa,
        chainId: result.chainId
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        auth: {
          ownerEoa: result.ownerEoa,
          chainId: result.chainId,
          authSource: 'onboarding-cookie'
        }
      });
    } catch (error) {
      return sendRouteFailure(req, res, {
        statusCode: 500,
        code: 'onboarding_verify_internal_error',
        reason: normalizeText(error?.message || 'onboarding verification failed') || 'onboarding verification failed'
      });
    }
  });

  app.post('/api/onboarding/auth/logout', (req, res) => {
    clearOnboardingAuthCookie?.(res);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      cleared: true
    });
  });

  app.get(
    '/api/session/runtime',
    requireRole('viewer', SELF_SERVE_VIEW_AUTH),
    (req, res) => {
    const lookup = buildRuntimeLookup(req);
    const explicitOwnerLookup = normalizeOwnerInput(req.query.owner || req.query.ownerEoa || '');
    const runtime = deps.resolveSessionRuntime({
      ...lookup,
      strictOwnerMatch: Boolean(
        explicitOwnerLookup ||
          (normalizeText(req?.authSource || '') === 'onboarding-cookie' && getScopedOwnerFromAuth(req))
      )
    });
    return res.json({
      ok: true,
      runtime: buildSessionRuntimePayload(runtime)
    });
  });

  app.post(
    '/api/setup/runtime/prepare',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    async (req, res) => {
      try {
        const scopedBody = buildSetupRouteBody(req, req.body || {});
        if (scopedBody?.error) {
          return sendRouteFailure(req, res, scopedBody.error);
        }
        const body = scopedBody || {};
        const prepared = await prepareSelfServeSessionRuntime({
          owner: body.owner || body.ownerEoa,
          singleLimit: body.singleLimit,
          dailyLimit: body.dailyLimit,
          tokenAddress: body.tokenAddress || body.token,
          gatewayRecipient: body.gatewayRecipient
        });
        return res.json({
          ok: true,
          traceId: req.traceId || '',
          bootstrap: prepared
        });
      } catch (error) {
        const reason = normalizeText(error?.message || 'setup_runtime_prepare_failed') || 'setup_runtime_prepare_failed';
        const status =
          /invalid|required|mismatch/i.test(reason)
            ? 400
            : 500;
        return res.status(status).json({
          ok: false,
          error: 'setup_runtime_prepare_failed',
          reason,
          traceId: req.traceId || ''
        });
      }
    }
  );

  app.post(
    '/api/setup/runtime/finalize',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    async (req, res) => {
      try {
        const scopedBody = buildSetupRouteBody(req, req.body || {}, { includeUserEoa: true });
        if (scopedBody?.error) {
          return sendRouteFailure(req, res, scopedBody.error);
        }
        const body = scopedBody || {};
        const runtimeInput =
          body?.runtime && typeof body.runtime === 'object' && !Array.isArray(body.runtime)
            ? body.runtime
            : {};
        const finalized = await finalizeSelfServeSessionRuntime({
          owner: body.owner || body.ownerEoa || body.userEoa,
          runtime: runtimeInput,
          singleLimit: body.singleLimit || runtimeInput.maxPerTx,
          dailyLimit: body.dailyLimit || runtimeInput.dailyLimit,
          tokenAddress: body.tokenAddress || runtimeInput.tokenAddress || body.token,
          gatewayRecipient: body.gatewayRecipient || runtimeInput.gatewayRecipient,
          userEoa: body.userEoa || body.ownerEoa || body.owner
        });
        return res.json({
          ok: true,
          traceId: req.traceId || '',
          bootstrap: finalized.prepared,
          runtime: buildSessionRuntimePayload(finalized.runtime)
        });
      } catch (error) {
        const reason = normalizeText(error?.message || 'setup_runtime_finalize_failed') || 'setup_runtime_finalize_failed';
        const status =
          /invalid|required|mismatch|not found|No contract code/i.test(reason)
            ? 400
            : 500;
        return res.status(status).json({
          ok: false,
          error: 'setup_runtime_finalize_failed',
          reason,
          traceId: req.traceId || ''
        });
      }
    }
  );

  app.get('/api/session/policy', requireRole('viewer'), (req, res) => {
    const result = materializeAuthority?.({
      owner: req.query.owner,
      aaWallet: req.query.aaWallet,
      sessionId: req.query.sessionId
    });
    if (!result?.ok) {
      return sendAuthorityFailure(req, res, result);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      authority: result?.authority || null,
      runtime: buildSessionRuntimePayload(result?.runtime || {})
    });
  });

  app.post(
    '/api/setup/session/policy',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    (req, res) => {
      const scopedBody = buildSetupRouteBody(req, req.body || {});
      if (scopedBody?.error) {
        return sendRouteFailure(req, res, scopedBody.error);
      }
      const result = writeConsumerAuthorityPolicy?.(buildAuthorityRouteInput(req, scopedBody || {}));
      if (!result?.ok) {
        return sendAuthorityFailure(req, res, result);
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        authority: result?.authority || null,
        runtime: buildSessionRuntimePayload(result?.runtime || {})
      });
    }
  );

  app.post('/api/session/policy', requireRole('agent'), (req, res) => {
    const result = writeConsumerAuthorityPolicy?.(buildAuthorityRouteInput(req, req.body || {}));
    if (!result?.ok) {
      return sendAuthorityFailure(req, res, result);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      authority: result?.authority || null,
      runtime: buildSessionRuntimePayload(result?.runtime || {})
    });
  });

  app.post('/api/session/policy/revoke', requireRole('agent'), (req, res) => {
    const result = revokeConsumerAuthorityPolicy?.(buildAuthorityRouteInput(req, req.body || {}));
    if (!result?.ok) {
      return sendAuthorityFailure(req, res, result);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      authority: result?.authority || null,
      runtime: buildSessionRuntimePayload(result?.runtime || {})
    });
  });

  app.post('/api/session/validate', requireRole('agent'), (req, res) => {
    const body = req.body || {};
    const routeInput = buildAuthorityRouteInput(req, body);
    const result = validateConsumerAuthority?.({
      ...routeInput,
      payer: body.payer,
      provider: body.provider,
      capability: body.capability,
      recipient: body.recipient,
      amount: body.amount,
      intentId: body.intentId || body.idempotencyKey,
      actionKind: body.actionKind || body.lane || body.kind,
      referenceId: body.referenceId || body.serviceId || body.jobId || body.templateId,
      traceId: req.traceId || ''
    });
    if (!result?.ok) {
      return sendAuthorityFailure(req, res, result);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      allowed: true,
      authority: result?.authority || null,
      policySnapshotHash: normalizeText(result?.policySnapshotHash || ''),
      detail: result?.detail || null
    });
  });

  app.get('/api/session/pay/config', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      config: sessionPayConfigSnapshot()
    });
  });

  app.get('/api/session/pay/metrics', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      metrics: {
        startedAt: sessionPayMetrics.startedAt,
        totalRequests: sessionPayMetrics.totalRequests,
        totalSuccess: sessionPayMetrics.totalSuccess,
        totalFailed: sessionPayMetrics.totalFailed,
        totalRetryAttempts: sessionPayMetrics.totalRetryAttempts,
        totalRetryDelayMs: sessionPayMetrics.totalRetryDelayMs,
        averageRetryDelayMs:
          sessionPayMetrics.totalRetryAttempts > 0
            ? Number((sessionPayMetrics.totalRetryDelayMs / sessionPayMetrics.totalRetryAttempts).toFixed(2))
            : 0,
        totalRetriesUsed: sessionPayMetrics.totalRetriesUsed,
        totalFallbackAttempted: sessionPayMetrics.totalFallbackAttempted,
        totalFallbackSucceeded: sessionPayMetrics.totalFallbackSucceeded,
        failureRate:
          sessionPayMetrics.totalRequests > 0
            ? Number((sessionPayMetrics.totalFailed / sessionPayMetrics.totalRequests).toFixed(4))
            : 0,
        failuresByCategory: sessionPayMetrics.failuresByCategory,
        retriesByCategory: sessionPayMetrics.retriesByCategory,
        retryDelayMsByCategory: sessionPayMetrics.retryDelayMsByCategory,
        recentFailures: sessionPayMetrics.recentFailures
      }
    });
  });

  app.get('/api/session/runtime/secret', requireRole('admin'), (req, res) => {
    const runtime = deps.resolveSessionRuntime({
      owner: req.query.owner,
      aaWallet: req.query.aaWallet,
      sessionId: req.query.sessionId
    });
    return res.json({
      ok: true,
      runtime
    });
  });

  app.post('/api/session/runtime/sync', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const next = writeSessionRuntime({
      aaWallet: body.aaWallet,
      owner: body.owner,
      sessionAddress: body.sessionAddress,
      sessionPrivateKey: body.sessionPrivateKey,
      sessionId: body.sessionId,
      sessionTxHash: body.sessionTxHash,
      tokenAddress: body.tokenAddress,
      expiresAt: body.expiresAt,
      maxPerTx: body.maxPerTx,
      dailyLimit: body.dailyLimit,
      gatewayRecipient: body.gatewayRecipient,
      accountVersion: body.accountVersion,
      accountVersionTag: body.accountVersionTag,
      accountFactoryAddress: body.accountFactoryAddress,
      accountImplementationAddress: body.accountImplementationAddress,
      accountCapabilities: body.accountCapabilities,
      requiredForJobLane: body.requiredForJobLane,
      authorizedBy: body.authorizedBy,
      authorizedAt: body.authorizedAt,
      authorizationMode: body.authorizationMode,
      authorizationPayload: body.authorizationPayload,
      authorizationPayloadHash: body.authorizationPayloadHash,
      authorizationSignature: body.authorizationSignature,
      authorizationNonce: body.authorizationNonce,
      authorizationExpiresAt: body.authorizationExpiresAt,
      authorizedAgentId: body.authorizedAgentId,
      authorizedAgentWallet: body.authorizedAgentWallet,
      authorizationAudience: body.authorizationAudience,
      allowedCapabilities: body.allowedCapabilities,
      source: body.source || 'frontend',
      updatedAt: Date.now()
    });
    return res.json({
      ok: true,
      runtime: buildSessionRuntimePayload(next)
    });
  });

  app.post(
    '/api/session/runtime/ensure',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    async (req, res) => {
    try {
      const scopedBody = buildSetupRouteBody(req, req.body || {});
      if (scopedBody?.error) {
        return sendRouteFailure(req, res, scopedBody.error);
      }
      if (normalizeText(req?.authSource || '') === 'onboarding-cookie') {
        return sendRouteFailure(req, res, {
          statusCode: 409,
          code: 'self_serve_runtime_prepare_required',
          reason:
            'Self-serve setup must use /api/setup/runtime/prepare and /api/setup/runtime/finalize. Backend-managed runtime ensure remains a demo/dev compatibility path only.'
        });
      }
      const body = scopedBody || {};
      const ensured = await ensureBackendSessionRuntime({
        owner: body.owner || body.ownerEoa,
        singleLimit: body.singleLimit,
        dailyLimit: body.dailyLimit,
        tokenAddress: body.tokenAddress || body.token,
        gatewayRecipient: body.gatewayRecipient,
        forceNewSession: /^(1|true|yes|on)$/i.test(String(body.forceNewSession || '').trim())
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        created: ensured.created,
        reused: ensured.reused,
        owner: ensured.runtime.owner,
        aaWallet: ensured.runtime.aaWallet,
        session: {
          address: ensured.runtime.sessionAddress,
          id: ensured.runtime.sessionId,
          txHash: ensured.runtime.sessionTxHash,
          maxPerTx: ensured.runtime.maxPerTx,
          dailyLimit: ensured.runtime.dailyLimit,
          gatewayRecipient: ensured.runtime.gatewayRecipient,
          tokenAddress: ensured.tokenAddress
        },
        runtime: buildSessionRuntimePayload(ensured.runtime)
      });
    } catch (error) {
      const reason = error?.message || 'session_runtime_ensure_failed';
      const status =
        /unavailable/i.test(reason)
          ? 503
          : /invalid|mismatch|required|positive number/i.test(reason)
            ? 400
            : 500;
      return res.status(status).json({
        ok: false,
        error: 'session_runtime_ensure_failed',
        reason,
        traceId: req.traceId || ''
      });
    }
  });

  app.post(
    '/api/v1/session/authorize',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    async (req, res) => {
    try {
      const scopedBody = buildSetupRouteBody(req, req.body || {}, { includeUserEoa: true });
      if (scopedBody?.error) {
        return sendRouteFailure(req, res, scopedBody.error);
      }
      const finalized = await finalizeSessionAuthorization({
        body: scopedBody || {},
        traceId: req.traceId || ''
      });

      return res.json({
        ok: true,
        schemaVersion: 'v1',
        traceId: req.traceId || '',
        created: Boolean(finalized?.ensured?.created),
        reused: Boolean(finalized?.ensured?.reused),
        imported: finalized.executionMode === 'external',
        executionMode: finalized.executionMode,
        authorizedBy: finalized.userEoa,
        authorization: {
          authorizationId: finalized.authorizationId,
          mode: finalized.authorizationMode,
          authorizedBy: finalized.userEoa,
          authorizedAt: finalized.authorizedAt,
          payload: finalized.payload,
          payloadHash: finalized.authorizationPayloadHash,
          signatureMasked: maskSecret(finalized.userSignature),
          expiresAt: finalized.payload.expiresAt,
          nonce: finalized.payload.nonce,
          allowedCapabilities: finalized.payload.allowedCapabilities
        },
        session: {
          address: finalized.nextRuntime.sessionAddress,
          id: finalized.nextRuntime.sessionId,
          txHash: finalized.nextRuntime.sessionTxHash,
          maxPerTx: finalized.nextRuntime.maxPerTx,
          dailyLimit: finalized.nextRuntime.dailyLimit,
          gatewayRecipient: finalized.nextRuntime.gatewayRecipient,
          tokenAddress: finalized.payload.tokenAddress,
          authorizedBy: finalized.nextRuntime.authorizedBy,
          authorizationMode: finalized.nextRuntime.authorizationMode
        },
        runtime: buildSessionRuntimePayload(finalized.nextRuntime),
        record: finalized.authorizationRecord
      });
    } catch (error) {
      const reason = error?.message || 'session_authorize_failed';
      const status = Number(error?.statusCode || 0) || (/already used|reused/i.test(reason) ? 409 : 400);
      console.error('[api/v1/session/authorize]', {
        traceId: req.traceId || '',
        authSource: normalizeText(req?.authSource || ''),
        ownerEoa: getScopedOwnerFromAuth(req) || normalizeOwnerInput(req.body?.userEoa || req.body?.owner || ''),
        executionMode: normalizeText(req.body?.executionMode || ''),
        reason,
        stack: error?.stack || ''
      });
      return res.status(status).json({
        ok: false,
        schemaVersion: 'v1',
        error: error?.code || 'session_authorize_failed',
        reason,
        traceId: req.traceId || '',
        ...(error?.data && typeof error.data === 'object' ? error.data : {})
      });
    }
  });

  app.get(
    '/api/account/api-key',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    (req, res) => {
      const ownerEoa = resolveAccountOwner(req);
      if (!ownerEoa) {
        return sendRouteFailure(req, res, {
          statusCode: 400,
          code: 'account_owner_required',
          reason: 'A valid ownerEoa is required.'
        });
      }
      const record = findActiveAccountApiKey?.(ownerEoa) || null;
      if (!record) {
        return res.status(404).json({
          ok: false,
          error: 'account_api_key_not_found',
          reason: 'No active account API key was found.',
          traceId: req.traceId || ''
        });
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ownerEoa,
        apiKey: buildAccountApiKeyPublicRecord?.(record) || null
      });
    }
  );

  app.post(
    '/api/account/api-key/generate',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    (req, res) => {
      const body = req.body || {};
      const ownerEoa = resolveAccountOwner(req, body);
      if (!ownerEoa) {
        return sendRouteFailure(req, res, {
          statusCode: 400,
          code: 'account_owner_required',
          reason: 'A valid ownerEoa is required.'
        });
      }
      const result = generateAccountApiKey?.({
        ownerEoa,
        label: body.label || '',
        role: 'agent',
        createdBy: normalizeText(req.authSource || req.authRole || '')
      });
      if (!result?.ok) {
        return sendRouteFailure(req, res, result);
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ownerEoa,
        apiKey: {
          ...result.publicRecord,
          key: result.key
        }
      });
    }
  );

  app.post(
    '/api/account/api-key/revoke',
    requireRole('agent', SELF_SERVE_MUTATION_AUTH),
    (req, res) => {
      const body = req.body || {};
      const ownerEoa = resolveAccountOwner(req, body);
      if (!ownerEoa) {
        return sendRouteFailure(req, res, {
          statusCode: 400,
          code: 'account_owner_required',
          reason: 'A valid ownerEoa is required.'
        });
      }
      const result = revokeAccountApiKey?.({
        ownerEoa,
        keyId: body.keyId || '',
        reason: body.reason || body.revocationReason || ''
      });
      if (!result?.ok) {
        return sendRouteFailure(req, res, result);
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ownerEoa,
        apiKey: result.publicRecord || null
      });
    }
  );

  function handleConnectorStatus(req, res, { client = 'agent', clientId = '' } = {}) {
    const ownerEoa = resolveAccountOwner(req);
    return res.json(
      buildAgentConnectorStatus(ownerEoa, req, {
        client,
        clientId,
        agentId: req.query.agentId || '',
        identityRegistry: req.query.identityRegistry || req.query.registry || ''
      })
    );
  }

  function handleConnectorBootstrap(req, res, { client = 'agent' } = {}) {
    const body = req.body || {};
    const ownerEoa = resolveAccountOwner(req, body);
    const normalizedClient = normalizeConnectorClient(body.client || client);
    const normalizedClientId = normalizeConnectorClientId(body.clientId || body.deviceId || '');
    const setup = evaluateAgentConnectorSetup(ownerEoa);
    const identity = resolveConnectorIdentity(body, setup);
    const allowedBuiltinTools = normalizeConnectorBuiltinToolList(body.allowedBuiltinTools || []);
    if (!normalizeOwnerInput(ownerEoa)) {
      return sendRouteFailure(req, res, {
        statusCode: 400,
        code: 'connector_setup_incomplete',
        reason: 'A valid ownerEoa is required to issue an agent connector credential.'
      });
    }
    if (!normalizeText(setup?.runtime?.owner || '')) {
      return res.status(409).json({
        ok: false,
        error: 'connector_runtime_not_ready',
        reason: 'Agent connector setup requires a ready owner-scoped runtime.',
        traceId: req.traceId || '',
        missing: setup.missing
      });
    }
    const runtimeSource = normalizeText(setup?.runtime?.source || '').toLowerCase();
    const authorizationMode = normalizeText(setup?.runtime?.authorizationMode || '').toLowerCase();
    const supportsManagedConnectorCompat =
      authorizationMode === 'owner_runtime_sync' ||
      runtimeSource === 'api-session-runtime-ensure' ||
      runtimeSource.startsWith('backend-managed');
    if (
      !normalizeText(setup?.runtime?.aaWallet || '') ||
      !normalizeText(setup?.runtime?.sessionAddress || '') ||
      !normalizeText(setup?.runtime?.sessionId || '') ||
      (!supportsManagedConnectorCompat && !normalizeText(setup?.runtime?.authorizationSignature || '')) ||
      (!supportsManagedConnectorCompat && !normalizeText(setup?.runtime?.authorizationPayloadHash || ''))
    ) {
      return res.status(409).json({
        ok: false,
        error: 'connector_runtime_not_ready',
        reason: 'Agent connector setup requires a ready AA session runtime.',
        traceId: req.traceId || '',
        missing: setup.missing
      });
    }
    if (!identity.agentId) {
      return res.status(409).json({
        ok: false,
        error: 'connector_identity_required',
        reason: 'Agent connector setup requires an agentId.',
        traceId: req.traceId || ''
      });
    }
    if (!identity.identityRegistry) {
      return res.status(409).json({
        ok: false,
        error: 'connector_identity_registry_required',
        reason: 'Agent connector setup requires an identityRegistry.',
        traceId: req.traceId || ''
      });
    }
    if (!setup.authority || setup.missing.some((item) => item.startsWith('authority_'))) {
      return res.status(409).json({
        ok: false,
        error: 'connector_authority_inactive',
        reason: 'Agent connector setup requires an active consumer authority policy.',
        traceId: req.traceId || '',
        missing: setup.missing
      });
    }

    const activeGrant =
      findActiveClaudeConnectorGrant?.(ownerEoa, {
        client: normalizedClient,
        clientId: normalizedClientId,
        agentId: identity.agentId,
        identityRegistry: identity.identityRegistry
      }) || null;
    if (activeGrant) {
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ownerEoa,
        connector: {
          client: normalizedClient,
          clientId: normalizedClientId,
          state: 'connected',
          alreadyConnected: true,
          activeGrant:
            buildClaudeConnectorGrantPublicRecord?.(activeGrant) || activeGrant || null
        }
      });
    }

    const issued = issueClaudeConnectorInstallCode?.({
      ownerEoa,
      aaWallet: setup.runtime?.aaWallet || '',
      authorityId: setup.authority?.authorityId || '',
      policySnapshotHash: buildAuthorityPolicySnapshotHash(setup.authority),
      client: normalizedClient,
      clientId: normalizedClientId,
      agentId: identity.agentId,
      identityRegistry: identity.identityRegistry,
      allowedBuiltinTools
    });
    if (!issued?.ok) {
      return sendRouteFailure(req, res, issued);
    }

    const connectorUrl = `${buildPublicBaseUrl(req)}/mcp/connect/${encodeURIComponent(issued.token)}`;
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      ownerEoa,
      connector: {
        client: normalizedClient,
        clientId: normalizedClientId,
        agentId: identity.agentId,
        identityRegistry: identity.identityRegistry,
        state: 'install_code_issued',
        installCodeId: issued.publicRecord?.installCodeId || '',
        maskedPreview: issued.publicRecord?.maskedPreview || '',
        expiresAt: issued.publicRecord?.expiresAt || 0,
        allowedBuiltinTools: issued.publicRecord?.allowedBuiltinTools || [],
        connectorUrl
      }
    });
  }

  function handleConnectorRevoke(req, res, { client = 'agent' } = {}) {
    const body = req.body || {};
    const ownerEoa = resolveAccountOwner(req, body);
    const normalizedClient = normalizeConnectorClient(body.client || client);
    const normalizedClientId = normalizeConnectorClientId(body.clientId || body.deviceId || '');
    const identity = resolveConnectorIdentity(body);
    const result = revokeClaudeConnectorGrant?.({
      ownerEoa,
      reason: body.reason || body.revocationReason || 'revoked',
      client: normalizedClient,
      clientId: normalizedClientId,
      agentId: identity.agentId,
      identityRegistry: identity.identityRegistry
    });
    if (!result?.ok) {
      return sendRouteFailure(req, res, result);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      ownerEoa,
      connector: {
        client: normalizedClient,
        clientId: normalizedClientId,
        revoked: true,
        grant: result.grant || null,
        pendingInstallCode: result.pendingInstallCode || null
      }
    });
  }

  app.get(
    '/api/connector/agent/status',
    requireRole('agent', CONNECTOR_COMPAT_AUTH),
    (req, res) => handleConnectorStatus(req, res, {
      client: req.query.client || 'agent',
      clientId: req.query.clientId || req.query.deviceId || ''
    })
  );

  app.post(
    '/api/connector/agent/bootstrap',
    requireRole('agent', CONNECTOR_COMPAT_AUTH),
    (req, res) => handleConnectorBootstrap(req, res, {
      client: req.body?.client || 'agent'
    })
  );

  app.post(
    '/api/connector/agent/revoke',
    requireRole('agent', CONNECTOR_COMPAT_AUTH),
    (req, res) => handleConnectorRevoke(req, res, {
      client: req.body?.client || 'agent'
    })
  );

  app.get(
    '/api/connector/claude/status',
    requireRole('agent', CONNECTOR_COMPAT_AUTH),
    (req, res) => handleConnectorStatus(req, res, { client: 'claude' })
  );

  app.post(
    '/api/connector/claude/install-code',
    requireRole('agent', CONNECTOR_COMPAT_AUTH),
    (req, res) => handleConnectorBootstrap(req, res, { client: 'claude' })
  );

  app.post(
    '/api/connector/claude/revoke',
    requireRole('agent', CONNECTOR_COMPAT_AUTH),
    (req, res) => handleConnectorRevoke(req, res, { client: 'claude' })
  );

  app.post('/api/v1/session/approval-requests', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const executionModeRaw = String(body.executionMode || '').trim().toLowerCase();
      const executionMode =
        executionModeRaw === 'external' ||
        executionModeRaw === 'self-custodial' ||
        executionModeRaw === 'self_custodial'
          ? 'external'
          : 'managed';
      if (executionMode !== 'external') {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_external_only',
          reason: 'Agent-first approval requests currently require executionMode=external.',
          traceId: req.traceId || ''
        });
      }

      const rawPayload =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? body.payload
          : {};
      const payload = normalizeSessionGrantPayload(rawPayload, {
        audience: normalizeSessionGrantText(
          rawPayload.audience,
          buildPublicBaseUrl(req)
        ),
        nonce: rawPayload.nonce || `0x${crypto.randomBytes(16).toString('hex')}`,
        issuedAt: rawPayload.issuedAt || Date.now(),
        expiresAt: rawPayload.expiresAt || Date.now() + 24 * 60 * 60 * 1000
      });
      const userEoa = normalizeSessionGrantAddress(body.userEoa || '');
      const sessionAddress = normalizeSessionGrantAddress(body.sessionAddress || '');
      if (!userEoa || !sessionAddress) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_invalid',
          reason: 'userEoa and sessionAddress are required to create an approval request.',
          traceId: req.traceId || ''
        });
      }
      if (!payload.agentId || !payload.agentWallet || !payload.identityRegistry) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_identity_missing',
          reason: 'Approval request payload is missing ERC-8004 identity fields.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (!payload.singleLimit || !payload.dailyLimit) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_limits_invalid',
          reason: 'Approval request payload must include positive singleLimit and dailyLimit values.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_expired',
          reason: 'Approval request payload is already expired.',
          traceId: req.traceId || '',
          payload
        });
      }

      const duplicate = listSessionApprovalRequests().find(
        (item) =>
          String(item.status || '').trim().toLowerCase() === 'pending' &&
          normalizeSessionGrantAddress(item.userEoa || '') === userEoa &&
          normalizeSessionGrantAddress(item.sessionAddress || '') === sessionAddress &&
          String(item?.payload?.nonce || '').trim() === payload.nonce
      );
      if (duplicate) {
        const existing = buildSessionApprovalRequestPayload(duplicate, { includeToken: true });
        return res.status(409).json({
          ok: false,
          error: 'approval_request_duplicate',
          reason: 'A pending approval request already exists for this user/session/nonce.',
          traceId: req.traceId || '',
          approvalRequest: existing
        });
      }

      const approvalRequestId = createTraceId('apr');
      const approvalToken = buildApprovalRequestToken();
      const createdAt = Date.now();
      const record = appendSessionApprovalRequest({
        approvalRequestId,
        approvalToken,
        executionMode: 'external',
        userEoa,
        sessionAddress,
        payload,
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
        traceId: req.traceId || ''
      });

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        approvalRequest: buildSessionApprovalRequestPayload(record, { includeToken: true })
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_create_failed',
        reason: error?.message || 'approval_request_create_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.post('/api/aa/ensure', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {};
      const runtime = readSessionRuntime();
      const owner = String(body.owner || runtime.owner || '').trim();
      const saltRaw = String(body.salt ?? process.env.KITECLAW_AA_SALT ?? '0').trim();
      let salt = 0n;
      try {
        salt = BigInt(saltRaw || '0');
      } catch {
        return res.status(400).json({
          ok: false,
          error: 'invalid_salt',
          reason: `Invalid salt: ${saltRaw}`,
          traceId: req.traceId || ''
        });
      }

      const ensured = await ensureAAAccountDeployment({ owner, salt });
      const merged = writeSessionRuntime({
        ...runtime,
        aaWallet: ensured.accountAddress,
        owner: ensured.owner,
        accountFactoryAddress: runtime.accountFactoryAddress || deps.KITE_AA_FACTORY_ADDRESS || '',
        accountImplementationAddress:
          runtime.accountImplementationAddress || deps.KITE_AA_ACCOUNT_IMPLEMENTATION || '',
        source: 'aa-ensure',
        updatedAt: Date.now()
      });

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        aaWallet: ensured.accountAddress,
        owner: ensured.owner,
        salt: ensured.salt,
        deployed: ensured.deployed,
        createdNow: ensured.createdNow,
        txHash: ensured.txHash,
        runtime: buildSessionRuntimePayload(merged)
      });
    } catch (error) {
      const isSignerErr =
        /backend signer unavailable|KITECLAW_BACKEND_SIGNER_PRIVATE_KEY/i.test(String(error?.message || ''));
      return res.status(isSignerErr ? 503 : 400).json({
        ok: false,
        error: isSignerErr ? 'backend_signer_unavailable' : 'aa_ensure_failed',
        reason: error?.message || 'aa_ensure_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.delete('/api/session/runtime', requireRole('admin'), (req, res) => {
    writeJsonObject(sessionRuntimePath, {});
    return res.json({ ok: true, cleared: true });
  });
}
