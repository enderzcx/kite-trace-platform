export function createAuthCommandHandlers({
  parseAuthSessionArgs,
  parseSessionAuthorizeArgs,
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
  normalizeSessionGrantPayload,
  createSessionAuthorizationMessage,
  resolveAdminTransportApiKey,
  randomBytes,
  ethers
}) {
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
    const walletAddress = normalizeWalletAddress(runtime.wallet || session.owner || '');
    const ready = Boolean(
      session?.aaWallet &&
        session?.owner &&
        session?.sessionAddress &&
        session?.sessionId &&
        session?.hasSessionPrivateKey
    );
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
        }
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
    const options = parseSessionAuthorizeArgs(commandArgs);
    const configuredPrivateKey = String(options.privateKey || process.env.KTRACE_USER_EOA_PRIVATE_KEY || '').trim();
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
        payerAaWallet: normalizeSessionGrantAddress(sessionSnapshot?.aaWallet || ''),
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
        singleLimit: options.singleLimit || String(sessionSnapshot?.maxPerTx || ''),
        dailyLimit: options.dailyLimit || String(sessionSnapshot?.dailyLimit || ''),
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
      apiKey: resolveAdminTransportApiKey(runtime),
      timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 90_000),
      body: {
        payload,
        userEoa,
        userSignature
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
          authorizationMode: String(response?.authorization?.mode || '').trim(),
          authorizationPayloadHash: String(response?.authorization?.payloadHash || '').trim(),
          authorizationNonce: String(response?.authorization?.nonce || payload.nonce || '').trim(),
          authorizationExpiresAt: Number(response?.authorization?.expiresAt || payload.expiresAt || 0),
          authorizedAgentId: payload.agentId,
          authorizedAgentWallet: payload.agentWallet,
          allowedCapabilities: payload.allowedCapabilities,
          payload
        },
        session
      },
      message:
        response?.created
          ? 'User-authorized session grant recorded and AA session created.'
          : response?.reused
            ? 'User-authorized session grant recorded against the active AA session.'
            : 'User-authorized session grant recorded.'
    });
  }

  return {
    handleAuthLogin,
    handleAuthWhoami,
    handleAuthSession,
    handleSessionAuthorize
  };
}
