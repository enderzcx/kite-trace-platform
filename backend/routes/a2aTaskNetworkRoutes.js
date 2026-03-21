import { createTrustLayerHelpers } from '../lib/trustLayerHelpers.js';

export function registerA2aTaskNetworkRoutes(app, deps) {
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
    appendReputationSignal,
    appendTrustPublication,
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
    publishTrustPublicationOnChain,
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

  function normalizeText(value = '') {
    return String(value ?? '').trim();
  }

  const { appendInvokeTrustArtifacts } = createTrustLayerHelpers({
    appendReputationSignal,
    appendTrustPublication,
    createTraceId,
    ensureNetworkAgents,
    publishTrustPublicationOnChain
  });

  function resolveA2AConsumerTrustSubject(reqItem = {}) {
    const identity = reqItem?.identity || {};
    const agentId = normalizeText(identity.agentId || identity.identityAgentId || '');
    const identityRegistry = normalizeText(identity.identityRegistry || identity.registry || '');
    if (!agentId || !identityRegistry) return null;
    return {
      agentId,
      identityRegistry
    };
  }

  async function appendA2ATrustArtifacts(
    reqItem = {},
    {
      targetAgentId = '',
      taskType = '',
      traceId = '',
      summary = ''
    } = {}
  ) {
    if (normalizeText(reqItem?.status || '').toLowerCase() !== 'paid') return null;
    return appendInvokeTrustArtifacts({
      consumerSubject: resolveA2AConsumerTrustSubject(reqItem),
      service: {
        providerAgentId: normalizeText(targetAgentId || reqItem?.a2a?.targetAgentId || '')
      },
      sourceLane: 'a2a',
      sourceKind: `x402-a2a:${normalizeText(taskType || reqItem?.a2a?.taskType || reqItem?.action || 'task')}`,
      referenceId: normalizeText(reqItem?.requestId || ''),
      traceId: normalizeText(reqItem?.a2a?.traceId || traceId || ''),
      paymentRequestId: normalizeText(reqItem?.requestId || ''),
      summary: normalizeText(summary || reqItem?.result?.summary || 'A2A paid invoke completed successfully.'),
      evaluator: normalizeText(targetAgentId || reqItem?.a2a?.targetAgentId || '')
    });
  }

  app.get('/api/a2a/capabilities', (req, res) => {
    res.json({ ok: true, capabilities: buildA2ACapabilities() });
  });
  
  app.get('/api/a2a/receipts', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 500));
    const items = listA2AReceipts({
      sourceAgentId: req.query.sourceAgentId,
      targetAgentId: req.query.targetAgentId,
      capability: req.query.capability,
      state: req.query.state,
      limit
    });
    return res.json({
      ok: true,
      total: items.length,
      items
    });
  });
  
  app.get('/api/a2a/network/graph', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 1000));
    const recent = Math.max(1, Math.min(Number(req.query.recent || 20), 200));
    const items = listA2AReceipts({
      sourceAgentId: req.query.sourceAgentId,
      targetAgentId: req.query.targetAgentId,
      capability: req.query.capability,
      state: req.query.state,
      limit
    });
    const graph = buildA2ANetworkGraph(items);
    return res.json({
      ok: true,
      total: items.length,
      graph,
      recent: items.slice(0, recent)
    });
  });
  
  async function handleA2ABtcPrice(body = {}) {
    const payer = String(body.payer || '').trim();
    const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
    const traceId = String(body.traceId || '').trim();
    const requestId = String(body.requestId || '').trim();
    const paymentProof = body.paymentProof;
    const taskInput = body.task || {};
    const identityInput = body.identity || {};
  
    let task = null;
    try {
      task = normalizeBtcPriceParams({
        pair: body.pair || taskInput.pair,
        source: body.source || taskInput.source
      });
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'invalid_task',
          reason: error.message
        }
      };
    }
  
    const actionCfg = getActionConfig('btc-price-feed');
    const actionAmount = String(actionCfg?.amount || X402_BTC_PRICE || '0.00001');
    const requests = readX402Requests();
    const a2aQuery = `ATAPI BTC price ${task.pair} source=${task.source}`;
  
    if (!requestId || !paymentProof) {
      let identityVerification = null;
      try {
        identityVerification = await ensureWorkflowIdentityVerified({
          traceId,
          identityInput
        });
      } catch (error) {
        return {
          status: 400,
          body: {
            error: 'identity_verification_failed',
            reason: error?.message || 'identity verification failed'
          }
        };
      }
  
      const policyResult = evaluateTransferPolicy({
        payer,
        recipient: actionCfg.recipient,
        amount: actionAmount,
        requests
      });
      if (!policyResult.ok) {
        logPolicyFailure({
          action: 'a2a-btc-price-feed',
          payer,
          recipient: actionCfg.recipient,
          amount: actionAmount,
          code: policyResult.code,
          message: policyResult.message,
          evidence: policyResult.evidence
        });
        return {
          status: 403,
          body: {
            error: policyResult.code,
            reason: policyResult.message,
            evidence: policyResult.evidence
          }
        };
      }
  
      const reqItem = createX402Request(a2aQuery, payer, actionCfg.action, {
        amount: actionAmount,
        recipient: actionCfg.recipient,
        policy: {
          decision: 'allowed',
          snapshot: buildPolicySnapshot(),
          evidence: policyResult.evidence
        },
        identity: identityVerification?.identity
      });
      reqItem.actionParams = task;
      reqItem.a2a = {
        sourceAgentId,
        targetAgentId,
        taskType: 'btc-price-feed',
        traceId
      };
      requests.unshift(reqItem);
      writeX402Requests(requests);
      const receipt = buildA2AReceipt(reqItem, null, {
        traceId,
        phase: 'payment_required',
        state: 'running'
      });
  
      return {
        status: 402,
        body: {
          ...buildPaymentRequiredResponse(reqItem),
          a2a: {
            protocol: 'x402-a2a-v1',
            sourceAgentId,
            targetAgentId,
            taskType: 'btc-price-feed',
            task,
            identity: identityVerification?.identity || null
          },
          receipt
        }
      };
    }
  
    const reqItem = requests.find((item) => item.requestId === requestId);
    if (!reqItem) {
      return {
        status: 402,
        body: {
          error: 'payment_required',
          reason: 'request not found'
        }
      };
    }
  
    if (Date.now() > reqItem.expiresAt) {
      reqItem.status = 'expired';
      writeX402Requests(requests);
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, 'request expired')
      };
    }
  
    if (reqItem.status === 'paid') {
      let quote = reqItem?.result?.quote || null;
      if (!quote) {
        try {
          quote = await fetchBtcPriceQuote(reqItem.actionParams || task);
        } catch {
          quote = null;
        }
      }
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'x402',
          requestId: reqItem.requestId,
          reused: true,
          result: {
            summary: reqItem?.result?.summary || 'ATAPI BTC price quote already unlocked',
            quote
          },
          a2a: reqItem.a2a || null,
          receipt: buildA2AReceipt(reqItem, null, {
            traceId,
            sourceAgentId,
            targetAgentId,
            capability: 'btc-price-feed',
            phase: 'settled',
            state: 'success',
            summary: reqItem?.result?.summary || 'ATAPI BTC price quote already unlocked'
          })
        }
      };
    }
  
    const validationError = validatePaymentProof(reqItem, paymentProof);
    if (validationError) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, validationError)
      };
    }
  
    const verification = await verifyProofOnChain(reqItem, paymentProof);
    if (!verification.ok) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`)
      };
    }
  
    const quote = await fetchBtcPriceQuote(reqItem.actionParams || task);
    const quoteSummary = `BTC ${quote.pair} = $${quote.priceUsd} (${quote.provider})`;
  
    reqItem.status = 'paid';
    reqItem.paidAt = Date.now();
    reqItem.paymentTxHash = paymentProof.txHash;
    reqItem.paymentProof = {
      requestId: paymentProof.requestId,
      txHash: paymentProof.txHash,
      payer: paymentProof.payer || '',
      tokenAddress: paymentProof.tokenAddress,
      recipient: paymentProof.recipient,
      amount: paymentProof.amount
    };
    reqItem.proofVerification = {
      mode: 'onchain_transfer_log',
      verifiedAt: Date.now(),
      details: verification.details || null
    };
    reqItem.a2a = {
      ...(reqItem.a2a || {}),
      sourceAgentId: String(reqItem?.a2a?.sourceAgentId || sourceAgentId).trim(),
      targetAgentId: String(reqItem?.a2a?.targetAgentId || targetAgentId).trim(),
      taskType: String(reqItem?.a2a?.taskType || 'btc-price-feed').trim(),
      traceId: String(reqItem?.a2a?.traceId || traceId).trim()
    };
    reqItem.result = {
      summary: `ATAPI BTC price quote unlocked by x402 payment: ${quoteSummary}`,
      quote
    };
    writeX402Requests(requests);
    const trust = await appendA2ATrustArtifacts(reqItem, {
      targetAgentId,
      taskType: 'btc-price-feed',
      traceId: reqItem?.a2a?.traceId || traceId,
      summary: reqItem?.result?.summary || quoteSummary
    });
  
    const receipt = buildA2AReceipt(reqItem, null, {
      traceId: reqItem?.a2a?.traceId || traceId,
      sourceAgentId,
      targetAgentId,
      capability: 'btc-price-feed',
      phase: 'settled',
      state: 'success',
      summary: reqItem?.result?.summary || quoteSummary
    });
  
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        payment: {
          txHash: paymentProof.txHash,
          amount: reqItem.amount,
          tokenAddress: reqItem.tokenAddress,
          recipient: reqItem.recipient
        },
        result: reqItem.result,
        a2a: reqItem.a2a || {
          sourceAgentId,
          targetAgentId,
          taskType: 'btc-price-feed'
        },
        receipt,
        trust
      }
    };
  }
  
  async function handleA2ARiskScore(body = {}) {
    const payer = String(body.payer || '').trim();
    const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
    const traceId = String(body.traceId || '').trim();
    const requestId = String(body.requestId || '').trim();
    const paymentProof = body.paymentProof;
    const prebindOnly = parseBooleanFlag(body.prebindOnly, false);
    const taskInput = body.task || {};
    const identityInput = body.identity || {};
    const requestedAction = String(body.action || 'risk-score-feed').trim().toLowerCase();
    const taskAction = requestedAction === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed';
    const serviceLabel = taskAction === 'technical-analysis-feed' ? 'A2A technical analysis' : 'A2A risk score';
  
    let task = null;
    try {
      task = normalizeRiskScoreParams(taskInput);
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'invalid_task',
          reason: error.message
        }
      };
    }
  
    const actionCfg = getActionConfig(taskAction);
    const actionAmount = String(actionCfg?.amount || X402_RISK_SCORE_PRICE || '0.00002');
    const requests = readX402Requests();
    const a2aQuery = `${serviceLabel} ${task.symbol} horizon=${task.horizonMin} source=${task.source}`;
  
    if (!requestId || !paymentProof) {
      let identityVerification = null;
      try {
        identityVerification = await ensureWorkflowIdentityVerified({
          traceId,
          identityInput
        });
      } catch (error) {
        return {
          status: 400,
          body: {
            error: 'identity_verification_failed',
            reason: error?.message || 'identity verification failed'
          }
        };
      }
  
      const policyResult = evaluateTransferPolicy({
        payer,
        recipient: actionCfg.recipient,
        amount: actionAmount,
        requests
      });
      if (!policyResult.ok) {
        logPolicyFailure({
          action: `a2a-${taskAction}`,
          payer,
          recipient: actionCfg.recipient,
          amount: actionAmount,
          code: policyResult.code,
          message: policyResult.message,
          evidence: policyResult.evidence
        });
        return {
          status: 403,
          body: {
            error: policyResult.code,
            reason: policyResult.message,
            evidence: policyResult.evidence
          }
        };
      }
  
      const reqItem = createX402Request(a2aQuery, payer, actionCfg.action, {
        amount: actionAmount,
        recipient: actionCfg.recipient,
        policy: {
          decision: 'allowed',
          snapshot: buildPolicySnapshot(),
          evidence: policyResult.evidence
        },
        identity: identityVerification?.identity
      });
      reqItem.actionParams = task;
      reqItem.a2a = {
        sourceAgentId,
        targetAgentId,
        taskType: taskAction,
        traceId
      };
      requests.unshift(reqItem);
      writeX402Requests(requests);
      const receipt = buildA2AReceipt(reqItem, null, {
        traceId,
        phase: 'payment_required',
        state: 'running'
      });
  
      return {
        status: 402,
        body: {
          ...buildPaymentRequiredResponse(reqItem),
          a2a: {
            protocol: 'x402-a2a-v1',
            sourceAgentId,
            targetAgentId,
            taskType: taskAction,
            task,
            identity: identityVerification?.identity || null
          },
          receipt
        }
      };
    }
  
    const reqItem = requests.find((item) => item.requestId === requestId);
    if (!reqItem) {
      return {
        status: 402,
        body: {
          error: 'payment_required',
          reason: 'request not found'
        }
      };
    }
  
    if (Date.now() > reqItem.expiresAt) {
      reqItem.status = 'expired';
      writeX402Requests(requests);
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, 'request expired')
      };
    }
  
    if (reqItem.status === 'paid') {
      if (prebindOnly) {
        return {
          status: 200,
          body: {
            ok: true,
            mode: 'x402',
            requestId: reqItem.requestId,
            reused: true,
            prebindOnly: true,
            result: {
              summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`,
              prebindOnly: true
            },
            a2a: reqItem.a2a || null,
            receipt: buildA2AReceipt(reqItem, null, {
              traceId,
              sourceAgentId,
              targetAgentId,
              capability: taskAction,
              phase: 'settled',
              state: 'success',
              summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`
            })
          }
        };
      }
      let riskResult = reqItem?.result || null;
      const needsFreshResult =
        !riskResult ||
        parseBooleanFlag(riskResult?.prebindOnly, false) ||
        !String(riskResult?.summary || '').trim();
      if (needsFreshResult) {
        try {
          const computed = await runRiskScoreAnalysis(reqItem.actionParams || task);
          riskResult = {
            summary: `${serviceLabel} unlocked by x402 payment: ${computed.summary}`,
            ...computed
          };
          reqItem.result = riskResult;
          writeX402Requests(requests);
        } catch {
          riskResult = null;
        }
      }
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'x402',
          requestId: reqItem.requestId,
          reused: true,
          result: riskResult || { summary: `${serviceLabel} already unlocked` },
          a2a: reqItem.a2a || null,
          receipt: buildA2AReceipt(reqItem, null, {
            traceId,
            sourceAgentId,
            targetAgentId,
            capability: taskAction,
            phase: 'settled',
            state: 'success',
            summary: reqItem?.result?.summary || `${serviceLabel} already unlocked`
          })
        }
      };
    }
  
    const validationError = validatePaymentProof(reqItem, paymentProof);
    if (validationError) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, validationError)
      };
    }
  
    const verification = await verifyProofOnChain(reqItem, paymentProof);
    if (!verification.ok) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`)
      };
    }
  
    reqItem.status = 'paid';
    reqItem.paidAt = Date.now();
    reqItem.paymentTxHash = paymentProof.txHash;
    reqItem.paymentProof = {
      requestId: paymentProof.requestId,
      txHash: paymentProof.txHash,
      payer: paymentProof.payer || '',
      tokenAddress: paymentProof.tokenAddress,
      recipient: paymentProof.recipient,
      amount: paymentProof.amount
    };
    reqItem.proofVerification = {
      mode: 'onchain_transfer_log',
      verifiedAt: Date.now(),
      details: verification.details || null
    };
    reqItem.a2a = {
      ...(reqItem.a2a || {}),
      sourceAgentId: String(reqItem?.a2a?.sourceAgentId || sourceAgentId).trim(),
      targetAgentId: String(reqItem?.a2a?.targetAgentId || targetAgentId).trim(),
      taskType: String(reqItem?.a2a?.taskType || taskAction).trim(),
      traceId: String(reqItem?.a2a?.traceId || traceId).trim()
    };
    if (prebindOnly) {
      reqItem.result = {
        summary: `${serviceLabel} payment settled (prebind-only)`,
        prebindOnly: true
      };
    } else {
      const riskResult = await runRiskScoreAnalysis(reqItem.actionParams || task);
      reqItem.result = {
        summary: `${serviceLabel} unlocked by x402 payment: ${riskResult.summary}`,
        ...riskResult
      };
    }
    writeX402Requests(requests);
    const trust = prebindOnly
      ? null
      : await appendA2ATrustArtifacts(reqItem, {
          targetAgentId,
          taskType: taskAction,
          traceId: reqItem?.a2a?.traceId || traceId,
          summary: reqItem?.result?.summary || `${serviceLabel} unlocked by x402 payment`
        });
  
    const receipt = buildA2AReceipt(reqItem, null, {
      traceId: reqItem?.a2a?.traceId || traceId,
      sourceAgentId,
      targetAgentId,
      capability: taskAction,
      phase: 'settled',
      state: 'success',
      summary: reqItem?.result?.summary || riskResult.summary
    });
  
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        payment: {
          txHash: paymentProof.txHash,
          amount: reqItem.amount,
          tokenAddress: reqItem.tokenAddress,
          recipient: reqItem.recipient
        },
        result: reqItem.result,
        a2a: reqItem.a2a || {
          sourceAgentId,
          targetAgentId,
          taskType: taskAction
        },
        receipt,
        trust
      }
    };
  }
  
  async function handleA2AXReader(body = {}) {
    const payer = String(body.payer || '').trim();
    const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
    const traceId = String(body.traceId || '').trim();
    const requestId = String(body.requestId || '').trim();
    const paymentProof = body.paymentProof;
    const prebindOnly = parseBooleanFlag(body.prebindOnly, false);
    const taskInput = body.task || {};
    const identityInput = body.identity || {};
    const taskAction = 'info-analysis-feed';
    const serviceLabel = 'A2A info analysis';
  
    let task = null;
    try {
      task = normalizeXReaderParams({
        url: body.url || taskInput.url || taskInput.resourceUrl,
        topic:
          body.topic ||
          body.query ||
          body.keyword ||
          taskInput.topic ||
          taskInput.query ||
          taskInput.keyword,
        mode: body.mode || body.source || taskInput.mode || taskInput.source || 'auto',
        maxChars: body.maxChars ?? taskInput.maxChars ?? X_READER_MAX_CHARS_DEFAULT
      });
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'invalid_task',
          reason: error.message
        }
      };
    }
  
    const actionCfg = getActionConfig(taskAction);
    const actionAmount = String(actionCfg?.amount || X402_INFO_PRICE || X402_X_READER_PRICE || '0.00001');
    const requests = readX402Requests();
    const a2aQuery = `${serviceLabel} ${task.url || task.topic || ''}`.trim();
  
    if (!requestId || !paymentProof) {
      let identityVerification = null;
      try {
        identityVerification = await ensureWorkflowIdentityVerified({
          traceId,
          identityInput
        });
      } catch (error) {
        return {
          status: 400,
          body: {
            error: 'identity_verification_failed',
            reason: error?.message || 'identity verification failed'
          }
        };
      }
  
      const policyResult = evaluateTransferPolicy({
        payer,
        recipient: actionCfg.recipient,
        amount: actionAmount,
        requests
      });
      if (!policyResult.ok) {
        logPolicyFailure({
          action: `a2a-${taskAction}`,
          payer,
          recipient: actionCfg.recipient,
          amount: actionAmount,
          code: policyResult.code,
          message: policyResult.message,
          evidence: policyResult.evidence
        });
        return {
          status: 403,
          body: {
            error: policyResult.code,
            reason: policyResult.message,
            evidence: policyResult.evidence
          }
        };
      }
  
      const reqItem = createX402Request(a2aQuery, payer, actionCfg.action, {
        amount: actionAmount,
        recipient: actionCfg.recipient,
        policy: {
          decision: 'allowed',
          snapshot: buildPolicySnapshot(),
          evidence: policyResult.evidence
        },
        identity: identityVerification?.identity
      });
      reqItem.actionParams = task;
      reqItem.a2a = {
        sourceAgentId,
        targetAgentId,
        taskType: taskAction,
        traceId
      };
      requests.unshift(reqItem);
      writeX402Requests(requests);
      const receipt = buildA2AReceipt(reqItem, null, {
        traceId,
        phase: 'payment_required',
        state: 'running'
      });
  
      return {
        status: 402,
        body: {
          ...buildPaymentRequiredResponse(reqItem),
          a2a: {
            protocol: 'x402-a2a-v1',
            sourceAgentId,
            targetAgentId,
            taskType: taskAction,
            task,
            identity: identityVerification?.identity || null
          },
          receipt
        }
      };
    }
  
    const reqItem = requests.find((item) => item.requestId === requestId);
    if (!reqItem) {
      return {
        status: 402,
        body: {
          error: 'payment_required',
          reason: 'request not found'
        }
      };
    }
  
    if (Date.now() > reqItem.expiresAt) {
      reqItem.status = 'expired';
      writeX402Requests(requests);
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, 'request expired')
      };
    }
  
    if (reqItem.status === 'paid') {
      if (prebindOnly) {
        return {
          status: 200,
          body: {
            ok: true,
            mode: 'x402',
            requestId: reqItem.requestId,
            reused: true,
            prebindOnly: true,
            result: {
              summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`,
              prebindOnly: true
            },
            a2a: reqItem.a2a || null,
            receipt: buildA2AReceipt(reqItem, null, {
              traceId,
              sourceAgentId,
              targetAgentId,
              capability: taskAction,
              phase: 'settled',
              state: 'success',
              summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`
            })
          }
        };
      }
      let reader = reqItem?.result?.reader || null;
      const needsFreshResult =
        !reader ||
        parseBooleanFlag(reqItem?.result?.prebindOnly, false) ||
        !String(reqItem?.result?.summary || '').trim();
      if (needsFreshResult) {
        try {
          reader = await fetchXReaderDigest(reqItem.actionParams || task);
          reqItem.result = {
            summary: `${serviceLabel} unlocked by x402 payment: ${reader.title || reader.url || task.topic || 'analysis result'}`,
            reader
          };
          writeX402Requests(requests);
        } catch {
          reader = null;
        }
      }
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'x402',
          requestId: reqItem.requestId,
          reused: true,
          result: {
            summary: reqItem?.result?.summary || `${serviceLabel} already unlocked`,
            reader
          },
          a2a: reqItem.a2a || null,
          receipt: buildA2AReceipt(reqItem, null, {
            traceId,
            sourceAgentId,
            targetAgentId,
            capability: taskAction,
            phase: 'settled',
            state: 'success',
            summary: reqItem?.result?.summary || `${serviceLabel} already unlocked`
          })
        }
      };
    }
  
    const validationError = validatePaymentProof(reqItem, paymentProof);
    if (validationError) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, validationError)
      };
    }
  
    const verification = await verifyProofOnChain(reqItem, paymentProof);
    if (!verification.ok) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`)
      };
    }
  
    reqItem.status = 'paid';
    reqItem.paidAt = Date.now();
    reqItem.paymentTxHash = paymentProof.txHash;
    reqItem.paymentProof = {
      requestId: paymentProof.requestId,
      txHash: paymentProof.txHash,
      payer: paymentProof.payer || '',
      tokenAddress: paymentProof.tokenAddress,
      recipient: paymentProof.recipient,
      amount: paymentProof.amount
    };
    reqItem.proofVerification = {
      mode: 'onchain_transfer_log',
      verifiedAt: Date.now(),
      details: verification.details || null
    };
    reqItem.a2a = {
      ...(reqItem.a2a || {}),
      sourceAgentId: String(reqItem?.a2a?.sourceAgentId || sourceAgentId).trim(),
      targetAgentId: String(reqItem?.a2a?.targetAgentId || targetAgentId).trim(),
      taskType: String(reqItem?.a2a?.taskType || taskAction).trim(),
      traceId: String(reqItem?.a2a?.traceId || traceId).trim()
    };
    let summaryTail = 'info analysis';
    if (prebindOnly) {
      reqItem.result = {
        summary: `${serviceLabel} payment settled (prebind-only)`,
        prebindOnly: true
      };
      summaryTail = `${serviceLabel} payment settled (prebind-only)`;
    } else {
      const reader = await fetchXReaderDigest(reqItem.actionParams || task);
      summaryTail = reader.title || reader.url || 'info analysis';
      reqItem.result = {
        summary: `${serviceLabel} unlocked by x402 payment: ${summaryTail}`,
        reader
      };
    }
    writeX402Requests(requests);
    const trust = prebindOnly
      ? null
      : await appendA2ATrustArtifacts(reqItem, {
          targetAgentId,
          taskType: taskAction,
          traceId: reqItem?.a2a?.traceId || traceId,
          summary: reqItem?.result?.summary || summaryTail
        });
  
    const receipt = buildA2AReceipt(reqItem, null, {
      traceId: reqItem?.a2a?.traceId || traceId,
      sourceAgentId,
      targetAgentId,
      capability: taskAction,
      phase: 'settled',
      state: 'success',
      summary: reqItem?.result?.summary || summaryTail
    });
  
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        payment: {
          txHash: paymentProof.txHash,
          amount: reqItem.amount,
          tokenAddress: reqItem.tokenAddress,
          recipient: reqItem.recipient
        },
        result: reqItem.result,
        a2a: reqItem.a2a || {
          sourceAgentId,
          targetAgentId,
          taskType: taskAction
        },
        receipt,
        trust
      }
    };
  }
  
  async function handleA2AStopOrders(body = {}) {
    const payer = String(body.payer || '').trim();
    const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
    const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
    const traceId = String(body.traceId || '').trim();
    const requestId = String(body.requestId || '').trim();
    const paymentProof = body.paymentProof;
    const task = body.task || {};
    const identityInput = body.identity || {};
  
    let actionParams = null;
    try {
      actionParams = normalizeReactiveParams(task);
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'invalid_task',
          reason: error.message
        }
      };
    }
  
    const actionCfg = getActionConfig('reactive-stop-orders');
    const actionAmount = computeReactiveStopOrderAmount(actionParams);
    const requests = readX402Requests();
    const a2aQuery = `A2A stop-order ${actionParams.symbol} tp=${actionParams.takeProfit} sl=${actionParams.stopLoss}${
      Number.isFinite(actionParams?.quantity) ? ` qty=${actionParams.quantity}` : ''
    }`;
  
    if (!requestId || !paymentProof) {
      let identityVerification = null;
      try {
        identityVerification = await ensureWorkflowIdentityVerified({
          traceId,
          identityInput
        });
      } catch (error) {
        return {
          status: 400,
          body: {
            error: 'identity_verification_failed',
            reason: error?.message || 'identity verification failed'
          }
        };
      }
  
      const policyResult = evaluateTransferPolicy({
        payer,
        recipient: actionCfg.recipient,
        amount: actionAmount,
        requests
      });
      if (!policyResult.ok) {
        logPolicyFailure({
          action: 'a2a-reactive-stop-orders',
          payer,
          recipient: actionCfg.recipient,
          amount: actionAmount,
          code: policyResult.code,
          message: policyResult.message,
          evidence: policyResult.evidence
        });
        return {
          status: 403,
          body: {
            error: policyResult.code,
            reason: policyResult.message,
            evidence: policyResult.evidence
          }
        };
      }
  
      const reqItem = createX402Request(a2aQuery, payer, actionCfg.action, {
        amount: actionAmount,
        recipient: actionCfg.recipient,
        policy: {
          decision: 'allowed',
          snapshot: buildPolicySnapshot(),
          evidence: policyResult.evidence
        },
        identity: identityVerification?.identity
      });
      reqItem.actionParams = actionParams;
      reqItem.a2a = {
        sourceAgentId,
        targetAgentId,
        taskType: 'reactive-stop-orders',
        traceId
      };
      requests.unshift(reqItem);
      writeX402Requests(requests);
      const receipt = buildA2AReceipt(reqItem, null, {
        traceId,
        phase: 'payment_required',
        state: 'running'
      });
  
      return {
        status: 402,
        body: {
          ...buildPaymentRequiredResponse(reqItem),
          a2a: {
            protocol: 'x402-a2a-v1',
            sourceAgentId,
            targetAgentId,
            taskType: 'reactive-stop-orders',
            task: actionParams,
            identity: identityVerification?.identity || null
          },
          receipt
        }
      };
    }
  
    const reqItem = requests.find((item) => item.requestId === requestId);
    if (!reqItem) {
      return {
        status: 402,
        body: {
          error: 'payment_required',
          reason: 'request not found'
        }
      };
    }
  
    if (Date.now() > reqItem.expiresAt) {
      reqItem.status = 'expired';
      writeX402Requests(requests);
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, 'request expired')
      };
    }
  
    if (reqItem.status === 'paid') {
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'x402',
          requestId: reqItem.requestId,
          reused: true,
          result: {
            summary: 'A2A reactive stop-order task already unlocked',
            orderPlan: {
              symbol: reqItem?.actionParams?.symbol || '-',
              takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
              stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
              quantity: reqItem?.actionParams?.quantity ?? '-',
              provider: 'Reactive Contracts'
            }
          },
          a2a: reqItem.a2a || null,
          receipt: buildA2AReceipt(reqItem, null, {
            traceId,
            sourceAgentId,
            targetAgentId,
            capability: 'reactive-stop-orders',
            phase: 'settled',
            state: 'success',
            summary: 'A2A reactive stop-order task already unlocked'
          })
        }
      };
    }
  
    const validationError = validatePaymentProof(reqItem, paymentProof);
    if (validationError) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, validationError)
      };
    }
  
    const verification = await verifyProofOnChain(reqItem, paymentProof);
    if (!verification.ok) {
      return {
        status: 402,
        body: buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`)
      };
    }
  
    reqItem.status = 'paid';
    reqItem.paidAt = Date.now();
    reqItem.paymentTxHash = paymentProof.txHash;
    reqItem.paymentProof = {
      requestId: paymentProof.requestId,
      txHash: paymentProof.txHash,
      payer: paymentProof.payer || '',
      tokenAddress: paymentProof.tokenAddress,
      recipient: paymentProof.recipient,
      amount: paymentProof.amount
    };
    reqItem.proofVerification = {
      mode: 'onchain_transfer_log',
      verifiedAt: Date.now(),
      details: verification.details || null
    };
    reqItem.a2a = {
      ...(reqItem.a2a || {}),
      sourceAgentId: String(reqItem?.a2a?.sourceAgentId || sourceAgentId).trim(),
      targetAgentId: String(reqItem?.a2a?.targetAgentId || targetAgentId).trim(),
      taskType: String(reqItem?.a2a?.taskType || 'reactive-stop-orders').trim(),
      traceId: String(reqItem?.a2a?.traceId || traceId).trim()
    };
    reqItem.result = {
      summary: 'A2A reactive stop-order task unlocked by x402 payment',
      orderPlan: {
        symbol: reqItem?.actionParams?.symbol || '-',
        takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
        stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
        quantity: reqItem?.actionParams?.quantity ?? '-',
        provider: 'Reactive Contracts'
      }
    };
    writeX402Requests(requests);
    const trust = await appendA2ATrustArtifacts(reqItem, {
      targetAgentId,
      taskType: 'reactive-stop-orders',
      traceId: reqItem?.a2a?.traceId || traceId,
      summary: reqItem?.result?.summary || 'A2A reactive stop-order task unlocked by x402 payment'
    });
    const receipt = buildA2AReceipt(reqItem, null, {
      traceId: reqItem?.a2a?.traceId || traceId,
      sourceAgentId,
      targetAgentId,
      capability: 'reactive-stop-orders',
      phase: 'settled',
      state: 'success',
      summary: reqItem?.result?.summary || 'A2A reactive stop-order task unlocked by x402 payment'
    });
  
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        payment: {
          txHash: paymentProof.txHash,
          amount: reqItem.amount,
          tokenAddress: reqItem.tokenAddress,
          recipient: reqItem.recipient
        },
        result: reqItem.result,
        a2a: reqItem.a2a || {
          sourceAgentId,
          targetAgentId,
          taskType: 'reactive-stop-orders'
        },
        receipt,
        trust
      }
    };
  }
  
  app.post('/api/a2a/tasks/stop-orders', requireRole('agent'), async (req, res) => {
    try {
      const result = await handleA2AStopOrders(req.body);
      return res.status(result.status).json(result.body);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'a2a_handler_failed',
        reason: error.message || 'Unknown error'
      });
    }
  });
  
  app.post('/api/a2a/tasks/btc-price', requireRole('agent'), async (req, res) => {
    try {
      const result = await handleA2ABtcPrice(req.body);
      return res.status(result.status).json(result.body);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'a2a_btc_price_handler_failed',
        reason: error.message || 'Unknown error'
      });
    }
  });
  
  app.post('/api/a2a/tasks/risk-score', requireRole('agent'), async (req, res) => {
    try {
      const result = await handleA2ARiskScore(req.body);
      return res.status(result.status).json(result.body);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'a2a_risk_score_handler_failed',
        reason: error.message || 'Unknown error'
      });
    }
  });
  
  app.post('/api/a2a/tasks/info', requireRole('agent'), async (req, res) => {
    try {
      const result = await handleA2AXReader(req.body);
      return res.status(result.status).json(result.body);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'a2a_x_reader_handler_failed',
        reason: error.message || 'Unknown error'
      });
    }
  });
  
  app.get('/api/skill/llm/manifest', (req, res) => {
    return res.json({
      ok: true,
      skill: {
        name: 'kiteclaw.stop_orders',
        version: '1.0.0',
        title: 'KITECLAW LLM Stop Orders',
        transport: 'http-json',
        endpoints: {
          invoke: '/api/skill/llm/invoke',
          status: '/api/skill/llm/status/:requestId',
          evidence: '/api/skill/llm/evidence/:requestId'
        },
        inputSchema: {
          type: 'object',
          required: ['payer', 'task'],
          properties: {
            payer: { type: 'string' },
            sourceAgentId: { type: 'string', default: KITE_AGENT1_ID },
            targetAgentId: { type: 'string', default: KITE_AGENT2_ID },
            task: {
              type: 'object',
              required: ['symbol', 'takeProfit', 'stopLoss'],
              properties: {
                symbol: { type: 'string' },
                takeProfit: { type: 'number' },
                stopLoss: { type: 'number' },
                quantity: { type: 'number' }
              }
            },
            requestId: { type: 'string' },
            paymentProof: { type: 'object' }
          }
        }
      }
    });
  });
  
  app.post('/api/skill/llm/invoke', requireRole('agent'), async (req, res) => {
    try {
      const result = await handleA2AStopOrders(req.body);
      return res.status(result.status).json({
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        ...result.body
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        status: 500,
        error: 'llm_invoke_failed',
        reason: error.message || 'Unknown error'
      });
    }
  });
  
  app.get('/api/skill/llm/status/:requestId', requireRole('agent'), (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId is required' });
    }
    const item = readX402Requests().find((r) => String(r.requestId) === requestId);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    const now = Date.now();
    const effectiveStatus =
      item.status === 'paid' ? 'paid' : now > Number(item.expiresAt || 0) ? 'expired' : item.status;
    return res.json({
      ok: true,
      requestId: item.requestId,
      status: effectiveStatus,
      action: item.action,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      paidAt: item.paidAt || null,
      paymentTxHash: item.paymentTxHash || item?.paymentProof?.txHash || ''
    });
  });
  
  app.get('/api/skill/llm/evidence/:requestId', requireRole('agent'), (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId is required' });
    }
    const item = readX402Requests().find((r) => String(r.requestId) === requestId);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    const txHash = String(item.paymentTxHash || item?.paymentProof?.txHash || '').toLowerCase();
    const transferRecord = readRecords().find(
      (r) => txHash && String(r.txHash || '').toLowerCase() === txHash
    );
    return res.json({
      ok: true,
      request: item,
      payment: {
        txHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
        tokenAddress: item.tokenAddress,
        recipient: item.recipient,
        amount: item.amount
      },
      transferRecord: transferRecord || null,
      policy: item.policy || null,
      identity: item.identity || null,
      a2a: item.a2a || null
    });
  });
  
  app.post('/api/signer/sign-userop-hash', requireRole('agent'), async (req, res) => {
    if (!KITE_ALLOW_BACKEND_USEROP_SIGN) {
      return res.status(403).json({
        ok: false,
        error: 'backend_userop_sign_disabled',
        reason: 'Backend userOp signing is disabled by policy. Use session key signing path.'
      });
    }
    if (!assertBackendSigner(res)) return;
    const userOpHash = String(req.body?.userOpHash || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
      return res.status(400).json({ error: 'invalid_userOpHash' });
    }
    try {
      const signature = await backendSigner.signMessage(ethers.getBytes(userOpHash));
      return res.json({ ok: true, signerAddress: backendSigner.address, signature });
    } catch (error) {
      return res.status(500).json({ error: 'sign_failed', reason: error.message });
    }
  });
  
  app.post('/api/x402/kol-score', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const query = String(body.query || '').trim();
    const payer = String(body.payer || '').trim();
    const actionRequested = String(body.action || 'kol-score').trim().toLowerCase();
    const requestId = String(body.requestId || '').trim();
    const paymentProof = body.paymentProof;
    const identityInput = body.identity || {};
    const actionParamsInput = body.actionParams || {};
    if (!query) return res.status(400).json({ error: 'query is required' });
    const actionCfg = getActionConfig(actionRequested);
    if (!actionCfg) {
      return res.status(400).json({
        error: 'unsupported_action',
        reason: `Unsupported action: ${actionRequested}`
      });
    }
    if (!ethers.isAddress(actionCfg.recipient)) {
      return res.status(400).json({
        error: 'invalid_action_recipient',
        reason: `Invalid address: action recipient is invalid (${actionCfg.recipient})`
      });
    }
  
    const requests = readX402Requests();
    let normalizedActionParams = null;
    if (actionCfg.action === 'reactive-stop-orders') {
      try {
        normalizedActionParams = normalizeReactiveParams(actionParamsInput);
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_reactive_params',
          reason: error.message
        });
      }
    }
    if (actionCfg.action === 'btc-price-feed') {
      try {
        normalizedActionParams = normalizeBtcPriceParams(actionParamsInput || {});
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_btc_price_params',
          reason: error.message
        });
      }
    }
    if (isTechnicalAnalysisAction(actionCfg.action)) {
      try {
        normalizedActionParams = normalizeRiskScoreParams(actionParamsInput || {});
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_risk_score_params',
          reason: error.message
        });
      }
    }
    if (isInfoAnalysisAction(actionCfg.action)) {
      try {
        normalizedActionParams = normalizeXReaderParams(actionParamsInput || {});
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_x_reader_params',
          reason: error.message
        });
      }
    }
    const amountToCharge =
      actionCfg.action === 'reactive-stop-orders'
        ? computeReactiveStopOrderAmount(normalizedActionParams || {})
        : actionCfg.amount;
    if (!requestId || !paymentProof) {
      const policyResult = evaluateTransferPolicy({
        payer,
        recipient: actionCfg.recipient,
        amount: amountToCharge,
        requests
      });
      if (!policyResult.ok) {
        logPolicyFailure({
          action: actionCfg.action,
          payer,
          recipient: actionCfg.recipient,
          amount: amountToCharge,
          code: policyResult.code,
          message: policyResult.message,
          evidence: policyResult.evidence
        });
        return res.status(403).json({
          error: policyResult.code,
          reason: policyResult.message,
          evidence: policyResult.evidence,
          policy: buildPolicySnapshot()
        });
      }
  
      let identityProfile = null;
      try {
        identityProfile = await readIdentityProfile({
          registry: identityInput.identityRegistry || identityInput.registry,
          agentId: identityInput.agentId
        });
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_identity',
          reason: error.message
        });
      }
      const reqItem = createX402Request(query, payer, actionCfg.action, {
        amount: amountToCharge,
        recipient: actionCfg.recipient,
        policy: {
          decision: 'allowed',
          snapshot: buildPolicySnapshot(),
          evidence: policyResult.evidence
        },
        identity: identityProfile?.configured
      });
      reqItem.actionParams = normalizedActionParams;
      requests.unshift(reqItem);
      writeX402Requests(requests);
      return res.status(402).json(buildPaymentRequiredResponse(reqItem));
    }
  
    const reqItem = requests.find((item) => item.requestId === requestId);
    if (!reqItem) {
      const fallbackItem = createX402Request(query, payer, 'kol-score');
      requests.unshift(fallbackItem);
      writeX402Requests(requests);
      return res.status(402).json(buildPaymentRequiredResponse(fallbackItem, 'request not found, regenerated'));
    }
  
    if (Date.now() > reqItem.expiresAt) {
      reqItem.status = 'expired';
      writeX402Requests(requests);
      return res.status(402).json(buildPaymentRequiredResponse(reqItem, 'request expired'));
    }
  
    if (reqItem.status === 'paid') {
      let paidResult = {
        summary: 'KOL score report already unlocked',
        topKOLs: [
          { handle: '@alpha_kol', score: 91 },
          { handle: '@beta_growth', score: 88 },
          { handle: '@gamma_builder', score: 84 }
        ]
      };
      if (reqItem.action === 'reactive-stop-orders') {
        paidResult = {
          summary: 'Reactive contracts stop-orders signal already unlocked',
          orderPlan: {
            symbol: reqItem?.actionParams?.symbol || '-',
            takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
            stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
            quantity: reqItem?.actionParams?.quantity ?? '-',
            provider: 'Reactive Contracts'
          }
        };
      }
      if (reqItem.action === 'btc-price-feed') {
        let quote = reqItem?.result?.quote || null;
        if (!quote) {
          try {
            quote = await fetchBtcPriceQuote(reqItem.actionParams || {});
          } catch {
            quote = null;
          }
        }
        paidResult = {
          summary: reqItem?.result?.summary || 'BTC price quote already unlocked',
          quote
        };
      }
      if (isTechnicalAnalysisAction(reqItem.action)) {
        let riskResult = reqItem?.result || null;
        if (!riskResult) {
          try {
            riskResult = await runRiskScoreAnalysis(reqItem.actionParams || {});
          } catch {
            riskResult = null;
          }
        }
        paidResult = riskResult || {
          summary: 'BTC risk score already unlocked'
        };
      }
      if (isInfoAnalysisAction(reqItem.action)) {
        let reader = reqItem?.result?.reader || null;
        if (!reader) {
          try {
            reader = await fetchXReaderDigest(reqItem.actionParams || {});
          } catch {
            reader = null;
          }
        }
        paidResult = {
          summary: reqItem?.result?.summary || 'x-reader digest already unlocked',
          reader
        };
      }
      return res.json({
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        reused: true,
        result: paidResult
      });
    }
  
    const validationError = validatePaymentProof(reqItem, paymentProof);
    if (validationError) return res.status(402).json(buildPaymentRequiredResponse(reqItem, validationError));
  
    const verification = await verifyProofOnChain(reqItem, paymentProof);
    if (!verification.ok) {
      return res
        .status(402)
        .json(buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`));
    }
  
    reqItem.status = 'paid';
    reqItem.paidAt = Date.now();
    reqItem.paymentTxHash = paymentProof.txHash;
    reqItem.paymentProof = {
      requestId: paymentProof.requestId,
      txHash: paymentProof.txHash,
      payer: paymentProof.payer || '',
      tokenAddress: paymentProof.tokenAddress,
      recipient: paymentProof.recipient,
      amount: paymentProof.amount
    };
    reqItem.proofVerification = {
      mode: 'onchain_transfer_log',
      verifiedAt: Date.now(),
      details: verification.details || null
    };
    let finalResult = {
      summary: 'KOL score report unlocked by x402 payment',
      topKOLs: [
        { handle: '@alpha_kol', score: 91 },
        { handle: '@beta_growth', score: 88 },
        { handle: '@gamma_builder', score: 84 }
      ]
    };
    if (reqItem.action === 'reactive-stop-orders') {
      finalResult = {
        summary: 'Reactive contracts stop-orders signal unlocked by x402 payment',
        orderPlan: {
          symbol: reqItem?.actionParams?.symbol || '-',
          takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
          stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
          quantity: reqItem?.actionParams?.quantity ?? '-',
          provider: 'Reactive Contracts'
        }
      };
    }
    if (reqItem.action === 'btc-price-feed') {
      const quote = await fetchBtcPriceQuote(reqItem.actionParams || {});
      finalResult = {
        summary: `BTC ${quote.pair} = $${quote.priceUsd} (${quote.provider})`,
        quote
      };
    }
    if (isTechnicalAnalysisAction(reqItem.action)) {
      const riskResult = await runRiskScoreAnalysis(reqItem.actionParams || {});
      finalResult = riskResult;
    }
    if (isInfoAnalysisAction(reqItem.action)) {
      const reader = await fetchXReaderDigest(reqItem.actionParams || {});
      finalResult = {
        summary: `x-reader digest unlocked by x402 payment: ${reader.title || reader.url}`,
        reader
      };
    }
    reqItem.result = finalResult;
    writeX402Requests(requests);
  
    return res.json({
      ok: true,
      mode: 'x402',
      requestId: reqItem.requestId,
      payment: {
        txHash: paymentProof.txHash,
        amount: reqItem.amount,
        tokenAddress: reqItem.tokenAddress,
        recipient: reqItem.recipient
      },
      result: finalResult
    });
  });
  
  app.post('/api/x402/transfer-intent', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const payer = String(body.payer || '').trim();
    const requestId = String(body.requestId || '').trim();
    const paymentProof = body.paymentProof;
    const recipient = String(body.recipient || '').trim();
    const amount = String(body.amount || '').trim();
    const tokenAddress = String(body.tokenAddress || SETTLEMENT_TOKEN).trim();
    const simulateInsufficientFunds = Boolean(body.simulateInsufficientFunds);
    const forceExpire = Boolean(body.debugForceExpire);
    const identityInput = body.identity || {};
  
    const requests = readX402Requests();
    if (!requestId || !paymentProof) {
      if (!recipient || !amount) return res.status(400).json({ error: 'recipient and amount are required' });
      if (simulateInsufficientFunds) {
        logPolicyFailure({
          action: 'transfer-intent',
          payer,
          recipient,
          amount,
          code: 'insufficient_funds',
          message: 'Simulated insufficient funds for graceful-failure demo.',
          evidence: {
            mode: 'demo_flag',
            requiredAmount: amount
          }
        });
        return res.status(402).json({
          error: 'insufficient_funds',
          reason: 'Insufficient funds to satisfy x402 payment requirement (demo).'
        });
      }
  
      const policyResult = evaluateTransferPolicy({
        payer,
        recipient,
        amount,
        requests
      });
      if (!policyResult.ok) {
        logPolicyFailure({
          action: 'transfer-intent',
          payer,
          recipient,
          amount,
          code: policyResult.code,
          message: policyResult.message,
          evidence: policyResult.evidence
        });
        return res.status(403).json({
          error: policyResult.code,
          reason: policyResult.message,
          evidence: policyResult.evidence,
          policy: buildPolicySnapshot()
        });
      }
  
      let identityProfile = null;
      try {
        identityProfile = await readIdentityProfile({
          registry: identityInput.identityRegistry || identityInput.registry,
          agentId: identityInput.agentId
        });
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_identity',
          reason: error.message
        });
      }
      const reqItem = createX402Request(`transfer ${amount} to ${recipient}`, payer, 'transfer-intent', {
        amount,
        recipient,
        tokenAddress,
        policy: {
          decision: 'allowed',
          snapshot: buildPolicySnapshot(),
          evidence: policyResult.evidence
        },
        identity: identityProfile?.configured
      });
      requests.unshift(reqItem);
      writeX402Requests(requests);
      return res.status(402).json(buildPaymentRequiredResponse(reqItem));
    }
  
    const reqItem = requests.find((item) => item.requestId === requestId);
    if (!reqItem) return res.status(402).json({ error: 'payment_required', reason: 'request not found' });
  
    if (forceExpire) {
      reqItem.expiresAt = Date.now() - 1;
    }
  
    if (Date.now() > reqItem.expiresAt) {
      reqItem.status = 'expired';
      writeX402Requests(requests);
      return res.status(402).json(buildPaymentRequiredResponse(reqItem, 'request expired'));
    }
  
    if (reqItem.status === 'paid') {
      return res.json({ ok: true, mode: 'x402', requestId: reqItem.requestId, reused: true, result: { summary: 'Transfer intent already unlocked' } });
    }
  
    const validationError = validatePaymentProof(reqItem, paymentProof);
    if (validationError) return res.status(402).json(buildPaymentRequiredResponse(reqItem, validationError));
  
    const verification = await verifyProofOnChain(reqItem, paymentProof);
    if (!verification.ok) {
      return res
        .status(402)
        .json(buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`));
    }
  
    reqItem.status = 'paid';
    reqItem.paidAt = Date.now();
    reqItem.paymentTxHash = paymentProof.txHash;
    reqItem.paymentProof = {
      requestId: paymentProof.requestId,
      txHash: paymentProof.txHash,
      payer: paymentProof.payer || '',
      tokenAddress: paymentProof.tokenAddress,
      recipient: paymentProof.recipient,
      amount: paymentProof.amount
    };
    reqItem.proofVerification = {
      mode: 'onchain_transfer_log',
      verifiedAt: Date.now(),
      details: verification.details || null
    };
    writeX402Requests(requests);
  
    return res.json({
      ok: true,
      mode: 'x402',
      requestId: reqItem.requestId,
      payment: {
        txHash: paymentProof.txHash,
        amount: reqItem.amount,
        tokenAddress: reqItem.tokenAddress,
        recipient: reqItem.recipient
      },
      result: { summary: 'Transfer intent unlocked by x402 proof verification' }
    });
  });
  
  app.get('/api/x402/policy', requireRole('viewer'), (req, res) => {
    res.json({ ok: true, traceId: req.traceId, policy: buildPolicySnapshot() });
  });
  
  app.get('/api/auth/info', requireRole('viewer'), (req, res) => {
    res.json({
      ok: true,
      traceId: req.traceId,
      role: req.authRole || '',
      authSource: req.authSource || '',
      authDisabled: AUTH_DISABLED,
      authConfigured: authConfigured(),
      acceptedHeaders: ['x-api-key', 'Authorization: Bearer <key>', 'Cookie: ktrace_onboard=<token>'],
      roles: ['viewer', 'agent', 'admin'],
      persistence: persistenceStore.info()
    });
  });
  
  app.get('/api/system/persistence', requireRole('viewer'), (req, res) => {
    res.json({
      ok: true,
      traceId: req.traceId || '',
      persistence: persistenceStore.info()
    });
  });
  
  app.get('/api/network/agents', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 80), 300));
    const activeOnly = /^(1|true|yes|on)$/i.test(String(req.query.active || '').trim());
    const rows = ensureNetworkAgents()
      .filter((item) => (activeOnly ? item?.active !== false : true))
      .slice(0, limit);
    const runtimeStatuses = getAllXmtpRuntimeStatuses();
    const routerStatus = runtimeStatuses.router;
    const riskStatus = runtimeStatuses.risk;
    const readerStatus = runtimeStatuses.reader;
    const priceStatus = runtimeStatuses.price;
    const executorStatus = runtimeStatuses.executor;
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      network: {
        total: rows.length,
        xmtp: {
          env: routerStatus.env || XMTP_ENV,
          router: {
            enabled: routerStatus.enabled,
            running: routerStatus.running
          },
          risk: {
            enabled: riskStatus.enabled,
            running: riskStatus.running
          },
          reader: {
            enabled: readerStatus.enabled,
            running: readerStatus.running
          },
          price: {
            enabled: priceStatus.enabled,
            running: priceStatus.running
          },
          executor: {
            enabled: executorStatus.enabled,
            running: executorStatus.running
          }
        }
      },
      items: rows
    });
  });
  
  app.get('/api/network/runs', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));
    const traceId = String(req.query.traceId || '').trim();
    const requestId = String(req.query.requestId || '').trim();
    const items = buildNetworkRunSummaries({ limit, traceId, requestId });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: items.length,
      items
    });
  });
  
  app.get('/api/network/audit/:traceId', requireRole('viewer'), (req, res) => {
    const traceId = String(req.params.traceId || '').trim();
    if (!traceId) {
      return res.status(400).json({
        ok: false,
        error: 'traceId_required',
        reason: 'traceId is required.',
        traceId: req.traceId || ''
      });
    }
    const workflow = readWorkflows().find((row) => String(row?.traceId || '').trim() === traceId) || null;
    const storedEvents = listNetworkAuditEventsByTraceId(traceId);
    const timeline = storedEvents.length > 0 ? storedEvents : buildWorkflowFallbackAuditEvents(workflow || {});
    if (!workflow && timeline.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'network_audit_not_found',
        reason: 'No workflow or audit events found for this traceId.',
        traceId: req.traceId || ''
      });
    }
    const negotiation = deriveNegotiationTermsFromAuditEvents(timeline);
    const run = buildNetworkRunSummaries({ limit: 1, traceId })[0] || {
      traceId,
      requestId: String(workflow?.requestId || '').trim(),
      state: String(workflow?.state || '').trim().toLowerCase(),
      startedAt: String(workflow?.createdAt || '').trim(),
      latestAt: String(workflow?.updatedAt || '').trim(),
      latestEventType: timeline.length > 0 ? String(timeline[timeline.length - 1]?.type || '').trim() : '',
      totalEvents: timeline.length
    };
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      run,
      timeline,
      negotiation,
      refs: {
        workflow: `/api/workflow/${encodeURIComponent(traceId)}`,
        evidenceExport: `/api/evidence/export?traceId=${encodeURIComponent(traceId)}`
      }
    });
  });
  
  app.post('/api/network/agents/publish', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const requestedId = String(body.id || '').trim().toLowerCase();
    if (!requestedId) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'agent_id_required',
        reason: 'id is required.'
      });
    }
    const rows = ensureNetworkAgents();
    const idx = rows.findIndex((item) => String(item?.id || '').trim().toLowerCase() === requestedId);
    const existing = idx >= 0 ? rows[idx] : null;
    const record = sanitizeNetworkAgentRecord(
      {
        ...body,
        id: requestedId,
        active: body.active !== false
      },
      existing
    );
    if (!record.id) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'agent_id_invalid',
        reason: 'invalid id'
      });
    }
    if (idx >= 0) rows[idx] = record;
    else rows.unshift(record);
    writeNetworkAgents(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode: idx >= 0 ? 'updated' : 'created',
      agent: record
    });
  });
  
}


