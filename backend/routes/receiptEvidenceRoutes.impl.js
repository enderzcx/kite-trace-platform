import { mergeJobWithEscrowRead } from '../lib/escrowReadModel.js';
import {
  buildBtcTradingPlanDeliveryStandard,
  normalizeBtcTradingPlanEvidence
} from '../lib/deliverySchemas/btcTradingPlanV1.js';
import { registerReceiptEvidenceEvidenceRoutes } from './receiptEvidenceEvidenceRoutes.js';
import { registerReceiptEvidenceReceiptRoutes } from './receiptEvidenceReceiptRoutes.js';

function buildLatestWorkflowByRequestId(rows = []) {
  const map = new Map();
  const items = Array.isArray(rows) ? rows : [];
  for (const workflow of items) {
    const requestId = String(workflow?.requestId || '').trim();
    if (!requestId) continue;
    const existing = map.get(requestId);
    const nextTime = Number(workflow?.updatedAt || workflow?.createdAt || 0);
    const currentTime = Number(existing?.updatedAt || existing?.createdAt || 0);
    if (!existing || nextTime >= currentTime) {
      map.set(requestId, workflow);
    }
  }
  return map;
}

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
    getEscrowJob,
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
    readJobs,
    readPurchases,
    readRecords,
    readServiceInvocations,
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
  } = deps;

  const normalizeExecutionState = (value = '', fallback = 'unknown') => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['success', 'completed', 'unlocked', 'paid', 'settled'].includes(raw)) return 'completed';
    if (['failed', 'error', 'rejected', 'expired'].includes(raw)) return 'failed';
    if (['pending', 'payment_pending', 'payment_required'].includes(raw)) return 'pending';
    if (['running', 'processing', 'submitted', 'funded'].includes(raw)) return 'running';
    return raw;
  };

  const mapX402Item = (reqItem = {}, workflow = null) => ({
    requestId: String(reqItem?.requestId || workflow?.requestId || '').trim(),
    traceId: String(workflow?.traceId || reqItem?.a2a?.traceId || '').trim(),
    state: normalizeExecutionState(reqItem?.status || workflow?.state || '', 'pending'),
    action: String(reqItem?.action || workflow?.type || '').trim(),
    amount: String(reqItem?.amount || '').trim(),
    payer: String(reqItem?.payer || workflow?.payer || '').trim(),
    recipient: String(reqItem?.recipient || '').trim(),
    tokenAddress: String(reqItem?.tokenAddress || '').trim(),
    txHash: String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim(),
    summary: String(workflow?.result?.summary || reqItem?.result?.summary || '').trim()
  });

  const buildA2AReceipt = (reqItem = {}, workflow = null, extras = {}) => ({
    traceId: String(extras?.traceId || workflow?.traceId || reqItem?.a2a?.traceId || '').trim(),
    requestId: String(reqItem?.requestId || workflow?.requestId || '').trim(),
    sourceAgentId: String(reqItem?.a2a?.sourceAgentId || workflow?.sourceAgentId || '').trim(),
    targetAgentId: String(reqItem?.a2a?.targetAgentId || workflow?.targetAgentId || '').trim(),
    capability: String(reqItem?.a2a?.capability || reqItem?.action || workflow?.type || '').trim(),
    state: normalizeExecutionState(reqItem?.status || workflow?.state || '', 'pending'),
    summary: String(workflow?.result?.summary || reqItem?.result?.summary || '').trim()
  });

  const buildTraceXmtpEvidence = () => ({ total: 0, digest: '' });

  const buildRuntimeSnapshot = (runtime = {}) => ({
    aaWallet: runtime.aaWallet || '',
    sessionAddress: runtime.sessionAddress || '',
    sessionId: runtime.sessionId || '',
    maxPerTx: runtime.maxPerTx || 0,
    dailyLimit: runtime.dailyLimit || 0,
    gatewayRecipient: runtime.gatewayRecipient || '',
    authorizedBy: runtime.authorizedBy || '',
    authorizedAt: runtime.authorizedAt || 0,
    authorizationMode: runtime.authorizationMode || '',
    authorizationPayloadHash: runtime.authorizationPayloadHash || '',
    authorizationNonce: runtime.authorizationNonce || '',
    authorizationExpiresAt: runtime.authorizationExpiresAt || 0,
    authorizedAgentId: runtime.authorizedAgentId || '',
    authorizedAgentWallet: runtime.authorizedAgentWallet || '',
    authorizationAudience: runtime.authorizationAudience || '',
    allowedCapabilities: Array.isArray(runtime.allowedCapabilities) ? runtime.allowedCapabilities : []
  });

  const buildAuthoritySummary = (authority = {}) => ({
    authorityId: String(authority?.authorityId || '').trim(),
    sessionId: String(authority?.sessionId || '').trim(),
    authorizedBy: String(authority?.authorizedBy || '').trim(),
    payer: String(authority?.payer || '').trim(),
    consumerAgentLabel: String(authority?.consumerAgentLabel || '').trim(),
    allowedCapabilities: Array.isArray(authority?.allowedCapabilities) ? authority.allowedCapabilities : [],
    allowedProviders: Array.isArray(authority?.allowedProviders) ? authority.allowedProviders : [],
    singleLimit: Number(authority?.singleLimit || 0),
    dailyLimit: Number(authority?.dailyLimit || 0),
    totalLimit: Number(authority?.totalLimit || 0),
    expiresAt: Number(authority?.expiresAt || 0),
    status: String(authority?.status || '').trim(),
    revokedAt: Number(authority?.revokedAt || 0)
  });

  const buildAuthorityEnvelope = ({ job = null, workflow = null, reqItem = null, purchase = null, invocation = null } = {}) => {
    const snapshotCandidate =
      (job?.submitAuthority && typeof job.submitAuthority === 'object' && !Array.isArray(job.submitAuthority)
        ? job.submitAuthority
        : null) ||
      (job?.fundAuthority && typeof job.fundAuthority === 'object' && !Array.isArray(job.fundAuthority)
        ? job.fundAuthority
        : null) ||
      (workflow?.authority && typeof workflow.authority === 'object' && !Array.isArray(workflow.authority)
        ? workflow.authority
        : null) ||
      (reqItem?.authority && typeof reqItem.authority === 'object' && !Array.isArray(reqItem.authority)
        ? reqItem.authority
        : null) ||
      (invocation?.authority && typeof invocation.authority === 'object' && !Array.isArray(invocation.authority)
        ? invocation.authority
        : null) ||
      (purchase?.authority && typeof purchase.authority === 'object' && !Array.isArray(purchase.authority)
        ? purchase.authority
        : null);
    const summaryCandidate =
      (job?.submitAuthorityPublic && typeof job.submitAuthorityPublic === 'object' ? job.submitAuthorityPublic : null) ||
      (job?.fundAuthorityPublic && typeof job.fundAuthorityPublic === 'object' ? job.fundAuthorityPublic : null) ||
      (workflow?.authorityPublic && typeof workflow.authorityPublic === 'object' ? workflow.authorityPublic : null) ||
      (reqItem?.authorityPublic && typeof reqItem.authorityPublic === 'object' ? reqItem.authorityPublic : null) ||
      (invocation?.authorityPublic && typeof invocation.authorityPublic === 'object' ? invocation.authorityPublic : null) ||
      (purchase?.authorityPublic && typeof purchase.authorityPublic === 'object' ? purchase.authorityPublic : null) ||
      (snapshotCandidate ? buildAuthoritySummary(snapshotCandidate) : null);
    const policySnapshotHash = String(
      job?.submitPolicySnapshotHash ||
        job?.fundPolicySnapshotHash ||
        workflow?.policySnapshotHash ||
        reqItem?.policySnapshotHash ||
        invocation?.policySnapshotHash ||
        purchase?.policySnapshotHash ||
        ''
    ).trim();
    const intentId = String(
      job?.submitIntentId ||
        job?.fundIntentId ||
        workflow?.intentId ||
        reqItem?.intentId ||
        invocation?.intentId ||
        purchase?.intentId ||
        ''
    ).trim();
    if (!snapshotCandidate && !summaryCandidate && !policySnapshotHash && !intentId) {
      return null;
    }
    return {
      authorityId: String(summaryCandidate?.authorityId || snapshotCandidate?.authorityId || '').trim(),
      intentId,
      policySnapshotHash,
      snapshot:
        snapshotCandidate && typeof snapshotCandidate === 'object' && !Array.isArray(snapshotCandidate)
          ? snapshotCandidate
          : null,
      summary:
        summaryCandidate && typeof summaryCandidate === 'object' && !Array.isArray(summaryCandidate)
          ? buildAuthoritySummary(summaryCandidate)
          : null,
      validationDecision: 'allowed'
    };
  };

  const buildJobAuditSnapshot = (job = null) => {
    if (!job || typeof job !== 'object') return null;
    const state = String(job?.state || '').trim().toLowerCase();
    const executorStakeAmount = String(job?.executorStakeAmount || '').trim();
    const hasStake = Boolean(executorStakeAmount && Number(executorStakeAmount) > 0);
    const hasEscrowBacking = Boolean(
      String(job?.escrowAddress || '').trim() ||
      String(job?.escrowTokenAddress || '').trim() ||
      String(job?.escrowAmount || '').trim()
    );
    const input =
      job?.input && typeof job.input === 'object' && !Array.isArray(job.input)
        ? job.input
        : {};
    const inputHash =
      String(job?.inputHash || '').trim() ||
      String(
        digestStableObject?.({
          scope: 'ktrace-job-input-v1',
          jobId: String(job?.jobId || '').trim(),
          traceId: String(job?.traceId || '').trim(),
          input
        })?.value || ''
      ).trim();
    const approved =
      state === 'completed'
        ? true
        : state === 'rejected'
          ? false
          : null;
    const resultHash = String(job?.resultHash || job?.submissionHash || '').trim();
    const outcomeAnchorTxHash = String(job?.outcomeAnchorTxHash || '').trim();
    const delivery =
      job?.delivery && typeof job.delivery === 'object' && !Array.isArray(job.delivery) ? job.delivery : null;
    const deliveryEvidence = normalizeBtcTradingPlanEvidence(delivery, {
      primaryTraceId: String(job?.traceId || '').trim(),
      primaryEvidenceRef: String(job?.evidenceRef || '').trim(),
      paymentRequestId: String(job?.paymentRequestId || '').trim(),
      paymentTxHash: String(job?.paymentTxHash || '').trim(),
      receiptRefs: [String(job?.receiptRef || '').trim()]
    });
    const contractPrimitives = {
      escrow: {
        present: hasEscrowBacking,
        enforcementMode: hasEscrowBacking ? 'onchain_backend_executed' : 'not_configured',
        contractAddress: String(job?.escrowAddress || '').trim(),
        tokenAddress: String(job?.escrowTokenAddress || '').trim()
      },
      conditionalPayment: {
        present: Boolean(String(job?.escrowValidateTxHash || '').trim() || outcomeAnchorTxHash),
        enforcementMode: hasEscrowBacking ? 'validator_outcome_then_settlement_with_stake_resolution' : 'not_configured',
        validatorRequired: Boolean(String(job?.validator || '').trim())
      },
      deadline: {
        present: Boolean(String(job?.expiresAt || '').trim()),
        onchainEnforced: hasEscrowBacking,
        enforcementMode: hasEscrowBacking ? 'onchain_job_escrow_v1' : 'backend_materialized',
        timeoutResolution: hasEscrowBacking ? 'onchain_expire_refund_and_optional_slash' : 'backend_materialized',
        refundOnTimeout: Boolean(String(job?.expiresAt || '').trim())
      },
      roleEnforcement: {
        onchainEnforced: hasEscrowBacking,
        executionMode:
          String(job?.executionMode || '').trim() === 'aa-native' ||
          String(job?.requesterRuntimeAddress || '').trim() ||
          String(job?.executorRuntimeAddress || '').trim() ||
          String(job?.validatorRuntimeAddress || '').trim()
            ? 'aa_account_role_enforced'
            : hasEscrowBacking
              ? 'requester_executor_validator_signers'
              : 'backend_owner_only',
        requesterAddress: String(job?.payer || '').trim(),
        executorAddress: String(job?.executor || '').trim(),
        validatorAddress: String(job?.validator || '').trim(),
        roleRuntimeSummary:
          String(job?.executionMode || '').trim() === 'aa-native' ||
          String(job?.requesterRuntimeAddress || '').trim() ||
          String(job?.executorRuntimeAddress || '').trim() ||
          String(job?.validatorRuntimeAddress || '').trim()
            ? {
                requesterRuntimeAddress: String(job?.requesterRuntimeAddress || job?.payer || '').trim(),
                executorRuntimeAddress: String(job?.executorRuntimeAddress || job?.executor || '').trim(),
                validatorRuntimeAddress: String(job?.validatorRuntimeAddress || job?.validator || '').trim()
              }
            : null
      },
      staking: {
        present: hasStake,
        executionMode: hasStake ? 'executor_stake_locked_on_accept' : 'not_configured'
      },
      slashing: {
        present: hasStake,
        executionMode: hasStake ? 'slash_to_requester_on_reject_or_expire' : 'not_configured'
      }
    };
    return {
      jobId: String(job?.jobId || '').trim(),
      traceId: String(job?.traceId || '').trim(),
      state,
      requester: String(job?.payer || '').trim(),
      executor: String(job?.executor || '').trim(),
      validator: String(job?.validator || '').trim(),
      provider: String(job?.provider || '').trim(),
      capability: String(job?.capability || '').trim(),
      amount: String(job?.escrowAmount || job?.budget || '').trim(),
      executorStakeAmount,
      escrowAddress: String(job?.escrowAddress || '').trim(),
      tokenAddress: String(job?.escrowTokenAddress || '').trim(),
      inputHash,
      resultHash,
      approved,
      approvalState: String(job?.approvalState || '').trim().toLowerCase(),
      approvalRequestedAt: Number(job?.approvalRequestedAt || 0),
      approvalDecidedAt: Number(job?.approvalDecidedAt || 0),
      approvalDecidedBy: String(job?.approvalDecidedBy || '').trim(),
      approvalReasonCode: String(job?.approvalReasonCode || '').trim(),
      approvalDecisionNote: String(job?.approvalDecisionNote || '').trim(),
      approvalPolicy:
        job?.approvalPolicy && typeof job.approvalPolicy === 'object' && !Array.isArray(job.approvalPolicy)
          ? job.approvalPolicy
          : {},
      authorizationId: String(job?.authorizationId || '').trim(),
      authorizedBy: String(job?.authorizedBy || '').trim(),
      authorizedAt: Number(job?.authorizedAt || 0),
      authorizationMode: String(job?.authorizationMode || '').trim(),
      authorizationPayloadHash: String(job?.authorizationPayloadHash || '').trim(),
      authorizationExpiresAt: Number(job?.authorizationExpiresAt || 0),
      authorizationAudience: String(job?.authorizationAudience || '').trim(),
      allowedCapabilities: Array.isArray(job?.allowedCapabilities) ? job.allowedCapabilities : [],
      fundIntentId: String(job?.fundIntentId || '').trim(),
      fundPolicySnapshotHash: String(job?.fundPolicySnapshotHash || '').trim(),
      fundAuthority:
        job?.fundAuthority && typeof job.fundAuthority === 'object' && !Array.isArray(job.fundAuthority)
          ? job.fundAuthority
          : null,
      fundAuthorityPublic:
        job?.fundAuthorityPublic && typeof job.fundAuthorityPublic === 'object' ? job.fundAuthorityPublic : null,
      submitIntentId: String(job?.submitIntentId || '').trim(),
      submitPolicySnapshotHash: String(job?.submitPolicySnapshotHash || '').trim(),
      submitAuthority:
        job?.submitAuthority && typeof job.submitAuthority === 'object' && !Array.isArray(job.submitAuthority)
          ? job.submitAuthority
          : null,
      submitAuthorityPublic:
        job?.submitAuthorityPublic && typeof job.submitAuthorityPublic === 'object' ? job.submitAuthorityPublic : null,
      createAnchorTxHash: String(job?.createAnchorTxHash || '').trim(),
      fundingAnchorTxHash: String(job?.fundingAnchorTxHash || '').trim(),
      acceptAnchorTxHash: String(job?.acceptAnchorTxHash || '').trim(),
      submitAnchorTxHash: String(job?.submitAnchorTxHash || '').trim(),
      outcomeAnchorTxHash: String(job?.outcomeAnchorTxHash || '').trim(),
      escrowFundTxHash: String(job?.escrowFundTxHash || '').trim(),
      escrowAcceptTxHash: String(job?.escrowAcceptTxHash || '').trim(),
      escrowSubmitTxHash: String(job?.escrowSubmitTxHash || '').trim(),
      escrowValidateTxHash: String(job?.escrowValidateTxHash || '').trim(),
      receiptRef: String(job?.receiptRef || '').trim(),
      evidenceRef: String(job?.evidenceRef || '').trim(),
      delivery,
      deliveryEvidence,
      deadline: {
        expiresAt: String(job?.expiresAt || '').trim(),
        expiredAt: String(job?.expiredAt || '').trim(),
        isExpired: ['expired', 'approval_expired'].includes(state),
        onchainEnforced: hasEscrowBacking,
        enforcementMode: hasEscrowBacking ? 'onchain_job_escrow_v1' : 'backend_materialized'
      },
      contractPrimitives,
      deliveryStandard: buildBtcTradingPlanDeliveryStandard({
        delivery,
        resultHash,
        outcomeAnchored: Boolean(outcomeAnchorTxHash),
        validatorApproved: approved === true
      })
    };
  };

  const hydrateJobForRead = async (job = null) => {
    if (!job || typeof job !== 'object') return null;
    const hasEscrowBacking = Boolean(
      String(job?.escrowAddress || '').trim() ||
      String(job?.escrowTokenAddress || '').trim() ||
      (String(job?.escrowAmount || '').trim() && String(job?.executor || '').trim() && String(job?.validator || '').trim())
    );
    if (!getEscrowJob || !hasEscrowBacking || !String(job?.jobId || '').trim()) {
      return job;
    }
    try {
      const escrow = await getEscrowJob({
        jobId: String(job?.jobId || '').trim()
      });
      return mergeJobWithEscrowRead(job, escrow);
    } catch {
      return job;
    }
  };

  const synthesizeWorkflowFromPurchase = (traceId = '') => {
    const normalizedTraceId = String(traceId || '').trim();
    if (!normalizedTraceId || typeof readPurchases !== 'function') return null;
    const purchase = readPurchases().find((item) => String(item?.traceId || '').trim() === normalizedTraceId);
    if (!purchase) return null;
    return {
      traceId: normalizedTraceId,
      type: String(purchase?.capabilityId || purchase?.serviceId || 'direct-buy').trim(),
      state: normalizeExecutionState(String(purchase?.state || '').trim(), 'failed'),
      sourceAgentId: '',
      targetAgentId: String(purchase?.providerAgentId || '').trim(),
      payer: String(purchase?.payer || '').trim(),
      input: {},
      requestId: String(purchase?.paymentId || '').trim(),
      txHash: String(purchase?.paymentTxHash || '').trim(),
      userOpHash: '',
      steps: [
        {
          name: 'failed',
          status: 'error',
          at: String(purchase?.updatedAt || purchase?.createdAt || new Date().toISOString()).trim(),
          details: {
            reason: String(purchase?.error || purchase?.summary || 'purchase failed').trim()
          }
        }
      ],
      createdAt: String(purchase?.createdAt || new Date().toISOString()).trim(),
      updatedAt: String(purchase?.updatedAt || purchase?.createdAt || new Date().toISOString()).trim(),
      result: String(purchase?.summary || '').trim() ? { summary: String(purchase.summary).trim() } : null,
      error: String(purchase?.error || '').trim(),
      authority: purchase?.authority && typeof purchase.authority === 'object' ? purchase.authority : null,
      authorityPublic: purchase?.authorityPublic && typeof purchase.authorityPublic === 'object' ? purchase.authorityPublic : null,
      policySnapshotHash: String(purchase?.policySnapshotHash || '').trim(),
      intentId: String(purchase?.intentId || '').trim()
    };
  };

  const buildEvidenceExportPayloadForTrace = async (traceId = '') => {
    const normalizedTraceId = String(traceId || '').trim();
    if (!normalizedTraceId) {
      return { ok: false, statusCode: 400, error: 'traceId_required' };
    }

    const workflows = readWorkflows();
    const workflow =
      workflows.find((w) => String(w.traceId || '') === normalizedTraceId) ||
      synthesizeWorkflowFromPurchase(normalizedTraceId);
    if (!workflow) {
      return { ok: false, statusCode: 404, error: 'workflow_not_found', traceId: normalizedTraceId };
    }

    const requests = readX402Requests();
    const reqItem = requests.find((r) => String(r.requestId || '') === String(workflow.requestId || ''));
    const records = readRecords();
    const paymentRecord = records.find(
      (r) => String(r.txHash || '').toLowerCase() === String(workflow.txHash || '').toLowerCase()
    );
    const runtime = readSessionRuntime();
    const xmtp = { total: 0, digest: '' };
    const networkAuditEvents = listNetworkAuditEventsByTraceId(normalizedTraceId);
    const networkAuditRef = {
      traceId: normalizedTraceId,
      total: networkAuditEvents.length,
      auditEndpoint: `/api/network/audit/${encodeURIComponent(normalizedTraceId)}`,
      runsEndpoint: '/api/network/runs'
    };
    const runtimeSnapshot = buildRuntimeSnapshot(runtime);
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const jobCandidate = jobs.find((item) => String(item?.traceId || '').trim() === normalizedTraceId) || null;
    const job = await hydrateJobForRead(jobCandidate);
    const jobAudit = buildJobAuditSnapshot(job);
    const purchases = typeof readPurchases === 'function' ? readPurchases() : [];
    const purchase = purchases.find((item) => String(item?.traceId || '').trim() === normalizedTraceId) || null;
    const serviceInvocations = typeof readServiceInvocations === 'function' ? readServiceInvocations() : [];
    const invocation =
      serviceInvocations.find((item) => String(item?.requestId || '').trim() === String(workflow?.requestId || '').trim()) ||
      serviceInvocations.find((item) => String(item?.traceId || '').trim() === normalizedTraceId) ||
      null;
    const authorityEnvelope = buildAuthorityEnvelope({
      job,
      workflow,
      reqItem,
      purchase,
      invocation
    });
    const action = String(reqItem?.action || workflow?.type || '').trim().toLowerCase();
    const resultPayload =
      workflow?.result && typeof workflow.result === 'object'
        ? workflow.result
        : reqItem?.result && typeof reqItem.result === 'object'
          ? reqItem.result
          : {};
    const requestId = String(reqItem?.requestId || workflow?.requestId || '').trim();
    const { responseHash } = buildResponseHash(requestId, action, resultPayload);
    const signatureBundle = await signResponseHash(responseHash);

    const evidenceSchemaVersion = 'kiteclaw-evidence-v1.1.0';
    const digestInput = {
      scope: 'evidence-core-v1',
      schemaVersion: evidenceSchemaVersion,
      traceId: normalizedTraceId,
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
      xmtp: { total: 0, digest: '' },
      paymentRecord: paymentRecord
        ? {
            txHash: String(paymentRecord.txHash || '').trim(),
            status: String(paymentRecord.status || '').trim().toLowerCase(),
            requestId: String(paymentRecord.requestId || '').trim()
          }
        : null,
      authority: authorityEnvelope
        ? {
            authorityId: String(authorityEnvelope.authorityId || '').trim(),
            intentId: String(authorityEnvelope.intentId || '').trim(),
            policySnapshotHash: String(authorityEnvelope.policySnapshotHash || '').trim(),
            summary: authorityEnvelope.summary
          }
        : null,
      runtimeSnapshot,
      job: jobAudit
    };
    const evidenceDigest = digestStableObject(digestInput);

    const exportPayload = {
      schemaVersion: evidenceSchemaVersion,
      traceId: normalizedTraceId,
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
      a2aReceipt: reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId: normalizedTraceId }) : null,
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
            paymentProof: reqItem.paymentProof || null,
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
      runtimeSnapshot,
      job: jobAudit,
      purchase,
      invocation,
      authorization: authorityEnvelope
        ? {
            authorityId: authorityEnvelope.authorityId,
            intentId: authorityEnvelope.intentId,
            policySnapshotHash: authorityEnvelope.policySnapshotHash,
            policySnapshot: authorityEnvelope.snapshot,
            authoritySummary: authorityEnvelope.summary,
            validationDecision: authorityEnvelope.validationDecision
          }
        : jobAudit
          ? {
              authorizationId: jobAudit.authorizationId,
              authorizedBy: jobAudit.authorizedBy,
              authorizedAt: jobAudit.authorizedAt,
              authorizationMode: jobAudit.authorizationMode,
              authorizationPayloadHash: jobAudit.authorizationPayloadHash,
              authorizationExpiresAt: jobAudit.authorizationExpiresAt,
              authorizationAudience: jobAudit.authorizationAudience,
              allowedCapabilities: jobAudit.allowedCapabilities
            }
          : null,
      humanApproval: jobAudit
        ? {
            approvalState: jobAudit.approvalState,
            approvalRequestedAt: jobAudit.approvalRequestedAt,
            approvalDecidedAt: jobAudit.approvalDecidedAt,
            approvalDecidedBy: jobAudit.approvalDecidedBy,
            approvalReasonCode: jobAudit.approvalReasonCode,
            approvalDecisionNote: jobAudit.approvalDecisionNote,
            approvalPolicy: jobAudit.approvalPolicy
          }
        : null,
      apiResult: {
        summary: String(resultPayload?.summary || '').trim(),
        payload: resultPayload,
        responseHash,
        responseSignature: signatureBundle.signature,
        signer: signatureBundle.signer,
        signatureScheme: signatureBundle.scheme,
        signatureAvailable: signatureBundle.available
      },
      deadline: jobAudit?.deadline || null,
      contractPrimitives: jobAudit?.contractPrimitives || null,
      deliveryStandard: jobAudit?.deliveryStandard || null
    };

    return {
      ok: true,
      traceId: normalizedTraceId,
      workflow,
      reqItem,
      paymentRecord,
      runtime,
      exportPayload
    };
  };

  const buildPublicEvidenceView = ({ traceId = '', workflow = null, reqItem = null, exportPayload = null } = {}) => {
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const purchases = typeof readPurchases === 'function' ? readPurchases() : [];
    const job = jobs.find((item) => String(item?.traceId || '').trim() === String(traceId || '').trim()) || null;
    const purchase =
      purchases.find((item) => String(item?.traceId || '').trim() === String(traceId || '').trim()) || null;
    const runtimeSnapshot = exportPayload?.runtimeSnapshot || {};
    const x402 = exportPayload?.x402 || null;
    const jobAudit = exportPayload?.job || null;
    const authorityEnvelope = exportPayload?.authorization || null;
    const jobAnchorTxHash =
      String(
        jobAudit?.outcomeAnchorTxHash ||
          jobAudit?.fundingAnchorTxHash ||
          jobAudit?.createAnchorTxHash ||
          job?.outcomeAnchorTxHash ||
          job?.fundingAnchorTxHash ||
          job?.createAnchorTxHash ||
          ''
      ).trim();
    const anchorContract = String(job?.anchorRegistry || process.env.ERC8183_JOB_ANCHOR_REGISTRY || '').trim();

    return {
      schemaVersion: 'kiteclaw-public-evidence-v1',
      traceId: String(traceId || '').trim(),
      state: normalizeExecutionState(
        workflow?.state || reqItem?.status || job?.state || purchase?.state || '',
        'unknown'
      ),
      sourceLane: job ? 'job' : purchase ? 'buy' : 'workflow',
      paymentProof: reqItem?.paymentProof || x402?.proofVerification || null,
      paymentTxHash: String(x402?.paymentTxHash || workflow?.txHash || '').trim(),
      authorizedBy: String(runtimeSnapshot.authorizedBy || '').trim(),
      authorizationMode: String(runtimeSnapshot.authorizationMode || '').trim(),
      authorizationPayloadHash: String(jobAudit?.authorizationPayloadHash || runtimeSnapshot.authorizationPayloadHash || '').trim(),
      authorizationExpiresAt: Number(jobAudit?.authorizationExpiresAt || runtimeSnapshot.authorizationExpiresAt || 0),
      allowedCapabilities: Array.isArray(jobAudit?.allowedCapabilities)
        ? jobAudit.allowedCapabilities
        : Array.isArray(runtimeSnapshot.allowedCapabilities)
          ? runtimeSnapshot.allowedCapabilities
          : [],
      approvalState: String(jobAudit?.approvalState || '').trim(),
      approvalReasonCode: String(jobAudit?.approvalReasonCode || '').trim(),
      approvalDecidedBy: String(jobAudit?.approvalDecidedBy || '').trim(),
      approvalPolicy:
        jobAudit?.approvalPolicy && typeof jobAudit.approvalPolicy === 'object' ? jobAudit.approvalPolicy : {},
      deadline: jobAudit?.deadline || null,
      contractPrimitives: jobAudit?.contractPrimitives || null,
      deliveryStandard: jobAudit?.deliveryStandard || null,
      authorityId: String(authorityEnvelope?.authorityId || '').trim(),
      authoritySummary:
        authorityEnvelope?.authoritySummary && typeof authorityEnvelope.authoritySummary === 'object'
          ? authorityEnvelope.authoritySummary
          : null,
      policySnapshotHash: String(authorityEnvelope?.policySnapshotHash || '').trim(),
      intentId: String(authorityEnvelope?.intentId || '').trim(),
      apiResult:
        exportPayload?.apiResult && typeof exportPayload.apiResult === 'object'
          ? {
              summary: String(exportPayload.apiResult.summary || '').trim(),
              responseHash: String(exportPayload.apiResult.responseHash || '').trim(),
              responseSignature: String(exportPayload.apiResult.responseSignature || '').trim(),
              signer: String(exportPayload.apiResult.signer || '').trim(),
              signatureScheme: String(exportPayload.apiResult.signatureScheme || '').trim(),
              signatureAvailable: Boolean(exportPayload.apiResult.signatureAvailable)
            }
          : null,
      jobAnchorTxHash,
      anchorContract,
      anchorNetwork: 'kite-testnet',
      issuedAt: String(exportPayload?.exportedAt || new Date().toISOString()).trim(),
      evidenceRef: `/api/public/evidence/${encodeURIComponent(String(traceId || '').trim())}`,
      receiptRef: String(jobAudit?.receiptRef || job?.receiptRef || purchase?.receiptRef || '').trim(),
      requestId: String(x402?.requestId || workflow?.requestId || '').trim()
    };
  };

  const routeContext = {
    app,
    deps,
    helpers: {
      buildA2AReceipt,
      buildEvidenceExportPayloadForTrace,
      buildJobAuditSnapshot,
      buildLatestWorkflowByRequestId,
      buildPublicEvidenceView,
      buildResponseHash,
      buildTraceXmtpEvidence,
      fetchXReaderDigest,
      getLatestIdentityChallengeSnapshot,
      hydrateJobForRead,
      mapX402Item,
      normalizeExecutionState,
      normalizeXReaderParams,
      parseExcerptMaxChars,
      signResponseHash
    }
  };

  registerReceiptEvidenceEvidenceRoutes(routeContext);
  registerReceiptEvidenceReceiptRoutes(routeContext);
}
