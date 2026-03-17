export function createAuthCommandHandlers({
  parseAuthSessionArgs,
  parseSessionApproveArgs,
  parseSessionAuthorizeArgs,
  parseSessionRequestArgs,
  parseSessionWaitArgs,
  requestJson,
  writeLocalProfileConfig,
  normalizeWalletAddress,
  createCliError,
  createEnvelope,
  maskApiKey,
  ensureUsableSession,
  normalizeSessionGrantAddress,
  readCurrentIdentityProfile,
  readSessionSnapshot,
  buildSessionSnapshot,
  buildLocalSessionRuntime,
  createSelfCustodialSession,
  normalizeSessionGrantPayload,
  createSessionAuthorizationMessage,
  normalizePrivateKey,
  resolveAgentTransportApiKey,
  resolveAdminTransportApiKey,
  randomBytes,
  ethers
}) {
  function wait(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function normalizeApprovalRequestMap(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, item]) => {
        return Boolean(String(key || '').trim()) && item && typeof item === 'object' && !Array.isArray(item);
      })
    );
  }

  function buildApprovalRequestUrl(baseUrl = '', approvalRequestId = '', approvalToken = '') {
    const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
    const normalizedId = String(approvalRequestId || '').trim();
    const normalizedToken = String(approvalToken || '').trim();
    const url = new URL(
      `/api/session/approval/${encodeURIComponent(normalizedId)}`,
      `${normalizedBaseUrl || 'http://127.0.0.1:3001'}/`
    );
    if (normalizedToken) {
      url.searchParams.set('token', normalizedToken);
    }
    return url.toString();
  }

  function parseApprovalReference(reference = '') {
    const text = String(reference || '').trim();
    if (!text) {
      return { approvalRequestId: '', approvalToken: '' };
    }
    if (!/^https?:\/\//i.test(text)) {
      return { approvalRequestId: text, approvalToken: '' };
    }
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/').filter(Boolean);
      return {
        approvalRequestId: decodeURIComponent(parts[parts.length - 1] || ''),
        approvalToken: String(url.searchParams.get('token') || '').trim()
      };
    } catch {
      return { approvalRequestId: text, approvalToken: '' };
    }
  }

  function buildPendingSessionSigner(sessionPrivateKey = '') {
    const normalizedSessionKey = normalizePrivateKey(sessionPrivateKey);
    const signer = /^0x[0-9a-fA-F]{64}$/.test(normalizedSessionKey)
      ? new ethers.Wallet(normalizedSessionKey)
      : ethers.Wallet.createRandom();
    return {
      sessionAddress: normalizeSessionGrantAddress(signer.address || ''),
      sessionPrivateKey: signer.privateKey
    };
  }

  function normalizeApprovalRequestRecord(record = {}) {
    const payload =
      record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : record?.authorizationPayload && typeof record.authorizationPayload === 'object'
          ? record.authorizationPayload
          : null;
    return {
      approvalRequestId: String(record?.approvalRequestId || '').trim(),
      approvalToken: String(record?.approvalToken || '').trim(),
      approvalUrl: String(record?.approvalUrl || '').trim(),
      qrText: String(record?.qrText || '').trim(),
      executionMode: String(record?.executionMode || '').trim(),
      sessionAddress: normalizeSessionGrantAddress(record?.sessionAddress || ''),
      sessionPrivateKey: normalizePrivateKey(record?.sessionPrivateKey || ''),
      userEoa: normalizeSessionGrantAddress(record?.userEoa || ''),
      status: String(record?.status || '').trim(),
      createdAt: Number(record?.createdAt || 0),
      completedAt: Number(record?.completedAt || 0),
      authorizationId: String(record?.authorizationId || '').trim(),
      payload
    };
  }

  function resolveLocalApprovalRequest(runtime = {}, approvalRequestId = '') {
    const normalizedId = String(approvalRequestId || '').trim();
    if (!normalizedId) return null;
    const requests = normalizeApprovalRequestMap(runtime?.localApprovalRequests || {});
    const matched = requests[normalizedId];
    return matched ? normalizeApprovalRequestRecord(matched) : null;
  }

  function coercePositiveInt(value, fallbackValue) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
    const fallback = Number(fallbackValue);
    if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback);
    return 0;
  }

  async function resolveSessionGrantDefaults(runtime = {}, options = {}, { payerAaWallet = '' } = {}) {
    const [identityProfile, currentSession] = await Promise.all([
      readCurrentIdentityProfile(runtime),
      readSessionSnapshot(runtime).catch(() => ({ traceId: '', session: buildSessionSnapshot({}) }))
    ]);
    const sessionSnapshot = currentSession?.session || buildSessionSnapshot({});
    const configuredIdentity = identityProfile?.configured || {};
    const payload = normalizeSessionGrantPayload(
      {
        agentId: options.agentId,
        agentWallet: options.agentWallet,
        identityRegistry: options.identityRegistry,
        payerAaWallet: options.payerAaWallet || payerAaWallet,
        tokenAddress: options.tokenAddress,
        gatewayRecipient: options.gatewayRecipient,
        singleLimit: options.singleLimit,
        dailyLimit: options.dailyLimit,
        allowedCapabilities: options.allowedCapabilities,
        audience: options.audience,
        nonce: options.nonce,
        issuedAt: options.issuedAt,
        expiresAt: options.expiresAt
      },
      {
        agentId: String(configuredIdentity?.agentId || '').trim(),
        agentWallet: normalizeSessionGrantAddress(identityProfile?.agentWallet || ''),
        identityRegistry: normalizeSessionGrantAddress(configuredIdentity?.registry || ''),
        chainId: String(identityProfile?.chainId || runtime.chain || '').trim(),
        payerAaWallet: normalizeSessionGrantAddress(
          payerAaWallet || options.payerAaWallet || sessionSnapshot?.aaWallet || ''
        ),
        tokenAddress: normalizeSessionGrantAddress(
          options.tokenAddress ||
            sessionSnapshot?.tokenAddress ||
            process.env.KITE_SETTLEMENT_TOKEN ||
            '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63' ||
            ''
        ),
        gatewayRecipient: normalizeSessionGrantAddress(
          options.gatewayRecipient ||
            sessionSnapshot?.gatewayRecipient ||
            process.env.KITE_MERCHANT_ADDRESS ||
            '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29' ||
            ''
        ),
        singleLimit: options.singleLimit || String(sessionSnapshot?.maxPerTx || process.env.KITE_POLICY_MAX_PER_TX || '1'),
        dailyLimit: options.dailyLimit || String(sessionSnapshot?.dailyLimit || process.env.KITE_POLICY_DAILY_LIMIT || '5'),
        allowedCapabilities: options.allowedCapabilities,
        audience: options.audience || runtime.baseUrl,
        nonce: options.nonce || `0x${randomBytes(16).toString('hex')}`,
        issuedAt: options.issuedAt || Date.now(),
        expiresAt: options.expiresAt || Date.now() + 24 * 60 * 60 * 1000
      }
    );

    return {
      identityProfile,
      sessionSnapshot,
      payload
    };
  }

  async function handleAuthLogin(runtimeBundle) {
    const runtime = runtimeBundle.config;
    const configPath = runtimeBundle.meta.configPath;
    const wallet = normalizeWalletAddress(runtime.wallet);
    if (!wallet) {
      throw createCliError('A valid wallet address is required. Pass --wallet 0x...', {
        code: 'wallet_required'
      });
    }

    const auth = await requestJson(runtime, { pathname: '/api/auth/info' });
    await writeLocalProfileConfig({
      configPath,
      profile: runtime.profile,
      patch: {
        wallet,
        baseUrl: runtime.baseUrl,
        chain: runtime.chain,
        outputMode: runtime.outputMode,
        ...(runtime.apiKeyConfigured ? { apiKey: runtime.apiKey } : {})
      }
    });

    const nextRuntime = {
      ...runtime,
      wallet
    };
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'auth', action: 'login', display: 'ktrace auth login' },
      runtime: nextRuntime,
      data: {
        login: {
          saved: true,
          profile: runtime.profile,
          configPath,
          walletAddress: wallet,
          baseUrl: runtime.baseUrl,
          chain: runtime.chain,
          apiKeyConfigured: runtime.apiKeyConfigured,
          apiKeyMasked: maskApiKey(runtime.apiKey)
        },
        auth: {
          role: String(auth.role || '').trim(),
          authDisabled: Boolean(auth.authDisabled),
          authConfigured: Boolean(auth.authConfigured),
          acceptedHeaders: Array.isArray(auth.acceptedHeaders) ? auth.acceptedHeaders : []
        }
      },
      message: `Saved profile "${runtime.profile}" for ${wallet}.`
    });
  }

  async function handleAuthWhoami(runtimeBundle) {
    const runtime = runtimeBundle.config;
    const [auth, sessionPayload] = await Promise.all([
      requestJson(runtime, { pathname: '/api/auth/info' }),
      requestJson(runtime, { pathname: '/api/session/runtime' })
    ]);
    const session = sessionPayload?.runtime || {};
    const localSession = buildLocalSessionRuntime(runtime?.localSessionRuntime || {});
    const walletAddress = normalizeWalletAddress(runtime.wallet || session.owner || '');
    const backendReady = Boolean(
      session?.aaWallet && session?.owner && session?.sessionAddress && session?.sessionId && session?.hasSessionPrivateKey
    );
    const localReady = Boolean(localSession?.ready);
    const ready = String(runtime?.sessionStrategy || '').trim().toLowerCase() === 'external' ? localReady : backendReady;
    const localSessionData =
      localSession?.aaWallet || localSession?.sessionAddress || localSession?.sessionId
        ? {
            ready: Boolean(localSession.ready),
            aaWallet: String(localSession.aaWallet || '').trim(),
            owner: String(localSession.owner || '').trim(),
            sessionAddress: String(localSession.sessionAddress || '').trim(),
            sessionId: String(localSession.sessionId || '').trim(),
            sessionTxHash: String(localSession.sessionTxHash || '').trim(),
            hasSessionPrivateKey: Boolean(localSession.sessionPrivateKey),
            maxPerTx: Number(localSession.maxPerTx || 0),
            dailyLimit: Number(localSession.dailyLimit || 0),
            gatewayRecipient: String(localSession.gatewayRecipient || '').trim(),
            source: String(localSession.source || '').trim()
          }
        : null;
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'auth', action: 'whoami', display: 'ktrace auth whoami' },
      runtime: {
        ...runtime,
        wallet: walletAddress || runtime.wallet
      },
      data: {
        auth: {
          role: String(auth.role || '').trim(),
          authDisabled: Boolean(auth.authDisabled),
          authConfigured: Boolean(auth.authConfigured),
          acceptedHeaders: Array.isArray(auth.acceptedHeaders) ? auth.acceptedHeaders : [],
          persistence: auth.persistence || null
        },
        identity: {
          walletAddress: walletAddress || '',
          ownerAddress: String(session.owner || '').trim()
        },
        session: {
          ready,
          backendReady,
          localReady,
          aaWallet: String(session.aaWallet || '').trim(),
          sessionAddress: String(session.sessionAddress || '').trim(),
          sessionId: String(session.sessionId || '').trim(),
          sessionTxHash: String(session.sessionTxHash || '').trim(),
          sessionPrivateKeyMasked: String(session.sessionPrivateKeyMasked || '').trim(),
          hasSessionPrivateKey: Boolean(session.hasSessionPrivateKey),
          maxPerTx: Number(session.maxPerTx || 0),
          dailyLimit: Number(session.dailyLimit || 0),
          gatewayRecipient: String(session.gatewayRecipient || '').trim(),
          source: String(session.source || '').trim(),
          updatedAt: Number(session.updatedAt || 0)
        },
        localSession: localSessionData
      }
    });
  }

  async function handleAuthSession(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseAuthSessionArgs(commandArgs);
    const wallet = normalizeWalletAddress(runtime.wallet);
    const ensured = await ensureUsableSession(runtime, {
      wallet,
      strategy: runtime.sessionStrategy,
      singleLimit: options.singleLimit,
      dailyLimit: options.dailyLimit,
      tokenAddress: options.tokenAddress,
      gatewayRecipient: options.gatewayRecipient,
      forceNewSession: options.forceNewSession
    });
    const session = ensured.session || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'auth', action: 'session', display: 'ktrace auth session' },
      runtime: {
        ...runtime,
        wallet: wallet || String(session.owner || '').trim()
      },
      data: {
        traceId: String(ensured.traceId || '').trim(),
        session: {
          checked: Boolean(ensured.checked),
          created: Boolean(ensured.created),
          reused: Boolean(ensured.reused),
          sessionStrategy: ensured.sessionStrategy,
          owner: String(session.owner || '').trim(),
          aaWallet: String(session.aaWallet || '').trim(),
          sessionAddress: String(session.sessionAddress || '').trim(),
          sessionId: String(session.sessionId || '').trim(),
          sessionTxHash: String(session.sessionTxHash || '').trim(),
          maxPerTx: Number(session.maxPerTx || 0),
          dailyLimit: Number(session.dailyLimit || 0),
          gatewayRecipient: String(session.gatewayRecipient || '').trim(),
          tokenAddress: String(session.tokenAddress || '').trim(),
          sessionPrivateKeyMasked: String(session.sessionPrivateKeyMasked || '').trim(),
          hasSessionPrivateKey: Boolean(session.hasSessionPrivateKey),
          source: String(session.source || '').trim(),
          updatedAt: Number(session.updatedAt || 0),
          ready: Boolean(session.ready)
        }
      },
      message:
        ensured.created
          ? 'AA session created and synced.'
          : ensured.reused
            ? 'AA session is ready.'
            : 'AA session was checked.'
    });
  }

  async function handleSessionAuthorize(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const configPath = runtimeBundle.meta.configPath;
    const options = parseSessionAuthorizeArgs(commandArgs);
    const executionMode =
      options.external || String(runtime.sessionStrategy || '').trim().toLowerCase() === 'external'
        ? 'external'
        : 'managed';
    const configuredOwnerKey = normalizePrivateKey(
      options.ownerPrivateKey || process.env.KTRACE_AA_OWNER_PRIVATE_KEY || ''
    );
    const configuredPrivateKey = normalizePrivateKey(
      options.privateKey ||
        process.env.KTRACE_USER_EOA_PRIVATE_KEY ||
        (executionMode === 'external' ? configuredOwnerKey : '')
    );
    if (!configuredPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(configuredPrivateKey)) {
      throw createCliError(
        'A user EOA signing key is required. Pass --private-key 0x... or set KTRACE_USER_EOA_PRIVATE_KEY.',
        {
          code: 'session_authorize_private_key_required'
        }
      );
    }

    const signer = new ethers.Wallet(configuredPrivateKey);
    const userEoa = normalizeSessionGrantAddress(options.userEoa || signer.address || '');
    if (!userEoa) {
      throw createCliError('A valid user EOA is required. Pass --eoa 0x... or provide a valid signing key.', {
        code: 'session_authorize_user_eoa_required'
      });
    }
    if (normalizeSessionGrantAddress(signer.address || '') !== userEoa) {
      throw createCliError('The provided --eoa does not match the supplied signing key.', {
        code: 'session_authorize_signer_mismatch',
        data: {
          expected: normalizeSessionGrantAddress(signer.address || ''),
          provided: userEoa
        }
      });
    }

    const [identityProfile, currentSession] = await Promise.all([
      readCurrentIdentityProfile(runtime),
      readSessionSnapshot(runtime).catch(() => ({ traceId: '', session: buildSessionSnapshot({}) }))
    ]);
    const sessionSnapshot = currentSession?.session || buildSessionSnapshot({});
    const localRuntime =
      executionMode === 'external'
        ? await createSelfCustodialSession(runtime, {
            ownerPrivateKey: configuredOwnerKey || configuredPrivateKey,
            sessionPrivateKey: options.sessionPrivateKey,
            singleLimit:
              options.singleLimit ||
              String(sessionSnapshot?.maxPerTx || process.env.KITE_POLICY_MAX_PER_TX || '1'),
            dailyLimit:
              options.dailyLimit ||
              String(sessionSnapshot?.dailyLimit || process.env.KITE_POLICY_DAILY_LIMIT || '5'),
            tokenAddress:
              options.tokenAddress ||
              sessionSnapshot?.tokenAddress ||
              process.env.KITE_SETTLEMENT_TOKEN ||
              '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63',
            gatewayRecipient:
              options.gatewayRecipient ||
              sessionSnapshot?.gatewayRecipient ||
              process.env.KITE_MERCHANT_ADDRESS ||
              '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29',
            forceNewSession: options.forceNewSession
          })
        : null;

    const configuredIdentity = identityProfile?.configured || {};
    const payload = normalizeSessionGrantPayload(
      {
        agentId: options.agentId,
        agentWallet: options.agentWallet,
        identityRegistry: options.identityRegistry,
        payerAaWallet: options.payerAaWallet,
        tokenAddress: options.tokenAddress,
        gatewayRecipient: options.gatewayRecipient,
        singleLimit: options.singleLimit,
        dailyLimit: options.dailyLimit,
        allowedCapabilities: options.allowedCapabilities,
        audience: options.audience,
        nonce: options.nonce,
        issuedAt: options.issuedAt,
        expiresAt: options.expiresAt
      },
      {
        agentId: String(configuredIdentity?.agentId || '').trim(),
        agentWallet: normalizeSessionGrantAddress(identityProfile?.agentWallet || ''),
        identityRegistry: normalizeSessionGrantAddress(configuredIdentity?.registry || ''),
        chainId: String(identityProfile?.chainId || runtime.chain || '').trim(),
        payerAaWallet: normalizeSessionGrantAddress(localRuntime?.aaWallet || options.payerAaWallet || sessionSnapshot?.aaWallet || ''),
        tokenAddress: normalizeSessionGrantAddress(
          options.tokenAddress ||
            localRuntime?.tokenAddress ||
            sessionSnapshot?.tokenAddress ||
            process.env.KITE_SETTLEMENT_TOKEN ||
            '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63' ||
            ''
        ),
        gatewayRecipient: normalizeSessionGrantAddress(
          options.gatewayRecipient ||
            localRuntime?.gatewayRecipient ||
            sessionSnapshot?.gatewayRecipient ||
            process.env.KITE_MERCHANT_ADDRESS ||
            '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29' ||
            ''
        ),
        singleLimit: options.singleLimit || String(localRuntime?.maxPerTx || sessionSnapshot?.maxPerTx || ''),
        dailyLimit: options.dailyLimit || String(localRuntime?.dailyLimit || sessionSnapshot?.dailyLimit || ''),
        allowedCapabilities: options.allowedCapabilities,
        audience: options.audience || runtime.baseUrl,
        nonce: options.nonce || `0x${randomBytes(16).toString('hex')}`,
        issuedAt: options.issuedAt || Date.now(),
        expiresAt: options.expiresAt || Date.now() + 24 * 60 * 60 * 1000
      }
    );

    if (!payload.agentId || !payload.agentWallet || !payload.identityRegistry) {
      throw createCliError('Resolved session authorization payload is missing ERC-8004 identity fields.', {
        code: 'session_authorize_identity_missing',
        data: {
          identityProfile
        }
      });
    }
    if (!payload.singleLimit || !payload.dailyLimit) {
      throw createCliError('Session authorization requires positive --single-limit and --daily-limit values.', {
        code: 'session_authorize_limits_required',
        data: {
          payload
        }
      });
    }

    const message = createSessionAuthorizationMessage({ payload, userEoa });
    const userSignature = await signer.signMessage(message);
    const response = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/session/authorize',
      apiKey: resolveAgentTransportApiKey(runtime) || resolveAdminTransportApiKey(runtime),
      timeoutMs: Math.max(Number(runtime.timeoutMs || 0), executionMode === 'external' ? 180_000 : 90_000),
      body: {
        payload,
        userEoa,
        userSignature,
        executionMode,
        ...(executionMode === 'external'
          ? {
              runtime: {
                owner: localRuntime?.owner || '',
                aaWallet: localRuntime?.aaWallet || '',
                sessionAddress: localRuntime?.sessionAddress || '',
                sessionId: localRuntime?.sessionId || '',
                sessionTxHash: localRuntime?.sessionTxHash || '',
                maxPerTx: localRuntime?.maxPerTx || 0,
                dailyLimit: localRuntime?.dailyLimit || 0,
                gatewayRecipient: localRuntime?.gatewayRecipient || '',
                tokenAddress: payload.tokenAddress || '',
                source: localRuntime?.source || 'cli-self-custodial'
              }
            }
          : {})
      }
    });

    if (executionMode === 'external' && localRuntime) {
      await writeLocalProfileConfig({
        configPath,
        profile: runtime.profile,
        patch: {
          sessionRuntime: {
            owner: localRuntime.owner || '',
            aaWallet: localRuntime.aaWallet || '',
            sessionAddress: localRuntime.sessionAddress || '',
            sessionPrivateKey: localRuntime.sessionPrivateKey || '',
            sessionId: localRuntime.sessionId || '',
            sessionTxHash: localRuntime.sessionTxHash || '',
            maxPerTx: localRuntime.maxPerTx || 0,
            dailyLimit: localRuntime.dailyLimit || 0,
            gatewayRecipient: localRuntime.gatewayRecipient || '',
            tokenAddress: payload.tokenAddress || '',
            authorizedBy: userEoa,
            authorizedAt: Number(response?.authorization?.authorizedAt || 0),
            authorizationMode: String(response?.authorization?.mode || '').trim(),
            authorizationPayload: payload,
            authorizationPayloadHash: String(response?.authorization?.payloadHash || '').trim(),
            authorizationNonce: String(response?.authorization?.nonce || payload.nonce || '').trim(),
            authorizationExpiresAt: Number(response?.authorization?.expiresAt || payload.expiresAt || 0),
            authorizedAgentId: payload.agentId,
            authorizedAgentWallet: payload.agentWallet,
            authorizationAudience: payload.audience,
            allowedCapabilities: payload.allowedCapabilities,
            source: localRuntime.source || 'cli-self-custodial',
            updatedAt: Date.now()
          }
        },
        setDefaultProfile: false
      });
    }

    const session = buildSessionSnapshot({
      ...(response?.runtime || {}),
      owner: response?.runtime?.owner || '',
      aaWallet: response?.runtime?.aaWallet || '',
      sessionAddress: response?.session?.address || response?.runtime?.sessionAddress || '',
      sessionId: response?.session?.id || response?.runtime?.sessionId || '',
      sessionTxHash: response?.session?.txHash || response?.runtime?.sessionTxHash || '',
      maxPerTx: response?.session?.maxPerTx ?? response?.runtime?.maxPerTx,
      dailyLimit: response?.session?.dailyLimit ?? response?.runtime?.dailyLimit,
      gatewayRecipient: response?.session?.gatewayRecipient || response?.runtime?.gatewayRecipient || '',
      tokenAddress: response?.session?.tokenAddress || response?.runtime?.tokenAddress || '',
      authorizedBy: response?.authorizedBy || response?.runtime?.authorizedBy || '',
      authorizedAt: response?.authorization?.authorizedAt || response?.runtime?.authorizedAt || 0,
      authorizationMode:
        response?.authorization?.mode || response?.session?.authorizationMode || response?.runtime?.authorizationMode || '',
      authorizationPayload: response?.authorization?.payload || response?.runtime?.authorizationPayload || null,
      authorizationPayloadHash:
        response?.authorization?.payloadHash || response?.runtime?.authorizationPayloadHash || '',
      authorizationSignatureMasked:
        response?.authorization?.signatureMasked || response?.runtime?.authorizationSignatureMasked || '',
      hasAuthorizationSignature: response?.runtime?.hasAuthorizationSignature || Boolean(response?.authorization?.signatureMasked),
      authorizationNonce: response?.authorization?.nonce || response?.runtime?.authorizationNonce || '',
      authorizationExpiresAt: response?.authorization?.expiresAt || response?.runtime?.authorizationExpiresAt || 0,
      authorizedAgentId: response?.runtime?.authorizedAgentId || payload.agentId,
      authorizedAgentWallet: response?.runtime?.authorizedAgentWallet || payload.agentWallet,
      authorizationAudience: response?.runtime?.authorizationAudience || payload.audience,
      allowedCapabilities: response?.runtime?.allowedCapabilities || payload.allowedCapabilities
    });

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'session', action: 'authorize', display: 'ktrace session authorize' },
      runtime,
      data: {
        traceId: String(response?.traceId || '').trim(),
        authorization: {
          authorizationId: String(response?.authorization?.authorizationId || '').trim(),
          authorizedBy: userEoa,
          authorizedAt: Number(response?.authorization?.authorizedAt || 0),
          executionMode: String(response?.executionMode || executionMode).trim(),
          authorizationMode: String(response?.authorization?.mode || '').trim(),
          authorizationPayloadHash: String(response?.authorization?.payloadHash || '').trim(),
          authorizationNonce: String(response?.authorization?.nonce || payload.nonce || '').trim(),
          authorizationExpiresAt: Number(response?.authorization?.expiresAt || payload.expiresAt || 0),
          authorizedAgentId: payload.agentId,
          authorizedAgentWallet: payload.agentWallet,
          allowedCapabilities: payload.allowedCapabilities,
          payload
        },
        session,
        localRuntime:
          executionMode === 'external'
            ? {
                owner: String(localRuntime?.owner || '').trim(),
                aaWallet: String(localRuntime?.aaWallet || '').trim(),
                sessionAddress: String(localRuntime?.sessionAddress || '').trim(),
                sessionId: String(localRuntime?.sessionId || '').trim(),
                sessionTxHash: String(localRuntime?.sessionTxHash || '').trim(),
                accountCreatedNow: Boolean(localRuntime?.accountCreatedNow),
                accountTxHash: String(localRuntime?.accountTxHash || '').trim()
              }
            : null
      },
      message:
        executionMode === 'external'
          ? 'User-authorized self-custodial session registered and synced.'
          : response?.created
            ? 'User-authorized session grant recorded and AA session created.'
            : response?.reused
              ? 'User-authorized session grant recorded against the active AA session.'
              : 'User-authorized session grant recorded.'
    });
  }

  async function handleSessionRequest(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const configPath = runtimeBundle.meta.configPath;
    if (String(runtime.sessionStrategy || '').trim().toLowerCase() !== 'external') {
      throw createCliError('session request is only available with --session-strategy external.', {
        code: 'session_request_external_only'
      });
    }

    const options = parseSessionRequestArgs(commandArgs);
    const userEoa = normalizeSessionGrantAddress(options.userEoa || '');
    if (!userEoa) {
      throw createCliError('A valid user EOA is required. Pass --eoa 0x...', {
        code: 'session_request_user_eoa_required'
      });
    }

    const pendingSigner = buildPendingSessionSigner(options.sessionPrivateKey);
    const { identityProfile, payload } = await resolveSessionGrantDefaults(runtime, options);

    if (!payload.agentId || !payload.agentWallet || !payload.identityRegistry) {
      throw createCliError('Resolved session approval request is missing ERC-8004 identity fields.', {
        code: 'session_request_identity_missing',
        data: {
          identityProfile
        }
      });
    }
    if (!payload.singleLimit || !payload.dailyLimit) {
      throw createCliError('Session approval request requires positive --single-limit and --daily-limit values.', {
        code: 'session_request_limits_required',
        data: {
          payload
        }
      });
    }

    const response = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/session/approval-requests',
      apiKey: resolveAgentTransportApiKey(runtime) || resolveAdminTransportApiKey(runtime),
      body: {
        payload,
        userEoa,
        executionMode: 'external',
        sessionAddress: pendingSigner.sessionAddress
      }
    });

    const approvalRequest = normalizeApprovalRequestRecord({
      ...(response?.approvalRequest || {}),
      sessionPrivateKey: pendingSigner.sessionPrivateKey,
      userEoa,
      payload
    });
    const nextApprovalRequests = {
      ...normalizeApprovalRequestMap(runtime.localApprovalRequests || {}),
      [approvalRequest.approvalRequestId]: {
        approvalRequestId: approvalRequest.approvalRequestId,
        approvalToken: approvalRequest.approvalToken,
        approvalUrl:
          approvalRequest.approvalUrl ||
          buildApprovalRequestUrl(runtime.baseUrl, approvalRequest.approvalRequestId, approvalRequest.approvalToken),
        qrText:
          approvalRequest.qrText ||
          buildApprovalRequestUrl(runtime.baseUrl, approvalRequest.approvalRequestId, approvalRequest.approvalToken),
        executionMode: 'external',
        sessionAddress: pendingSigner.sessionAddress,
        sessionPrivateKey: pendingSigner.sessionPrivateKey,
        userEoa,
        status: String(response?.approvalRequest?.status || 'pending').trim() || 'pending',
        createdAt: Number(response?.approvalRequest?.createdAt || Date.now()),
        payload
      }
    };

    await writeLocalProfileConfig({
      configPath,
      profile: runtime.profile,
      patch: {
        approvalRequests: nextApprovalRequests
      },
      setDefaultProfile: false
    });

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'session', action: 'request', display: 'ktrace session request' },
      runtime,
      data: {
        traceId: String(response?.traceId || '').trim(),
        approvalRequest: {
          approvalRequestId: approvalRequest.approvalRequestId,
          approvalUrl:
            approvalRequest.approvalUrl ||
            buildApprovalRequestUrl(runtime.baseUrl, approvalRequest.approvalRequestId, approvalRequest.approvalToken),
          qrText:
            approvalRequest.qrText ||
            buildApprovalRequestUrl(runtime.baseUrl, approvalRequest.approvalRequestId, approvalRequest.approvalToken),
          approvalToken: approvalRequest.approvalToken,
          executionMode: 'external',
          status: String(response?.approvalRequest?.status || 'pending').trim() || 'pending',
          userEoa,
          sessionAddress: pendingSigner.sessionAddress,
          createdAt: Number(response?.approvalRequest?.createdAt || Date.now()),
          payload
        }
      },
      message: 'Session approval request created. Send the approvalUrl or QR text to the user.'
    });
  }

  async function handleSessionWait(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const configPath = runtimeBundle.meta.configPath;
    const reference = String((Array.isArray(commandArgs) ? commandArgs[0] : '') || '').trim();
    if (!reference) {
      throw createCliError('An approval request id or approval URL is required.', {
        code: 'session_wait_reference_required'
      });
    }
    const options = parseSessionWaitArgs(commandArgs.slice(1));
    const parsedReference = parseApprovalReference(reference);
    const approvalRequestId = String(parsedReference.approvalRequestId || '').trim();
    const localApprovalRequest = resolveLocalApprovalRequest(runtime, approvalRequestId);
    const approvalToken =
      String(options.token || parsedReference.approvalToken || localApprovalRequest?.approvalToken || '').trim();
    if (!approvalRequestId || !approvalToken) {
      throw createCliError('A valid approval request id and token are required to wait for completion.', {
        code: 'session_wait_token_required'
      });
    }

    const intervalMs = coercePositiveInt(options.intervalMs, 3_000) || 3_000;
    const timeoutMs = coercePositiveInt(options.timeoutMs, 5 * 60 * 1000) || 5 * 60 * 1000;
    const startedAt = Date.now();
    let latest = null;
    while (Date.now() - startedAt <= timeoutMs) {
      latest = await requestJson(runtime, {
        pathname: `/api/session/approval/${encodeURIComponent(approvalRequestId)}?token=${encodeURIComponent(approvalToken)}`,
        omitRuntimeApiKey: true
      });
      const status = String(latest?.approvalRequest?.status || '').trim().toLowerCase();
      if (['completed', 'authorized'].includes(status)) break;
      if (['rejected', 'expired', 'cancelled', 'failed'].includes(status)) {
        throw createCliError(`Approval request ended with status=${status}.`, {
          code: 'session_wait_terminal_status',
          data: latest
        });
      }
      await wait(intervalMs);
    }

    if (!latest || !['completed', 'authorized'].includes(String(latest?.approvalRequest?.status || '').trim().toLowerCase())) {
      throw createCliError(`Timed out waiting for approval request ${approvalRequestId}.`, {
        code: 'session_wait_timeout',
        data: latest
      });
    }

    const session = buildSessionSnapshot({
      ...(latest?.runtime || {}),
      owner: latest?.runtime?.owner || '',
      aaWallet: latest?.runtime?.aaWallet || '',
      sessionAddress: latest?.session?.address || latest?.runtime?.sessionAddress || '',
      sessionId: latest?.session?.id || latest?.runtime?.sessionId || '',
      sessionTxHash: latest?.session?.txHash || latest?.runtime?.sessionTxHash || '',
      maxPerTx: latest?.session?.maxPerTx ?? latest?.runtime?.maxPerTx,
      dailyLimit: latest?.session?.dailyLimit ?? latest?.runtime?.dailyLimit,
      gatewayRecipient: latest?.session?.gatewayRecipient || latest?.runtime?.gatewayRecipient || '',
      tokenAddress: latest?.session?.tokenAddress || latest?.runtime?.tokenAddress || '',
      authorizedBy: latest?.authorization?.authorizedBy || latest?.runtime?.authorizedBy || '',
      authorizedAt: latest?.authorization?.authorizedAt || latest?.runtime?.authorizedAt || 0,
      authorizationMode: latest?.authorization?.mode || latest?.runtime?.authorizationMode || '',
      authorizationPayload: latest?.authorization?.payload || latest?.runtime?.authorizationPayload || null,
      authorizationPayloadHash: latest?.authorization?.payloadHash || latest?.runtime?.authorizationPayloadHash || '',
      authorizationNonce: latest?.authorization?.nonce || latest?.runtime?.authorizationNonce || '',
      authorizationExpiresAt: latest?.authorization?.expiresAt || latest?.runtime?.authorizationExpiresAt || 0,
      authorizedAgentId: latest?.runtime?.authorizedAgentId || '',
      authorizedAgentWallet: latest?.runtime?.authorizedAgentWallet || '',
      authorizationAudience: latest?.runtime?.authorizationAudience || '',
      allowedCapabilities: latest?.runtime?.allowedCapabilities || []
    });

    let localRuntimeSynced = false;
    if (
      localApprovalRequest?.sessionPrivateKey &&
      normalizeSessionGrantAddress(session.sessionAddress || '') ===
        normalizeSessionGrantAddress(localApprovalRequest.sessionAddress || '')
    ) {
      const approvalRequests = normalizeApprovalRequestMap(runtime.localApprovalRequests || {});
      delete approvalRequests[approvalRequestId];
      await writeLocalProfileConfig({
        configPath,
        profile: runtime.profile,
        patch: {
          sessionRuntime: {
            owner: latest?.runtime?.owner || '',
            aaWallet: latest?.runtime?.aaWallet || '',
            sessionAddress: session.sessionAddress,
            sessionPrivateKey: localApprovalRequest.sessionPrivateKey,
            sessionId: session.sessionId,
            sessionTxHash: session.sessionTxHash,
            maxPerTx: session.maxPerTx || 0,
            dailyLimit: session.dailyLimit || 0,
            gatewayRecipient: session.gatewayRecipient || '',
            tokenAddress: session.tokenAddress || '',
            authorizedBy: session.authorizedBy || '',
            authorizedAt: session.authorizedAt || 0,
            authorizationMode: session.authorizationMode || '',
            authorizationPayload: latest?.authorization?.payload || session.authorizationPayload || null,
            authorizationPayloadHash: session.authorizationPayloadHash || '',
            authorizationNonce: session.authorizationNonce || '',
            authorizationExpiresAt: session.authorizationExpiresAt || 0,
            authorizedAgentId: session.authorizedAgentId || '',
            authorizedAgentWallet: session.authorizedAgentWallet || '',
            authorizationAudience: session.authorizationAudience || '',
            allowedCapabilities: session.allowedCapabilities || [],
            source: 'cli-agent-first-approved',
            updatedAt: Date.now()
          },
          approvalRequests
        },
        setDefaultProfile: false
      });
      localRuntimeSynced = true;
    }

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'session', action: 'wait', display: 'ktrace session wait' },
      runtime,
      data: {
        traceId: String(latest?.traceId || '').trim(),
        approvalRequest: latest?.approvalRequest || null,
        authorization: latest?.authorization || null,
        session,
        localRuntimeSynced
      },
      message: localRuntimeSynced
        ? 'Approval completed and local session runtime is now ready.'
        : 'Approval completed.'
    });
  }

  async function handleSessionApprove(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const reference = String((Array.isArray(commandArgs) ? commandArgs[0] : '') || '').trim();
    if (!reference) {
      throw createCliError('An approval request id or approval URL is required.', {
        code: 'session_approve_reference_required'
      });
    }

    const options = parseSessionApproveArgs(commandArgs.slice(1));
    const parsedReference = parseApprovalReference(reference);
    const approvalRequestId = String(parsedReference.approvalRequestId || '').trim();
    const approvalToken = String(options.token || parsedReference.approvalToken || '').trim();
    if (!approvalRequestId || !approvalToken) {
      throw createCliError('A valid approval request id and token are required.', {
        code: 'session_approve_token_required'
      });
    }

    const currentApproval = await requestJson(runtime, {
      pathname: `/api/session/approval/${encodeURIComponent(approvalRequestId)}?token=${encodeURIComponent(approvalToken)}`,
      omitRuntimeApiKey: true
    });
    const approvalRequest = currentApproval?.approvalRequest || {};
    const requestPayload =
      approvalRequest?.payload && typeof approvalRequest.payload === 'object' ? approvalRequest.payload : {};
    if (String(approvalRequest?.status || '').trim().toLowerCase() === 'completed') {
      return createEnvelope({
        ok: true,
        exitCode: 0,
        command: { family: 'session', action: 'approve', display: 'ktrace session approve' },
        runtime,
        data: {
          traceId: String(currentApproval?.traceId || '').trim(),
          approvalRequest,
          authorization: currentApproval?.authorization || null,
          session: buildSessionSnapshot(currentApproval?.runtime || {})
        },
        message: 'Approval request was already completed.'
      });
    }

    const configuredOwnerKey = normalizePrivateKey(
      options.ownerPrivateKey || process.env.KTRACE_AA_OWNER_PRIVATE_KEY || ''
    );
    if (!configuredOwnerKey || !/^0x[0-9a-fA-F]{64}$/.test(configuredOwnerKey)) {
      throw createCliError('A valid owner private key is required. Pass --owner-key 0x...', {
        code: 'session_approve_owner_key_required'
      });
    }
    const configuredPrivateKey = normalizePrivateKey(
      options.privateKey || process.env.KTRACE_USER_EOA_PRIVATE_KEY || configuredOwnerKey
    );
    if (!configuredPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(configuredPrivateKey)) {
      throw createCliError('A valid user EOA signing key is required. Pass --private-key 0x...', {
        code: 'session_approve_private_key_required'
      });
    }

    const signer = new ethers.Wallet(configuredPrivateKey);
    const userEoa = normalizeSessionGrantAddress(options.userEoa || approvalRequest?.userEoa || signer.address || '');
    if (!userEoa) {
      throw createCliError('A valid user EOA is required for approval.', {
        code: 'session_approve_user_eoa_required'
      });
    }
    if (normalizeSessionGrantAddress(signer.address || '') !== userEoa) {
      throw createCliError('The provided --eoa does not match the supplied signing key.', {
        code: 'session_approve_signer_mismatch'
      });
    }
    if (approvalRequest?.userEoa && normalizeSessionGrantAddress(approvalRequest.userEoa) !== userEoa) {
      throw createCliError('The supplied signing key does not match the targeted user EOA for this approval request.', {
        code: 'session_approve_user_mismatch'
      });
    }

    const localRuntime = await createSelfCustodialSession(runtime, {
      ownerPrivateKey: configuredOwnerKey,
      sessionAddress: approvalRequest?.sessionAddress || '',
      singleLimit: requestPayload.singleLimit,
      dailyLimit: requestPayload.dailyLimit,
      tokenAddress: requestPayload.tokenAddress,
      gatewayRecipient: requestPayload.gatewayRecipient
    });
    const payload = normalizeSessionGrantPayload(requestPayload, {
      payerAaWallet: localRuntime.aaWallet || requestPayload.payerAaWallet || ''
    });
    const message = createSessionAuthorizationMessage({ payload, userEoa });
    const userSignature = await signer.signMessage(message);
    const response = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/session/approval/${encodeURIComponent(approvalRequestId)}/complete?token=${encodeURIComponent(approvalToken)}`,
      omitRuntimeApiKey: true,
      timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 180_000),
      body: {
        payload,
        userEoa,
        userSignature,
        executionMode: 'external',
        runtime: {
          owner: localRuntime.owner || '',
          aaWallet: localRuntime.aaWallet || '',
          sessionAddress: localRuntime.sessionAddress || '',
          sessionId: localRuntime.sessionId || '',
          sessionTxHash: localRuntime.sessionTxHash || '',
          maxPerTx: localRuntime.maxPerTx || 0,
          dailyLimit: localRuntime.dailyLimit || 0,
          gatewayRecipient: localRuntime.gatewayRecipient || '',
          tokenAddress: payload.tokenAddress || '',
          source: localRuntime.source || 'cli-self-custodial-approval'
        }
      }
    });

    const session = buildSessionSnapshot({
      ...(response?.runtime || {}),
      owner: response?.runtime?.owner || '',
      aaWallet: response?.runtime?.aaWallet || '',
      sessionAddress: response?.session?.address || response?.runtime?.sessionAddress || '',
      sessionId: response?.session?.id || response?.runtime?.sessionId || '',
      sessionTxHash: response?.session?.txHash || response?.runtime?.sessionTxHash || '',
      maxPerTx: response?.session?.maxPerTx ?? response?.runtime?.maxPerTx,
      dailyLimit: response?.session?.dailyLimit ?? response?.runtime?.dailyLimit,
      gatewayRecipient: response?.session?.gatewayRecipient || response?.runtime?.gatewayRecipient || '',
      tokenAddress: response?.session?.tokenAddress || response?.runtime?.tokenAddress || ''
    });

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'session', action: 'approve', display: 'ktrace session approve' },
      runtime,
      data: {
        traceId: String(response?.traceId || '').trim(),
        approvalRequest: response?.approvalRequest || approvalRequest,
        authorization: response?.authorization || null,
        session,
        aaWallet: localRuntime.aaWallet || ''
      },
      message: 'Approval completed and the requested session is now authorized.'
    });
  }

  return {
    handleAuthLogin,
    handleAuthWhoami,
    handleAuthSession,
    handleSessionAuthorize,
    handleSessionRequest,
    handleSessionWait,
    handleSessionApprove
  };
}
