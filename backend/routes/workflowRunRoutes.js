export function registerWorkflowRunRoutes(app, deps) {
  const {
    aaWallet,
    action,
    active,
    address,
    after,
    agent,
    AGENT001_BIND_TIMEOUT_MS,
    AGENT001_PREBIND_ONLY,
    amount,
    API_KEY_ADMIN,
    API_KEY_AGENT,
    API_KEY_VIEWER,
    appendWorkflowStep,
    assertBackendSigner,
    attempt,
    attempts,
    auth,
    AUTH_DISABLED,
    authConfigured,
    backendSigner,
    block,
    body,
    broadcastEvent,
    buildA2ACapabilities,
    buildNetworkRunSummaries,
    buildPaymentRequiredResponse,
    buildPolicySnapshot,
    buildResponseHash,
    buildWorkflowFallbackAuditEvents,
    capabilities,
    capability,
    channel,
    code,
    computed,
    computeReactiveStopOrderAmount,
    controller,
    created,
    createdAt,
    createTraceId,
    createX402Request,
    current,
    dailyLimit,
    deriveNegotiationTermsFromAuditEvents,
    digestStableObject,
    done,
    endpoint,
    ensureNetworkAgents,
    ensureWorkflowIdentityVerified,
    envelope,
    err,
    error,
    ethers,
    evaluateTransferPolicy,
    events,
    excerpt,
    executor,
    existing,
    expired,
    expiresAt,
    explorer,
    failed,
    failure,
    fallback,
    fetchBtcPriceQuote,
    fetchXReaderDigest,
    fromAgentId,
    gatewayRecipient,
    getActionConfig,
    getAllXmtpRuntimeStatuses,
    getLatestIdentityChallengeSnapshot,
    handle,
    hasQuantity,
    headers,
    horizonMin,
    HYPERLIQUID_ORDER_RECIPIENT,
    hyperliquidAdapter,
    id,
    idx,
    info,
    input,
    intent,
    isInfoAnalysisAction,
    isTechnicalAnalysisAction,
    items,
    json,
    key,
    kind,
    KITE_AGENT1_ID,
    KITE_AGENT2_AA_ADDRESS,
    KITE_AGENT2_ID,
    KITE_ALLOW_BACKEND_USEROP_SIGN,
    label,
    lastError,
    limit,
    listNetworkAuditEventsByTraceId,
    logPolicyFailure,
    low,
    mapped,
    market,
    matched,
    maxAttempts,
    maxChars,
    maxPerTx,
    MERCHANT_ADDRESS,
    message,
    method,
    mode,
    ms,
    name,
    network,
    normalizeAddress,
    normalizeBtcPriceParams,
    normalized,
    normalizedCapability,
    normalizedTask,
    normalizeReactiveParams,
    normalizeRiskScoreParams,
    normalizeXReaderParams,
    now,
    onchainStatus,
    paid,
    params,
    parsed,
    parseExcerptMaxChars,
    path,
    payer,
    payload,
    payment,
    paymentIntent,
    pending,
    persistenceStore,
    policy,
    PORT,
    postSessionPayWithRetry,
    price,
    provider,
    qty,
    quantityText,
    quote,
    readAgent001Results,
    reader,
    readIdentityProfile,
    readRecords,
    readSessionRuntime,
    readWorkflows,
    readX402Requests,
    reason,
    receipt,
    receiptRef,
    receipts,
    recipient,
    record,
    records,
    refs,
    reqItem,
    requestId,
    requests,
    requireRole,
    resolveInfoSettlementRecipient,
    resolveTechnicalSettlementRecipient,
    resolveWorkflowTraceId,
    responseHash,
    result,
    resultSummary,
    retryable,
    risk,
    router,
    routerStatus,
    row,
    rows,
    running,
    runRiskScoreAnalysis,
    runtime,
    runtimeName,
    sanitizeNetworkAgentRecord,
    sessionAddress,
    sessionId,
    SETTLEMENT_TOKEN,
    shouldRetrySessionPayReason,
    signature,
    signer,
    signerAddress,
    signResponseHash,
    source,
    sourceAgentId,
    startedAt,
    state,
    status,
    step,
    steps,
    success,
    summary,
    symbol,
    targetAgentId,
    task,
    taskId,
    tasks,
    technical,
    text,
    timeoutMs,
    timer,
    title,
    to,
    toAgentId,
    token,
    tokenAddress,
    topic,
    total,
    traceId,
    tx,
    txHash,
    type,
    updated,
    updatedAt,
    upsertAgent001ResultRecord,
    upsertWorkflow,
    url,
    validatePaymentProof,
    value,
    verifiedAt,
    verifyProofOnChain,
    waitMs,
    warnings,
    workflow,
    workflowByRequestId,
    workflows,
    writeNetworkAgents,
    writeX402Requests,
    X_READER_MAX_CHARS_DEFAULT,
    X402_BTC_PRICE,
    X402_HYPERLIQUID_ORDER_PRICE,
    X402_INFO_PRICE,
    X402_RISK_SCORE_PRICE,
    X402_X_READER_PRICE,
    XMTP_ENV,
    xmtpRuntime,
  } = deps;

  function parseBooleanFlag(value, fallback = false) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return Boolean(fallback);
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return Boolean(fallback);
  }

  const buildA2AReceipt =
    typeof deps.buildA2AReceipt === 'function' ? deps.buildA2AReceipt : () => null;

  function buildInternalAgentHeadersLocal() {
    const headers = { 'Content-Type': 'application/json' };
    const key = String(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER || '').trim();
    if (key) headers['x-api-key'] = key;
    return headers;
  }

  async function callA2ATaskEndpoint(endpoint = '', payload = {}, label = 'a2a task') {
    const port = String(PORT || process.env.PORT || 3001).trim() || '3001';
    const timeoutMs = Math.max(10_000, Math.min(Number(AGENT001_BIND_TIMEOUT_MS || 210_000), 300_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        method: 'POST',
        headers: buildInternalAgentHeadersLocal(),
        body: JSON.stringify(payload || {}),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, body };
    } catch (error) {
      if (String(error?.name || '').trim() === 'AbortError') {
        throw new Error(`${label} timeout after ${timeoutMs}ms`);
      }
      throw new Error(String(error?.message || `${label} failed`).trim() || `${label} failed`);
    } finally {
      clearTimeout(timer);
    }
  }

  const handleA2AStopOrders =
    typeof deps.handleA2AStopOrders === 'function'
      ? deps.handleA2AStopOrders
      : async (body = {}) => callA2ATaskEndpoint('/api/a2a/tasks/stop-orders', body, 'a2a stop-orders');

  const handleA2ABtcPrice =
    typeof deps.handleA2ABtcPrice === 'function'
      ? deps.handleA2ABtcPrice
      : async (body = {}) => callA2ATaskEndpoint('/api/a2a/tasks/btc-price', body, 'a2a btc-price');

  const handleA2ARiskScore =
    typeof deps.handleA2ARiskScore === 'function'
      ? deps.handleA2ARiskScore
      : async (body = {}) => callA2ATaskEndpoint('/api/a2a/tasks/risk-score', body, 'a2a risk-score');

  const handleA2AXReader =
    typeof deps.handleA2AXReader === 'function'
      ? deps.handleA2AXReader
      : async (body = {}) => callA2ATaskEndpoint('/api/a2a/tasks/info', body, 'a2a info');

  app.post('/api/workflow/stop-order/run', requireRole('agent'), async (req, res) => {
    const symbol = String(req.body?.symbol || 'BTC-USDT').trim().toUpperCase();
    const takeProfit = Number(req.body?.takeProfit);
    const stopLoss = Number(req.body?.stopLoss);
    const quantityText = String(req.body?.quantity ?? '').trim();
    const hasQuantity = quantityText !== '';
    const quantity = hasQuantity ? Number(quantityText) : null;
    const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
    const traceId = resolveWorkflowTraceId(req.body?.traceId);
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
    const taskPayload = {
      symbol,
      takeProfit,
      stopLoss,
      ...(hasQuantity ? { quantity } : {})
    };
    const workflow = {
      traceId,
      type: 'stop-order',
      state: 'running',
      sourceAgentId,
      targetAgentId,
      payer,
      input: taskPayload,
      requestId: '',
      txHash: '',
      userOpHash: '',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    upsertWorkflow(workflow);
    broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });
  
    try {
      if (!symbol || !Number.isFinite(takeProfit) || !Number.isFinite(stopLoss) || takeProfit <= 0 || stopLoss <= 0) {
        throw new Error('Invalid stop-order params. symbol/takeProfit/stopLoss are required.');
      }
      if (hasQuantity && (!Number.isFinite(quantity) || quantity <= 0)) {
        throw new Error('Invalid stop-order params. quantity must be > 0 when provided.');
      }
  
      const challengeResult = await handleA2AStopOrders({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        task: taskPayload
      });
      if (challengeResult.status !== 402) {
        throw new Error(
          challengeResult?.body?.reason ||
            challengeResult?.body?.error ||
            `Expected 402 challenge, got ${challengeResult.status}`
        );
      }
      const challenge = challengeResult.body?.x402;
      const requestId = String(challenge?.requestId || '').trim();
      const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
      if (!requestId || !accept?.tokenAddress || !accept?.recipient || !accept?.amount) {
        throw new Error('Malformed x402 challenge payload.');
      }
      workflow.requestId = requestId;
      appendWorkflowStep(workflow, 'challenge_issued', 'ok', {
        requestId,
        amount: accept.amount,
        recipient: accept.recipient
      });
      broadcastEvent('challenge_issued', {
        traceId,
        requestId,
        amount: accept.amount,
        recipient: accept.recipient,
        symbol,
        takeProfit,
        stopLoss,
        ...(hasQuantity ? { quantity } : {})
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      let payBody = {};
      try {
        const pay = await postSessionPayWithRetry(
          {
            tokenAddress: accept.tokenAddress,
            recipient: accept.recipient,
            amount: accept.amount,
            payer,
            requestId,
            action: 'reactive-stop-orders',
            query: `A2A stop-order ${symbol} tp=${takeProfit} sl=${stopLoss}${
              hasQuantity ? ` qty=${quantity}` : ''
            }`
          },
          { maxAttempts: 5, timeoutMs: 210_000 }
        );
        payBody = pay.body || {};
      } catch (error) {
        payBody = error?.payBody || {};
        const payError = String(payBody?.error || '').trim().toLowerCase();
        if (payError === 'insufficient_funds') {
          const required = String(payBody?.details?.required || accept.amount || '').trim();
          const balance = String(payBody?.details?.balance || '').trim();
          const err = new Error(
            `Insufficient balance: requires ${required || accept.amount} USDT, current balance ${balance || 'unknown'}.`
          );
          err.code = 'insufficient_funds';
          err.required = required || String(accept.amount || '');
          err.balance = balance || '';
          throw err;
        }
        if (payError === 'insufficient_kite_gas') {
          const requiredGas = String(payBody?.details?.required || '0.0001').trim();
          const gasBalance = String(payBody?.details?.balance || '').trim();
          const err = new Error(
            `Insufficient KITE gas: requires >= ${requiredGas} KITE, current balance ${gasBalance || 'unknown'}.`
          );
          err.code = 'insufficient_kite_gas';
          err.requiredGas = requiredGas;
          err.balance = gasBalance || '';
          throw err;
        }
        if (payError === 'unsupported_settlement_token' || payError === 'invalid_token_contract') {
          const err = new Error(payBody?.reason || 'Settlement token config is invalid.');
          err.code = payError;
          throw err;
        }
        if (payError === 'session_not_found' || payError === 'session_agent_mismatch' || payError === 'session_rule_failed') {
          const err = new Error(payBody?.reason || payError);
          err.code = payError;
          throw err;
        }
        throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
      }
      const txHash = String(payBody?.payment?.txHash || '').trim();
      const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
      if (!txHash) throw new Error('session pay returned empty txHash.');
      workflow.txHash = txHash;
      workflow.userOpHash = userOpHash;
      appendWorkflowStep(workflow, 'payment_sent', 'ok', {
        txHash,
        userOpHash
      });
      broadcastEvent('payment_sent', {
        traceId,
        requestId,
        txHash,
        userOpHash,
        symbol,
        takeProfit,
        stopLoss,
        ...(hasQuantity ? { quantity } : {})
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const proofResult = await handleA2AStopOrders({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        requestId,
        paymentProof: {
          requestId,
          txHash,
          payer,
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount
        },
        task: taskPayload
      });
      if (proofResult.status !== 200) {
        throw new Error(
          proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
        );
      }
      appendWorkflowStep(workflow, 'proof_submitted', 'ok', {
        verified: true
      });
      broadcastEvent('proof_submitted', { traceId, requestId, verified: true });
      appendWorkflowStep(workflow, 'unlocked', 'ok', {
        result: proofResult?.body?.result?.summary || ''
      });
      broadcastEvent('unlocked', {
        traceId,
        requestId,
        txHash,
        summary: proofResult?.body?.result?.summary || '',
        symbol,
        takeProfit,
        stopLoss,
        ...(hasQuantity ? { quantity } : {})
      });
      workflow.state = 'unlocked';
      workflow.result = proofResult?.body?.result || null;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      return res.json({
        ok: true,
        traceId,
        requestId,
        txHash,
        userOpHash,
        state: workflow.state,
        workflow,
        receipt: proofResult?.body?.receipt || null
      });
    } catch (error) {
      appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
      broadcastEvent('failed', {
        traceId,
        state: 'failed',
        reason: error.message,
        code: error?.code || 'workflow_failed',
        required: error?.required || '',
        balance: error?.balance || ''
      });
      workflow.state = 'failed';
      workflow.error = error.message;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
      return res.status(500).json({
        ok: false,
        traceId,
        state: workflow.state,
        error: 'workflow_failed',
        reason: error.message,
        workflow,
        receipt:
          workflow.requestId && workflow.sourceAgentId && workflow.targetAgentId
            ? buildA2AReceipt(
                {
                  requestId: workflow.requestId,
                  status: 'pending',
                  action: 'reactive-stop-orders',
                  query: `A2A stop-order ${workflow?.input?.symbol || ''}`.trim(),
                  payer: workflow.payer || '',
                  amount: '',
                  tokenAddress: SETTLEMENT_TOKEN,
                  recipient: KITE_AGENT2_AA_ADDRESS,
                  paymentTxHash: workflow.txHash || '',
                  a2a: {
                    sourceAgentId: workflow.sourceAgentId,
                    targetAgentId: workflow.targetAgentId,
                    taskType: 'reactive-stop-orders',
                    traceId
                  }
                },
                workflow,
                { state: 'failed', phase: 'failed', error: error.message, traceId }
              )
            : null
      });
    }
  });
  
  app.post('/api/workflow/btc-price/run', requireRole('agent'), async (req, res) => {
    const pair = String(req.body?.pair || 'BTCUSDT').trim().toUpperCase();
    const source = String(req.body?.source || 'auto').trim().toLowerCase();
    const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
    const traceId = resolveWorkflowTraceId(req.body?.traceId);
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
    const workflow = {
      traceId,
      type: 'btc-price',
      state: 'running',
      sourceAgentId,
      targetAgentId,
      payer,
      input: { pair, source },
      requestId: '',
      txHash: '',
      userOpHash: '',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    upsertWorkflow(workflow);
    broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });
  
    try {
      const challengeResult = await handleA2ABtcPrice({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        task: { pair, source }
      });
      if (challengeResult.status !== 402) {
        throw new Error(
          challengeResult?.body?.reason ||
            challengeResult?.body?.error ||
            `Expected 402 challenge, got ${challengeResult.status}`
        );
      }
      const challenge = challengeResult.body?.x402;
      const requestId = String(challenge?.requestId || '').trim();
      const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
      if (!requestId || !accept?.tokenAddress || !accept?.recipient || !accept?.amount) {
        throw new Error('Malformed x402 challenge payload.');
      }
      workflow.requestId = requestId;
      appendWorkflowStep(workflow, 'challenge_issued', 'ok', {
        requestId,
        amount: accept.amount,
        recipient: accept.recipient
      });
      broadcastEvent('challenge_issued', {
        traceId,
        requestId,
        amount: accept.amount,
        recipient: accept.recipient,
        pair,
        source
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      let payBody = {};
      try {
        const pay = await postSessionPayWithRetry(
          {
            tokenAddress: accept.tokenAddress,
            recipient: accept.recipient,
            amount: accept.amount,
            payer,
            requestId,
            action: 'btc-price-feed',
          query: `ATAPI BTC price ${pair} source=${source}`
          },
          { maxAttempts: 5, timeoutMs: 210_000 }
        );
        payBody = pay.body || {};
      } catch (error) {
        payBody = error?.payBody || {};
        const payError = String(payBody?.error || '').trim().toLowerCase();
        if (payError === 'insufficient_funds') {
          const required = String(payBody?.details?.required || accept.amount || '').trim();
          const balance = String(payBody?.details?.balance || '').trim();
          const err = new Error(
            `Insufficient balance: requires ${required || accept.amount} USDT, current balance ${balance || 'unknown'}.`
          );
          err.code = 'insufficient_funds';
          err.required = required || String(accept.amount || '');
          err.balance = balance || '';
          throw err;
        }
        if (payError === 'insufficient_kite_gas') {
          const requiredGas = String(payBody?.details?.required || '0.0001').trim();
          const gasBalance = String(payBody?.details?.balance || '').trim();
          const err = new Error(
            `Insufficient KITE gas: requires >= ${requiredGas} KITE, current balance ${gasBalance || 'unknown'}.`
          );
          err.code = 'insufficient_kite_gas';
          err.requiredGas = requiredGas;
          err.balance = gasBalance || '';
          throw err;
        }
        throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
      }
      const txHash = String(payBody?.payment?.txHash || '').trim();
      const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
      if (!txHash) throw new Error('session pay returned empty txHash.');
      workflow.txHash = txHash;
      workflow.userOpHash = userOpHash;
      appendWorkflowStep(workflow, 'payment_sent', 'ok', { txHash, userOpHash });
      broadcastEvent('payment_sent', {
        traceId,
        requestId,
        txHash,
        userOpHash,
        pair,
        source
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const proofResult = await handleA2ABtcPrice({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        requestId,
        paymentProof: {
          requestId,
          txHash,
          payer,
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount
        },
        task: { pair, source }
      });
      if (proofResult.status !== 200) {
        throw new Error(
          proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
        );
      }
      appendWorkflowStep(workflow, 'proof_submitted', 'ok', { verified: true });
      broadcastEvent('proof_submitted', { traceId, requestId, verified: true });
      appendWorkflowStep(workflow, 'unlocked', 'ok', {
        result: proofResult?.body?.result?.summary || ''
      });
      broadcastEvent('unlocked', {
        traceId,
        requestId,
        txHash,
        summary: proofResult?.body?.result?.summary || '',
        quote: proofResult?.body?.result?.quote || null,
        pair,
        source
      });
      workflow.state = 'unlocked';
      workflow.result = proofResult?.body?.result || null;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      return res.json({
        ok: true,
        traceId,
        requestId,
        txHash,
        userOpHash,
        state: workflow.state,
        workflow,
        receipt: proofResult?.body?.receipt || null
      });
    } catch (error) {
      appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
      broadcastEvent('failed', {
        traceId,
        state: 'failed',
        reason: error.message,
        code: error?.code || 'workflow_failed'
      });
      workflow.state = 'failed';
      workflow.error = error.message;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
      return res.status(500).json({
        ok: false,
        traceId,
        state: workflow.state,
        error: 'workflow_failed',
        reason: error.message,
        workflow,
        receipt:
          workflow.requestId && workflow.sourceAgentId && workflow.targetAgentId
            ? buildA2AReceipt(
                {
                  requestId: workflow.requestId,
                  status: 'pending',
                  action: 'btc-price-feed',
                  query: `ATAPI BTC price ${workflow?.input?.pair || 'BTCUSDT'}`.trim(),
                  payer: workflow.payer || '',
                  amount: String(X402_BTC_PRICE || ''),
                  tokenAddress: SETTLEMENT_TOKEN,
                  recipient: KITE_AGENT2_AA_ADDRESS,
                  paymentTxHash: workflow.txHash || '',
                  a2a: {
                    sourceAgentId: workflow.sourceAgentId,
                    targetAgentId: workflow.targetAgentId,
                    taskType: 'btc-price-feed',
                    traceId
                  }
                },
                workflow,
                { state: 'failed', phase: 'failed', error: error.message, traceId }
              )
            : null
      });
    }
  });
  
  app.post('/api/workflow/risk-score/run', requireRole('agent'), async (req, res) => {
    let normalizedTask = null;
    try {
      normalizedTask = normalizeRiskScoreParams({
        symbol: req.body?.symbol || req.body?.pair || 'BTCUSDT',
        source: req.body?.source || 'hyperliquid',
        horizonMin: req.body?.horizonMin ?? 60
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_task',
        reason: error?.message || 'invalid task'
      });
    }
  
    const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
    const prebindOnly = parseBooleanFlag(req.body?.prebindOnly, false);
    const requestedAction = String(req.body?.action || 'risk-score-feed').trim().toLowerCase();
    const workflowAction = requestedAction === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed';
    const workflowActionCfg = getActionConfig(workflowAction) || getActionConfig('risk-score-feed');
    const traceId = resolveWorkflowTraceId(req.body?.traceId);
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
    const workflow = {
      traceId,
      type: 'risk-score',
      state: 'running',
      sourceAgentId,
      targetAgentId,
      payer,
      input: normalizedTask,
      requestId: '',
      txHash: '',
      userOpHash: '',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    upsertWorkflow(workflow);
    broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });
  
    try {
      const challengeResult = await handleA2ARiskScore({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        action: workflowAction,
        task: normalizedTask
      });
      if (challengeResult.status !== 402) {
        throw new Error(
          challengeResult?.body?.reason ||
            challengeResult?.body?.error ||
            `Expected 402 challenge, got ${challengeResult.status}`
        );
      }
      const challenge = challengeResult.body?.x402;
      const requestId = String(challenge?.requestId || '').trim();
      const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
      if (!requestId || !accept?.tokenAddress || !accept?.recipient || !accept?.amount) {
        throw new Error('Malformed x402 challenge payload.');
      }
      workflow.requestId = requestId;
      appendWorkflowStep(workflow, 'challenge_issued', 'ok', {
        requestId,
        amount: accept.amount,
        recipient: accept.recipient
      });
      broadcastEvent('challenge_issued', {
        traceId,
        requestId,
        amount: accept.amount,
        recipient: accept.recipient,
        symbol: normalizedTask.symbol,
        horizonMin: normalizedTask.horizonMin
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      let payBody = {};
      try {
        const pay = await postSessionPayWithRetry(
          {
            tokenAddress: accept.tokenAddress,
            recipient: accept.recipient,
            amount: accept.amount,
            payer,
            requestId,
            action: workflowAction,
            query: `A2A risk-score ${normalizedTask.symbol} horizon=${normalizedTask.horizonMin} source=${normalizedTask.source}`
          },
          { maxAttempts: 5, timeoutMs: 210_000 }
        );
        payBody = pay.body || {};
      } catch (error) {
        payBody = error?.payBody || {};
        throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
      }
      const txHash = String(payBody?.payment?.txHash || '').trim();
      const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
      if (!txHash) throw new Error('session pay returned empty txHash.');
      workflow.txHash = txHash;
      workflow.userOpHash = userOpHash;
      appendWorkflowStep(workflow, 'payment_sent', 'ok', { txHash, userOpHash });
      broadcastEvent('payment_sent', {
        traceId,
        requestId,
        txHash,
        userOpHash,
        symbol: normalizedTask.symbol,
        horizonMin: normalizedTask.horizonMin
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const proofResult = await handleA2ARiskScore({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        action: workflowAction,
        prebindOnly,
        requestId,
        paymentProof: {
          requestId,
          txHash,
          payer,
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount
        },
        task: normalizedTask
      });
      if (proofResult.status !== 200) {
        throw new Error(
          proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
        );
      }
      appendWorkflowStep(workflow, 'proof_submitted', 'ok', { verified: true });
      broadcastEvent('proof_submitted', { traceId, requestId, verified: true });
      appendWorkflowStep(workflow, 'unlocked', 'ok', {
        result: proofResult?.body?.result?.summary || ''
      });
      broadcastEvent('unlocked', {
        traceId,
        requestId,
        txHash,
        summary: proofResult?.body?.result?.summary || '',
        quote: proofResult?.body?.result?.quote || null,
        risk: proofResult?.body?.result?.risk || null,
        symbol: normalizedTask.symbol,
        horizonMin: normalizedTask.horizonMin
      });
      workflow.state = 'unlocked';
      workflow.result = proofResult?.body?.result || null;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      return res.json({
        ok: true,
        traceId,
        requestId,
        txHash,
        userOpHash,
        prebindOnly,
        state: workflow.state,
        workflow,
        receipt: proofResult?.body?.receipt || null
      });
    } catch (error) {
      appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
      broadcastEvent('failed', {
        traceId,
        state: 'failed',
        reason: error.message,
        code: error?.code || 'workflow_failed'
      });
      workflow.state = 'failed';
      workflow.error = error.message;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
      return res.status(500).json({
        ok: false,
        traceId,
        state: workflow.state,
        error: 'workflow_failed',
        reason: error.message,
        workflow,
        receipt:
          workflow.requestId && workflow.sourceAgentId && workflow.targetAgentId
            ? buildA2AReceipt(
                {
                  requestId: workflow.requestId,
                  status: 'pending',
                  action: workflowAction,
                  query: `A2A risk-score ${workflow?.input?.symbol || 'BTCUSDT'} horizon=${workflow?.input?.horizonMin || 60}`.trim(),
                  payer: workflow.payer || '',
                  amount: String(workflowActionCfg?.amount || X402_RISK_SCORE_PRICE || ''),
                  tokenAddress: SETTLEMENT_TOKEN,
                  recipient: String(workflowActionCfg?.recipient || resolveTechnicalSettlementRecipient()).trim(),
                  paymentTxHash: workflow.txHash || '',
                  a2a: {
                    sourceAgentId: workflow.sourceAgentId,
                    targetAgentId: workflow.targetAgentId,
                    taskType: workflowAction,
                    traceId
                  }
                },
                workflow,
                { state: 'failed', phase: 'failed', error: error.message, traceId }
              )
            : null
      });
    }
  });
  
  app.post('/api/workflow/info/run', requireRole('agent'), async (req, res) => {
    let normalizedTask = null;
    try {
      normalizedTask = normalizeXReaderParams({
        url: req.body?.url || req.body?.resourceUrl || req.body?.targetUrl,
        topic: req.body?.topic || req.body?.query || req.body?.keyword,
        mode: req.body?.mode || req.body?.source || 'auto',
        maxChars: req.body?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_task',
        reason: error?.message || 'invalid task'
      });
    }
  
    const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
    const prebindOnly = parseBooleanFlag(req.body?.prebindOnly, false);
    const workflowAction = 'info-analysis-feed';
    const workflowActionCfg = getActionConfig(workflowAction) || getActionConfig('info-analysis-feed');
    const traceId = resolveWorkflowTraceId(req.body?.traceId);
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
    const workflow = {
      traceId,
      type: 'info-analysis',
      state: 'running',
      sourceAgentId,
      targetAgentId,
      payer,
      input: normalizedTask,
      requestId: '',
      txHash: '',
      userOpHash: '',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    upsertWorkflow(workflow);
    broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });
  
    try {
      const challengeResult = await handleA2AXReader({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        action: workflowAction,
        task: normalizedTask
      });
      if (challengeResult.status !== 402) {
        throw new Error(
          challengeResult?.body?.reason ||
            challengeResult?.body?.error ||
            `Expected 402 challenge, got ${challengeResult.status}`
        );
      }
      const challenge = challengeResult.body?.x402;
      const requestId = String(challenge?.requestId || '').trim();
      const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
      if (!requestId || !accept?.tokenAddress || !accept?.recipient || !accept?.amount) {
        throw new Error('Malformed x402 challenge payload.');
      }
      workflow.requestId = requestId;
      appendWorkflowStep(workflow, 'challenge_issued', 'ok', {
        requestId,
        amount: accept.amount,
        recipient: accept.recipient
      });
      broadcastEvent('challenge_issued', {
        traceId,
        requestId,
        amount: accept.amount,
        recipient: accept.recipient,
        url: normalizedTask.url
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      let payBody = {};
      try {
        const pay = await postSessionPayWithRetry(
          {
            tokenAddress: accept.tokenAddress,
            recipient: accept.recipient,
            amount: accept.amount,
            payer,
            requestId,
            action: workflowAction,
            query: `ATAPI x-reader ${normalizedTask.url}`
          },
          { maxAttempts: 5, timeoutMs: 210_000 }
        );
        payBody = pay.body || {};
      } catch (error) {
        payBody = error?.payBody || {};
        throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
      }
      const txHash = String(payBody?.payment?.txHash || '').trim();
      const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
      if (!txHash) throw new Error('session pay returned empty txHash.');
      workflow.txHash = txHash;
      workflow.userOpHash = userOpHash;
      appendWorkflowStep(workflow, 'payment_sent', 'ok', { txHash, userOpHash });
      broadcastEvent('payment_sent', {
        traceId,
        requestId,
        txHash,
        userOpHash,
        url: normalizedTask.url
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const proofResult = await handleA2AXReader({
        payer,
        sourceAgentId,
        targetAgentId,
        traceId,
        action: workflowAction,
        prebindOnly,
        requestId,
        paymentProof: {
          requestId,
          txHash,
          payer,
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount
        },
        task: normalizedTask
      });
      if (proofResult.status !== 200) {
        throw new Error(
          proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
        );
      }
      appendWorkflowStep(workflow, 'proof_submitted', 'ok', { verified: true });
      broadcastEvent('proof_submitted', { traceId, requestId, verified: true });
      appendWorkflowStep(workflow, 'unlocked', 'ok', {
        result: proofResult?.body?.result?.summary || ''
      });
      broadcastEvent('unlocked', {
        traceId,
        requestId,
        txHash,
        summary: proofResult?.body?.result?.summary || '',
        reader: proofResult?.body?.result?.reader || null,
        url: normalizedTask.url
      });
      workflow.state = 'unlocked';
      workflow.result = proofResult?.body?.result || null;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      return res.json({
        ok: true,
        traceId,
        requestId,
        txHash,
        userOpHash,
        prebindOnly,
        state: workflow.state,
        workflow,
        receipt: proofResult?.body?.receipt || null
      });
    } catch (error) {
      appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
      broadcastEvent('failed', {
        traceId,
        state: 'failed',
        reason: error.message,
        code: error?.code || 'workflow_failed'
      });
      workflow.state = 'failed';
      workflow.error = error.message;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
      return res.status(500).json({
        ok: false,
        traceId,
        state: workflow.state,
        error: 'workflow_failed',
        reason: error.message,
        workflow,
        receipt:
          workflow.requestId && workflow.sourceAgentId && workflow.targetAgentId
            ? buildA2AReceipt(
                {
                  requestId: workflow.requestId,
                  status: 'pending',
                  action: workflowAction,
                  query: `ATAPI x-reader ${workflow?.input?.url || ''}`.trim(),
                  payer: workflow.payer || '',
                  amount: String(workflowActionCfg?.amount || X402_X_READER_PRICE || ''),
                  tokenAddress: SETTLEMENT_TOKEN,
                  recipient: String(workflowActionCfg?.recipient || resolveInfoSettlementRecipient()).trim(),
                  paymentTxHash: workflow.txHash || '',
                  a2a: {
                    sourceAgentId: workflow.sourceAgentId,
                    targetAgentId: workflow.targetAgentId,
                    taskType: workflowAction,
                    traceId
                  }
                },
                workflow,
                { state: 'failed', phase: 'failed', error: error.message, traceId }
              )
            : null
      });
    }
  });
  
  app.post('/api/workflow/hyperliquid-order/run', requireRole('agent'), async (req, res) => {
    const symbol = String(req.body?.symbol || req.body?.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
    const side = String(req.body?.side || '').trim().toLowerCase();
    const orderType = String(req.body?.orderType || req.body?.type || 'limit').trim().toLowerCase() || 'limit';
    const tif = String(req.body?.tif || 'Gtc').trim() || 'Gtc';
    const size = Number(req.body?.size ?? req.body?.sz ?? NaN);
    const price = Number(req.body?.price ?? NaN);
    const reduceOnly = req.body?.reduceOnly === true || String(req.body?.reduceOnly || '').trim().toLowerCase() === 'true';
    const sourceAgentId = String(req.body?.sourceAgentId || 'router-agent').trim();
    const targetAgentId = String(req.body?.targetAgentId || 'executor-agent').trim();
    const traceId = resolveWorkflowTraceId(req.body?.traceId);
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
    const tokenAddress = normalizeAddress(req.body?.tokenAddress || SETTLEMENT_TOKEN);
    const recipient = normalizeAddress(req.body?.recipient || HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS);
    const amount = String(req.body?.amount || X402_HYPERLIQUID_ORDER_PRICE).trim();
    const bindRealX402 = parseBooleanFlag(req.body?.bindRealX402, true);
    const strictBinding = parseBooleanFlag(req.body?.strictBinding, true);
    const simulate = req.body?.simulate === true || req.body?.dryRun === true;
  
    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ ok: false, error: 'invalid_side', reason: 'side must be buy/sell' });
    }
    if (!['limit', 'market'].includes(orderType)) {
      return res.status(400).json({ ok: false, error: 'invalid_order_type', reason: 'orderType must be limit/market' });
    }
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_size', reason: 'size must be a positive number' });
    }
    if (orderType === 'limit' && (!Number.isFinite(price) || price <= 0)) {
      return res.status(400).json({ ok: false, error: 'invalid_price', reason: 'limit order requires positive price' });
    }
    if (!tokenAddress || !recipient) {
      return res.status(400).json({ ok: false, error: 'invalid_settlement_target', reason: 'tokenAddress/recipient invalid' });
    }
    if (!bindRealX402 || !strictBinding) {
      return res.status(400).json({
        ok: false,
        error: 'x402_strict_required',
        reason: 'hyperliquid-order workflow requires bindRealX402=true and strictBinding=true.'
      });
    }
  
    const workflow = {
      traceId,
      type: 'hyperliquid-order',
      state: 'running',
      sourceAgentId,
      targetAgentId,
      payer,
      input: {
        symbol,
        side,
        orderType,
        tif,
        size,
        price: Number.isFinite(price) ? price : null,
        reduceOnly,
        simulate
      },
      requestId: '',
      txHash: '',
      userOpHash: '',
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    upsertWorkflow(workflow);
    broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });
  
    try {
      const challengeResp = await fetch(`http://127.0.0.1:${PORT}/api/x402/transfer-intent`, {
        method: 'POST',
        headers: buildInternalAgentHeaders(),
        body: JSON.stringify({
          payer,
          recipient,
          amount,
          tokenAddress,
          action: 'hyperliquid-order-testnet',
          query: `ATAPI hyperliquid order ${symbol} ${side} ${orderType} size=${size}`,
          identity: req.body?.identity && typeof req.body.identity === 'object' ? req.body.identity : {}
        })
      });
      const challengeBody = await challengeResp.json().catch(() => ({}));
      if (challengeResp.status !== 402) {
        throw new Error(
          challengeBody?.reason || challengeBody?.error || `Expected 402 challenge, got ${challengeResp.status}`
        );
      }
      const challenge = challengeBody?.x402;
      const requestId = String(challenge?.requestId || '').trim();
      const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
      if (!requestId || !accept?.tokenAddress || !accept?.recipient || !accept?.amount) {
        throw new Error('Malformed x402 challenge payload.');
      }
      workflow.requestId = requestId;
      appendWorkflowStep(workflow, 'challenge_issued', 'ok', {
        requestId,
        amount: accept.amount,
        recipient: accept.recipient
      });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const pay = await postSessionPayWithRetry(
        {
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount,
          payer,
          requestId,
          action: 'hyperliquid-order-testnet',
          query: `ATAPI hyperliquid order ${symbol} ${side} ${orderType} size=${size}`
        },
        { maxAttempts: 5, timeoutMs: 210_000 }
      );
      const payBody = pay.body || {};
      const txHash = String(payBody?.payment?.txHash || '').trim();
      const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
      if (!txHash) throw new Error('session pay returned empty txHash.');
      workflow.txHash = txHash;
      workflow.userOpHash = userOpHash;
      appendWorkflowStep(workflow, 'payment_sent', 'ok', { txHash, userOpHash });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const proofResp = await fetch(`http://127.0.0.1:${PORT}/api/x402/transfer-intent`, {
        method: 'POST',
        headers: buildInternalAgentHeaders(),
        body: JSON.stringify({
          requestId,
          paymentProof: {
            requestId,
            txHash,
            payer,
            tokenAddress: accept.tokenAddress,
            recipient: accept.recipient,
            amount: accept.amount
          }
        })
      });
      const proofBody = await proofResp.json().catch(() => ({}));
      if (!proofResp.ok || proofBody?.ok === false) {
        throw new Error(proofBody?.reason || proofBody?.error || `proof submit failed: ${proofResp.status}`);
      }
      appendWorkflowStep(workflow, 'proof_submitted', 'ok', { verified: true });
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
  
      const orderResult = await hyperliquidAdapter.placePerpOrder({
        symbol,
        side,
        orderType,
        size,
        ...(orderType === 'limit' ? { price } : {}),
        tif,
        reduceOnly,
        simulate
      });
      appendWorkflowStep(workflow, 'unlocked', 'ok', {
        result: `Hyperliquid ${orderType} ${side} ${symbol} executed`
      });
      workflow.state = 'unlocked';
      workflow.result = {
        summary: `Hyperliquid ${orderType} ${side} ${symbol} executed`,
        order: orderResult
      };
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
      const evidence = resolveX402EvidenceByRequestId(requestId);
      return res.json({
        ok: true,
        traceId,
        requestId,
        txHash,
        userOpHash,
        state: workflow.state,
        workflow,
        payment: evidence
          ? {
              mode: 'x402',
              requestId: evidence.requestId,
              txHash: evidence.txHash,
              block: evidence.block,
              status: evidence.status,
              explorer: evidence.explorer,
              verifiedAt: evidence.verifiedAt
            }
          : null,
        receiptRef: evidence?.receiptRef || null,
        orderResult
      });
    } catch (error) {
      appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
      workflow.state = 'failed';
      workflow.error = error.message;
      workflow.updatedAt = new Date().toISOString();
      upsertWorkflow(workflow);
      const evidence = workflow.requestId ? resolveX402EvidenceByRequestId(workflow.requestId) : null;
      return res.status(500).json({
        ok: false,
        traceId,
        state: workflow.state,
        error: 'workflow_failed',
        reason: error.message,
        workflow,
        payment: evidence
          ? {
              mode: 'x402',
              requestId: evidence.requestId,
              txHash: evidence.txHash,
              block: evidence.block,
              status: evidence.status,
              explorer: evidence.explorer,
              verifiedAt: evidence.verifiedAt
            }
          : null,
        receiptRef: evidence?.receiptRef || null
      });
    }
  });
  
  app.get('/api/workflow/:traceId', requireRole('viewer'), (req, res) => {
    const traceId = String(req.params.traceId || '').trim();
    if (!traceId) {
      return res.status(400).json({ ok: false, error: 'traceId_required' });
    }
    const rows = readWorkflows();
    const workflow = rows.find((w) => String(w.traceId || '') === traceId);
    if (!workflow) {
      return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
    }
    const reqItem = readX402Requests().find((item) => String(item.requestId || '') === String(workflow.requestId || ''));
    return res.json({
      ok: true,
      traceId,
      workflow,
      receipt: reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null
    });
  });
  
  function parseBooleanFlag(value, fallback = false) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return Boolean(fallback);
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return Boolean(fallback);
  }
  
  function buildInternalAgentHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    const key = String(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER || '').trim();
    if (key) {
      headers['x-api-key'] = key;
    }
    return headers;
  }
  
  async function fetchJsonResponseWithTimeout(
    url,
    { method = 'GET', headers = {}, body = undefined, timeoutMs = 30_000, label = 'request' } = {}
  ) {
    const resolvedTimeout = Math.max(3_000, Math.min(Number(timeoutMs) || 30_000, 300_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolvedTimeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    } catch (error) {
      if (String(error?.name || '').trim() === 'AbortError') {
        throw new Error(`${label} timeout after ${resolvedTimeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  
  function shouldRetryAgent001PrebindReason(reason = '') {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return false;
    if (shouldRetrySessionPayReason(text)) return true;
    return (
      text.includes('eth_estimateuseroperationgas') ||
      text.includes('reverted') ||
      text.includes('bundler') ||
      text.includes('replacement fee too low') ||
      text.includes('replacement transaction underpriced')
    );
  }
  
  async function runAgent001PrebindWorkflowWithRetry({
    endpoint = '',
    payload = {},
    label = 'agent001 prebind'
  } = {}) {
    const url = `http://127.0.0.1:${PORT}${String(endpoint || '').trim()}`;
    const maxAttempts = Math.max(1, Math.min(Number(process.env.AGENT001_PREBIND_RETRIES || 5), 5));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { response, payload: body } = await fetchJsonResponseWithTimeout(url, {
          method: 'POST',
          headers: buildInternalAgentHeaders(),
          timeoutMs: AGENT001_BIND_TIMEOUT_MS,
          label,
          body: JSON.stringify(payload)
        });
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.reason || body?.error || `${label} failed: HTTP ${response.status}`);
        }
        return { body, attempt, attempts: attempt };
      } catch (error) {
        const reason = String(error?.message || 'agent001_prebind_failed').trim();
        const retryable = shouldRetryAgent001PrebindReason(reason);
        lastError = new Error(reason || 'agent001_prebind_failed');
        lastError.attempt = attempt;
        lastError.retryable = retryable;
        if (!retryable || attempt >= maxAttempts) break;
        await waitMs(1200 * attempt);
      }
    }
    throw lastError || new Error('agent001_prebind_failed');
  }

  function parseWorkflowSortTimestamp(row = null) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 0;
    const candidates = [row.updatedAt, row.createdAt, row.completedAt, row.startedAt];
    for (const candidate of candidates) {
      if (Number.isFinite(Number(candidate)) && Number(candidate) > 0) {
        return Number(candidate);
      }
      const parsed = Date.parse(String(candidate || '').trim());
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function buildLatestWorkflowByRequestIdLocal(rows = []) {
    if (typeof deps.buildLatestWorkflowByRequestId === 'function') {
      try {
        const externalMap = deps.buildLatestWorkflowByRequestId(rows);
        if (externalMap instanceof Map) return externalMap;
      } catch {
        // fallback to local map builder
      }
    }
    const list = Array.isArray(rows) ? rows : [];
    const map = new Map();
    for (const item of list) {
      const reqId = String(item?.requestId || '').trim();
      if (!reqId) continue;
      const previous = map.get(reqId) || null;
      if (!previous) {
        map.set(reqId, item);
        continue;
      }
      const currentTs = parseWorkflowSortTimestamp(item);
      const previousTs = parseWorkflowSortTimestamp(previous);
      if (currentTs >= previousTs) map.set(reqId, item);
    }
    return map;
  }
  
  function resolveX402EvidenceByRequestId(requestId = '', workflowByRequestId = null) {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) return null;
    const reqItem =
      readX402Requests().find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
    if (!reqItem) return null;
  
    const workflowLookup =
      workflowByRequestId instanceof Map ? workflowByRequestId : buildLatestWorkflowByRequestIdLocal(readWorkflows());
    const workflow = workflowLookup.get(normalizedRequestId) || null;
    const txHash = String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim();
    const blockRaw = reqItem?.proofVerification?.details?.blockNumber;
    const block = Number.isFinite(Number(blockRaw)) ? Number(blockRaw) : null;
    const proofStatus =
      reqItem?.proofVerification
        ? 'success'
        : ['failed', 'error', 'expired', 'rejected'].includes(String(reqItem?.status || '').trim().toLowerCase())
          ? 'failed'
          : 'pending';
    const explorer = txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : '';
    const verifiedAtRaw = Number(reqItem?.proofVerification?.verifiedAt || 0);
    const verifiedAt = verifiedAtRaw > 0 ? new Date(verifiedAtRaw).toISOString() : '';
    return {
      mode: reqItem?.proofVerification ? 'x402' : 'mock',
      requestId: normalizedRequestId,
      txHash,
      block,
      status: proofStatus,
      explorer,
      verifiedAt,
      receiptRef: {
        requestId: normalizedRequestId,
        txHash,
        block,
        status: proofStatus,
        explorer,
        verifiedAt,
        endpoint: `/api/receipt/${normalizedRequestId}`
      }
    };
  }
  
  function hasStrictX402Evidence(payment = null) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return false;
    const requestId = String(payment.requestId || '').trim();
    const txHash = String(payment.txHash || '').trim();
    if (!requestId || !txHash) return false;
    if (txHash.toLowerCase().startsWith('mock_')) return false;
    return true;
  }
  
  function resolveAgent001CapabilityByAction(action = '') {
    const normalized = String(action || '').trim().toLowerCase();
    if (normalized === 'risk-score-feed' || normalized === 'technical-analysis-feed') return 'technical-analysis-feed';
    if (normalized === 'x-reader-feed' || normalized === 'info-analysis-feed') return 'info-analysis-feed';
    if (normalized === 'hyperliquid-order-testnet') return 'hyperliquid-order-testnet';
    return '';
  }
  
  async function computeAgent001PaidResult({
    capability = '',
    input = {},
    traceId = ''
  } = {}) {
    const normalizedCapability = String(capability || '').trim().toLowerCase();
    if (normalizedCapability === 'technical-analysis-feed') {
      const task = normalizeRiskScoreParams({
        symbol: input?.symbol || input?.pair || 'BTCUSDT',
        source: input?.source || 'hyperliquid',
        horizonMin: input?.horizonMin ?? 60
      });
      return runRiskScoreAnalysis({
        ...task,
        traceId
      });
    }
    if (normalizedCapability === 'info-analysis-feed') {
      const task = normalizeXReaderParams({
        url: input?.url || input?.resourceUrl || '',
        topic: input?.topic || input?.query || input?.keyword || '',
        mode: input?.mode || input?.source || 'auto',
        maxChars: input?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
      });
      const info = await runInfoAnalysis({
        ...task,
        traceId
      });
      return {
        summary: String(info?.summary || '').trim(),
        info,
        analysisType: 'info'
      };
    }
    if (normalizedCapability === 'hyperliquid-order-testnet') {
      return {
        summary: 'hyperliquid-order-testnet result is not recomputable; use stored workflow/order result.',
        analysisType: 'order',
        recomputable: false
      };
    }
    throw new Error(`unsupported_agent001_capability:${normalizedCapability || 'unknown'}`);
  }
  
  async function resolveAgent001ResultByRequestId(requestId = '') {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) {
      return {
        ok: false,
        statusCode: 400,
        error: 'requestId_required',
        reason: 'requestId is required'
      };
    }
    const rows = readAgent001Results();
    const existing =
      rows.find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
    const requests = readX402Requests();
    const reqItem =
      requests.find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
    if (!existing && !reqItem) {
      return {
        ok: false,
        statusCode: 404,
        error: 'agent001_result_not_found',
        reason: 'No AGENT001 paid result record found for requestId.',
        requestId: normalizedRequestId
      };
    }
    const evidence = resolveX402EvidenceByRequestId(normalizedRequestId);
    if (!evidence?.txHash) {
      return {
        ok: false,
        statusCode: 409,
        error: 'payment_not_verified',
        reason: 'x402 payment is not verified yet for this requestId.',
        requestId: normalizedRequestId
      };
    }
  
    const capability =
      String(existing?.capability || '').trim().toLowerCase() ||
      resolveAgent001CapabilityByAction(reqItem?.action || '');
    if (!capability) {
      return {
        ok: false,
        statusCode: 400,
        error: 'capability_unknown',
        reason: 'Cannot resolve capability by requestId.',
        requestId: normalizedRequestId,
        payment: evidence
      };
    }
    if (
      existing?.result &&
      typeof existing.result === 'object' &&
      !Array.isArray(existing.result) &&
      String(existing?.status || '').trim().toLowerCase() === 'done'
    ) {
      return {
        ok: true,
        requestId: normalizedRequestId,
        capability,
        status: 'done',
        source: 'stored',
        payment: evidence,
        receiptRef: evidence.receiptRef || null,
        result: existing.result,
        dm: existing?.dm || null,
        error: String(existing?.error || '').trim(),
        reason: String(existing?.reason || '').trim()
      };
    }
  
    const taskInput =
      existing?.input && typeof existing.input === 'object' && !Array.isArray(existing.input)
        ? existing.input
        : reqItem?.actionParams && typeof reqItem.actionParams === 'object' && !Array.isArray(reqItem.actionParams)
          ? reqItem.actionParams
          : {};
    const computed = await computeAgent001PaidResult({
      capability,
      input: taskInput,
      traceId: createTraceId('agent001_pull')
    });
    const saved = upsertAgent001ResultRecord({
      requestId: normalizedRequestId,
      capability,
      status: 'done',
      stage: 'request_pull',
      input: taskInput,
      payment: {
        mode: 'x402',
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        verifiedAt: evidence.verifiedAt
      },
      receiptRef: evidence.receiptRef || null,
      result: computed,
      source: 'request_pull',
      dm: existing?.dm || null
    });
    return {
      ok: true,
      requestId: normalizedRequestId,
      capability,
      status: 'done',
      source: 'computed',
      payment: evidence,
      receiptRef: evidence.receiptRef || null,
      result: saved?.result || computed,
      dm: saved?.dm || null,
      error: String(saved?.error || '').trim(),
      reason: String(saved?.reason || '').trim()
    };
  }
  
  async function buildRiskScorePaymentIntentForTask({
    body = {},
    traceId = '',
    fallbackRequestId = '',
    defaultTask = { symbol: 'BTCUSDT', source: 'hyperliquid', horizonMin: 60 }
  } = {}) {
    const inputTask =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : defaultTask;
    const normalizedTask = normalizeRiskScoreParams({
      symbol: inputTask?.symbol || inputTask?.pair || defaultTask.symbol || 'BTCUSDT',
      source: inputTask?.source || defaultTask.source || 'hyperliquid',
      horizonMin: inputTask?.horizonMin ?? defaultTask.horizonMin ?? 60
    });
    const rawIntent =
      body?.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
        ? body.paymentIntent
        : {};
    const bindRealX402 = parseBooleanFlag(body?.bindRealX402, false);
    const strictBinding = parseBooleanFlag(body?.strictBinding, false);
    const prebindOnly = parseBooleanFlag(body?.prebindOnly, AGENT001_PREBIND_ONLY);
    const workflowAction =
      String(body?.action || '').trim().toLowerCase() === 'technical-analysis-feed'
        ? 'technical-analysis-feed'
        : 'risk-score-feed';
    const shouldBindRealX402 =
      bindRealX402 ||
      (String(rawIntent?.mode || '').trim().toLowerCase() === 'x402' &&
        (!String(rawIntent?.requestId || '').trim() || !String(rawIntent?.txHash || '').trim()));
  
    let paymentIntent = {
      mode: String(rawIntent?.mode || 'mock').trim().toLowerCase() || 'mock',
      requestId: String(rawIntent?.requestId || fallbackRequestId || '').trim(),
      txHash: String(rawIntent?.txHash || '').trim(),
      block: Number.isFinite(Number(rawIntent?.block)) ? Number(rawIntent.block) : null,
      status: String(rawIntent?.status || '').trim().toLowerCase(),
      explorer: String(rawIntent?.explorer || '').trim(),
      verifiedAt: String(rawIntent?.verifiedAt || '').trim()
    };
  
    const warnings = [];
    let workflowBinding = null;
    if (shouldBindRealX402) {
      try {
        const payload = {
          ...normalizedTask,
          traceId: resolveWorkflowTraceId(body?.paymentTraceId || createTraceId('risk_bind')),
          payer: normalizeAddress(body?.payer || ''),
          sourceAgentId: String(body?.sourceAgentId || KITE_AGENT1_ID).trim(),
          targetAgentId: String(body?.targetAgentId || KITE_AGENT2_ID).trim(),
          action: workflowAction,
          prebindOnly
        };
        const { body: result, attempts } = await runAgent001PrebindWorkflowWithRetry({
          endpoint: '/api/workflow/risk-score/run',
          payload,
          label: 'agent001 risk prebind'
        });
        const boundRequestId = String(result?.requestId || result?.workflow?.requestId || '').trim();
        const evidence = resolveX402EvidenceByRequestId(boundRequestId);
        if (!boundRequestId || !evidence?.txHash) {
          throw new Error('x402 evidence missing after workflow run');
        }
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
        workflowBinding = {
          ok: true,
          traceId: String(result?.traceId || result?.workflow?.traceId || '').trim(),
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          attempts
        };
      } catch (error) {
        const reason = String(error?.message || 'bind_real_x402_failed').trim();
        warnings.push(reason);
        if (strictBinding) {
          throw new Error(reason);
        }
      }
    } else if (paymentIntent.mode === 'x402' && paymentIntent.requestId) {
      const evidence = resolveX402EvidenceByRequestId(paymentIntent.requestId);
      if (evidence?.txHash) {
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
      }
    }
  
    if (!paymentIntent.mode) paymentIntent.mode = 'mock';
    if (!paymentIntent.requestId) paymentIntent.requestId = fallbackRequestId;
    if (paymentIntent.mode === 'x402' && !paymentIntent.txHash) {
      warnings.push('x402 evidence unavailable, fallback to mock payment intent');
      paymentIntent.mode = 'mock';
    }
    if (!paymentIntent.txHash && paymentIntent.mode === 'mock') {
      paymentIntent.txHash = `mock_${taskIdSafeToken(traceId || fallbackRequestId || 'risk')}`;
    }
  
    return {
      paymentIntent,
      normalizedTask,
      workflowBinding,
      warnings
    };
  }
  
  async function buildXReaderPaymentIntentForTask({
    body = {},
    traceId = '',
    fallbackRequestId = '',
    defaultTask = {
      url: 'https://newshacker.me/',
      topic: 'btc market sentiment today',
      mode: 'auto',
      maxChars: X_READER_MAX_CHARS_DEFAULT
    }
  } = {}) {
    const inputTask =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : defaultTask;
    const normalizedTask = normalizeXReaderParams({
      url: inputTask?.url || inputTask?.resourceUrl || '',
      topic:
        inputTask?.topic ||
        inputTask?.query ||
        inputTask?.keyword ||
        defaultTask.topic ||
        '',
      mode: inputTask?.mode || inputTask?.source || defaultTask.mode || 'auto',
      maxChars: inputTask?.maxChars ?? defaultTask.maxChars ?? X_READER_MAX_CHARS_DEFAULT
    });
    const rawIntent =
      body?.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
        ? body.paymentIntent
        : {};
    const bindRealX402 = parseBooleanFlag(body?.bindRealX402, false);
    const strictBinding = parseBooleanFlag(body?.strictBinding, false);
    const prebindOnly = parseBooleanFlag(body?.prebindOnly, AGENT001_PREBIND_ONLY);
    const workflowAction =
      String(body?.action || '').trim().toLowerCase() === 'info-analysis-feed'
        ? 'info-analysis-feed'
        : 'info-analysis-feed';
    const shouldBindRealX402 =
      bindRealX402 ||
      (String(rawIntent?.mode || '').trim().toLowerCase() === 'x402' &&
        (!String(rawIntent?.requestId || '').trim() || !String(rawIntent?.txHash || '').trim()));
  
    let paymentIntent = {
      mode: String(rawIntent?.mode || 'mock').trim().toLowerCase() || 'mock',
      requestId: String(rawIntent?.requestId || fallbackRequestId || '').trim(),
      txHash: String(rawIntent?.txHash || '').trim(),
      block: Number.isFinite(Number(rawIntent?.block)) ? Number(rawIntent.block) : null,
      status: String(rawIntent?.status || '').trim().toLowerCase(),
      explorer: String(rawIntent?.explorer || '').trim(),
      verifiedAt: String(rawIntent?.verifiedAt || '').trim()
    };
  
    const warnings = [];
    let workflowBinding = null;
    if (shouldBindRealX402) {
      try {
        const payload = {
          ...normalizedTask,
          traceId: resolveWorkflowTraceId(body?.paymentTraceId || createTraceId('reader_bind')),
          payer: normalizeAddress(body?.payer || ''),
          sourceAgentId: String(body?.sourceAgentId || KITE_AGENT1_ID).trim(),
          targetAgentId: String(body?.targetAgentId || KITE_AGENT2_ID).trim(),
          action: workflowAction,
          prebindOnly
        };
        const { body: result, attempts } = await runAgent001PrebindWorkflowWithRetry({
          endpoint: '/api/workflow/info/run',
          payload,
          label: 'agent001 info prebind'
        });
        const boundRequestId = String(result?.requestId || result?.workflow?.requestId || '').trim();
        const evidence = resolveX402EvidenceByRequestId(boundRequestId);
        if (!boundRequestId || !evidence?.txHash) {
          throw new Error('x402 evidence missing after workflow run');
        }
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
        workflowBinding = {
          ok: true,
          traceId: String(result?.traceId || result?.workflow?.traceId || '').trim(),
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          attempts
        };
      } catch (error) {
        const reason = String(error?.message || 'bind_real_x402_failed').trim();
        warnings.push(reason);
        if (strictBinding) {
          throw new Error(reason);
        }
      }
    } else if (paymentIntent.mode === 'x402' && paymentIntent.requestId) {
      const evidence = resolveX402EvidenceByRequestId(paymentIntent.requestId);
      if (evidence?.txHash) {
        paymentIntent = {
          mode: 'x402',
          requestId: evidence.requestId,
          txHash: evidence.txHash,
          block: evidence.block,
          status: evidence.status,
          explorer: evidence.explorer,
          verifiedAt: evidence.verifiedAt
        };
      }
    }
  
    if (!paymentIntent.mode) paymentIntent.mode = 'mock';
    if (!paymentIntent.requestId) paymentIntent.requestId = fallbackRequestId;
    if (paymentIntent.mode === 'x402' && !paymentIntent.txHash) {
      warnings.push('x402 evidence unavailable, fallback to mock payment intent');
      paymentIntent.mode = 'mock';
    }
    if (!paymentIntent.txHash && paymentIntent.mode === 'mock') {
      paymentIntent.txHash = `mock_${taskIdSafeToken(traceId || fallbackRequestId || 'reader')}`;
    }
  
    return {
      paymentIntent,
      normalizedTask,
      workflowBinding,
      warnings
    };
  }
  
  async function buildInfoPaymentIntentForTask(options = {}) {
    return buildXReaderPaymentIntentForTask(options);
  }
  
  function taskIdSafeToken(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24);
  }
  
  const XMTP_HOP_DIGEST_FIELDS = Object.freeze([
    'id',
    'createdAt',
    'runtimeName',
    'direction',
    'kind',
    'fromAgentId',
    'toAgentId',
    'channel',
    'hopIndex',
    'traceId',
    'requestId',
    'taskId',
    'conversationId',
    'messageId',
    'status',
    'phase',
    'detail',
    'resultSummary',
    'error',
    'payment.mode',
    'payment.requestId',
    'payment.txHash',
    'payment.block',
    'payment.status',
    'payment.explorer',
    'payment.verifiedAt',
    'receiptRef.requestId',
    'receiptRef.txHash',
    'receiptRef.block',
    'receiptRef.status',
    'receiptRef.explorer',
    'receiptRef.verifiedAt',
    'receiptRef.endpoint'
  ]);
  
  function buildXmtpHopDigestMaterial(hop = {}) {
    const payment = hop?.payment && typeof hop.payment === 'object' && !Array.isArray(hop.payment) ? hop.payment : null;
    const receiptRef =
      hop?.receiptRef && typeof hop.receiptRef === 'object' && !Array.isArray(hop.receiptRef) ? hop.receiptRef : null;
    return {
      id: String(hop?.id || '').trim(),
      createdAt: String(hop?.createdAt || '').trim(),
      runtimeName: String(hop?.runtimeName || '').trim(),
      direction: String(hop?.direction || '').trim().toLowerCase(),
      kind: String(hop?.kind || '').trim().toLowerCase(),
      fromAgentId: String(hop?.fromAgentId || '').trim(),
      toAgentId: String(hop?.toAgentId || '').trim(),
      channel: String(hop?.channel || '').trim(),
      hopIndex: Number.isFinite(Number(hop?.hopIndex)) ? Number(hop.hopIndex) : null,
      traceId: String(hop?.traceId || '').trim(),
      requestId: String(hop?.requestId || '').trim(),
      taskId: String(hop?.taskId || '').trim(),
      conversationId: String(hop?.conversationId || '').trim(),
      messageId: String(hop?.messageId || '').trim(),
      status: String(hop?.status || '').trim().toLowerCase(),
      phase: String(hop?.phase || '').trim().toLowerCase(),
      detail: String(hop?.detail || '').trim(),
      resultSummary: String(hop?.resultSummary || '').trim(),
      error: String(hop?.error || '').trim(),
      payment: payment
        ? {
            mode: String(payment.mode || '').trim().toLowerCase(),
            requestId: String(payment.requestId || '').trim(),
            txHash: String(payment.txHash || '').trim(),
            block: Number.isFinite(Number(payment.block)) ? Number(payment.block) : null,
            status: String(payment.status || '').trim().toLowerCase(),
            explorer: String(payment.explorer || '').trim(),
            verifiedAt: String(payment.verifiedAt || '').trim()
          }
        : null,
      receiptRef: receiptRef
        ? {
            requestId: String(receiptRef.requestId || '').trim(),
            txHash: String(receiptRef.txHash || '').trim(),
            block: Number.isFinite(Number(receiptRef.block)) ? Number(receiptRef.block) : null,
            status: String(receiptRef.status || '').trim().toLowerCase(),
            explorer: String(receiptRef.explorer || '').trim(),
            verifiedAt: String(receiptRef.verifiedAt || '').trim(),
            endpoint: String(receiptRef.endpoint || '').trim()
          }
        : null
    };
  }
  
  function buildTraceXmtpEvidence({ traceId = '', requestId = '', taskId = '' } = {}) {
    const normalizedTraceId = String(traceId || '').trim();
    const normalizedRequestId = String(requestId || '').trim();
    const normalizedTaskId = String(taskId || '').trim();
  
    const query = { limit: 500 };
    if (normalizedTaskId) {
      query.taskId = normalizedTaskId;
    } else if (normalizedTraceId && !normalizedRequestId) {
      query.traceId = normalizedTraceId;
    }
  
    const rows = xmtpRuntime.listEvents(query);
    const allowedKinds = new Set(['task-envelope', 'task-result', 'task-ack', 'task-phase']);
    const hops = (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        const kind = String(row?.kind || '').trim().toLowerCase();
        if (!allowedKinds.has(kind)) return false;
        const parsed = row?.parsed && typeof row.parsed === 'object' && !Array.isArray(row.parsed) ? row.parsed : null;
        const rowTraceId = String(row?.traceId || parsed?.traceId || '').trim();
        const rowTaskId = String(row?.taskId || parsed?.taskId || '').trim();
        const relatedRequestIds = [
          String(row?.requestId || '').trim(),
          String(parsed?.requestId || '').trim(),
          String(parsed?.payment?.requestId || '').trim(),
          String(parsed?.receiptRef?.requestId || '').trim()
        ].filter(Boolean);
  
        if (normalizedTaskId && rowTaskId !== normalizedTaskId) return false;
        if (normalizedTraceId && normalizedRequestId) {
          const traceMatch = rowTraceId === normalizedTraceId;
          const requestMatch = relatedRequestIds.includes(normalizedRequestId);
          if (!traceMatch && !requestMatch) return false;
        } else if (normalizedTraceId && rowTraceId !== normalizedTraceId) {
          return false;
        } else if (normalizedRequestId && !relatedRequestIds.includes(normalizedRequestId)) {
          return false;
        }
        return true;
      })
      .map((row) => {
        const parsed = row?.parsed && typeof row.parsed === 'object' && !Array.isArray(row.parsed) ? row.parsed : null;
        const payment = parsed?.payment && typeof parsed.payment === 'object' && !Array.isArray(parsed.payment) ? parsed.payment : null;
        const receiptRef =
          parsed?.receiptRef && typeof parsed.receiptRef === 'object' && !Array.isArray(parsed.receiptRef)
            ? parsed.receiptRef
            : null;
        const hop = {
          id: String(row?.id || '').trim(),
          createdAt: String(row?.createdAt || '').trim(),
          runtimeName: String(row?.runtimeName || '').trim(),
          direction: String(row?.direction || '').trim().toLowerCase(),
          kind: String(row?.kind || '').trim().toLowerCase(),
          fromAgentId: String(row?.fromAgentId || parsed?.fromAgentId || '').trim(),
          toAgentId: String(row?.toAgentId || parsed?.toAgentId || '').trim(),
          channel: String(row?.channel || parsed?.channel || '').trim(),
          hopIndex: Number.isFinite(Number(row?.hopIndex)) ? Number(row.hopIndex) : null,
          traceId: String(row?.traceId || parsed?.traceId || '').trim(),
          requestId: String(row?.requestId || parsed?.requestId || '').trim(),
          taskId: String(row?.taskId || parsed?.taskId || '').trim(),
          conversationId: String(row?.conversationId || '').trim(),
          messageId: String(row?.messageId || '').trim(),
          status: String(parsed?.status || '').trim().toLowerCase(),
          phase: String(parsed?.phase || '').trim().toLowerCase(),
          detail: String(parsed?.detail || '').trim(),
          resultSummary: String(parsed?.result?.summary || '').trim(),
          error: String(parsed?.error || row?.error || '').trim(),
          payment: payment
            ? {
                mode: String(payment.mode || '').trim().toLowerCase(),
                requestId: String(payment.requestId || '').trim(),
                txHash: String(payment.txHash || '').trim(),
                block: Number.isFinite(Number(payment.block)) ? Number(payment.block) : null,
                status: String(payment.status || '').trim().toLowerCase(),
                explorer: String(payment.explorer || '').trim(),
                verifiedAt: String(payment.verifiedAt || '').trim()
              }
            : null,
          receiptRef: receiptRef
            ? {
                requestId: String(receiptRef.requestId || '').trim(),
                txHash: String(receiptRef.txHash || '').trim(),
                block: Number.isFinite(Number(receiptRef.block)) ? Number(receiptRef.block) : null,
                status: String(receiptRef.status || '').trim().toLowerCase(),
                explorer: String(receiptRef.explorer || '').trim(),
                verifiedAt: String(receiptRef.verifiedAt || '').trim(),
                endpoint: String(receiptRef.endpoint || '').trim()
              }
            : null
        };
        const hopDigest = digestStableObject(buildXmtpHopDigestMaterial(hop));
        hop.hopDigest = hopDigest.value;
        return hop;
      })
      .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  
    const xmtpDigestInput = {
      scope: 'xmtp-hop-core-v1',
      traceId: normalizedTraceId,
      requestId: normalizedRequestId,
      taskId: normalizedTaskId,
      total: hops.length,
      hops: hops.map((hop) => buildXmtpHopDigestMaterial(hop))
    };
    const xmtpDigest = digestStableObject(xmtpDigestInput);
    const latestTaskResult = [...hops].reverse().find((row) => row.kind === 'task-result') || null;
    return {
      total: hops.length,
      digest: {
        algorithm: xmtpDigest.algorithm,
        canonicalization: xmtpDigest.canonicalization,
        scope: 'xmtp-hop-core-v1',
        value: xmtpDigest.value
      },
      integrity: {
        hopFields: XMTP_HOP_DIGEST_FIELDS,
        digestInput: {
          scope: 'xmtp-hop-core-v1',
          traceId: normalizedTraceId,
          requestId: normalizedRequestId,
          taskId: normalizedTaskId,
          total: hops.length
        }
      },
      hops,
      latestTaskResult: latestTaskResult
        ? {
            status: latestTaskResult.status || '',
            resultSummary: latestTaskResult.resultSummary || '',
            error: latestTaskResult.error || '',
            payment: latestTaskResult.payment || null,
            receiptRef: latestTaskResult.receiptRef || null
          }
        : null
    };
  }
  
}
