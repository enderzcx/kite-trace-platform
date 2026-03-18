export function registerCoreIdentitySessionRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    PORT,
    createTraceId,
    crypto,
    ensureAAAccountDeployment,
    maskSecret,
    readRecords,
    readSessionRuntime,
    requireRole,
    sessionPayConfigSnapshot,
    sessionPayMetrics,
    sessionRuntimePath,
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
    finalizeSessionAuthorization,
    getBackendSignerState,
    listSessionApprovalRequests,
    normalizeSessionGrantAddress,
    normalizeSessionGrantPayload,
    normalizeSessionGrantText
  } = helpers;

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

  app.get('/api/session/runtime', requireRole('viewer'), (req, res) => {
    const runtime = deps.resolveSessionRuntime({
      owner: req.query.owner,
      aaWallet: req.query.aaWallet,
      sessionId: req.query.sessionId
    });
    return res.json({
      ok: true,
      runtime: buildSessionRuntimePayload(runtime)
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
      expiresAt: body.expiresAt,
      maxPerTx: body.maxPerTx,
      dailyLimit: body.dailyLimit,
      gatewayRecipient: body.gatewayRecipient,
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

  app.post('/api/session/runtime/ensure', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const ensured = await ensureBackendSessionRuntime({
        owner: body.owner,
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

  app.post('/api/v1/session/authorize', requireRole('agent'), async (req, res) => {
    try {
      const finalized = await finalizeSessionAuthorization({
        body: req.body || {},
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
          `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`
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
