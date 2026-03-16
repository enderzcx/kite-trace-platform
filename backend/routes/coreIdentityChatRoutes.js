export function registerCoreIdentityChatRoutes(app, deps) {
  const {
    BACKEND_RPC_URL,
    MERCHANT_ADDRESS,
    POLICY_DAILY_LIMIT_DEFAULT,
    POLICY_MAX_PER_TX_DEFAULT,
    ROUTER_WALLET_KEY_NORMALIZED,
    SETTLEMENT_TOKEN,
    backendSigner,
    createTraceId,
    crypto,
    ensureAAAccountDeployment,
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    ethers,
    getInternalAgentApiKey,
    IDENTITY_CHALLENGE_MAX_ROWS,
    IDENTITY_CHALLENGE_TTL_MS,
    IDENTITY_VERIFY_MODE,
    KITE_AGENT1_ID,
    KITE_AGENT2_ID,
    maskSecret,
    normalizeAddress,
    normalizeReactiveParams,
    llmAdapter,
    PORT,
    readSessionAuthorizations,
    XMTP_ROUTER_DERIVED_ADDRESS,
    readIdentityChallenges,
    readRecords,
    readSessionRuntime,
    readWorkflows,
    readX402Requests,
    requireRole,
    sessionPayConfigSnapshot,
    sessionPayMetrics,
    sessionRuntimePath,
    writeIdentityChallenges,
    writeJsonObject,
    writeRecords,
    writeSessionAuthorizations,
    writeSessionRuntime,
  } = deps;

  function getBackendSignerState() {
    return {
      enabled: Boolean(backendSigner),
      address: backendSigner?.address || '',
      custody: 'backend_env'
    };
  }

  const AA_SESSION_ABI = [
    'function addSupportedToken(address token) external',
    'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
    'function sessionExists(bytes32 sessionId) view returns (bool)',
    'function getSessionAgent(bytes32 sessionId) view returns (address)'
  ];

  function normalizeSessionGrantText(value = '', fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function normalizeSessionGrantAddress(value = '') {
    const text = normalizeSessionGrantText(value);
    if (!text || !ethers.isAddress(text)) return '';
    return ethers.getAddress(text);
  }

  function normalizeSessionGrantAmount(value, fallback = '') {
    const text = normalizeSessionGrantText(value, fallback);
    const numeric = Number(text);
    if (!text || !Number.isFinite(numeric) || numeric <= 0) return '';
    return text;
  }

  function normalizeSessionGrantTimestamp(value, fallback = 0) {
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

  function normalizeAllowedCapabilities(input = []) {
    const values = Array.isArray(input)
      ? input
      : normalizeSessionGrantText(input)
          .split(',')
          .map((item) => String(item || '').trim())
          .filter(Boolean);
    return Array.from(
      new Set(values.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
    ).sort();
  }

  function normalizeSessionGrantPayload(input = {}, fallback = {}) {
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

  function buildSessionGrantMessage(payloadInput = {}) {
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

  function createSessionAuthorizationMessage({ payload = {}, userEoa = '' } = {}) {
    return [
      buildSessionGrantMessage(payload),
      `userEoa: ${normalizeSessionGrantAddress(userEoa || '')}`
    ].join('\n');
  }

  function hashSessionGrantPayload(payloadInput = {}) {
    const payload = normalizeSessionGrantPayload(payloadInput);
    return ethers.keccak256(ethers.toUtf8Bytes(buildSessionGrantMessage(payload)));
  }

  function buildSessionRuntimePayload(runtime = {}) {
    return {
      ...runtime,
      sessionPrivateKey: undefined,
      sessionPrivateKeyMasked: maskSecret(runtime.sessionPrivateKey),
      hasSessionPrivateKey: Boolean(runtime.sessionPrivateKey),
      authorizationSignature: undefined,
      authorizationSignatureMasked: maskSecret(runtime.authorizationSignature),
      hasAuthorizationSignature: Boolean(runtime.authorizationSignature)
    };
  }

  function normalizeSessionAuthorizationRows(rows = []) {
    const items = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
    return items
      .filter((item) => String(item.authorizationId || '').trim())
      .sort((left, right) => Number(right.authorizedAt || 0) - Number(left.authorizedAt || 0))
      .slice(0, 1000);
  }

  function appendSessionAuthorizationRecord(record = {}) {
    const rows = normalizeSessionAuthorizationRows(readSessionAuthorizations());
    rows.unshift(record);
    const nextRows = normalizeSessionAuthorizationRows(rows);
    writeSessionAuthorizations(nextRows);
    return nextRows[0] || null;
  }

  function normalizePositiveAmount(rawValue, fallbackValue, label = 'amount') {
    const candidate = String(rawValue ?? fallbackValue ?? '').trim();
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`${label} must be a positive number.`);
    }
    return {
      text: candidate,
      numeric
    };
  }

  async function isSessionRuntimeReadyOnchain(runtime = {}, contract = null) {
    if (!contract) return false;
    if (!ethers.isAddress(runtime?.aaWallet || '')) return false;
    if (!ethers.isAddress(runtime?.sessionAddress || '')) return false;
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(runtime?.sessionId || ''))) return false;
    const [exists, onchainAgent] = await Promise.all([
      contract.sessionExists(runtime.sessionId),
      contract.getSessionAgent(runtime.sessionId)
    ]);
    return Boolean(exists) && normalizeAddress(onchainAgent || '') === normalizeAddress(runtime.sessionAddress || '');
  }

  async function ensureBackendSessionRuntime({
    owner = '',
    singleLimit = '',
    dailyLimit = '',
    tokenAddress = '',
    gatewayRecipient = '',
    forceNewSession = false
  } = {}) {
    const routerOwnerKey = String(ROUTER_WALLET_KEY_NORMALIZED || '').trim();
    if (!routerOwnerKey) {
      throw new Error('Router owner key unavailable. Set XMTP_ROUTER_WALLET_KEY in backend environment.');
    }

    const provider = backendSigner?.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const ownerWallet = new ethers.Wallet(routerOwnerKey, provider);
    const signerOwner = normalizeAddress(ownerWallet.address || XMTP_ROUTER_DERIVED_ADDRESS || '');
    const currentRuntime = readSessionRuntime();
    const requestedOwner = normalizeAddress(owner || currentRuntime.owner || signerOwner || '');
    if (!ethers.isAddress(requestedOwner)) {
      throw new Error('A valid owner address is required for session creation.');
    }
    if (requestedOwner !== signerOwner) {
      throw new Error(`Owner mismatch. requested=${requestedOwner} signer=${signerOwner}`);
    }

    const saltRaw = String(process.env.KITECLAW_AA_SALT ?? '0').trim();
    let salt = 0n;
    try {
      salt = BigInt(saltRaw || '0');
    } catch {
      throw new Error(`Invalid salt: ${saltRaw}`);
    }

    const ensured = await ensureAAAccountDeployment({ owner: requestedOwner, salt });
    const account = new ethers.Contract(ensured.accountAddress, AA_SESSION_ABI, ownerWallet);

    if (!forceNewSession) {
      const canReuse =
        normalizeAddress(currentRuntime.owner || '') === requestedOwner &&
        normalizeAddress(currentRuntime.aaWallet || '') === normalizeAddress(ensured.accountAddress || '') &&
        currentRuntime.sessionPrivateKey &&
        currentRuntime.sessionAddress &&
        currentRuntime.sessionId;
      if (canReuse && (await isSessionRuntimeReadyOnchain(currentRuntime, account))) {
        return {
          created: false,
          reused: true,
          tokenAddress: normalizeAddress(tokenAddress || SETTLEMENT_TOKEN || ''),
          runtime: currentRuntime
        };
      }
    }

    const normalizedTokenAddress = normalizeAddress(tokenAddress || SETTLEMENT_TOKEN || '');
    if (!ethers.isAddress(normalizedTokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress || SETTLEMENT_TOKEN || ''}`);
    }

    const normalizedGatewayRecipient = normalizeAddress(
      gatewayRecipient || currentRuntime.gatewayRecipient || MERCHANT_ADDRESS || ''
    );
    if (!ethers.isAddress(normalizedGatewayRecipient)) {
      throw new Error(
        `Invalid gateway recipient: ${gatewayRecipient || currentRuntime.gatewayRecipient || MERCHANT_ADDRESS || ''}`
      );
    }

    const maxPerTx = normalizePositiveAmount(
      singleLimit,
      currentRuntime.maxPerTx || POLICY_MAX_PER_TX_DEFAULT,
      'singleLimit'
    );
    const dailyBudget = normalizePositiveAmount(
      dailyLimit,
      currentRuntime.dailyLimit || POLICY_DAILY_LIMIT_DEFAULT,
      'dailyLimit'
    );

    try {
      const tokenTx = await account.addSupportedToken(normalizedTokenAddress);
      await tokenTx.wait();
    } catch {
      // addSupportedToken may already be configured on-chain.
    }

    const latestBlock = await provider.getBlock('latest');
    const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
    const rules = [
      {
        timeWindow: 0n,
        budget: ethers.parseUnits(maxPerTx.text, 18),
        initialWindowStartTime: 0,
        targetProviders: []
      },
      {
        timeWindow: 86400n,
        budget: ethers.parseUnits(dailyBudget.text, 18),
        initialWindowStartTime: Math.max(0, nowTs - 1),
        targetProviders: []
      }
    ];

    const sessionWallet = ethers.Wallet.createRandom();
    const sessionId = ethers.keccak256(ethers.toUtf8Bytes(`${sessionWallet.address}-${Date.now()}`));
    const tx = await account.createSession(sessionId, sessionWallet.address, rules);
    await tx.wait();

    const sessionReady = await isSessionRuntimeReadyOnchain(
      {
        aaWallet: ensured.accountAddress,
        sessionAddress: sessionWallet.address,
        sessionId
      },
      account
    );
    if (!sessionReady) {
      throw new Error(`Session not found on-chain after tx: ${sessionId}`);
    }

    const nextRuntime = writeSessionRuntime({
      ...currentRuntime,
      aaWallet: ensured.accountAddress,
      owner: requestedOwner,
      sessionAddress: sessionWallet.address,
      sessionPrivateKey: sessionWallet.privateKey,
      sessionId,
      sessionTxHash: tx.hash,
      expiresAt: 0,
      maxPerTx: maxPerTx.numeric,
      dailyLimit: dailyBudget.numeric,
      gatewayRecipient: normalizedGatewayRecipient,
      source: 'api-session-runtime-ensure',
      updatedAt: Date.now()
    });

    return {
      created: true,
      reused: false,
      tokenAddress: normalizedTokenAddress,
      runtime: nextRuntime
    };
  }
  
  const ERC8004_IDENTITY_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function getAgentWallet(uint256 agentId) view returns (address)'
  ];
  
  function parseAgentId(raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  
  function isIdentitySignatureRequired() {
    return !['registry', 'registry_only', 'service', 'service_registry'].includes(
      IDENTITY_VERIFY_MODE
    );
  }
  
  function buildIdentitySummary(profile = {}) {
    return {
      available: Boolean(profile?.available),
      chainId: String(profile?.chainId || ''),
      configured: profile?.configured || null,
      agentId: String(profile?.configured?.agentId || ''),
      registry: String(profile?.configured?.registry || ''),
      ownerAddress: String(profile?.ownerAddress || ''),
      agentWallet: String(profile?.agentWallet || ''),
      tokenURI: String(profile?.tokenURI || '')
    };
  }
  
  function createIdentityChallengeMessage({
    challengeId = '',
    traceId = '',
    nonce = '',
    issuedAt = 0,
    expiresAt = 0,
    profile = {}
  } = {}) {
    return [
      'KITECLAW Identity Verification',
      `challengeId: ${challengeId}`,
      `traceId: ${traceId}`,
      `registry: ${String(profile?.configured?.registry || '')}`,
      `agentId: ${String(profile?.configured?.agentId || '')}`,
      `agentWallet: ${String(profile?.agentWallet || '')}`,
      `nonce: ${nonce}`,
      `issuedAt: ${new Date(issuedAt).toISOString()}`,
      `expiresAt: ${new Date(expiresAt).toISOString()}`
    ].join('\n');
  }
  
  function normalizeIdentityChallengeRows(rows = []) {
    const now = Date.now();
    const validRows = Array.isArray(rows)
      ? rows.filter((item) => item && typeof item === 'object')
      : [];
    const freshRows = validRows.filter((item) => {
      const expiresAt = Number(item.expiresAt || 0);
      if (item.usedAt) return now - Number(item.usedAt || 0) <= 24 * 60 * 60 * 1000;
      return expiresAt > 0 && now - expiresAt <= 24 * 60 * 60 * 1000;
    });
    const limit = Number.isFinite(IDENTITY_CHALLENGE_MAX_ROWS) && IDENTITY_CHALLENGE_MAX_ROWS > 0
      ? IDENTITY_CHALLENGE_MAX_ROWS
      : 500;
    return freshRows.slice(0, limit);
  }
  
  function getLatestIdentityChallengeSnapshot() {
    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    if (!rows.length) return null;
    const latest = [...rows].sort((a, b) => {
      const ta = Number(a?.verifiedAt || a?.usedAt || a?.issuedAt || 0);
      const tb = Number(b?.verifiedAt || b?.usedAt || b?.issuedAt || 0);
      return tb - ta;
    })[0];
    if (!latest) return null;
    return {
      challengeId: String(latest.challengeId || ''),
      traceId: String(latest.traceId || ''),
      status: String(latest.status || ''),
      issuedAt: Number(latest.issuedAt || 0) > 0 ? new Date(Number(latest.issuedAt)).toISOString() : '',
      expiresAt: Number(latest.expiresAt || 0) > 0 ? new Date(Number(latest.expiresAt)).toISOString() : '',
      verifiedAt: Number(latest.verifiedAt || 0) > 0 ? new Date(Number(latest.verifiedAt)).toISOString() : '',
      recoveredAddress: String(latest.recoveredAddress || ''),
      identity: {
        registry: String(latest?.identity?.registry || ''),
        agentId: String(latest?.identity?.agentId || ''),
        agentWallet: String(latest?.identity?.agentWallet || '')
      }
    };
  }
  
  function buildIdentityPayload(profile = {}, extras = {}) {
    return {
      registry: String(profile?.configured?.registry || '').trim(),
      agentId: String(profile?.configured?.agentId || '').trim(),
      agentWallet: normalizeAddress(profile?.agentWallet || ''),
      ownerAddress: normalizeAddress(profile?.ownerAddress || ''),
      tokenURI: String(profile?.tokenURI || '').trim(),
      ...extras
    };
  }
  
  function saveIdentityVerificationRecord({
    traceId = '',
    profile = {},
    verifyMode = '',
    status = 'verified',
    challengeId = '',
    nonce = '',
    message = '',
    signature = '',
    issuedAt = 0,
    expiresAt = 0,
    verifiedAt = Date.now(),
    recoveredAddress = ''
  } = {}) {
    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    rows.unshift({
      challengeId: String(challengeId || createTraceId('idv')).trim(),
      traceId: String(traceId || '').trim(),
      nonce: String(nonce || '').trim(),
      message: String(message || '').trim(),
      signature: String(signature || '').trim(),
      issuedAt: Number(issuedAt || 0),
      expiresAt: Number(expiresAt || 0),
      usedAt: Number(verifiedAt || 0),
      verifiedAt: Number(verifiedAt || 0),
      recoveredAddress: normalizeAddress(recoveredAddress || ''),
      status: String(status || 'verified').trim(),
      verifyMode: String(verifyMode || IDENTITY_VERIFY_MODE || '').trim(),
      identity: buildIdentityPayload(profile)
    });
    writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
  }
  
  async function ensureWorkflowIdentityVerified({ traceId = '', identityInput = {} } = {}) {
    const profile = await readIdentityProfile({
      registry: identityInput?.identityRegistry || identityInput?.registry,
      agentId: identityInput?.agentId
    });
    if (!profile?.available) {
      throw new Error(profile?.reason || 'identity_unavailable');
    }
  
    const agentWallet = normalizeAddress(profile.agentWallet || '');
    if (!ethers.isAddress(agentWallet)) {
      throw new Error('identity_wallet_invalid');
    }
  
    const now = Date.now();
    if (!isIdentitySignatureRequired()) {
      saveIdentityVerificationRecord({
        traceId,
        profile,
        verifyMode: 'registry',
        status: 'verified_registry',
        issuedAt: now,
        expiresAt: now,
        verifiedAt: now,
        recoveredAddress: agentWallet
      });
      return {
        verifyMode: 'registry',
        signatureRequired: false,
        verifiedAt: new Date(now).toISOString(),
        identity: buildIdentityPayload(profile, {
          verifyMode: 'registry',
          verifiedAt: new Date(now).toISOString()
        }),
        profile: buildIdentitySummary(profile)
      };
    }
  
    if (!backendSigner) {
      throw new Error('identity_signature_required_but_backend_signer_unavailable');
    }
  
    const signerAddress = normalizeAddress(backendSigner.address || '');
    if (!signerAddress || signerAddress !== agentWallet) {
      throw new Error(
        `identity_signer_mismatch: backend_signer=${signerAddress || '-'} expected_agent_wallet=${agentWallet}`
      );
    }
  
    const challengeId = createTraceId('idv');
    const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
    const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
      ? IDENTITY_CHALLENGE_TTL_MS
      : 120_000;
    const expiresAt = now + ttl;
    const message = createIdentityChallengeMessage({
      challengeId,
      traceId,
      nonce,
      issuedAt: now,
      expiresAt,
      profile
    });
    const signature = await backendSigner.signMessage(message);
    const recoveredAddress = normalizeAddress(ethers.verifyMessage(message, signature));
    if (!recoveredAddress || recoveredAddress !== agentWallet) {
      throw new Error(
        `identity_signature_invalid: recovered=${recoveredAddress || '-'} expected_agent_wallet=${agentWallet}`
      );
    }
  
    saveIdentityVerificationRecord({
      traceId,
      profile,
      verifyMode: 'signature',
      status: 'verified',
      challengeId,
      nonce,
      message,
      signature,
      issuedAt: now,
      expiresAt,
      verifiedAt: now,
      recoveredAddress
    });
  
    return {
      verifyMode: 'signature',
      signatureRequired: true,
      verifiedAt: new Date(now).toISOString(),
      identity: buildIdentityPayload(profile, {
        verifyMode: 'signature',
        verifiedAt: new Date(now).toISOString(),
        challengeId
      }),
      profile: buildIdentitySummary(profile)
    };
  }
  
  async function readIdentityProfile(input = {}) {
    const requestedRegistry = String(input.registry || '').trim();
    const requestedAgentId = parseAgentId(input.agentId);
    const configured = {
      registry: requestedRegistry || ERC8004_IDENTITY_REGISTRY || '',
      agentId:
        requestedAgentId !== null
          ? String(requestedAgentId)
          : ERC8004_AGENT_ID !== null
            ? String(ERC8004_AGENT_ID)
            : ''
    };
  
    if (!configured.registry || !ethers.isAddress(configured.registry)) {
      return {
        configured,
        available: false,
        reason: 'identity_registry_not_configured'
      };
    }
    const resolvedAgentId = parseAgentId(configured.agentId);
    if (resolvedAgentId === null) {
      return {
        configured,
        available: false,
        reason: 'agent_id_not_configured'
      };
    }
  
    const provider = new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const network = await provider.getNetwork();
    const contract = new ethers.Contract(configured.registry, ERC8004_IDENTITY_ABI, provider);
    const [ownerAddress, tokenURI, agentWallet] = await Promise.all([
      contract.ownerOf(resolvedAgentId),
      contract.tokenURI(resolvedAgentId),
      contract.getAgentWallet(resolvedAgentId)
    ]);
  
    return {
      configured,
      available: true,
      chainId: String(network.chainId),
      ownerAddress,
      tokenURI,
      agentWallet
    };
  }
  
  function assertBackendSigner(res) {
    if (!backendSigner) {
      res.status(503).json({
        error: 'backend_signer_unavailable',
        reason: 'Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY in backend environment.'
      });
      return false;
    }
    return true;
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
  
  app.get('/api/session/runtime', requireRole('viewer'), (req, res) => {
    const runtime = readSessionRuntime();
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
    const runtime = readSessionRuntime();
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

  app.post('/api/v1/session/authorize', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {};
      const rawPayload =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? body.payload
          : {};
      const profile = await readIdentityProfile({
        registry: rawPayload.identityRegistry || body.identityRegistry,
        agentId: rawPayload.agentId || body.agentId
      });
      if (!profile?.available) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'identity_unavailable',
          reason: profile?.reason || 'identity_unavailable',
          traceId: req.traceId || '',
          profile: buildIdentitySummary(profile)
        });
      }

      const currentRuntime = readSessionRuntime();
      const fallbackPayload = {
        agentId: String(profile?.configured?.agentId || '').trim(),
        agentWallet: normalizeSessionGrantAddress(profile?.agentWallet || ''),
        identityRegistry: normalizeSessionGrantAddress(profile?.configured?.registry || ''),
        chainId: String(profile?.chainId || '').trim(),
        payerAaWallet: normalizeSessionGrantAddress(currentRuntime?.aaWallet || ''),
        tokenAddress: normalizeSessionGrantAddress(
          rawPayload.tokenAddress || body.tokenAddress || body.token || SETTLEMENT_TOKEN || ''
        ),
        gatewayRecipient: normalizeSessionGrantAddress(
          rawPayload.gatewayRecipient || body.gatewayRecipient || currentRuntime?.gatewayRecipient || MERCHANT_ADDRESS || ''
        ),
        audience: normalizeSessionGrantText(
          rawPayload.audience,
          `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`
        ),
        singleLimit: normalizeSessionGrantAmount(
          rawPayload.singleLimit,
          body.singleLimit || currentRuntime?.maxPerTx || POLICY_MAX_PER_TX_DEFAULT
        ),
        dailyLimit: normalizeSessionGrantAmount(
          rawPayload.dailyLimit,
          body.dailyLimit || currentRuntime?.dailyLimit || POLICY_DAILY_LIMIT_DEFAULT
        ),
        allowedCapabilities: rawPayload.allowedCapabilities || body.allowedCapabilities || [],
        nonce:
          rawPayload.nonce ||
          (body.nonce ? String(body.nonce || '').trim() : `0x${crypto.randomBytes(16).toString('hex')}`),
        issuedAt: rawPayload.issuedAt || body.issuedAt || Date.now(),
        expiresAt:
          rawPayload.expiresAt ||
          body.expiresAt ||
          Date.now() + 24 * 60 * 60 * 1000
      };
      const payload = normalizeSessionGrantPayload(rawPayload, fallbackPayload);
      if (!payload.agentId || !payload.identityRegistry || !payload.agentWallet) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_payload_invalid',
          reason: 'Session authorization payload must include agentId, identityRegistry, and agentWallet.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (!payload.singleLimit || !payload.dailyLimit) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_limits_invalid',
          reason: 'Session authorization payload must include positive singleLimit and dailyLimit values.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (!payload.nonce) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_nonce_required',
          reason: 'Session authorization payload must include a nonce.',
          traceId: req.traceId || ''
        });
      }
      if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_expired',
          reason: 'Session authorization payload is already expired.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (payload.issuedAt > Date.now() + 5 * 60 * 1000) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_issued_at_invalid',
          reason: 'Session authorization issuedAt is too far in the future.',
          traceId: req.traceId || '',
          payload
        });
      }
      const expectedRegistry = normalizeSessionGrantAddress(profile?.configured?.registry || '');
      const expectedAgentId = String(profile?.configured?.agentId || '').trim();
      const expectedAgentWallet = normalizeSessionGrantAddress(profile?.agentWallet || '');
      if (payload.identityRegistry !== expectedRegistry || payload.agentId !== expectedAgentId) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_identity_mismatch',
          reason: 'Session authorization payload does not match the resolved ERC-8004 identity.',
          traceId: req.traceId || '',
          payload,
          profile: buildIdentitySummary(profile)
        });
      }
      if (payload.agentWallet !== expectedAgentWallet) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_agent_wallet_mismatch',
          reason: 'Session authorization payload agentWallet does not match the ERC-8004 agent wallet.',
          traceId: req.traceId || '',
          payload,
          profile: buildIdentitySummary(profile)
        });
      }

      const userSignature = String(body.userSignature || body.signature || '').trim();
      if (!userSignature) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_signature_required',
          reason: 'userSignature is required for session authorization.',
          traceId: req.traceId || ''
        });
      }
      const recoveredAddress = normalizeSessionGrantAddress(
        ethers.verifyMessage(
          createSessionAuthorizationMessage({
            payload,
            userEoa: body.userEoa || ''
          }),
          userSignature
        )
      );
      const userEoa = normalizeSessionGrantAddress(body.userEoa || recoveredAddress || '');
      if (!userEoa) {
        return res.status(400).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_user_eoa_invalid',
          reason: 'userEoa is invalid.',
          traceId: req.traceId || ''
        });
      }
        if (recoveredAddress !== userEoa) {
          return res.status(400).json({
            ok: false,
            schemaVersion: 'v1',
            error: 'authorization_signature_invalid',
            reason: `Signature recovered ${recoveredAddress || '-'} but expected ${userEoa}.`,
            traceId: req.traceId || ''
          });
        }

      const authorizationRows = normalizeSessionAuthorizationRows(readSessionAuthorizations());
      const duplicateNonce = authorizationRows.find(
        (item) =>
          String(item?.authorizationNonce || '').trim() === payload.nonce &&
          normalizeSessionGrantAddress(item?.authorizedBy || '') === userEoa
      );
      if (duplicateNonce) {
        return res.status(409).json({
          ok: false,
          schemaVersion: 'v1',
          error: 'authorization_nonce_reused',
          reason: 'This session authorization nonce was already used for the same user.',
          traceId: req.traceId || '',
          authorizationId: String(duplicateNonce.authorizationId || '').trim()
        });
      }

      const ensured = await ensureBackendSessionRuntime({
        singleLimit: payload.singleLimit,
        dailyLimit: payload.dailyLimit,
        tokenAddress: payload.tokenAddress,
        gatewayRecipient: payload.gatewayRecipient,
        forceNewSession: /^(1|true|yes|on)$/i.test(String(body.forceNewSession || '').trim())
      });

      const authorizedAt = Date.now();
      const authorizationPayloadHash = hashSessionGrantPayload(payload);
      const authorizationId = createTraceId('sga');
      const authorizationRecord = appendSessionAuthorizationRecord({
        authorizationId,
        traceId: req.traceId || '',
        authorizedBy: userEoa,
        authorizedAt,
        authorizationMode: 'user_grant_backend_executed',
        authorizationPayload: payload,
        authorizationPayloadHash,
        authorizationSignature: userSignature,
        authorizationNonce: payload.nonce,
        authorizationExpiresAt: payload.expiresAt,
        authorizedAgentId: payload.agentId,
        authorizedAgentWallet: payload.agentWallet,
        authorizationAudience: payload.audience,
        allowedCapabilities: payload.allowedCapabilities,
        status: 'authorized',
        created: ensured.created ? 1 : 0,
        reused: ensured.reused ? 1 : 0
      });

      const nextRuntime = writeSessionRuntime({
        ...ensured.runtime,
        authorizedBy: userEoa,
        authorizedAt,
        authorizationMode: 'user_grant_backend_executed',
        authorizationPayload: payload,
        authorizationPayloadHash,
        authorizationSignature: userSignature,
        authorizationNonce: payload.nonce,
        authorizationExpiresAt: payload.expiresAt,
        authorizedAgentId: payload.agentId,
        authorizedAgentWallet: payload.agentWallet,
        authorizationAudience: payload.audience,
        allowedCapabilities: payload.allowedCapabilities,
        source: 'api-v1-session-authorize',
        updatedAt: Date.now()
      });

      return res.json({
        ok: true,
        schemaVersion: 'v1',
        traceId: req.traceId || '',
        created: ensured.created,
        reused: ensured.reused,
        authorizedBy: userEoa,
        authorization: {
          authorizationId,
          mode: 'user_grant_backend_executed',
          authorizedBy: userEoa,
          authorizedAt,
          payload,
          payloadHash: authorizationPayloadHash,
          signatureMasked: maskSecret(userSignature),
          expiresAt: payload.expiresAt,
          nonce: payload.nonce,
          allowedCapabilities: payload.allowedCapabilities
        },
        session: {
          address: nextRuntime.sessionAddress,
          id: nextRuntime.sessionId,
          txHash: nextRuntime.sessionTxHash,
          maxPerTx: nextRuntime.maxPerTx,
          dailyLimit: nextRuntime.dailyLimit,
          gatewayRecipient: nextRuntime.gatewayRecipient,
          tokenAddress: payload.tokenAddress,
          authorizedBy: nextRuntime.authorizedBy,
          authorizationMode: nextRuntime.authorizationMode
        },
        runtime: buildSessionRuntimePayload(nextRuntime),
        record: authorizationRecord
      });
    } catch (error) {
      const reason = error?.message || 'session_authorize_failed';
      const status =
        /invalid|required|mismatch|expired|nonce/i.test(reason)
          ? 400
          : /already used|reused/i.test(reason)
            ? 409
            : 500;
      return res.status(status).json({
        ok: false,
        schemaVersion: 'v1',
        error: 'session_authorize_failed',
        reason,
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
  
  app.get('/api/identity', requireRole('viewer'), async (req, res) => {
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
  
  app.get('/api/identity/current', requireRole('viewer'), async (req, res) => {
    try {
      const profile = await readIdentityProfile({});
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
  
  app.post('/api/chat/agent', requireRole('agent'), async (req, res) => {
    const message = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    const traceId = String(req.body?.traceId || `trace_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`).trim();
    const agent = String(req.body?.agent || '').trim();
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .slice(-20)
          .map((item) => ({
            role: String(item?.role || '').trim(),
            content: String(item?.content || item?.text || item?.message || '').trim()
          }))
          .filter((item) => item.content)
      : [];
  
    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'message_required',
        reason: 'message is required',
        traceId
      });
    }
  
    try {
      const runtime = readSessionRuntime();
      const inferStopOrderIntent = ({ text = '', suggestions = [] }) => {
        const fromSuggestions = Array.isArray(suggestions)
          ? suggestions.find((item) => {
              const action = String(item?.action || '').trim().toLowerCase();
              const endpoint = String(item?.endpoint || '').trim().toLowerCase();
              return (
                action === 'place_stop_order' ||
                action === 'reactive-stop-orders' ||
                endpoint.includes('/workflow/stop-order/run') ||
                endpoint.includes('/a2a/tasks/stop-orders')
              );
            })
          : null;
  
        if (fromSuggestions) {
          try {
            const params = fromSuggestions?.params || fromSuggestions?.task || {};
            return normalizeReactiveParams(params);
          } catch {
            // fall through to text parser
          }
        }
  
        const raw = String(text || '').trim();
        if (!raw) return null;
        const triggerLike = /(stop[\s-]*order|reactive\s*stop|a2a|agent\s*to\s*agent|a\s*to\s*a|tp|sl)/i.test(raw);
        if (!triggerLike) return null;
  
        const symbolCandidates = Array.from(
          raw.matchAll(/\b([A-Za-z]{2,10}\s*[-/]\s*[A-Za-z]{2,10})\b/g),
          (m) => String(m?.[1] || '').replace(/\s+/g, '').replace('/', '-').toUpperCase()
        ).filter(Boolean);
        const symbolFromText =
          symbolCandidates.find((s) => /(USDT|USD|BTC|ETH|BNB|SOL)$/.test(s.split('-')[1] || '')) ||
          symbolCandidates.find((s) => s !== 'STOP-ORDER' && s !== 'TAKE-PROFIT' && s !== 'STOP-LOSS') ||
          '';
        const tpMatch = raw.match(/(?:\btp\b|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const slMatch = raw.match(/(?:\bsl\b|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const qtyMatch = raw.match(/(?:\bqty\b|quantity|size|amount)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        if (!tpMatch || !slMatch) return null;
  
        try {
          const parsed = {
            symbol: symbolFromText || 'BTC-USDT',
            takeProfit: Number(tpMatch[1]),
            stopLoss: Number(slMatch[1])
          };
          if (qtyMatch) {
            parsed.quantity = Number(qtyMatch[1]);
          }
          return normalizeReactiveParams(parsed);
        } catch {
          return null;
        }
      };
  
      const runStopOrderWorkflow = async ({ intent, workflowTraceId }) => {
        const internalApiKey = getInternalAgentApiKey();
        const headers = { 'Content-Type': 'application/json' };
        if (internalApiKey) {
          headers['x-api-key'] = internalApiKey;
        }
        const payer = normalizeAddress(req.body?.payer || runtime?.aaWallet || '');
        const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
        const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
        const workflowResp = await fetch(`http://127.0.0.1:${PORT}/api/workflow/stop-order/run`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            symbol: intent.symbol,
            takeProfit: intent.takeProfit,
            stopLoss: intent.stopLoss,
            ...(Number.isFinite(intent.quantity) ? { quantity: intent.quantity } : {}),
            payer,
            sourceAgentId,
            targetAgentId,
            traceId: workflowTraceId
          })
        });
        const workflowBody = await workflowResp.json().catch(() => ({}));
        return {
          ok: workflowResp.ok && Boolean(workflowBody?.ok),
          status: workflowResp.status,
          body: workflowBody
        };
      };
  
      const fallbackIntent = inferStopOrderIntent({ text: message, suggestions: [] });
      let result = await llmAdapter.chat({
        message,
        sessionId,
        traceId,
        history,
        agent,
        context: {
          aaWallet: runtime?.aaWallet || '',
          owner: runtime?.owner || '',
          runtimeReady: Boolean(runtime?.sessionAddress && runtime?.sessionPrivateKey)
        }
      });
  
      if (!result?.ok && fallbackIntent) {
        result = {
          ok: true,
          mode: 'intent-fallback',
          reply: 'Intent recognized. Running x402 stop-order workflow now.',
          traceId,
          state: 'intent_recognized',
          step: 'intent_parsed',
          suggestions: [
            {
              action: 'place_stop_order',
              endpoint: '/api/workflow/stop-order/run',
              params: fallbackIntent
            }
          ]
        };
      }
  
      if (!result?.ok) {
        return res.status(result?.statusCode || 503).json({
          ok: false,
          error: result?.error || 'llm_adapter_error',
          reason: result?.reason || 'LLM adapter failed',
          traceId: result?.traceId || traceId
        });
      }
  
      const resolvedSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
      const intent = inferStopOrderIntent({ text: message, suggestions: resolvedSuggestions });
      const nextTraceId = String(result.traceId || traceId).trim() || traceId;
  
      if (intent) {
        const workflow = await runStopOrderWorkflow({
          intent,
          workflowTraceId: nextTraceId
        });
        if (!workflow.ok) {
          return res.status(workflow.status || 500).json({
            ok: false,
            mode: 'x402',
            error: workflow.body?.error || 'workflow_failed',
            reason: workflow.body?.reason || `workflow failed: HTTP ${workflow.status}`,
            traceId: nextTraceId,
            state: workflow.body?.state || 'failed',
            step: 'workflow_failed'
          });
        }
  
        return res.json({
          ok: true,
          mode: 'x402',
          reply:
            workflow.body?.state === 'unlocked'
              ? `A2A stop-order unlocked: ${intent.symbol} TP ${intent.takeProfit} SL ${intent.stopLoss}${
                Number.isFinite(intent.quantity) ? ` QTY ${intent.quantity}` : ''
              }`
              : (result.reply || 'Workflow accepted.'),
          traceId: nextTraceId,
          sessionId: sessionId || null,
          state: workflow.body?.state || 'unlocked',
          step: workflow.body?.state === 'unlocked' ? 'workflow_unlocked' : 'workflow_running',
          requestId: workflow.body?.requestId || workflow.body?.workflow?.requestId || '',
          txHash: workflow.body?.txHash || workflow.body?.workflow?.txHash || '',
          userOpHash: workflow.body?.userOpHash || workflow.body?.workflow?.userOpHash || '',
          suggestions: resolvedSuggestions
        });
      }
  
      return res.json({
        ok: true,
        mode: result.mode || 'local-fallback',
        reply: result.reply || 'Received.',
        traceId: nextTraceId,
        sessionId: sessionId || null,
        state: result.state || 'received',
        step: result.step || 'chat_received',
        suggestions: resolvedSuggestions
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'chat_agent_internal_error',
        reason: error?.message || 'chat failed',
        traceId
      });
    }
  });
  
  app.get('/api/chat/agent/health', requireRole('viewer'), async (req, res) => {
    try {
      const adapterInfo = typeof llmAdapter.info === 'function' ? llmAdapter.info() : {};
      const health = await llmAdapter.health();
      if (!health?.ok) {
        return res.status(503).json({
          ok: false,
          error: 'llm_unreachable',
          mode: health?.mode || 'remote',
          connected: false,
          reason: health?.reason || 'LLM health check failed',
          adapter: adapterInfo,
          traceId: req.traceId || ''
        });
      }
      return res.json({
        ok: true,
        mode: health.mode || 'local-fallback',
        connected: Boolean(health.connected),
        reason: health.reason || 'ok',
        adapter: adapterInfo,
        traceId: req.traceId || ''
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'llm_health_error',
        connected: false,
        reason: error?.message || 'LLM health failed',
        traceId: req.traceId || ''
      });
    }
  });
  
}



