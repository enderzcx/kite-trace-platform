export function registerAutomationX402Routes(app, deps) {
  const {
    requireRole,
    getAutoTradePlanStatus,
    startAutoTradePlanLoop,
    stopAutoTradePlanLoop,
    writePolicyConfig,
    normalizeAddress,
    ethers,
    buildPolicySnapshot,
    readPolicyFailures,
    readX402Requests,
    computeX402StatusCounts,
    x402Path,
    persistenceStore,
    expireStaleX402PendingRequests,
    sessionPayMetrics,
    markSessionPayFailure,
    readSessionRuntime,
    resolveSessionRuntime,
    resolveSessionOwnerByAaWallet,
    SETTLEMENT_TOKEN,
    BACKEND_RPC_URL,
    PORT,
    getServiceProviderBytes32,
    KITE_REQUIRE_AA_V2,
    AA_V2_VERSION_TAG,
    KITE_MIN_NATIVE_GAS,
    KITE_BUNDLER_RPC_TIMEOUT_MS,
    KITE_BUNDLER_RPC_RETRIES,
    BUNDLER_RPC_BACKOFF_POLICY,
    KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    KITE_SESSION_PAY_RETRIES,
    withSessionUserOpLock,
    classifySessionPayFailure,
    shouldRetrySessionPayCategory,
    markSessionPayRetry,
    getSessionPayRetryBackoffMs,
    markSessionPayRetryDelay,
    waitMs,
    extractUserOpHashFromReason,
    KITE_ALLOW_EOA_RELAY_FALLBACK,
    shouldFallbackToEoaRelay,
    sendSessionTransferViaEoaRelay,
    readRecords,
    writeRecords,
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    GokiteAASDK,
    BACKEND_BUNDLER_URL,
    BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS,
    KITE_AA_ACCOUNT_IMPLEMENTATION,
  } = deps;
  const sessionPayInflightByPayer = new Map();
  const SESSION_PAY_RECEIPT_WAIT_MS = Math.max(
    180_000,
    Number(KITE_BUNDLER_RPC_TIMEOUT_MS || 0) * 24,
    360_000
  );

  function buildSessionPayPayerKey(value = '') {
    return normalizeAddress(value || '') || String(value || '').trim().toLowerCase() || 'default';
  }

  function buildTrackedSessionPayResult(tracked = null) {
    if (!tracked?.ok || !tracked?.receipt?.success || !tracked?.transactionHash) {
      return null;
    }
    return {
      status: 'success',
      transactionHash: tracked.transactionHash,
      userOpHash: String(tracked.userOpHash || '').trim(),
      receipt: {
        blockNumber: tracked?.receipt?.blockNumber || tracked?.receipt?.receipt?.blockNumber || null
      }
    };
  }

  function trackInflightSessionPay(lockKey = '', userOpHash = '', sdk = null) {
    const key = buildSessionPayPayerKey(lockKey);
    const normalizedUserOpHash = String(userOpHash || '').trim();
    if (!key || !normalizedUserOpHash || !sdk || typeof sdk.waitForUserOperation !== 'function') {
      return null;
    }
    const current = sessionPayInflightByPayer.get(key);
    if (current && current.userOpHash === normalizedUserOpHash) {
      return current.promise;
    }
    const promise = sdk
      .waitForUserOperation(
        normalizedUserOpHash,
        SESSION_PAY_RECEIPT_WAIT_MS,
        KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
      )
      .then((receipt) => ({
        ok: Boolean(receipt?.success && receipt?.transactionHash),
        userOpHash: normalizedUserOpHash,
        transactionHash: String(receipt?.transactionHash || '').trim(),
        receipt
      }))
      .catch((error) => ({
        ok: false,
        userOpHash: normalizedUserOpHash,
        reason: String(error?.message || 'userop_receipt_wait_failed').trim()
      }))
      .finally(() => {
        const latest = sessionPayInflightByPayer.get(key);
        if (latest && latest.promise === promise) {
          sessionPayInflightByPayer.delete(key);
        }
      });
    sessionPayInflightByPayer.set(key, {
      userOpHash: normalizedUserOpHash,
      startedAt: Date.now(),
      promise
    });
    return promise;
  }

  async function awaitInflightSessionPay(lockKey = '') {
    const key = buildSessionPayPayerKey(lockKey);
    const current = sessionPayInflightByPayer.get(key);
    if (!current?.promise) return null;
    return current.promise.catch(() => null);
  }

  async function ensureManagedRuntimeForSessionPay({
    owner = '',
    payer = '',
    tokenAddress = '',
    recipient = ''
  } = {}) {
    const resolvedOwner =
      normalizeAddress(owner || '') || resolveSessionOwnerByAaWallet?.(payer || '') || '';
    if (!resolvedOwner) return null;

    const headers = { 'Content-Type': 'application/json' };
    const internalApiKey =
      typeof deps.getInternalAgentApiKey === 'function' ? String(deps.getInternalAgentApiKey() || '').trim() : '';
    if (internalApiKey) headers['x-api-key'] = internalApiKey;

    const response = await fetch(`http://127.0.0.1:${PORT}/api/session/runtime/ensure`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        owner: resolvedOwner,
        tokenAddress: tokenAddress || SETTLEMENT_TOKEN || '',
        gatewayRecipient: recipient || ''
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.ok) {
      throw new Error(String(body?.reason || body?.error || 'session runtime ensure failed').trim());
    }
    return body;
  }

  app.get('/api/automation/trade-plan/status', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      automation: {
        type: 'agent001-trade-plan',
        ...getAutoTradePlanStatus()
      }
    });
  });
  
  app.post('/api/automation/trade-plan/start', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    startAutoTradePlanLoop({
      intervalMs: body.intervalMs,
      symbol: body.symbol,
      horizonMin: body.horizonMin,
      prompt: body.prompt,
      immediate: body.immediate !== false,
      reason: 'manual'
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      automation: {
        type: 'agent001-trade-plan',
        ...getAutoTradePlanStatus()
      }
    });
  });
  
  app.post('/api/automation/trade-plan/stop', requireRole('admin'), (req, res) => {
    stopAutoTradePlanLoop();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      automation: {
        type: 'agent001-trade-plan',
        ...getAutoTradePlanStatus()
      }
    });
  });
  
  app.post('/api/x402/policy', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const nextPolicy = writePolicyConfig({
      maxPerTx: body.maxPerTx,
      dailyLimit: body.dailyLimit,
      allowedRecipients: body.allowedRecipients,
      revokedPayers: body.revokedPayers
    });
    res.json({ ok: true, traceId: req.traceId, policy: nextPolicy });
  });
  
  app.post('/api/policy/update', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const nextPolicy = writePolicyConfig({
      maxPerTx: body.maxPerTx,
      dailyLimit: body.dailyLimit,
      allowedRecipients: body.allowedRecipients,
      revokedPayers: body.revokedPayers
    });
    res.json({ ok: true, traceId: req.traceId, policy: nextPolicy });
  });
  
  app.post('/api/x402/policy/revoke', requireRole('admin'), (req, res) => {
    const payer = normalizeAddress(req.body?.payer || '');
    if (!payer || !ethers.isAddress(payer)) {
      return res.status(400).json({ error: 'invalid_payer' });
    }
    const current = buildPolicySnapshot();
    const revoked = new Set(current.revokedPayers || []);
    revoked.add(payer);
    const next = writePolicyConfig({
      ...current,
      revokedPayers: Array.from(revoked)
    });
    return res.json({
      ok: true,
      action: 'revoked',
      payer,
      traceId: req.traceId,
      policy: next
    });
  });
  
  app.post('/api/policy/revoke', requireRole('admin'), (req, res) => {
    const payer = normalizeAddress(req.body?.payer || '');
    if (!payer || !ethers.isAddress(payer)) {
      return res.status(400).json({ error: 'invalid_payer' });
    }
    const current = buildPolicySnapshot();
    const revoked = new Set(current.revokedPayers || []);
    revoked.add(payer);
    const next = writePolicyConfig({
      ...current,
      revokedPayers: Array.from(revoked)
    });
    return res.json({ ok: true, action: 'revoked', payer, traceId: req.traceId, policy: next });
  });
  
  app.post('/api/x402/policy/unrevoke', requireRole('admin'), (req, res) => {
    const payer = normalizeAddress(req.body?.payer || '');
    if (!payer || !ethers.isAddress(payer)) {
      return res.status(400).json({ error: 'invalid_payer' });
    }
    const current = buildPolicySnapshot();
    const revoked = new Set((current.revokedPayers || []).filter((addr) => addr !== payer));
    const next = writePolicyConfig({
      ...current,
      revokedPayers: Array.from(revoked)
    });
    return res.json({
      ok: true,
      action: 'unrevoked',
      payer,
      traceId: req.traceId,
      policy: next
    });
  });
  
  app.post('/api/policy/unrevoke', requireRole('admin'), (req, res) => {
    const payer = normalizeAddress(req.body?.payer || '');
    if (!payer || !ethers.isAddress(payer)) {
      return res.status(400).json({ error: 'invalid_payer' });
    }
    const current = buildPolicySnapshot();
    const revoked = new Set((current.revokedPayers || []).filter((addr) => addr !== payer));
    const next = writePolicyConfig({
      ...current,
      revokedPayers: Array.from(revoked)
    });
    return res.json({ ok: true, action: 'unrevoked', payer, traceId: req.traceId, policy: next });
  });
  
  app.get('/api/x402/policy-failures', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const code = String(req.query.code || '').trim().toLowerCase();
    const action = String(req.query.action || '').trim().toLowerCase();
    const payer = String(req.query.payer || '').trim().toLowerCase();
    const rows = readPolicyFailures().filter((item) => {
      const codeOk = !code || String(item.code || '').toLowerCase() === code;
      const actionOk = !action || String(item.action || '').toLowerCase() === action;
      const payerOk = !payer || String(item.payer || '').toLowerCase() === payer;
      return codeOk && actionOk && payerOk;
    });
    res.json({ ok: true, total: rows.length, items: rows.slice(0, limit) });
  });
  
  app.get('/api/x402/requests', requireRole('viewer'), (req, res) => {
    const requestId = String(req.query.requestId || '').trim().toLowerCase();
    const txHash = String(req.query.txHash || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const action = String(req.query.action || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
  
    const requests = readX402Requests();
    const filtered = requests.filter((item) => {
      const idOk = !requestId || String(item.requestId || '').toLowerCase() === requestId;
      const txOk = !txHash || String(item.paymentTxHash || '').toLowerCase() === txHash || String(item?.paymentProof?.txHash || '').toLowerCase() === txHash;
      const statusOk = !status || String(item.status || '').toLowerCase() === status;
      const actionOk = !action || String(item.action || '').toLowerCase() === action;
      return idOk && txOk && statusOk && actionOk;
    });
  
    res.json({ ok: true, total: filtered.length, items: filtered.slice(0, limit) });
  });
  
  app.get('/api/x402/maintenance/summary', requireRole('viewer'), (req, res) => {
    const now = Date.now();
    const rows = readX402Requests();
    const counts = computeX402StatusCounts(rows, now);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      now,
      nowIso: new Date(now).toISOString(),
      storage: {
        cwd: process.cwd(),
        x402Path
      },
      persistence: persistenceStore.info(),
      counts
    });
  });
  
  app.post('/api/x402/maintenance/expire-stale', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const cleanup = expireStaleX402PendingRequests({
      dryRun: Boolean(body.dryRun),
      stalePendingMs: body.stalePendingMs,
      limit: body.limit,
      reason: String(body.reason || '').trim() || 'manual_cleanup'
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      cleanup
    });
  });
  
  // AA Session Payment Endpoint
  app.post('/api/session/pay', requireRole('agent'), async (req, res) => {
    let requestIdForCatch = '';
    let sessionIdForCatch = '';
    let payerForCatch = '';
    let failSessionPay = (status = 500, { error = 'payment_failed', reason = 'session pay failed', details = {} } = {}) =>
      res.status(status).json({ ok: false, error, reason, details });
    try {
      sessionPayMetrics.totalRequests += 1;
      failSessionPay = (status = 500, { error = 'payment_failed', reason = 'session pay failed', details = {} } = {}) => {
        const attemptsRaw = Number(details?.attempts || 0);
        const attempts = Number.isFinite(attemptsRaw) ? attemptsRaw : 0;
        const requestId = String(details?.requestId || '').trim();
        const category = markSessionPayFailure({
          errorCode: error,
          reason,
          traceId: req.traceId || '',
          requestId,
          attempts
        });
        return res.status(status).json({
          ok: false,
          error,
          reason,
          details: {
            ...details,
            reasonCategory: category
          }
        });
      };
      const body = req.body || {};
      const requestId = String(body.requestId || '').trim();
      requestIdForCatch = requestId;
      const x402Request =
        requestId
          ? readX402Requests().find((item) => String(item?.requestId || '').trim() === requestId) || null
          : null;
      const requestedOwner = normalizeAddress(body.owner || '');
      const requestedPayer = normalizeAddress(body.payer || body.aaWallet || x402Request?.payer || '');
      let runtime = resolveSessionRuntime({
        owner: requestedOwner,
        aaWallet: requestedPayer,
        sessionId: String(body.sessionId || '').trim()
      });

      const runtimeMatchedPayer =
        !requestedPayer || normalizeAddress(runtime.aaWallet || '') === requestedPayer;
      const runtimeMatchedOwner =
        !requestedOwner || normalizeAddress(runtime.owner || '') === requestedOwner;
      const runtimeMissingSecrets = !runtime.sessionPrivateKey || !runtime.aaWallet;
      const inferredOwner = requestedOwner || resolveSessionOwnerByAaWallet?.(requestedPayer || '') || '';

      if ((runtimeMissingSecrets || !runtimeMatchedPayer || !runtimeMatchedOwner) && (requestedPayer || inferredOwner)) {
        try {
          await ensureManagedRuntimeForSessionPay({
            owner: inferredOwner,
            payer: requestedPayer,
            tokenAddress: body.tokenAddress || x402Request?.tokenAddress || SETTLEMENT_TOKEN || '',
            recipient: body.recipient || x402Request?.recipient || ''
          });
          runtime = resolveSessionRuntime({
            owner: inferredOwner || requestedOwner,
            aaWallet: requestedPayer,
            sessionId: String(body.sessionId || '').trim()
          });
        } catch (ensureError) {
          const message = String(ensureError?.message || 'session runtime ensure failed').trim();
          if (runtimeMissingSecrets) {
            return failSessionPay(400, {
              error: 'session_not_configured',
              reason: message,
              details: {
                owner: inferredOwner || requestedOwner,
                payer: requestedPayer,
                requestId
              }
            });
          }
        }
      }

      if (!runtime.sessionPrivateKey || !runtime.aaWallet) {
        return failSessionPay(400, {
          error: 'session_not_configured',
          reason: 'Session key not synced. Please configure via /api/session/runtime/sync first.'
        });
      }
      if (requestedPayer && normalizeAddress(runtime.aaWallet || '') !== requestedPayer) {
        return failSessionPay(400, {
          error: 'session_not_configured',
          reason: `No synced session runtime matched payer ${requestedPayer}.`,
          details: {
            payer: requestedPayer,
            requestId
          }
        });
      }
      if (requestedOwner && normalizeAddress(runtime.owner || '') !== requestedOwner) {
        return failSessionPay(400, {
          error: 'session_not_configured',
          reason: `No synced session runtime matched owner ${requestedOwner}.`,
          details: {
            owner: requestedOwner,
            requestId
          }
        });
      }
  
      const {
        tokenAddress,
        recipient,
        amount,
        action = 'kol-score',
        query = '',
        sessionId: bodySessionId = ''
      } = body;
  
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        return failSessionPay(400, { error: 'invalid_tokenAddress', reason: 'tokenAddress must be a valid address.' });
      }
      const expectedSettlementToken = normalizeAddress(SETTLEMENT_TOKEN || '');
      if (
        expectedSettlementToken &&
        ethers.isAddress(expectedSettlementToken) &&
        normalizeAddress(tokenAddress) !== expectedSettlementToken
      ) {
        return failSessionPay(400, {
          error: 'unsupported_settlement_token',
          reason: `Unsupported settlement token. expected=${expectedSettlementToken}, got=${normalizeAddress(tokenAddress)}`
        });
      }
      if (!recipient || !ethers.isAddress(recipient)) {
        return failSessionPay(400, { error: 'invalid_recipient', reason: 'recipient must be a valid address.' });
      }
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        return failSessionPay(400, { error: 'invalid_amount', reason: 'amount must be a positive number.' });
      }
  
      const decimals = 18;
      const amountRaw = ethers.parseUnits(String(amount), decimals);
      const sessionId = String(bodySessionId || runtime.sessionId || '').trim();
      sessionIdForCatch = sessionId;
      payerForCatch = String(runtime.aaWallet || requestedPayer || '').trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
        return failSessionPay(400, {
          error: 'invalid_session_id',
          reason: 'sessionId is required. Sync runtime with sessionId from Agent Settings.',
          details: { requestId: String(requestId || '').trim() }
        });
      }
  
      const rpcRequest = new ethers.FetchRequest(BACKEND_RPC_URL);
      rpcRequest.timeout = Math.min(30_000, Math.max(15_000, Number(KITE_BUNDLER_RPC_TIMEOUT_MS || 0) * 4));
      const provider = new ethers.JsonRpcProvider(rpcRequest);
      const sessionWallet = new ethers.Wallet(runtime.sessionPrivateKey, provider);
      const sessionSignerAddress = await sessionWallet.getAddress();
      const serviceProvider = getServiceProviderBytes32(action);
  
      const accountCode = await provider.getCode(runtime.aaWallet);
      if (!accountCode || accountCode === '0x') {
        return failSessionPay(400, {
          error: 'aa_wallet_not_deployed_or_incompatible',
          reason: `No contract code found at runtime aaWallet: ${runtime.aaWallet}. Deploy AA account first, then recreate/sync session.`,
          details: {
            aaWallet: runtime.aaWallet,
            sessionId,
            requestId: String(requestId || '').trim()
          }
        });
      }
      let aaVersion = '';
      try {
        const versionReadAbi = ['function version() view returns (string)'];
        const versionContract = new ethers.Contract(runtime.aaWallet, versionReadAbi, provider);
        aaVersion = String(await versionContract.version()).trim();
      } catch {
        aaVersion = '';
      }
      if (KITE_REQUIRE_AA_V2 && aaVersion !== AA_V2_VERSION_TAG) {
        return failSessionPay(400, {
          error: 'aa_version_mismatch',
          reason: `AA version mismatch for session payments. required=${AA_V2_VERSION_TAG}, current=${aaVersion || 'unknown_or_legacy'}`,
          details: {
            aaWallet: runtime.aaWallet,
            requiredVersion: AA_V2_VERSION_TAG,
            currentVersion: aaVersion || '',
            requestId: String(requestId || '').trim()
          }
        });
      }
  
      const sessionReadAbi = [
        'function sessionExists(bytes32 sessionId) view returns (bool)',
        'function getSessionAgent(bytes32 sessionId) view returns (address)',
        'function checkSpendingRules(bytes32 sessionId, uint256 normalizedAmount, bytes32 serviceProvider) view returns (bool)'
      ];
      const account = new ethers.Contract(runtime.aaWallet, sessionReadAbi, provider);
      const [exists, agentAddr, rulePass] = await Promise.all([
        account.sessionExists(sessionId),
        account.getSessionAgent(sessionId),
        account.checkSpendingRules(sessionId, amountRaw, serviceProvider)
      ]);
      if (!exists) {
        return failSessionPay(400, {
          error: 'session_not_found',
          reason: `Session not found on-chain: ${sessionId}`,
          details: { requestId: String(requestId || '').trim(), sessionId }
        });
      }
      if (String(agentAddr || '').toLowerCase() !== String(sessionSignerAddress).toLowerCase()) {
        return failSessionPay(400, {
          error: 'session_agent_mismatch',
          reason: `On-chain session agent mismatch. expected=${agentAddr}, current=${sessionSignerAddress}`,
          details: { requestId: String(requestId || '').trim(), sessionId }
        });
      }
  
      const erc20Abi = ['function balanceOf(address account) view returns (uint256)'];
      const tokenCode = await provider.getCode(tokenAddress);
      if (!tokenCode || tokenCode === '0x') {
        return failSessionPay(400, {
          error: 'invalid_token_contract',
          reason: `No contract code at tokenAddress: ${tokenAddress}`,
          details: { requestId: String(requestId || '').trim(), sessionId }
        });
      }
      const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
      const aaBalance = await tokenContract.balanceOf(runtime.aaWallet);
      if (aaBalance < amountRaw) {
        return failSessionPay(400, {
          error: 'insufficient_funds',
          reason: `AA wallet ${runtime.aaWallet} has insufficient balance`,
          details: {
            aaWallet: runtime.aaWallet,
            balance: ethers.formatUnits(aaBalance, decimals),
            required: amount,
            requestId: String(requestId || '').trim(),
            sessionId
          }
        });
      }
      let minNativeGas = 0n;
      try {
        minNativeGas = ethers.parseEther(KITE_MIN_NATIVE_GAS || '0');
      } catch {
        minNativeGas = ethers.parseEther('0.0001');
      }
      const nativeBalance = await provider.getBalance(runtime.aaWallet);
      if (nativeBalance < minNativeGas) {
        return failSessionPay(400, {
          error: 'insufficient_kite_gas',
          reason: `AA wallet ${runtime.aaWallet} has insufficient KITE for gas. Need >= ${ethers.formatEther(minNativeGas)} KITE.`,
          details: {
            aaWallet: runtime.aaWallet,
            balance: ethers.formatEther(nativeBalance),
            required: ethers.formatEther(minNativeGas),
            requestId: String(requestId || '').trim(),
            sessionId
          }
        });
      }
      if (!rulePass) {
        return failSessionPay(400, {
          error: 'session_rule_failed',
          reason: 'Session spending rule precheck failed (amount/provider out of scope).',
          details: { requestId: String(requestId || '').trim(), sessionId }
        });
      }
  
      const sdk = new GokiteAASDK({
        network: 'kite_testnet',
        rpcUrl: BACKEND_RPC_URL,
        bundlerUrl: BACKEND_BUNDLER_URL,
        entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
        accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
        accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
        proxyAddress: runtime.aaWallet,
        bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
        bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
        bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
        bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
        bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
        bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
        bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
      });
      if (runtime.owner && ethers.isAddress(runtime.owner)) {
        sdk.config.ownerAddress = runtime.owner;
      }
  
      const nowSec = Math.floor(Date.now() / 1000);
      const authPayload = {
        from: runtime.aaWallet,
        to: recipient,
        token: tokenAddress,
        value: amountRaw,
        validAfter: BigInt(Math.max(0, nowSec - 30)),
        validBefore: BigInt(nowSec + 10 * 60),
        nonce: ethers.hexlify(ethers.randomBytes(32))
      };
      const authSignature = await sdk.buildTransferAuthorizationSignature(sessionWallet, authPayload);
      const metadata = ethers.hexlify(
        ethers.toUtf8Bytes(
          JSON.stringify({
            requestId: String(requestId || ''),
            action: String(action || ''),
            query: String(query || '')
          })
        )
      );
      const signFunction = async (userOpHash) =>
        sessionWallet.signMessage(ethers.getBytes(userOpHash));
  
      const maxAttempts = Math.max(1, Math.min(KITE_SESSION_PAY_RETRIES, 5));
      const payerLockKey = buildSessionPayPayerKey(runtime.aaWallet || '');
      const lockStartedAt = Date.now();
      const { result, attempts, queueWaitMs } = await withSessionUserOpLock(payerLockKey, async () => {
        let innerResult = null;
        let innerAttempts = 0;
        const queueStartedAt = Date.now();
        await awaitInflightSessionPay(payerLockKey);
        const innerQueueWaitMs = Math.max(0, Date.now() - queueStartedAt);
        for (let i = 0; i < maxAttempts; i += 1) {
          innerAttempts = i + 1;
          innerResult = await sdk.sendSessionTransferWithAuthorizationAndProvider(
            {
              sessionId,
              auth: authPayload,
              authSignature,
              serviceProvider,
              metadata
            },
            signFunction,
            {
              callGasLimit: 320000n,
              verificationGasLimit: 450000n,
              preVerificationGas: 120000n
            }
          );
          const submittedUserOpHash = String(
            innerResult?.userOpHash || extractUserOpHashFromReason(String(innerResult?.reason || '').trim())
          ).trim();
          if ((!innerResult || innerResult.status !== 'success' || !innerResult.transactionHash) && submittedUserOpHash) {
            const tracked = await trackInflightSessionPay(payerLockKey, submittedUserOpHash, sdk);
            const recoveredResult = buildTrackedSessionPayResult(tracked);
            if (recoveredResult) {
              innerResult = recoveredResult;
              break;
            }
          }
          if (innerResult?.status === 'success' && innerResult?.transactionHash) break;
          const reason = String(innerResult?.reason || '').trim();
          const reasonCategory = classifySessionPayFailure({ reason });
          const retriable = shouldRetrySessionPayCategory(reasonCategory);
          if (!retriable || i >= maxAttempts - 1) break;
          const retryCategory = markSessionPayRetry({ reason, errorCode: String(innerResult?.error || '').trim() });
          const retryDelayMs = getSessionPayRetryBackoffMs({ attempt: innerAttempts, category: retryCategory });
          markSessionPayRetryDelay({ category: retryCategory, delayMs: retryDelayMs });
          if (retryDelayMs > 0) await waitMs(retryDelayMs);
          continue;
        }
        return { result: innerResult, attempts: innerAttempts, queueWaitMs: innerQueueWaitMs };
      });
      const payElapsedMs = Math.max(0, Date.now() - lockStartedAt);
      const primaryReason = String(result?.reason || '').trim();
      const extractedUserOpHash = String(result?.userOpHash || extractUserOpHashFromReason(primaryReason)).trim();
      let finalResult = result;
      let signerMode = 'aa-session';
      let relaySender = '';
      let fallbackAttempted = false;
      let fallbackReason = '';
  
      if (!finalResult || finalResult.status !== 'success' || !finalResult.transactionHash) {
        if (KITE_ALLOW_EOA_RELAY_FALLBACK && shouldFallbackToEoaRelay(primaryReason)) {
          fallbackAttempted = true;
          const fallback = await sendSessionTransferViaEoaRelay({
            provider,
            aaWallet: runtime.aaWallet,
            sessionId,
            authPayload,
            authSignature,
            serviceProvider,
            metadata
          });
          if (fallback.ok && fallback.txHash) {
            signerMode = 'aa-session-eoa-relay';
            relaySender = String(fallback.relaySender || '').trim();
            finalResult = {
              status: 'success',
              transactionHash: fallback.txHash,
              userOpHash: extractedUserOpHash,
              receipt: {
                blockNumber: fallback.blockNumber || null
              }
            };
          } else {
            fallbackReason = String(fallback.reason || '').trim();
          }
        }
      }
  
      if (!finalResult || finalResult.status !== 'success' || !finalResult.transactionHash) {
        const reason = primaryReason || 'unknown';
        sessionPayMetrics.totalRetriesUsed += Math.max(0, Number(attempts || 1) - 1);
        if (fallbackAttempted) sessionPayMetrics.totalFallbackAttempted += 1;
        return failSessionPay(500, {
          error: 'aa_session_payment_failed',
          reason: fallbackReason
            ? `${reason}; eoa_relay_failed: ${fallbackReason}`
            : !KITE_ALLOW_EOA_RELAY_FALLBACK
              ? `${reason}; eoa_relay_disabled`
              : reason,
          details: {
            userOpHash: extractedUserOpHash,
            requestId: String(requestId || '').trim(),
            sessionId,
            payer: runtime.aaWallet,
            attempts,
            payElapsedMs,
            queueWaitMs,
            eoaRelayEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
            fallbackAttempted,
            fallbackReason
          }
        });
      }
  
      const records = readRecords();
      const record = {
        time: new Date().toISOString(),
        type: 'aa-session-payment',
        amount: String(amount),
        token: tokenAddress,
        recipient: recipient,
        txHash: finalResult.transactionHash,
        userOpHash: extractedUserOpHash,
        status: 'success',
        requestId: requestId || '',
        signerMode,
        relaySender,
        agentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : '',
        identityRegistry: ERC8004_IDENTITY_REGISTRY || '',
        aaWallet: runtime.aaWallet,
        sessionAddress: runtime.sessionAddress,
        sessionId,
        action
      };
      records.unshift(record);
      writeRecords(records);
      sessionPayMetrics.totalSuccess += 1;
      sessionPayMetrics.totalRetriesUsed += Math.max(0, Number(attempts || 1) - 1);
      if (fallbackAttempted) sessionPayMetrics.totalFallbackAttempted += 1;
      if (signerMode === 'aa-session-eoa-relay') sessionPayMetrics.totalFallbackSucceeded += 1;
  
      return res.json({
        ok: true,
        status: 'paid',
        payment: {
          requestId: requestId || '',
          tokenAddress,
          recipient,
          amount: String(amount),
          amountWei: amountRaw.toString(),
          aaWallet: runtime.aaWallet,
          sessionAddress: runtime.sessionAddress,
          sessionId,
          aaVersion,
          txHash: finalResult.transactionHash,
          userOpHash: extractedUserOpHash,
          payElapsedMs,
          queueWaitMs,
          eoaRelayEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
          signerMode,
          relaySender,
          fallbackAttempted
        },
        message: 'AA session payment submitted and confirmed.'
      });
  
    } catch (error) {
      console.error('Session pay error:', error);
      return failSessionPay(500, {
        error: 'payment_failed',
        reason: error?.message || 'session pay failed',
        details: {
          requestId: requestIdForCatch,
          sessionId: sessionIdForCatch,
          payer: payerForCatch
        }
      });
    }
  });
  
}
