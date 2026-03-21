export function registerCoreIdentityIdentityRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    IDENTITY_CHALLENGE_TTL_MS,
    IDENTITY_VERIFY_MODE,
    buildDemoPriceSeries,
    buildLatestWorkflowByRequestId,
    computeDashboardKpi,
    createTraceId,
    crypto,
    ethers,
    mapX402Item,
    normalizeAddress,
    readIdentityChallenges,
    readRecords,
    readWorkflows,
    readX402Requests,
    resolveSessionRuntime,
    requireRole,
    writeIdentityChallenges
  } = deps;
  const {
    buildIdentitySummary,
    createIdentityChallengeMessage,
    getLatestIdentityChallengeSnapshot,
    isIdentitySignatureRequired,
    normalizeIdentityChallengeRows,
    readIdentityProfile
  } = helpers;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function getScopedOwnerFromAuth(req) {
    return normalizeAddress(req?.authOwnerEoa || req?.accountCtx?.ownerEoa || '');
  }

  function buildUnavailableCurrentIdentityProfile({
    ownerAddress = '',
    registry = '',
    agentId = '',
    agentWallet = '',
    reason = 'identity_not_registered'
  } = {}) {
    return {
      available: false,
      reason,
      configured: {
        registry: normalizeAddress(registry || ''),
        agentId: normalizeText(agentId || '')
      },
      registry: normalizeAddress(registry || ''),
      agentId: normalizeText(agentId || ''),
      ownerAddress: normalizeAddress(ownerAddress || ''),
      agentWallet: normalizeAddress(agentWallet || ''),
      tokenURI: ''
    };
  }

  async function readCurrentIdentityProfileForRequest(req) {
    const scopedOwner = getScopedOwnerFromAuth(req);
    if (!scopedOwner || typeof resolveSessionRuntime !== 'function') {
      return readIdentityProfile({});
    }

    const scopedRuntime = resolveSessionRuntime({
      owner: scopedOwner,
      strictOwnerMatch: true
    });
    const scopedAgentId = normalizeText(scopedRuntime?.agentId || scopedRuntime?.authorizedAgentId || '');
    const scopedRegistry = normalizeAddress(
      scopedRuntime?.identityRegistry ||
      scopedRuntime?.authorizationPayload?.identityRegistry ||
      ''
    );
    const scopedAgentWallet = normalizeAddress(
      scopedRuntime?.agentWallet ||
      scopedRuntime?.authorizedAgentWallet ||
      scopedRuntime?.aaWallet ||
      ''
    );

    if (scopedAgentId && scopedRegistry) {
      return readIdentityProfile({
        registry: scopedRegistry,
        agentId: scopedAgentId
      });
    }

    return buildUnavailableCurrentIdentityProfile({
      ownerAddress: scopedOwner,
      registry: scopedRegistry,
      agentId: scopedAgentId,
      agentWallet: scopedAgentWallet,
      reason: 'identity_not_registered_for_owner'
    });
  }

  app.get(
    '/api/identity',
    requireRole('viewer', {
      allowEnvApiKey: true,
      allowAccountApiKey: false,
      allowOnboardingCookie: true
    }),
    async (req, res) => {
    try {
      const profile = await readIdentityProfile({
        registry: req.query.identityRegistry,
        agentId: req.query.agentId
      });
      res.json({ ok: true, profile });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'identity_read_failed',
        reason: error.message
      });
    }
  });

  app.get(
    '/api/identity/current',
    requireRole('viewer', {
      allowEnvApiKey: true,
      allowAccountApiKey: false,
      allowOnboardingCookie: true
    }),
    async (req, res) => {
    try {
      const profile = await readCurrentIdentityProfileForRequest(req);
      return res.json({ ok: true, profile });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'identity_read_failed',
        reason: error.message
      });
    }
  });

  app.post('/api/identity/challenge', requireRole('viewer'), async (req, res) => {
    try {
      const body = req.body || {};
      const profile = await readIdentityProfile({
        registry: body.identityRegistry || body.registry,
        agentId: body.agentId
      });
      if (!profile?.available) {
        return res.status(400).json({
          ok: false,
          error: 'identity_unavailable',
          reason: profile?.reason || 'identity_unavailable',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }

      const agentWallet = normalizeAddress(profile.agentWallet || '');
      if (!ethers.isAddress(agentWallet)) {
        return res.status(400).json({
          ok: false,
          error: 'identity_wallet_invalid',
          reason: 'Configured identity wallet is invalid.',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }

      if (!isIdentitySignatureRequired()) {
        return res.json({
          ok: true,
          traceId: req.traceId || '',
          challenge: {
            mode: 'registry',
            signatureRequired: false
          },
          profile: buildIdentitySummary(profile)
        });
      }

      const now = Date.now();
      const challengeId = createTraceId('idv');
      const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
      const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
        ? IDENTITY_CHALLENGE_TTL_MS
        : 120_000;
      const expiresAt = now + ttl;
      const message = createIdentityChallengeMessage({
        challengeId,
        traceId: req.traceId || '',
        nonce,
        issuedAt: now,
        expiresAt,
        profile
      });

      const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
      rows.unshift({
        challengeId,
        traceId: req.traceId || '',
        nonce,
        message,
        issuedAt: now,
        expiresAt,
        identity: {
          registry: String(profile?.configured?.registry || ''),
          agentId: String(profile?.configured?.agentId || ''),
          agentWallet
        },
        status: 'issued'
      });
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        challenge: {
          challengeId,
          message,
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          ttlMs: ttl
        },
        profile: buildIdentitySummary(profile)
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'identity_challenge_failed',
        reason: error?.message || 'challenge failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.post('/api/identity/verify', requireRole('viewer'), async (req, res) => {
    try {
      const body = req.body || {};
      const challengeId = String(body.challengeId || '').trim();
      const signature = String(body.signature || '').trim();
      if (!challengeId) {
        return res.status(400).json({
          ok: false,
          error: 'challenge_required',
          reason: 'challengeId is required.',
          traceId: req.traceId || ''
        });
      }
      if (!signature) {
        return res.status(400).json({
          ok: false,
          error: 'signature_required',
          reason: 'signature is required.',
          traceId: req.traceId || ''
        });
      }

      const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
      const idx = rows.findIndex((item) => String(item?.challengeId || '') === challengeId);
      if (idx < 0) {
        return res.status(404).json({
          ok: false,
          error: 'challenge_not_found',
          reason: 'challenge not found',
          traceId: req.traceId || ''
        });
      }

      const entry = rows[idx];
      const now = Date.now();
      if (Number(entry.usedAt || 0) > 0) {
        return res.status(409).json({
          ok: false,
          error: 'challenge_used',
          reason: 'challenge already used',
          traceId: req.traceId || ''
        });
      }
      if (now > Number(entry.expiresAt || 0)) {
        entry.status = 'expired';
        rows[idx] = entry;
        writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
        return res.status(410).json({
          ok: false,
          error: 'challenge_expired',
          reason: 'challenge expired',
          traceId: req.traceId || ''
        });
      }

      const profile = await readIdentityProfile({
        registry: entry?.identity?.registry || '',
        agentId: entry?.identity?.agentId || ''
      });
      if (!profile?.available) {
        return res.status(400).json({
          ok: false,
          error: 'identity_unavailable',
          reason: profile?.reason || 'identity_unavailable',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }

      const expectedWallet = normalizeAddress(profile.agentWallet || '');
      if (!ethers.isAddress(expectedWallet)) {
        return res.status(400).json({
          ok: false,
          error: 'identity_wallet_invalid',
          reason: 'Configured identity wallet is invalid.',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }

      let recoveredAddress = '';
      try {
        recoveredAddress = normalizeAddress(ethers.verifyMessage(String(entry.message || ''), signature));
      } catch (error) {
        return res.status(401).json({
          ok: false,
          error: 'invalid_signature',
          reason: error?.message || 'invalid signature',
          traceId: req.traceId || ''
        });
      }

      if (recoveredAddress !== expectedWallet) {
        return res.status(401).json({
          ok: false,
          error: 'invalid_signature',
          reason: 'signature does not match configured agent wallet',
          expected: expectedWallet,
          recovered: recoveredAddress,
          traceId: req.traceId || ''
        });
      }

      entry.status = 'verified';
      entry.usedAt = now;
      entry.verifiedAt = now;
      entry.recoveredAddress = recoveredAddress;
      rows[idx] = entry;
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));

      return res.json({
        ok: true,
        verified: true,
        traceId: req.traceId || '',
        challengeId,
        verifiedAt: new Date(now).toISOString(),
        profile: buildIdentitySummary(profile)
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'identity_verify_failed',
        reason: error?.message || 'identity verify failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.get('/api/demo/identity/latest', requireRole('viewer'), (req, res) => {
    const latest = getLatestIdentityChallengeSnapshot();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      verifyMode: IDENTITY_VERIFY_MODE,
      latest
    });
  });

  app.get('/api/x402/mapping/latest', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
    const workflows = readWorkflows();
    const workflowByRequestId = buildLatestWorkflowByRequestId(workflows);
    const rows = readX402Requests()
      .map((item) => mapX402Item(item, workflowByRequestId.get(String(item?.requestId || '').trim()) || null))
      .slice(0, limit);
    const kpi = computeDashboardKpi(readX402Requests());
    return res.json({ ok: true, total: rows.length, kpi, items: rows });
  });

  app.get('/api/demo/price-series', requireRole('viewer'), (req, res) => {
    const { limit, series } = buildDemoPriceSeries(req.query.limit);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      window: {
        limit,
        intervalSec: 60
      },
      series
    });
  });

  app.get('/api/onchain/latest', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
    const paidRows = readX402Requests()
      .filter((item) => String(item.status || '').toLowerCase() === 'paid' && (item.paymentTxHash || item?.paymentProof?.txHash))
      .map((item) => ({
        source: 'x402',
        requestId: item.requestId || '',
        txHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
        payer: item.payer || '',
        from: item.payer || '',
        to: item.recipient || '',
        amount: item.amount || '',
        tokenAddress: item.tokenAddress || '',
        block: item?.proofVerification?.details?.blockNumber || '',
        time: Number(item.paidAt || item.createdAt || 0) > 0
          ? new Date(Number(item.paidAt || item.createdAt)).toISOString()
          : ''
      }));

    const recordRows = readRecords()
      .filter((row) => row && row.txHash)
      .map((row) => ({
        source: row.type || 'record',
        requestId: row.requestId || '',
        txHash: row.txHash || '',
        payer: row.aaWallet || '',
        from: row.aaWallet || '',
        to: row.recipient || '',
        amount: row.amount || '',
        tokenAddress: row.token || '',
        block: row.block || '',
        time: row.time || ''
      }));

    const merged = [...paidRows, ...recordRows];
    const dedup = [];
    const seen = new Set();
    for (const row of merged) {
      const key = String(row.txHash || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedup.push(row);
    }
    dedup.sort((a, b) => {
      const ta = Date.parse(a.time || 0) || 0;
      const tb = Date.parse(b.time || 0) || 0;
      return tb - ta;
    });

    return res.json({ ok: true, total: dedup.length, items: dedup.slice(0, limit) });
  });
}
