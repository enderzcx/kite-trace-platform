export function registerReceiptEvidenceRoutes(app, deps) {
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

  app.get('/api/demo/trace/:traceId', requireRole('viewer'), (req, res) => {
    const traceId = String(req.params.traceId || '').trim();
    if (!traceId) {
      return res.status(400).json({ ok: false, error: 'traceId_required' });
    }
  
    const workflows = readWorkflows();
    const workflow = workflows.find((w) => String(w.traceId || '') === traceId);
    if (!workflow) {
      return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
    }
  
    const reqItem = readX402Requests().find((item) => String(item.requestId || '') === String(workflow.requestId || ''));
    const mapped = reqItem ? mapX402Item(reqItem, workflow) : null;
    const receipt = reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null;
    const xmtpEvidence = buildTraceXmtpEvidence({
      traceId,
      requestId: String(workflow?.requestId || reqItem?.requestId || '').trim()
    });
    const identityLatest = getLatestIdentityChallengeSnapshot();
  
    const hasIdentity = Boolean(reqItem?.identity?.registry || reqItem?.identity?.agentId);
    const hasChallenge = Boolean(
      workflow?.requestId ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'challenge_issued'))
    );
    const hasPayment = Boolean(
      workflow?.txHash ||
        reqItem?.paymentTxHash ||
        reqItem?.paymentProof?.txHash ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'payment_sent'))
    );
    const hasProof = Boolean(
      reqItem?.proofVerification ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'proof_submitted'))
    );
    const hasApiResult = Boolean(
      workflow?.result ||
        String(workflow?.state || '').trim().toLowerCase() === 'unlocked' ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'unlocked'))
    );
    const hasOnchain = Boolean(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash);
    const workflowState = normalizeExecutionState(workflow?.state || '', 'running');
  
    const order = ['identity', 'challenge', 'payment', 'proof', 'api_result', 'onchain'];
    const stepState = {
      identity: hasIdentity ? 'success' : 'waiting',
      challenge: hasChallenge ? 'success' : 'waiting',
      payment: hasPayment ? 'success' : 'waiting',
      proof: hasProof ? 'success' : 'waiting',
      api_result: hasApiResult ? 'success' : 'waiting',
      onchain: hasOnchain ? 'success' : 'waiting'
    };
  
    if (workflowState === 'failed') {
      const failedStep =
        order.find((id) => stepState[id] !== 'success') ||
        'api_result';
      stepState[failedStep] = 'failed';
    } else {
      const runningStep = order.find((id) => stepState[id] !== 'success');
      if (runningStep) {
        stepState[runningStep] = 'running';
      }
    }
  
    const timeline = [
      {
        id: 'identity',
        label: 'ERC8004 Identity',
        state: stepState.identity,
        detail: hasIdentity
          ? `agentId ${String(reqItem?.identity?.agentId || '-')}`
          : 'waiting for identity metadata'
      },
      {
        id: 'challenge',
        label: 'x402 Challenge',
        state: stepState.challenge,
        detail: hasChallenge ? `requestId ${String(workflow?.requestId || reqItem?.requestId || '-')}` : 'waiting for challenge'
      },
      {
        id: 'payment',
        label: 'Payment Sent',
        state: stepState.payment,
        detail: hasPayment ? `tx ${String(workflow?.txHash || reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || '-')}` : 'waiting for payment'
      },
      {
        id: 'proof',
        label: 'Proof Verified',
        state: stepState.proof,
        detail: hasProof ? 'on-chain transfer log matched' : 'waiting for proof verification'
      },
      {
        id: 'api_result',
        label: 'API Result',
        state: stepState.api_result,
        detail: hasApiResult ? String(workflow?.result?.summary || reqItem?.result?.summary || 'result unlocked') : 'waiting for result unlock'
      },
      {
        id: 'onchain',
        label: 'On-chain Evidence',
        state: stepState.onchain,
        detail: hasOnchain ? String(workflow?.txHash || reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || '-') : 'waiting for tx evidence'
      }
    ];
  
    return res.json({
      ok: true,
      traceId,
      state: workflowState,
      workflow,
      request: reqItem || null,
      mapped,
      receipt,
      xmtp: xmtpEvidence,
      identityLatest,
      timeline
    });
  });
  
  app.get('/api/demo/trace-by-request/:requestId', requireRole('viewer'), (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId_required' });
    }
    const workflows = readWorkflows();
    const workflow = workflows.find((w) => String(w.requestId || '').trim() === requestId);
    if (!workflow?.traceId) {
      return res.status(404).json({ ok: false, error: 'workflow_not_found_by_request', requestId });
    }
    return res.json({
      ok: true,
      requestId,
      traceId: String(workflow.traceId || '').trim()
    });
  });
  
  app.get('/api/evidence/export', requireRole('viewer'), (req, res) => {
    const traceId = String(req.query.traceId || '').trim();
    if (!traceId) {
      return res.status(400).json({ ok: false, error: 'traceId_required' });
    }
  
    const workflows = readWorkflows();
    const workflow = workflows.find((w) => String(w.traceId || '') === traceId);
    if (!workflow) {
      return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
    }
  
    const requests = readX402Requests();
    const reqItem = requests.find((r) => String(r.requestId || '') === String(workflow.requestId || ''));
    const records = readRecords();
    const paymentRecord = records.find((r) => String(r.txHash || '').toLowerCase() === String(workflow.txHash || '').toLowerCase());
    const runtime = readSessionRuntime();
    const xmtp = buildTraceXmtpEvidence({
      traceId,
      requestId: String(workflow?.requestId || reqItem?.requestId || '').trim()
    });
    const networkAuditEvents = listNetworkAuditEventsByTraceId(traceId);
    const networkAuditRef = {
      traceId,
      total: networkAuditEvents.length,
      auditEndpoint: `/api/network/audit/${encodeURIComponent(traceId)}`,
      runsEndpoint: '/api/network/runs'
    };
  
    const evidenceSchemaVersion = 'kiteclaw-evidence-v1.1.0';
    const digestInput = {
      scope: 'evidence-core-v1',
      schemaVersion: evidenceSchemaVersion,
      traceId,
      workflow: {
        traceId: String(workflow?.traceId || '').trim(),
        type: String(workflow?.type || '').trim(),
        state: String(workflow?.state || '').trim().toLowerCase(),
        requestId: String(workflow?.requestId || '').trim(),
        txHash: String(workflow?.txHash || '').trim(),
        userOpHash: String(workflow?.userOpHash || '').trim()
      },
      x402: reqItem
        ? {
            requestId: String(reqItem.requestId || '').trim(),
            status: String(reqItem.status || '').trim().toLowerCase(),
            action: String(reqItem.action || '').trim().toLowerCase(),
            amount: String(reqItem.amount || '').trim(),
            payer: String(reqItem.payer || '').trim(),
            recipient: String(reqItem.recipient || '').trim(),
            tokenAddress: String(reqItem.tokenAddress || '').trim(),
            paymentTxHash: String(reqItem.paymentTxHash || reqItem?.paymentProof?.txHash || '').trim()
          }
        : null,
      xmtp: {
        total: Number(xmtp?.total || 0),
        digest: String(xmtp?.digest?.value || '').trim()
      },
      paymentRecord: paymentRecord
        ? {
            txHash: String(paymentRecord.txHash || '').trim(),
            status: String(paymentRecord.status || '').trim().toLowerCase(),
            requestId: String(paymentRecord.requestId || '').trim()
          }
        : null,
      runtimeSnapshot: {
        aaWallet: runtime.aaWallet || '',
        sessionAddress: runtime.sessionAddress || '',
        sessionId: runtime.sessionId || '',
        maxPerTx: runtime.maxPerTx || 0,
        dailyLimit: runtime.dailyLimit || 0,
        gatewayRecipient: runtime.gatewayRecipient || ''
      }
    };
    const evidenceDigest = digestStableObject(digestInput);
  
    const exportPayload = {
      schemaVersion: evidenceSchemaVersion,
      traceId,
      exportedAt: new Date().toISOString(),
      digest: {
        algorithm: evidenceDigest.algorithm,
        canonicalization: evidenceDigest.canonicalization,
        scope: 'evidence-core-v1',
        value: evidenceDigest.value
      },
      integrity: {
        digestInput
      },
      workflow: workflow || null,
      a2aReceipt: reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null,
      x402: reqItem
        ? {
            requestId: reqItem.requestId || '',
            status: reqItem.status || '',
            action: reqItem.action || '',
            amount: reqItem.amount || '',
            payer: reqItem.payer || '',
            recipient: reqItem.recipient || '',
            tokenAddress: reqItem.tokenAddress || '',
            paymentTxHash: reqItem.paymentTxHash || reqItem?.paymentProof?.txHash || '',
            proofVerification: reqItem.proofVerification || null,
            policy: reqItem.policy || null,
            identity: reqItem.identity || null,
            actionParams: reqItem.actionParams || null,
            a2a: reqItem.a2a || null
          }
        : null,
      xmtp,
      networkAuditRef,
      paymentRecord: paymentRecord || null,
      runtimeSnapshot: {
        aaWallet: runtime.aaWallet || '',
        sessionAddress: runtime.sessionAddress || '',
        sessionId: runtime.sessionId || '',
        maxPerTx: runtime.maxPerTx || 0,
        dailyLimit: runtime.dailyLimit || 0,
        gatewayRecipient: runtime.gatewayRecipient || ''
      }
    };
  
    const shouldDownload = /^(1|true|yes|download)$/i.test(String(req.query.download || '').trim());
    if (shouldDownload) {
      const fileName = `kiteclaw_evidence_${traceId}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
    }
  
    return res.json({ ok: true, traceId, evidence: exportPayload });
  });
  
  app.get('/api/receipt/:requestId', requireRole('viewer'), async (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId_required' });
    }
    const requests = readX402Requests();
    const reqItem = requests.find((item) => String(item?.requestId || '').trim() === requestId);
    if (!reqItem) {
      return res.status(404).json({ ok: false, error: 'request_not_found', requestId });
    }
  
    const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
    const workflow = workflowByRequestId.get(requestId) || null;
    const action = String(reqItem?.action || workflow?.type || '').trim().toLowerCase();
    const resultPayload = (workflow?.result && typeof workflow.result === 'object' ? workflow.result : null) ||
      (reqItem?.result && typeof reqItem.result === 'object' ? reqItem.result : {}) ||
      {};
    const { responseHash } = buildResponseHash(requestId, action, resultPayload);
    const signatureBundle = await signResponseHash(responseHash);
  
    const txHash = String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim();
    const block = reqItem?.proofVerification?.details?.blockNumber ?? '-';
    const onchainStatus =
      reqItem?.proofVerification
        ? 'success'
        : ['failed', 'expired', 'rejected', 'error'].includes(String(reqItem?.status || '').trim().toLowerCase())
          ? 'failed'
          : 'pending';
    const explorer = txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : '';
    const flow =
      String(reqItem?.a2a?.sourceAgentId || '').trim() && String(reqItem?.a2a?.targetAgentId || '').trim()
        ? 'a2a+x402'
        : 'agent-to-api+x402';
  
    const receiptPayload = {
      version: 'kiteclaw-receipt-v1',
      generatedAt: new Date().toISOString(),
      requestId,
      workflowTraceId: String(workflow?.traceId || reqItem?.a2a?.traceId || '').trim(),
      action,
      flow,
      identity: {
        agentId: reqItem?.identity?.agentId || '',
        registry: reqItem?.identity?.registry || '',
        wallet: reqItem?.identity?.agentWallet || ''
      },
      payment: {
        amount: String(reqItem?.amount || '').trim(),
        tokenAddress: String(reqItem?.tokenAddress || '').trim(),
        payer: String(reqItem?.payer || workflow?.payer || '').trim(),
        payee: String(reqItem?.recipient || '').trim(),
        txHash,
        userOpHash: String(workflow?.userOpHash || '').trim(),
        settledAt: Number(reqItem?.paidAt || 0) > 0 ? new Date(Number(reqItem.paidAt)).toISOString() : ''
      },
      onchainConfirmation: {
        txHash,
        block,
        status: onchainStatus,
        explorer,
        mode: reqItem?.proofVerification?.mode || 'onchain_transfer_log',
        verifiedAt:
          Number(reqItem?.proofVerification?.verifiedAt || 0) > 0
            ? new Date(Number(reqItem.proofVerification.verifiedAt)).toISOString()
            : ''
      },
      apiResult: {
        summary: String(resultPayload?.summary || '').trim(),
        payload: resultPayload,
        responseHash,
        responseSignature: signatureBundle.signature,
        signer: signatureBundle.signer,
        signatureScheme: signatureBundle.scheme,
        signatureAvailable: signatureBundle.available
      }
    };
  
    const shouldDownload = /^(1|true|yes|download)$/i.test(String(req.query.download || '').trim());
    if (shouldDownload) {
      const fileName = `kiteclaw_receipt_${requestId}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      receipt: receiptPayload
    });
  });
  
  app.get('/api/receipt/:requestId/excerpt', requireRole('viewer'), async (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId_required' });
    }
  
    const requests = readX402Requests();
    const reqIndex = requests.findIndex((item) => String(item?.requestId || '').trim() === requestId);
    if (reqIndex < 0) {
      return res.status(404).json({ ok: false, error: 'request_not_found', requestId });
    }
  
    const reqItem = requests[reqIndex];
    if (!['x-reader-feed', 'info-analysis-feed'].includes(String(reqItem?.action || '').trim().toLowerCase())) {
      return res.status(400).json({
        ok: false,
        error: 'excerpt_not_supported',
        reason: 'only info-analysis-feed supports excerpt retrieval'
      });
    }
  
    const state = String(reqItem?.status || '').trim().toLowerCase();
    const isUnlocked = state === 'paid' || state === 'unlocked';
    if (!isUnlocked) {
      return res.status(409).json({
        ok: false,
        error: 'request_not_unlocked',
        reason: `request state is ${state || 'pending'}`
      });
    }
  
    const maxChars = parseExcerptMaxChars(req.query.maxChars, 8000);
    const forceRefresh = /^(1|true|yes|refresh)$/i.test(String(req.query.refresh || '').trim());
    const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
    const workflow = workflowByRequestId.get(requestId) || null;
    const workflowReader =
      workflow?.result?.reader && typeof workflow.result.reader === 'object'
        ? workflow.result.reader
        : null;
    const storedReader =
      reqItem?.result?.reader && typeof reqItem.result.reader === 'object'
        ? reqItem.result.reader
        : workflowReader;
    const storedExcerpt = String(storedReader?.excerpt || '').trim();
    const shouldRefresh = forceRefresh || !storedExcerpt || storedExcerpt.length < maxChars;
  
    let reader = storedReader;
    let source = 'stored';
    if (shouldRefresh) {
      try {
        const normalizedTask = normalizeXReaderParams({
          url: reqItem?.actionParams?.url || storedReader?.url || '',
          topic:
            reqItem?.actionParams?.topic ||
            reqItem?.actionParams?.query ||
            reqItem?.actionParams?.keyword ||
            storedReader?.topic ||
            '',
          mode: reqItem?.actionParams?.mode || storedReader?.mode || 'auto',
          maxChars
        });
        reader = await fetchXReaderDigest(normalizedTask);
        source = 'refreshed';
        reqItem.actionParams = {
          ...(reqItem.actionParams || {}),
          ...normalizedTask
        };
        reqItem.result = {
          ...(reqItem.result || {}),
          summary: String(reqItem?.result?.summary || `x-reader digest unlocked by x402 payment: ${reader.title || reader.url}`).trim(),
          reader
        };
        requests[reqIndex] = reqItem;
        writeX402Requests(requests);
      } catch (error) {
        return res.status(502).json({
          ok: false,
          error: 'x_reader_fetch_failed',
          reason: error?.message || 'x_reader_fetch_failed'
        });
      }
    }
  
    const excerpt = String(reader?.excerpt || '').trim();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      requestId,
      excerpt: {
        provider: String(reader?.provider || 'x-reader').trim() || 'x-reader',
        url: String(reader?.url || reqItem?.actionParams?.url || '').trim(),
        title: String(reader?.title || '').trim(),
        mode: String(reader?.mode || reqItem?.actionParams?.mode || 'auto').trim(),
        contentLength: Number(reader?.contentLength || excerpt.length || 0),
        maxCharsRequested: maxChars,
        capped: excerpt.length >= maxChars,
        fetchedAt: String(reader?.fetchedAt || '').trim(),
        source,
        excerpt
      }
    });
  });
  
}
