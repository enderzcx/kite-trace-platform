export function createIdentityVerificationHelpers(deps = {}) {
  const {
    BACKEND_RPC_URL,
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    IDENTITY_CHALLENGE_MAX_ROWS,
    IDENTITY_CHALLENGE_TTL_MS,
    IDENTITY_VERIFY_MODE,
    createTraceId,
    crypto,
    ethers,
    getBackendSigner,
    normalizeAddress,
    readIdentityChallenges,
    writeIdentityChallenges
  } = deps;

  const ERC8004_IDENTITY_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function getAgentWallet(uint256 agentId) view returns (address)'
  ];

  function parseAgentId(raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function createIdentityRpcProvider() {
    const request = new ethers.FetchRequest(BACKEND_RPC_URL);
    request.timeout = 120_000;
    return new ethers.JsonRpcProvider(request);
  }

  function isRetryableIdentityRpcError(error = null) {
    const code = String(error?.code || '').trim().toLowerCase();
    const message = String(error?.message || error || '').trim().toLowerCase();
    return (
      code === 'timeout' ||
      message.includes('econnreset') ||
      message.includes('fetch failed') ||
      message.includes('socket hang up') ||
      message.includes('etimedout') ||
      message.includes('request timeout') ||
      message.includes('code=timeout') ||
      message.includes('this operation was aborted')
    );
  }

  function isIdentitySignatureRequired() {
    return !['registry', 'registry_only', 'service', 'service_registry'].includes(IDENTITY_VERIFY_MODE);
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

  function issueIdentityChallenge({ traceId = '', identityInput = {} } = {}) {
    return readIdentityProfile({
      registry: identityInput?.identityRegistry || identityInput?.registry,
      agentId: identityInput?.identityAgentId || identityInput?.agentId
    }).then((profile) => {
      if (!profile?.available) {
        throw new Error(profile?.reason || 'identity_unavailable');
      }
      const now = Date.now();
      const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
        ? IDENTITY_CHALLENGE_TTL_MS
        : 120_000;
      const challengeId = createTraceId('idv');
      const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
      const expiresAt = now + ttl;
      const message = createIdentityChallengeMessage({
        challengeId,
        traceId,
        nonce,
        issuedAt: now,
        expiresAt,
        profile
      });
      const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
      rows.unshift({
        challengeId,
        traceId: String(traceId || '').trim(),
        nonce,
        message,
        signature: '',
        issuedAt: now,
        expiresAt,
        usedAt: 0,
        verifiedAt: 0,
        recoveredAddress: '',
        status: 'issued',
        verifyMode: isIdentitySignatureRequired() ? 'signature' : 'registry',
        identity: buildIdentityPayload(profile)
      });
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
      return {
        challengeId,
        traceId: String(traceId || '').trim(),
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        signatureRequired: isIdentitySignatureRequired(),
        message,
        identity: buildIdentityPayload(profile),
        profile: buildIdentitySummary(profile)
      };
    });
  }

  async function verifyIdentityChallengeResponse({
    challengeId = '',
    signature = '',
    traceId = ''
  } = {}) {
    const normalizedChallengeId = String(challengeId || '').trim();
    if (!normalizedChallengeId) {
      throw new Error('identity_challenge_id_required');
    }
    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    const index = rows.findIndex((item) => String(item?.challengeId || '').trim() === normalizedChallengeId);
    if (index < 0) {
      throw new Error('identity_challenge_not_found');
    }
    const row = rows[index];
    const now = Date.now();
    if (Number(row?.expiresAt || 0) > 0 && now > Number(row.expiresAt)) {
      throw new Error('identity_challenge_expired');
    }
    if (Number(row?.usedAt || 0) > 0) {
      throw new Error('identity_challenge_already_used');
    }

    const profile = await readIdentityProfile({
      registry: row?.identity?.registry,
      agentId: row?.identity?.agentId
    });
    if (!profile?.available) {
      throw new Error(profile?.reason || 'identity_unavailable');
    }

    if (!isIdentitySignatureRequired()) {
      rows[index] = {
        ...row,
        status: 'verified_registry',
        usedAt: now,
        verifiedAt: now,
        traceId: String(traceId || row?.traceId || '').trim()
      };
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
      return {
        verifyMode: 'registry',
        signerType: 'registry',
        verifiedAt: new Date(now).toISOString(),
        identity: buildIdentityPayload(profile, {
          verifyMode: 'registry',
          verifiedAt: new Date(now).toISOString()
        }),
        profile: buildIdentitySummary(profile)
      };
    }

    const normalizedSignature = String(signature || '').trim();
    if (!normalizedSignature) {
      throw new Error('identity_signature_required');
    }

    const recoveredAddress = normalizeAddress(ethers.verifyMessage(String(row?.message || ''), normalizedSignature));
    const ownerAddress = normalizeAddress(profile?.ownerAddress || '');
    const agentWallet = normalizeAddress(profile?.agentWallet || '');
    let signerType = '';
    if (recoveredAddress && recoveredAddress === ownerAddress) {
      signerType = 'owner';
    } else if (recoveredAddress && recoveredAddress === agentWallet) {
      signerType = 'agent_wallet';
    } else {
      throw new Error(
        `identity_signature_invalid: recovered=${recoveredAddress || '-'} expected_owner=${ownerAddress || '-'} expected_agent_wallet=${agentWallet || '-'}`
      );
    }

    rows[index] = {
      ...row,
      signature: normalizedSignature,
      recoveredAddress,
      status: 'verified',
      usedAt: now,
      verifiedAt: now,
      traceId: String(traceId || row?.traceId || '').trim(),
      verifyMode: 'signature'
    };
    writeIdentityChallenges(normalizeIdentityChallengeRows(rows));

    return {
      verifyMode: 'signature',
      signerType,
      verifiedAt: new Date(now).toISOString(),
      identity: buildIdentityPayload(profile, {
        verifyMode: 'signature',
        verifiedAt: new Date(now).toISOString(),
        challengeId: normalizedChallengeId
      }),
      profile: buildIdentitySummary(profile)
    };
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

    const maxAttempts = 5;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const provider = createIdentityRpcProvider();
        const network = await provider.getNetwork();
        const contract = new ethers.Contract(configured.registry, ERC8004_IDENTITY_ABI, provider);
        const ownerAddress = await contract.ownerOf(resolvedAgentId);
        const tokenURI = await contract.tokenURI(resolvedAgentId);
        const agentWallet = await contract.getAgentWallet(resolvedAgentId);

        return {
          configured,
          available: true,
          chainId: String(network.chainId),
          ownerAddress,
          tokenURI,
          agentWallet
        };
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableIdentityRpcError(error)) {
          throw error;
        }
        await sleep(500 * attempt);
      }
    }
    throw lastError || new Error('identity_profile_unavailable');
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

    const backendSigner = typeof getBackendSigner === 'function' ? getBackendSigner() : null;
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

  function assertBackendSigner(res) {
    const backendSigner = typeof getBackendSigner === 'function' ? getBackendSigner() : null;
    if (!backendSigner) {
      res.status(503).json({
        error: 'backend_signer_unavailable',
        reason: 'Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY in backend environment.'
      });
      return false;
    }
    return true;
  }

  return {
    assertBackendSigner,
    ensureWorkflowIdentityVerified,
    getLatestIdentityChallengeSnapshot,
    issueIdentityChallenge,
    readIdentityProfile,
    verifyIdentityChallengeResponse
  };
}
