import { mergeJobWithEscrowRead } from '../lib/escrowReadModel.js';

export function registerJobLaneRoutes(app, deps) {
  const {
    acceptEscrowJob,
    appendReputationSignal,
    appendValidationRecord,
    crypto,
    createTraceId,
    digestStableObject,
    ensureServiceCatalog,
    ERC8183_DEFAULT_JOB_TIMEOUT_SEC,
    ERC8183_EXECUTOR_AA_ADDRESS,
    ERC8183_EXECUTOR_OWNER_ADDRESS,
    ERC8183_EXECUTOR_STAKE_DEFAULT,
    ERC8183_REQUESTER_AA_ADDRESS,
    ERC8183_REQUESTER_OWNER_ADDRESS,
    ERC8183_VALIDATOR_AA_ADDRESS,
    ERC8183_VALIDATOR_OWNER_ADDRESS,
    expireEscrowJob,
    getInternalAgentApiKey,
    getEscrowJob,
    KTRACE_JOB_APPROVAL_THRESHOLD,
    KTRACE_JOB_APPROVAL_TTL_MS,
    lockEscrowFunds,
    normalizeAddress,
    PORT,
    publishJobLifecycleAnchorOnChain,
    readJobs,
    readSessionApprovalRequests,
    readSessionRuntime,
    resolveSessionOwnerByAaWallet,
    requireRole,
    resolveWorkflowTraceId,
    submitEscrowResult,
    upsertJobRecord,
    validateEscrowJob,
    writeSessionApprovalRequests
  } = deps;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function pickAddress(...values) {
    for (const value of values) {
      const normalized = normalizeAddress(value || '');
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeCapability(capability = '') {
    return normalizeText(capability).toLowerCase();
  }

  function normalizePositiveNumber(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return numeric;
  }

  function normalizeFutureIsoTimestamp(value = '', fallbackSeconds = 0) {
    const normalized = normalizeText(value);
    if (normalized) {
      const parsed = Date.parse(normalized);
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        return new Date(parsed).toISOString();
      }
    }
    const fallback = Number(fallbackSeconds || 0);
    if (!Number.isFinite(fallback) || fallback <= 0) return '';
    return new Date(Date.now() + fallback * 1000).toISOString();
  }

  function isoToUnixSeconds(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) return 0;
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed / 1000);
  }

  function normalizeApprovalRequestRows(rows = []) {
    const items = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
    return items
      .filter((item) => normalizeText(item?.approvalRequestId || item?.approvalId))
      .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))
      .slice(0, 2000);
  }

  function listApprovalRequests() {
    return normalizeApprovalRequestRows(readSessionApprovalRequests?.() || []);
  }

  function writeApprovalRequestRows(rows = []) {
    writeSessionApprovalRequests?.(normalizeApprovalRequestRows(rows));
    return listApprovalRequests();
  }

  function findApprovalRequest(approvalRequestId = '') {
    const normalizedId = normalizeText(approvalRequestId);
    if (!normalizedId) return null;
    return (
      listApprovalRequests().find(
        (item) => normalizeText(item?.approvalRequestId || item?.approvalId) === normalizedId
      ) || null
    );
  }

  function appendApprovalRequest(record = {}) {
    const rows = listApprovalRequests();
    rows.unshift(record);
    return writeApprovalRequestRows(rows)[0] || null;
  }

  function updateApprovalRequest(approvalRequestId = '', patch = {}) {
    const normalizedId = normalizeText(approvalRequestId);
    const rows = listApprovalRequests().map((item) =>
      normalizeText(item?.approvalRequestId || item?.approvalId) === normalizedId ? { ...item, ...patch } : item
    );
    writeApprovalRequestRows(rows);
    return findApprovalRequest(normalizedId);
  }

  function buildApprovalRequestToken() {
    return `sat_${crypto.randomBytes(18).toString('hex')}`;
  }

  function resolveApprovalFrontendBaseUrl(audience = '') {
    const explicit = String(
      process.env.KTRACE_APPROVAL_FRONTEND_URL ||
        process.env.FRONTEND_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.AGENT_NETWORK_PUBLIC_URL ||
        ''
    ).trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const fallback = String(audience || '').trim() || `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
    try {
      const url = new URL(fallback);
      if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port && url.port !== '3000') {
        url.port = '3000';
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return fallback.replace(/\/+$/, '');
    }
  }

  function buildApprovalRequestUrl(approvalRequestId = '', approvalToken = '', audience = '') {
    const frontendBaseUrl = resolveApprovalFrontendBaseUrl(audience);
    const backendBaseUrl =
      String(audience || '').trim() || `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
    try {
      const url = new URL(
        `/approval/${encodeURIComponent(normalizeText(approvalRequestId))}`,
        `${frontendBaseUrl.replace(/\/+$/, '')}/`
      );
      if (approvalToken) url.searchParams.set('token', normalizeText(approvalToken));
      if (backendBaseUrl) url.searchParams.set('backend', backendBaseUrl.replace(/\/+$/, ''));
      return url.toString();
    } catch {
      const query = new URLSearchParams();
      if (approvalToken) query.set('token', normalizeText(approvalToken));
      if (backendBaseUrl) query.set('backend', backendBaseUrl.replace(/\/+$/, ''));
      const suffix = query.toString();
      return `/approval/${encodeURIComponent(normalizeText(approvalRequestId))}${suffix ? `?${suffix}` : ''}`;
    }
  }

  function buildJobApprovalEnvelope(record = {}) {
    const approvalId = normalizeText(record?.approvalRequestId || record?.approvalId);
    const approvalToken = normalizeText(record?.approvalToken);
    const audience = normalizeText(record?.authorizationAudience || record?.audience || '');
    return {
      approvalId,
      approvalRequestId: approvalId,
      approvalKind: 'job',
      approvalState: normalizeText(record?.status).toLowerCase() || 'pending',
      approvalToken,
      approvalUrl: buildApprovalRequestUrl(approvalId, approvalToken, audience),
      createdAt: Number(record?.createdAt || 0),
      updatedAt: Number(record?.updatedAt || 0),
      expiresAt: Number(record?.expiresAt || 0),
      decidedAt: Number(record?.decidedAt || 0),
      decidedBy: normalizeText(record?.decidedBy),
      decisionNote: normalizeText(record?.decisionNote),
      reasonCode: normalizeText(record?.reasonCode || 'amount_threshold'),
      requestedByAaWallet: normalizeText(record?.requestedByAaWallet),
      requestedByOwnerEoa: normalizeText(record?.requestedByOwnerEoa),
      jobId: normalizeText(record?.jobId),
      traceId: normalizeText(record?.traceId),
      policySnapshot: record?.policySnapshot && typeof record.policySnapshot === 'object' ? record.policySnapshot : {},
      jobSnapshot: record?.jobSnapshot && typeof record.jobSnapshot === 'object' ? record.jobSnapshot : {},
      resumeStatus: normalizeText(record?.resumeStatus),
      resumeError: normalizeText(record?.resumeError)
    };
  }

  function buildApprovalPolicySnapshot(job = {}, overrides = {}) {
    const threshold = normalizePositiveNumber(
      overrides?.threshold,
      normalizePositiveNumber(KTRACE_JOB_APPROVAL_THRESHOLD, 0)
    );
    const ttlMs = Math.max(
      60_000,
      Number(
        overrides?.ttlMs ||
          overrides?.approvalTtlMs ||
          KTRACE_JOB_APPROVAL_TTL_MS ||
          0
      ) || 24 * 60 * 60 * 1000
    );
    const amount = normalizePositiveNumber(
      overrides?.amount,
      normalizePositiveNumber(job?.escrowAmount, normalizePositiveNumber(job?.budget, 0))
    );
    const currency = normalizeText(
      overrides?.currency || job?.escrowTokenAddress || process.env.KITE_SETTLEMENT_TOKEN || ''
    );
    return {
      threshold,
      ttlMs,
      amount,
      currency,
      exceeded: threshold > 0 && amount > threshold,
      reasonCode: threshold > 0 && amount > threshold ? 'amount_threshold' : ''
    };
  }

  function buildJobFundResumeToken({
    approvalId = '',
    createdAt = 0,
    job = {},
    payerAaWallet = '',
    sessionAuthorizationRef = ''
  } = {}) {
    return {
      version: 'ktrace-job-fund-resume-v1',
      operation: 'job_fund',
      approvalId: normalizeText(approvalId),
      jobId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId),
      createdAt: Number(createdAt || 0),
      fundRequest: {
        budget: normalizeText(job?.budget),
        escrowAmount: normalizeText(job?.escrowAmount || job?.budget),
        tokenAddress: normalizeText(job?.escrowTokenAddress || process.env.KITE_SETTLEMENT_TOKEN || ''),
        payerAaWallet: pickAddress(payerAaWallet, job?.payer),
        requester: pickAddress(job?.payer, ERC8183_REQUESTER_OWNER_ADDRESS, ERC8183_REQUESTER_AA_ADDRESS),
        executor: pickAddress(job?.executor, ERC8183_EXECUTOR_OWNER_ADDRESS, ERC8183_EXECUTOR_AA_ADDRESS),
        validator: pickAddress(job?.validator, ERC8183_VALIDATOR_OWNER_ADDRESS, ERC8183_VALIDATOR_AA_ADDRESS)
      },
      sessionAuthorizationRef: normalizeText(sessionAuthorizationRef || job?.authorizationId)
    };
  }

  function findActiveJobApproval(jobId = '') {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return null;
    const now = Date.now();
    return (
      listApprovalRequests().find((item) => {
        if (normalizeText(item?.approvalKind || 'session') !== 'job') return false;
        if (normalizeText(item?.jobId) !== normalizedJobId) return false;
        const status = normalizeText(item?.status).toLowerCase();
        if (!['pending', 'approved', 'completed'].includes(status)) return false;
        const expiresAt = Number(item?.expiresAt || 0);
        if (status === 'pending' && expiresAt > 0 && expiresAt <= now) return false;
        return true;
      }) || null
    );
  }

  function capabilityAliases(capability = '') {
    const normalized = normalizeCapability(capability);
    if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
      return ['technical-analysis-feed', 'risk-score-feed'];
    }
    if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
      return ['info-analysis-feed', 'x-reader-feed'];
    }
    if (['btc-price-feed', 'market-quote'].includes(normalized)) {
      return ['btc-price-feed', 'market-quote'];
    }
    if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
      return ['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'];
    }
    return [normalized].filter(Boolean);
  }

  function providerMatches(service = {}, provider = '') {
    const wanted = normalizeText(provider).toLowerCase();
    if (!wanted) return true;
    const candidates = [
      normalizeText(service?.providerAgentId).toLowerCase(),
      normalizeText(service?.id).toLowerCase(),
      normalizeText(service?.name).toLowerCase()
    ].filter(Boolean);
    return candidates.includes(wanted);
  }

  function selectService(provider = '', capability = '') {
    const aliases = capabilityAliases(capability);
    const services = ensureServiceCatalog();
    return (
      services.find((service) => {
        const action = normalizeText(service?.action).toLowerCase();
        return service?.active !== false && providerMatches(service, provider) && aliases.includes(action);
      }) || null
    );
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function isRetryableInvokeError(error = null) {
    const message = normalizeText(error?.message || error || '').toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('fetch failed') ||
      message.includes('socket hang up') ||
      message.includes('und_err_socket') ||
      message.includes('etimedout')
    );
  }

  async function invokeServiceWithRetry(serviceId = '', headers = {}, invokeBody = {}) {
    const normalizedServiceId = normalizeText(serviceId);
    let lastError = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${PORT}/api/services/${encodeURIComponent(normalizedServiceId)}/invoke`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(invokeBody)
          }
        );
        const payload = await response.json().catch(() => ({}));
        return {
          ok: response.ok && payload?.ok !== false,
          status: response.status,
          payload
        };
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableInvokeError(error)) {
          throw error;
        }
        await sleep(250 * attempt);
      }
    }

    throw lastError || new Error('service invoke failed');
  }

  function findJob(jobId = '') {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return null;
    return readJobs().find((item) => normalizeText(item?.jobId) === normalizedJobId) || null;
  }

  function findJobByTraceId(traceId = '') {
    const normalizedTraceId = normalizeText(traceId);
    if (!normalizedTraceId) return null;
    return readJobs().find((item) => normalizeText(item?.traceId) === normalizedTraceId) || null;
  }

  function normalizeJobState(value = '') {
    const raw = normalizeText(value).toLowerCase();
    if (
      [
        'created',
        'funding_pending',
        'pending_approval',
        'funded',
        'accepted',
        'submitted',
        'completed',
        'rejected',
        'approval_rejected',
        'approval_expired',
        'expired',
        'failed'
      ].includes(raw)
    ) {
      return raw;
    }
    return 'created';
  }

  function normalizeEscrowState(value = '') {
    const raw = normalizeText(value).toLowerCase();
    if (['not_configured', 'funded', 'accepted', 'submitted', 'completed', 'rejected', 'expired'].includes(raw)) {
      return raw;
    }
    return '';
  }

  function parseApprovedFlag(value) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (['1', 'true', 'yes', 'on', 'approve', 'approved'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'reject', 'rejected'].includes(normalized)) return false;
    return null;
  }

  function hasEscrowBacking(job = {}) {
    return Boolean(normalizeText(job?.escrowAmount) && normalizeText(job?.executor) && normalizeText(job?.validator));
  }

  function isTerminalJobState(state = '') {
    return ['completed', 'rejected', 'approval_rejected', 'approval_expired', 'expired', 'failed'].includes(
      normalizeJobState(state)
    );
  }

  function canAutoExpireJob(job = {}) {
    const state = normalizeJobState(job?.state);
    if (isTerminalJobState(state)) return false;
    if (!hasEscrowBacking(job)) return true;
    return ['created', 'funding_pending', 'pending_approval'].includes(state);
  }

  function materializeJob(job = {}) {
    const safeJob = job && typeof job === 'object' ? job : {};
    const normalizedState = normalizeJobState(safeJob?.state);
    const expiresAt = normalizeText(safeJob?.expiresAt);
    if (canAutoExpireJob({ ...safeJob, state: normalizedState }) && expiresAt) {
      const expiry = Date.parse(expiresAt);
      if (Number.isFinite(expiry) && Date.now() > expiry) {
        return {
          ...safeJob,
          state: 'expired',
          expiredAt: normalizeText(safeJob?.expiredAt || new Date(expiry).toISOString())
        };
      }
    }
    return {
      ...safeJob,
      state: normalizedState,
      escrowState: normalizeEscrowState(safeJob?.escrowState)
    };
  }

  async function hydrateJobForRead(job = {}) {
    if (!job || typeof job !== 'object') return null;
    const materialized = materializeJob(job);
    if (!getEscrowJob || !hasEscrowBacking(materialized) || !normalizeText(materialized?.jobId)) {
      return materialized;
    }
    try {
      const escrow = await getEscrowJob({
        jobId: normalizeText(materialized.jobId)
      });
      return materializeJob(mergeJobWithEscrowRead(materialized, escrow));
    } catch {
      return materialized;
    }
  }

  function appendJobTrustSignals(job = {}, { outcome = '', evaluator = '', evaluatorRef = '' } = {}) {
    const normalizedOutcome = normalizeJobState(outcome || job?.state);
    const providerAgentId = normalizeText(job?.provider);
    if (!providerAgentId || !['completed', 'rejected'].includes(normalizedOutcome)) {
      return {
        validationId: '',
        signalId: ''
      };
    }
    const verdict = normalizedOutcome === 'completed' ? 'positive' : 'negative';
    const score = normalizedOutcome === 'completed' ? 1 : -1;
    const createdAt = new Date().toISOString();
    const validation = appendValidationRecord?.({
      validationId: createTraceId('val'),
      agentId: providerAgentId,
      referenceType: 'job',
      referenceId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId),
      status: normalizedOutcome,
      evaluator: normalizeText(evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(evaluatorRef),
      responseRef: normalizeText(job?.resultRef || job?.submissionRef || ''),
      responseHash: normalizeText(job?.resultHash || job?.submissionHash || ''),
      summary: normalizeText(job?.summary || ''),
      createdAt
    });
    const signal = appendReputationSignal?.({
      signalId: createTraceId('rep'),
      agentId: providerAgentId,
      sourceLane: 'job',
      sourceKind: 'job',
      referenceId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId),
      paymentRequestId: normalizeText(job?.paymentRequestId),
      verdict,
      score,
      summary: normalizeText(job?.summary || ''),
      evaluator: normalizeText(evaluator || 'ktrace-job'),
      createdAt
    });
    return {
      validationId: normalizeText(validation?.validationId),
      signalId: normalizeText(signal?.signalId)
    };
  }

  function buildJobView(job = {}) {
    const materialized = materializeJob(job);
    const approvalPolicy = buildApprovalPolicySnapshot(materialized, materialized?.approvalPolicy);
    return {
      jobId: normalizeText(materialized?.jobId),
      traceId: normalizeText(materialized?.traceId),
      state: normalizeJobState(materialized?.state),
      provider: normalizeText(materialized?.provider),
      capability: normalizeText(materialized?.capability),
      budget: normalizeText(materialized?.budget),
      payer: normalizeText(materialized?.payer),
      executor: normalizeText(materialized?.executor),
      validator: normalizeText(materialized?.validator),
      escrowAmount: normalizeText(materialized?.escrowAmount),
      executorStakeAmount: normalizeText(materialized?.executorStakeAmount),
      escrowState: normalizeEscrowState(materialized?.escrowState),
      escrowAddress: normalizeText(materialized?.escrowAddress),
      escrowTokenAddress: normalizeText(materialized?.escrowTokenAddress),
      templateId: normalizeText(materialized?.templateId),
      serviceId: normalizeText(materialized?.serviceId),
      fundingRef: normalizeText(materialized?.fundingRef),
      paymentRequestId: normalizeText(materialized?.paymentRequestId),
      paymentTxHash: normalizeText(materialized?.paymentTxHash),
      signerMode: normalizeText(materialized?.signerMode),
      approvalId: normalizeText(materialized?.approvalId),
      approvalState: normalizeText(materialized?.approvalState),
      approvalReasonCode: normalizeText(materialized?.approvalReasonCode),
      approvalUrl: normalizeText(materialized?.approvalUrl),
      approvalRequestedAt: Number(materialized?.approvalRequestedAt || 0),
      approvalExpiresAt: Number(materialized?.approvalExpiresAt || 0),
      approvalDecidedAt: Number(materialized?.approvalDecidedAt || 0),
      approvalDecidedBy: normalizeText(materialized?.approvalDecidedBy),
      approvalDecisionNote: normalizeText(materialized?.approvalDecisionNote),
      approvalPolicy,
      authorizationId: normalizeText(materialized?.authorizationId),
      authorizedBy: normalizeText(materialized?.authorizedBy),
      authorizedAt: Number(materialized?.authorizedAt || 0),
      authorizationMode: normalizeText(materialized?.authorizationMode),
      authorizationPayloadHash: normalizeText(materialized?.authorizationPayloadHash),
      authorizationExpiresAt: Number(materialized?.authorizationExpiresAt || 0),
      authorizationAudience: normalizeText(materialized?.authorizationAudience),
      allowedCapabilities: Array.isArray(materialized?.allowedCapabilities) ? materialized.allowedCapabilities : [],
      inputHash: normalizeText(materialized?.inputHash),
      submissionRef: normalizeText(materialized?.submissionRef),
      submissionHash: normalizeText(materialized?.submissionHash),
      resultRef: normalizeText(materialized?.resultRef),
      resultHash: normalizeText(materialized?.resultHash),
      receiptRef: normalizeText(materialized?.receiptRef),
      evidenceRef: normalizeText(materialized?.evidenceRef),
      summary: normalizeText(materialized?.summary),
      error: normalizeText(materialized?.error),
      evaluator: normalizeText(materialized?.evaluator),
      evaluatorRef: normalizeText(materialized?.evaluatorRef),
      rejectionReason: normalizeText(materialized?.rejectionReason),
      validationId: normalizeText(materialized?.validationId),
      anchorRegistry: normalizeText(materialized?.anchorRegistry),
      createAnchorId: normalizeText(materialized?.createAnchorId),
      createAnchorTxHash: normalizeText(materialized?.createAnchorTxHash),
      fundingAnchorId: normalizeText(materialized?.fundingAnchorId),
      fundingAnchorTxHash: normalizeText(materialized?.fundingAnchorTxHash),
      acceptAnchorId: normalizeText(materialized?.acceptAnchorId),
      acceptAnchorTxHash: normalizeText(materialized?.acceptAnchorTxHash),
      submitAnchorId: normalizeText(materialized?.submitAnchorId),
      submitAnchorTxHash: normalizeText(materialized?.submitAnchorTxHash),
      outcomeAnchorId: normalizeText(materialized?.outcomeAnchorId),
      outcomeAnchorTxHash: normalizeText(materialized?.outcomeAnchorTxHash),
      escrowFundTxHash: normalizeText(materialized?.escrowFundTxHash),
      escrowAcceptTxHash: normalizeText(materialized?.escrowAcceptTxHash),
      escrowSubmitTxHash: normalizeText(materialized?.escrowSubmitTxHash),
      escrowValidateTxHash: normalizeText(materialized?.escrowValidateTxHash),
      createdAt: normalizeText(materialized?.createdAt),
      updatedAt: normalizeText(materialized?.updatedAt),
      fundedAt: normalizeText(materialized?.fundedAt),
      acceptedAt: normalizeText(materialized?.acceptedAt),
      submittedAt: normalizeText(materialized?.submittedAt),
      validatedAt: normalizeText(materialized?.validatedAt),
      completedAt: normalizeText(materialized?.completedAt),
      rejectedAt: normalizeText(materialized?.rejectedAt),
      expiredAt: normalizeText(materialized?.expiredAt),
      expiresAt: normalizeText(materialized?.expiresAt),
      input:
        materialized?.input && typeof materialized.input === 'object' && !Array.isArray(materialized.input)
          ? materialized.input
          : {}
    };
  }

  function buildJobAuditView(job = {}) {
    const view = buildJobView(job);
    const hasEscrow = Boolean(
      hasEscrowBacking(view) ||
        view.escrowAddress ||
        view.escrowFundTxHash ||
        view.escrowAcceptTxHash ||
        view.escrowSubmitTxHash
    );
    const hasStake = Boolean(view.executorStakeAmount && Number(view.executorStakeAmount) > 0);
    const deadline = {
      expiresAt: view.expiresAt,
      expiredAt: view.expiredAt,
      isExpired: ['expired', 'approval_expired'].includes(view.state),
      autoExpireEligible: canAutoExpireJob(view),
      onchainEnforced: hasEscrowBacking(view),
      enforcementMode: hasEscrowBacking(view) ? 'onchain_job_escrow_v1' : 'backend_materialized'
    };
    const deliveryStandard = {
      version: 'ktrace-delivery-v1',
      definition: 'validator_approve + result_hash_submitted + outcome_anchor_onchain',
      validatorApproved: view.state === 'completed',
      resultHashSubmitted: Boolean(view.resultHash || view.submissionHash),
      outcomeAnchored: Boolean(view.outcomeAnchorTxHash),
      satisfied: view.state === 'completed' && Boolean(view.resultHash || view.submissionHash) && Boolean(view.outcomeAnchorTxHash)
    };
    const contractPrimitives = {
      escrow: {
        present: hasEscrow,
        enforcementMode: hasEscrow ? 'onchain_role_enforced' : 'not_configured',
        contractAddress: view.escrowAddress,
        tokenAddress: view.escrowTokenAddress
      },
      conditionalPayment: {
        present: Boolean(view.escrowValidateTxHash || view.outcomeAnchorTxHash),
        enforcementMode: hasEscrow ? 'validator_outcome_then_settlement_with_stake_resolution' : 'not_configured',
        validatorRequired: Boolean(view.validator)
      },
      deadline: {
        present: Boolean(view.expiresAt),
        onchainEnforced: hasEscrowBacking(view),
        enforcementMode: deadline.enforcementMode,
        timeoutResolution: hasEscrow ? 'onchain_expire_refund_and_optional_slash' : 'backend_materialized',
        refundOnTimeout: Boolean(view.expiresAt)
      },
      roleEnforcement: {
        onchainEnforced: hasEscrowBacking(view),
        executionMode: hasEscrowBacking(view) ? 'requester_executor_validator_signers' : 'backend_owner_only',
        requesterAddress: view.payer,
        executorAddress: view.executor,
        validatorAddress: view.validator
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
    const timeline = [
      {
        key: 'created',
        label: 'Created',
        status: view.createAnchorTxHash ? 'completed' : view.state === 'created' ? 'current' : 'pending',
        at: view.createdAt,
        anchorTxHash: view.createAnchorTxHash,
        escrowTxHash: ''
      },
      {
        key: 'funded',
        label: 'Funded',
        status:
          view.fundingAnchorTxHash || view.escrowFundTxHash
            ? 'completed'
            : ['funded', 'accepted', 'submitted', 'completed', 'rejected', 'expired'].includes(view.state)
              ? 'current'
              : 'pending',
        at: view.fundedAt,
        anchorTxHash: view.fundingAnchorTxHash,
        escrowTxHash: view.escrowFundTxHash
      },
      {
        key: 'accepted',
        label: 'Accepted',
        status:
          view.acceptAnchorTxHash || view.escrowAcceptTxHash
            ? 'completed'
            : ['accepted', 'submitted', 'completed', 'rejected', 'expired'].includes(view.state)
              ? 'current'
              : 'pending',
        at: view.acceptedAt,
        anchorTxHash: view.acceptAnchorTxHash,
        escrowTxHash: view.escrowAcceptTxHash
      },
      {
        key: 'submitted',
        label: 'Submitted',
        status:
          view.submitAnchorTxHash || view.escrowSubmitTxHash
            ? 'completed'
            : ['submitted', 'completed', 'rejected', 'expired'].includes(view.state)
              ? 'current'
              : 'pending',
        at: view.submittedAt,
        anchorTxHash: view.submitAnchorTxHash,
        escrowTxHash: view.escrowSubmitTxHash
      },
      {
        key: 'outcome',
        label: 'Outcome',
        status:
          view.outcomeAnchorTxHash || view.escrowValidateTxHash
            ? 'completed'
            : ['completed', 'rejected', 'approval_rejected', 'approval_expired', 'expired', 'failed'].includes(view.state)
              ? 'current'
              : 'pending',
        at: view.validatedAt || view.completedAt || view.rejectedAt || view.expiredAt,
        anchorTxHash: view.outcomeAnchorTxHash,
        escrowTxHash: view.escrowValidateTxHash
      }
    ];

    return {
      jobId: view.jobId,
      traceId: view.traceId,
      summary: {
        state: view.state,
        provider: view.provider,
        capability: view.capability,
        requester: view.payer,
        executor: view.executor,
        validator: view.validator,
        budget: view.budget,
        escrowAmount: view.escrowAmount,
        executorStakeAmount: view.executorStakeAmount,
        escrowAddress: view.escrowAddress,
        tokenAddress: view.escrowTokenAddress,
        expiresAt: view.expiresAt
      },
      deadline,
      deliveryStandard,
      contractPrimitives,
      approvalPolicy: view.approvalPolicy,
      lifecycle: timeline,
      authorization: {
        authorizationId: view.authorizationId,
        authorizedBy: view.authorizedBy,
        authorizedAt: view.authorizedAt,
        authorizationMode: view.authorizationMode,
        authorizationPayloadHash: view.authorizationPayloadHash,
        authorizationExpiresAt: view.authorizationExpiresAt,
        authorizationAudience: view.authorizationAudience,
        allowedCapabilities: view.allowedCapabilities
      },
      humanApproval: {
        approvalId: view.approvalId,
        approvalState: view.approvalState,
        approvalReasonCode: view.approvalReasonCode,
        approvalUrl: view.approvalUrl,
        approvalRequestedAt: view.approvalRequestedAt,
        approvalExpiresAt: view.approvalExpiresAt,
        approvalDecidedAt: view.approvalDecidedAt,
        approvalDecidedBy: view.approvalDecidedBy,
        approvalDecisionNote: view.approvalDecisionNote
      },
      evidence: {
        receiptRef: view.receiptRef,
        evidenceRef: view.evidenceRef,
        resultRef: view.resultRef,
        resultHash: view.resultHash,
        inputHash: view.inputHash
      }
    };
  }

  function buildPublicJobAuditView(job = {}) {
    const audit = buildJobAuditView(job);
    return {
      ...audit,
      authorization: {
        ...audit.authorization,
        authorizationAudience: ''
      },
      humanApproval: {
        ...audit.humanApproval,
        approvalUrl: ''
      }
    };
  }

  async function anchorJobLifecycle(job = {}, anchorType = '', overrides = {}) {
    if (typeof publishJobLifecycleAnchorOnChain !== 'function') {
      return {
        configured: false,
        published: false
      };
    }
    return publishJobLifecycleAnchorOnChain({
      anchorType,
      jobId: normalizeText(job?.jobId),
      traceId: normalizeText(overrides?.traceId || job?.traceId),
      providerId: normalizeText(overrides?.providerId || job?.provider),
      capability: normalizeText(overrides?.capability || job?.capability),
      status: normalizeText(overrides?.status || job?.state),
      paymentRequestId: normalizeText(overrides?.paymentRequestId || job?.paymentRequestId),
      paymentTxHash: normalizeText(overrides?.paymentTxHash || job?.paymentTxHash),
      validationId: normalizeText(overrides?.validationId || job?.validationId),
      referenceId: normalizeText(overrides?.referenceId || ''),
      detailsURI: normalizeText(overrides?.detailsURI || `/api/jobs/${encodeURIComponent(normalizeText(job?.jobId))}`)
    });
  }

  function applyEscrowOutcome(job = {}, result = {}, fallbackState = '') {
    if (!result?.configured) {
      return {
        ...job,
        escrowState: normalizeEscrowState(fallbackState || job?.escrowState || 'not_configured')
      };
    }
    return {
      ...job,
      escrowState: normalizeEscrowState(result?.escrowState || fallbackState || job?.escrowState),
      escrowAddress: normalizeText(result?.contractAddress || job?.escrowAddress),
      escrowTokenAddress: normalizeText(result?.tokenAddress || job?.escrowTokenAddress)
    };
  }

  app.post('/api/jobs', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const provider = normalizeText(body.provider);
    const capability = normalizeCapability(body.capability);
    const budget = normalizeText(body.budget);
    const runtime = readSessionRuntime();
    const payer = pickAddress(
      body.requesterAddress,
      body.requester,
      body.payer,
      runtime?.owner,
      resolveSessionOwnerByAaWallet?.(runtime?.aaWallet || ''),
      runtime?.aaWallet,
      ERC8183_REQUESTER_OWNER_ADDRESS,
      ERC8183_REQUESTER_AA_ADDRESS
    );
    const executor = pickAddress(
      body.executorAddress,
      body.executor,
      ERC8183_EXECUTOR_OWNER_ADDRESS,
      ERC8183_EXECUTOR_AA_ADDRESS
    );
    const validator = pickAddress(
      body.validatorAddress,
      body.validator,
      ERC8183_VALIDATOR_OWNER_ADDRESS,
      ERC8183_VALIDATOR_AA_ADDRESS
    );
    const escrowAmount = normalizeText(body.escrowAmount || budget);
    const input = body?.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
    const expiresAt = normalizeFutureIsoTimestamp(
      body.expiresAt || '',
      Number(ERC8183_DEFAULT_JOB_TIMEOUT_SEC || 0)
    );
    const executorStakeAmount = normalizeText(
      body.executorStakeAmount || body.executorStake || ERC8183_EXECUTOR_STAKE_DEFAULT || ''
    );
    const evaluator = normalizeText(body.evaluator || '');
    const evaluatorRef = normalizeText(body.evaluatorRef || '');
    const templateId = normalizeText(body.templateId || '');
    const authorizationId = normalizeText(runtime?.authorizationId || '');
    const authorizedBy = pickAddress(runtime?.authorizedBy);
    const authorizationMode = normalizeText(runtime?.authorizationMode || '');
    const authorizationPayloadHash = normalizeText(runtime?.authorizationPayloadHash || '');
    const authorizationAudience = normalizeText(runtime?.authorizationAudience || '');
    const authorizationExpiresAt = Number(runtime?.authorizationExpiresAt || 0);
    const authorizedAt = Number(runtime?.authorizedAt || 0);
    const allowedCapabilities = Array.isArray(runtime?.allowedCapabilities)
      ? runtime.allowedCapabilities.map((item) => normalizeText(item)).filter(Boolean)
      : [];

    if (!provider) {
      return res.status(400).json({ ok: false, error: 'provider_required', reason: 'provider is required' });
    }
    if (!capability) {
      return res.status(400).json({ ok: false, error: 'capability_required', reason: 'capability is required' });
    }
    if (!budget) {
      return res.status(400).json({ ok: false, error: 'budget_required', reason: 'budget is required' });
    }
    if (!payer) {
      return res.status(400).json({ ok: false, error: 'payer_required', reason: 'payer is required' });
    }
    if (!executor) {
      return res.status(400).json({ ok: false, error: 'executor_required', reason: 'executor is required' });
    }
    if (!validator) {
      return res.status(400).json({ ok: false, error: 'validator_required', reason: 'validator is required' });
    }
    if (!escrowAmount) {
      return res.status(400).json({ ok: false, error: 'escrow_amount_required', reason: 'escrowAmount is required' });
    }

    const now = new Date().toISOString();
    const traceId = resolveWorkflowTraceId(body.traceId || createTraceId('job'));
    const inputHash =
      normalizeText(body.inputHash || '') ||
      digestStableObject?.({
        scope: 'ktrace-job-input-v1',
        traceId,
        provider,
        capability,
        input
      })?.value ||
      '';
    const job = {
      jobId: createTraceId('job'),
      traceId,
      state: 'created',
      provider,
      capability,
      budget,
      payer,
      executor,
      validator,
      escrowAmount,
      executorStakeAmount,
      escrowState: '',
      escrowAddress: '',
      escrowTokenAddress: '',
      templateId,
      serviceId: '',
      fundingRef: '',
      paymentRequestId: '',
      paymentTxHash: '',
      signerMode: '',
      approvalId: '',
      approvalState: '',
      approvalReasonCode: '',
      approvalUrl: '',
      approvalRequestedAt: 0,
      approvalExpiresAt: 0,
      approvalDecidedAt: 0,
      approvalDecidedBy: '',
      approvalDecisionNote: '',
      authorizationId,
      authorizedBy,
      authorizedAt,
      authorizationMode,
      authorizationPayloadHash,
      authorizationExpiresAt,
      authorizationAudience,
      allowedCapabilities,
      inputHash,
      submissionRef: '',
      submissionHash: '',
      receiptRef: '',
      evidenceRef: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : '',
      summary: 'Job created.',
      error: '',
      evaluator,
      evaluatorRef,
      rejectionReason: '',
      validationId: '',
      anchorRegistry: '',
      createAnchorId: '',
      createAnchorTxHash: '',
      fundingAnchorId: '',
      fundingAnchorTxHash: '',
      acceptAnchorId: '',
      acceptAnchorTxHash: '',
      submitAnchorId: '',
      submitAnchorTxHash: '',
      outcomeAnchorId: '',
      outcomeAnchorTxHash: '',
      escrowFundTxHash: '',
      escrowAcceptTxHash: '',
      escrowSubmitTxHash: '',
      escrowValidateTxHash: '',
      resultRef: '',
      resultHash: '',
      createdAt: now,
      updatedAt: now,
      fundedAt: '',
      acceptedAt: '',
      submittedAt: '',
      validatedAt: '',
      completedAt: '',
      rejectedAt: '',
      expiredAt: '',
      expiresAt,
      input
    };
    let next = job;
    try {
      const anchor = await anchorJobLifecycle(job, 'created', {
        referenceId: normalizeText(job?.jobId)
      });
      next = {
        ...job,
        anchorRegistry: normalizeText(anchor?.registryAddress || job.anchorRegistry),
        createAnchorId: normalizeText(anchor?.anchorId || job.createAnchorId),
        createAnchorTxHash: normalizeText(anchor?.anchorTxHash || job.createAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_create_anchor_failed',
          reason: normalizeText(error?.message || 'job create anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/fund', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (!['created', 'funding_pending', 'pending_approval'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_fundable',
        reason: `job state ${normalizeJobState(job.state)} cannot be funded`
      });
    }

    const body = req.body || {};
    const approvalThreshold = normalizePositiveNumber(KTRACE_JOB_APPROVAL_THRESHOLD, 0);
    const approvalTtlMs = Math.max(60_000, Number(KTRACE_JOB_APPROVAL_TTL_MS || 0) || 24 * 60 * 60 * 1000);
    const escrowAmountNumeric = normalizePositiveNumber(job.escrowAmount, normalizePositiveNumber(job.budget, 0));
    const approvalPolicy = buildApprovalPolicySnapshot(job, {
      threshold: approvalThreshold,
      ttlMs: approvalTtlMs,
      amount: escrowAmountNumeric,
      currency: normalizeText(job.escrowTokenAddress || process.env.KITE_SETTLEMENT_TOKEN || '')
    });
    const approvalId = normalizeText(body.approvalId || body.approvalRequestId);
    const approvalToken = normalizeText(body.token || body.approvalToken);
    const nowMs = Date.now();

    if (normalizeJobState(job.state) === 'pending_approval') {
      const approvalRecord = findApprovalRequest(approvalId || job.approvalId);
      if (!approvalRecord || normalizeText(approvalRecord?.approvalKind || 'session') !== 'job') {
        return res.status(409).json({
          ok: false,
          error: 'approval_required',
          reason: 'Job funding is waiting for human approval.'
        });
      }
      if (approvalToken && approvalToken !== normalizeText(approvalRecord?.approvalToken)) {
        return res.status(403).json({
          ok: false,
          error: 'approval_token_invalid',
          reason: 'approval token is invalid'
        });
      }
      const approvalStatus = normalizeText(approvalRecord?.status).toLowerCase();
      const approvalExpiresAt = Number(approvalRecord?.expiresAt || 0);
      if (approvalStatus === 'pending' && approvalExpiresAt > 0 && approvalExpiresAt <= nowMs) {
        const expiredRecord = updateApprovalRequest(normalizeText(approvalRecord?.approvalRequestId), {
          status: 'expired',
          updatedAt: nowMs,
          completedAt: nowMs,
          resumeStatus: 'expired'
        });
        const expiredJob = {
          ...job,
          state: 'approval_expired',
          approvalState: 'expired',
          approvalExpiresAt,
          updatedAt: new Date().toISOString(),
          summary: 'Job approval expired before funding.',
          error: 'approval_expired'
        };
        upsertJobRecord(expiredJob);
        return res.status(409).json({
          ok: false,
          error: 'approval_expired',
          reason: 'Job approval expired before funding.',
          approval: buildJobApprovalEnvelope(expiredRecord || approvalRecord),
          job: buildJobView(expiredJob)
        });
      }
      if (!['approved', 'completed'].includes(approvalStatus)) {
        return res.status(409).json({
          ok: false,
          error: 'approval_required',
          reason: 'Job funding is waiting for human approval.',
          approval: buildJobApprovalEnvelope(approvalRecord),
          job: buildJobView(job)
        });
      }
    } else if (approvalThreshold > 0 && escrowAmountNumeric > approvalThreshold) {
      const existingApproval = findActiveJobApproval(job.jobId);
      if (existingApproval) {
        const pendingJob = {
          ...job,
          state: 'pending_approval',
          approvalId: normalizeText(existingApproval?.approvalRequestId),
          approvalState: normalizeText(existingApproval?.status),
          approvalReasonCode: normalizeText(existingApproval?.reasonCode || 'amount_threshold'),
          approvalUrl: buildApprovalRequestUrl(
            existingApproval?.approvalRequestId,
            existingApproval?.approvalToken,
            existingApproval?.authorizationAudience || ''
          ),
          approvalRequestedAt: Number(existingApproval?.createdAt || 0),
          approvalExpiresAt: Number(existingApproval?.expiresAt || 0),
          approvalPolicy: {
            ...approvalPolicy,
            ...(existingApproval?.policySnapshot && typeof existingApproval.policySnapshot === 'object'
              ? existingApproval.policySnapshot
              : {})
          },
          updatedAt: new Date().toISOString(),
          summary: 'Job funding is waiting for human approval.',
          error: ''
        };
        upsertJobRecord(pendingJob);
        return res.status(202).json({
          ok: true,
          traceId: req.traceId || '',
          state: 'pending_approval',
          approval: buildJobApprovalEnvelope(existingApproval),
          job: buildJobView(pendingJob)
        });
      }

      const runtime = readSessionRuntime() || {};
      const requestedByAaWallet = pickAddress(runtime?.aaWallet, body.payerAaWallet, body.payer, job.payer);
      const requestedByOwnerEoa = pickAddress(
        runtime?.owner,
        resolveSessionOwnerByAaWallet?.(requestedByAaWallet || ''),
        job?.payer,
        runtime?.authorizedBy
      );
      const createdAt = nowMs;
      const expiresAt = createdAt + approvalTtlMs;
      const approvalRequestId = createTraceId('apr');
      const createdApproval = appendApprovalRequest({
        approvalKind: 'job',
        approvalRequestId,
        approvalToken: buildApprovalRequestToken(),
        jobId: normalizeText(job.jobId),
        traceId: normalizeText(job.traceId),
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        reasonCode: 'amount_threshold',
        requestedByAaWallet,
        requestedByOwnerEoa,
        requestedAction: 'job_fund',
        authorizationAudience: `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`,
        authorizationId: normalizeText(job.authorizationId),
        sessionAuthorizationRef: normalizeText(job.authorizationId),
        approvalPayloadHash: normalizeText(job.authorizationPayloadHash),
        policySnapshot: {
          ...approvalPolicy
        },
        jobSnapshot: buildJobView(job),
        resumeToken: buildJobFundResumeToken({
          approvalId: approvalRequestId,
          createdAt,
          job,
          payerAaWallet: requestedByAaWallet,
          sessionAuthorizationRef: normalizeText(job.authorizationId)
        }),
        resumeStatus: 'pending'
      });
      const approval = buildJobApprovalEnvelope(createdApproval);
        const pendingJob = {
          ...job,
          state: 'pending_approval',
        approvalId: approval.approvalId,
        approvalState: approval.approvalState,
        approvalReasonCode: approval.reasonCode,
        approvalUrl: approval.approvalUrl,
          approvalRequestedAt: approval.createdAt,
          approvalExpiresAt: approval.expiresAt,
          approvalPolicy,
          updatedAt: new Date(createdAt).toISOString(),
          summary: 'Job funding is waiting for human approval.',
        error: ''
      };
      upsertJobRecord(pendingJob);
      return res.status(202).json({
        ok: true,
        traceId: req.traceId || '',
        state: 'pending_approval',
        approval,
        job: buildJobView(pendingJob)
      });
    }

    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'funded',
      fundingRef: createTraceId('job_fund'),
      paymentRequestId: normalizeText(job?.paymentRequestId || createTraceId('job_payment')),
      paymentTxHash: '',
      signerMode: 'backend-signer-escrow',
      approvalState: job.approvalId ? 'completed' : job.approvalState,
      summary: 'Job funds locked in escrow.',
      error: '',
      fundedAt: now,
      updatedAt: now
    };
    try {
      const escrow = await lockEscrowFunds?.({
        jobId: next.jobId,
        requester: pickAddress(next.payer, ERC8183_REQUESTER_OWNER_ADDRESS, ERC8183_REQUESTER_AA_ADDRESS),
        executor: pickAddress(next.executor, ERC8183_EXECUTOR_OWNER_ADDRESS, ERC8183_EXECUTOR_AA_ADDRESS),
        validator: pickAddress(next.validator, ERC8183_VALIDATOR_OWNER_ADDRESS, ERC8183_VALIDATOR_AA_ADDRESS),
        amount: next.escrowAmount,
        deadlineAt: isoToUnixSeconds(next.expiresAt),
        executorStakeAmount: next.executorStakeAmount
      });
      next = applyEscrowOutcome(
        {
          ...next,
          signerMode: escrow?.configured ? 'backend-signer-escrow' : 'degraded-local',
          summary: escrow?.configured ? 'Job funds locked in escrow.' : 'Job funded locally. Escrow not configured.',
          escrowFundTxHash: normalizeText(escrow?.txHash),
          paymentTxHash: normalizeText(escrow?.txHash || next.paymentTxHash)
        },
        escrow,
        escrow?.configured ? 'funded' : 'not_configured'
      );
      const anchor = await anchorJobLifecycle(next, 'funded', {
        referenceId: normalizeText(next?.escrowFundTxHash || next?.fundingRef || next?.paymentRequestId),
        paymentTxHash: normalizeText(next?.escrowFundTxHash || next?.paymentTxHash)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        fundingAnchorId: normalizeText(anchor?.anchorId || next.fundingAnchorId),
        fundingAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.fundingAnchorTxHash)
      };
      if (normalizeText(job?.approvalId)) {
        updateApprovalRequest(normalizeText(job.approvalId), {
          status: 'completed',
          updatedAt: Date.now(),
          completedAt: Date.now(),
          resumeStatus: 'completed',
          resumeError: '',
          decisionNote: normalizeText(job?.approvalDecisionNote)
        });
        next = {
          ...next,
          approvalState: 'completed'
        };
      }
    } catch (error) {
      if (normalizeText(job?.approvalId)) {
        updateApprovalRequest(normalizeText(job.approvalId), {
          status: normalizeText(job?.approvalState || 'approved') || 'approved',
          updatedAt: Date.now(),
          resumeStatus: 'failed',
          resumeError: normalizeText(error?.message || 'job fund failed')
        });
      }
      return res.status(500).json({
        ok: false,
        error: 'job_fund_failed',
        reason: normalizeText(error?.message || 'job fund failed'),
        traceId: req.traceId || ''
      });
    }
    upsertJobRecord(next);

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/accept', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (normalizeJobState(job.state) !== 'funded') {
      return res.status(409).json({
        ok: false,
        error: 'job_not_acceptable',
        reason: `job state ${normalizeJobState(job.state)} cannot be accepted`
      });
    }

    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'accepted',
      summary: 'Job accepted by executor.',
      error: '',
      acceptedAt: now,
      updatedAt: now
    };

    try {
      const escrow = await acceptEscrowJob?.({
        jobId: next.jobId
      });
      next = applyEscrowOutcome(
        {
          ...next,
          summary: escrow?.configured ? 'Job accepted by executor.' : 'Job accepted locally. Escrow not configured.',
          escrowAcceptTxHash: normalizeText(escrow?.txHash)
        },
        escrow,
        escrow?.configured ? 'accepted' : 'not_configured'
      );
      const anchor = await anchorJobLifecycle(next, 'accepted', {
        referenceId: normalizeText(next?.escrowAcceptTxHash || next?.jobId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        acceptAnchorId: normalizeText(anchor?.anchorId || next.acceptAnchorId),
        acceptAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.acceptAnchorTxHash)
      };
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'job_accept_failed',
        reason: normalizeText(error?.message || 'job accept failed'),
        traceId: req.traceId || ''
      });
    }

    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/submit', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (normalizeJobState(job.state) !== 'accepted') {
      return res.status(409).json({
        ok: false,
        error: 'job_not_submittable',
        reason: `job state ${normalizeJobState(job.state)} cannot be submitted`
      });
    }

    const input =
      req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input)
        ? req.body.input
        : job.input || {};
    const service = selectService(job.provider, job.capability);
    if (!service) {
      return res.status(404).json({
        ok: false,
        error: 'service_not_found',
        reason: `No active service matched provider=${job.provider} capability=${job.capability}.`
      });
    }

    const internalApiKey = getInternalAgentApiKey();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (internalApiKey) {
      headers['x-api-key'] = internalApiKey;
    }

    const invokeBody = {
      ...input,
      traceId: job.traceId,
      payer: job.payer
    };

    try {
      const invokeResult = await invokeServiceWithRetry(normalizeText(service.id), headers, invokeBody);
      const response = {
        ok: invokeResult.ok,
        status: invokeResult.status
      };
      const payload = invokeResult.payload || {};
      const workflow = payload?.workflow || {};
      const requestId = normalizeText(payload?.requestId || workflow?.requestId);
      const traceId = normalizeText(payload?.traceId || workflow?.traceId || job.traceId);
      const txHash = normalizeText(payload?.txHash || workflow?.txHash);
      const summary =
        normalizeText(workflow?.result?.summary || payload?.receipt?.result?.summary || payload?.reason || '') ||
        'Job submitted for validation.';
      const resultHash =
        normalizeText(payload?.resultHash || '') ||
        (digestStableObject?.({
          scope: 'ktrace-job-result-v3',
          jobId: job.jobId,
          traceId,
          requestId,
          txHash,
          summary,
          input
        })?.value ||
          '');

      if (!response.ok) {
        const failed = {
          ...job,
          state: 'accepted',
          error: normalizeText(payload?.reason || payload?.error || 'job submit failed'),
          summary: normalizeText(payload?.reason || payload?.error || 'job submit failed'),
          updatedAt: new Date().toISOString(),
          input
        };
        upsertJobRecord(failed);
        return res.status(response.status).json({
          ok: false,
          traceId: req.traceId || '',
          error: 'job_submit_failed',
          reason: failed.error,
          job: buildJobView(failed),
          workflow: workflow && typeof workflow === 'object' ? workflow : null,
          receipt: payload?.receipt || null
        });
      }

      const now = new Date().toISOString();
      let next = {
        ...job,
        traceId: traceId || job.traceId,
        state: 'submitted',
        provider: normalizeText(service.providerAgentId || job.provider),
        capability: normalizeText(service.action || job.capability),
        serviceId: normalizeText(service.id),
        submissionRef: `/api/jobs/${encodeURIComponent(job.jobId)}`,
        submissionHash:
          digestStableObject?.({
            scope: 'ktrace-job-submission-v2',
            jobId: job.jobId,
            traceId,
            input,
            requestId,
            txHash,
            resultHash
          })?.value || '',
        paymentRequestId: requestId || job.paymentRequestId,
        paymentTxHash: txHash || job.paymentTxHash,
        receiptRef: requestId ? `/api/receipt/${encodeURIComponent(requestId)}` : '',
        evidenceRef: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : '',
        summary,
        error: '',
        submittedAt: now,
        updatedAt: now,
        resultRef: normalizeText(payload?.resultRef || '') || `/api/jobs/${encodeURIComponent(job.jobId)}`,
        resultHash,
        input
      };

      const escrow = await submitEscrowResult?.({
        jobId: next.jobId,
        resultHash: next.resultHash
      });
      next = applyEscrowOutcome(
        {
          ...next,
          summary: escrow?.configured ? summary : `${summary} Escrow not configured.`,
          escrowSubmitTxHash: normalizeText(escrow?.txHash)
        },
        escrow,
        escrow?.configured ? 'submitted' : 'not_configured'
      );
      const anchor = await anchorJobLifecycle(next, 'submitted', {
        referenceId: normalizeText(next?.resultRef || next?.submissionRef || next?.jobId),
        paymentTxHash: normalizeText(next?.escrowSubmitTxHash || next?.paymentTxHash)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        submitAnchorId: normalizeText(anchor?.anchorId || next.submitAnchorId),
        submitAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.submitAnchorTxHash)
      };
      upsertJobRecord(next);

      return res.status(response.status).json({
        ok: true,
        traceId: req.traceId || '',
        job: buildJobView(next),
        workflow: workflow && typeof workflow === 'object' ? workflow : null,
        receipt: payload?.receipt || null
      });
    } catch (error) {
      const next = {
        ...job,
        state: 'accepted',
        error: normalizeText(error?.message || 'job submit failed'),
        summary: normalizeText(error?.message || 'job submit failed'),
        updatedAt: new Date().toISOString()
      };
      upsertJobRecord(next);
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'job_submit_failed',
        reason: next.error,
        job: buildJobView(next)
      });
    }
  });

  app.post('/api/jobs/:jobId/validate', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (normalizeJobState(job.state) !== 'submitted') {
      return res.status(409).json({
        ok: false,
        error: 'job_not_validatable',
        reason: `job state ${normalizeJobState(job.state)} cannot be validated`
      });
    }

    const body = req.body || {};
    const approved = parseApprovedFlag(body.approved);
    if (approved === null) {
      return res.status(400).json({
        ok: false,
        error: 'validation_decision_required',
        reason: 'approved must be true or false'
      });
    }

    const validatorAddress = pickAddress(
      body.validatorAddress,
      body.validator,
      ERC8183_VALIDATOR_OWNER_ADDRESS,
      ERC8183_VALIDATOR_AA_ADDRESS
    );
    if (
      !validatorAddress ||
      validatorAddress !== pickAddress(job.validator, ERC8183_VALIDATOR_OWNER_ADDRESS, ERC8183_VALIDATOR_AA_ADDRESS)
    ) {
      return res.status(403).json({
        ok: false,
        error: 'validator_mismatch',
        reason: 'validatorAddress must match the job validator'
      });
    }

    const now = new Date().toISOString();
    let next = {
      ...job,
      state: approved ? 'completed' : 'rejected',
      summary: normalizeText(body.summary || (approved ? 'Job approved and escrow released.' : 'Job rejected and requester refunded with any slashed stake.')),
      rejectionReason: approved ? '' : normalizeText(body.reason || body.summary || 'Job rejected by validator.'),
      evaluator: normalizeText(body.evaluator || validatorAddress || job.evaluator || 'ktrace-job-validator'),
      evaluatorRef: normalizeText(body.evaluatorRef || job.evaluatorRef || ''),
      error: '',
      validatedAt: now,
      completedAt: approved ? now : job.completedAt,
      rejectedAt: approved ? job.rejectedAt : now,
      updatedAt: now
    };

    try {
      const escrow = await validateEscrowJob?.({
        jobId: next.jobId,
        approved
      });
      next = applyEscrowOutcome(
        {
          ...next,
          escrowValidateTxHash: normalizeText(escrow?.txHash)
        },
        escrow,
        approved ? 'completed' : 'rejected'
      );
      const trust = appendJobTrustSignals(next, {
        outcome: next.state,
        evaluator: next.evaluator,
        evaluatorRef: next.evaluatorRef
      });
      next = {
        ...next,
        validationId: trust.validationId || next.validationId
      };
      const anchor = await anchorJobLifecycle(next, approved ? 'completed' : 'rejected', {
        referenceId: normalizeText(next?.resultRef || next?.jobId),
        validationId: normalizeText(next?.validationId),
        paymentTxHash: normalizeText(next?.escrowValidateTxHash || next?.paymentTxHash)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'job_validate_failed',
        reason: normalizeText(error?.message || 'job validate failed'),
        traceId: req.traceId || ''
      });
    }

    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.get('/api/jobs/:jobId', requireRole('viewer'), async (req, res) => {
    const job = await hydrateJobForRead(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(job)
    });
  });

  app.get('/api/jobs/:jobId/audit', requireRole('viewer'), async (req, res) => {
    const job = await hydrateJobForRead(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      audit: buildJobAuditView(job)
    });
  });

  app.get('/api/public/jobs/:jobId/audit', async (req, res) => {
    const job = await hydrateJobForRead(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      audit: buildPublicJobAuditView(job)
    });
  });

  app.get('/api/public/jobs/by-trace/:traceId/audit', async (req, res) => {
    const job = await hydrateJobForRead(findJobByTraceId(req.params.traceId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', traceId: normalizeText(req.params.traceId) });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      audit: buildPublicJobAuditView(job)
    });
  });

  app.get('/api/jobs', requireRole('viewer'), async (req, res) => {
    const traceId = normalizeText(req.query.traceId || '');
    const jobId = normalizeText(req.query.jobId || '');
    const provider = normalizeText(req.query.provider || '').toLowerCase();
    const capability = normalizeCapability(req.query.capability || '');
    const state = normalizeText(req.query.state || '').toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));

    const rows = (await Promise.all(readJobs().map((item) => hydrateJobForRead(item))))
      .filter((item) => {
        if (traceId && normalizeText(item?.traceId) !== traceId) return false;
        if (jobId && normalizeText(item?.jobId) !== jobId) return false;
        if (provider && normalizeText(item?.provider).toLowerCase() !== provider) return false;
        if (capability && normalizeCapability(item?.capability) !== capability) return false;
        if (state && normalizeJobState(item?.state) !== state) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildJobView(item));

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });

  app.post('/api/jobs/:jobId/complete', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (hasEscrowBacking(job)) {
      return res.status(409).json({
        ok: false,
        error: 'job_requires_validation',
        reason: 'Escrow-backed jobs must use /api/jobs/:jobId/validate.'
      });
    }
    if (!['funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_completable',
        reason: `job state ${normalizeJobState(job.state)} cannot be completed`
      });
    }
    const body = req.body || {};
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'completed',
      summary: normalizeText(body.summary || job.summary || 'Job completed.'),
      resultRef: normalizeText(body.resultRef || job.resultRef || `/api/jobs/${encodeURIComponent(job.jobId)}`),
      resultHash:
        normalizeText(body.resultHash || job.resultHash) ||
        digestStableObject?.({
          scope: 'ktrace-job-manual-complete-v1',
          jobId: job.jobId,
          traceId: job.traceId,
          summary: normalizeText(body.summary || job.summary || 'Job completed.')
        })?.value ||
        '',
      evaluator: normalizeText(body.evaluator || job.evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(body.evaluatorRef || job.evaluatorRef || ''),
      error: '',
      completedAt: now,
      updatedAt: now
    };
    const trust = appendJobTrustSignals(next, {
      outcome: 'completed',
      evaluator: next.evaluator,
      evaluatorRef: next.evaluatorRef
    });
    next = {
      ...next,
      validationId: trust.validationId || next.validationId
    };
    try {
      const anchor = await anchorJobLifecycle(next, 'completed', {
        referenceId: normalizeText(next?.resultRef || next?.jobId),
        validationId: normalizeText(next?.validationId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_complete_anchor_failed',
          reason: normalizeText(error?.message || 'job complete anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/reject', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (hasEscrowBacking(job)) {
      return res.status(409).json({
        ok: false,
        error: 'job_requires_validation',
        reason: 'Escrow-backed jobs must use /api/jobs/:jobId/validate.'
      });
    }
    if (!['created', 'funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_rejectable',
        reason: `job state ${normalizeJobState(job.state)} cannot be rejected`
      });
    }
    const body = req.body || {};
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'rejected',
      rejectionReason: normalizeText(body.reason || body.summary || 'Job rejected.'),
      summary: normalizeText(body.summary || body.reason || 'Job rejected.'),
      evaluator: normalizeText(body.evaluator || job.evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(body.evaluatorRef || job.evaluatorRef || ''),
      error: '',
      rejectedAt: now,
      updatedAt: now
    };
    const trust = appendJobTrustSignals(next, {
      outcome: 'rejected',
      evaluator: next.evaluator,
      evaluatorRef: next.evaluatorRef
    });
    next = {
      ...next,
      validationId: trust.validationId || next.validationId
    };
    try {
      const anchor = await anchorJobLifecycle(next, 'rejected', {
        referenceId: normalizeText(next?.jobId),
        validationId: normalizeText(next?.validationId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_reject_anchor_failed',
          reason: normalizeText(error?.message || 'job reject anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/expire', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (isTerminalJobState(job.state)) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_expirable',
        reason: `job state ${normalizeJobState(job.state)} cannot be expired`
      });
    }
    const expiryMs = Date.parse(normalizeText(job.expiresAt));
    if (!Number.isFinite(expiryMs) || expiryMs > Date.now()) {
      return res.status(409).json({
        ok: false,
        error: 'job_deadline_not_reached',
        reason: 'job deadline has not been reached yet'
      });
    }
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'expired',
      summary: normalizeText(req.body?.summary || job.summary || 'Job expired.'),
      expiredAt: now,
      updatedAt: now
    };
    try {
      if (hasEscrowBacking(job) && ['funded', 'accepted', 'submitted'].includes(normalizeJobState(job.state))) {
        const escrow = await expireEscrowJob?.({
          jobId: next.jobId
        });
        next = applyEscrowOutcome(
          {
            ...next,
            escrowValidateTxHash: normalizeText(escrow?.txHash)
          },
          escrow,
          'expired'
        );
      }
      const anchor = await anchorJobLifecycle(next, 'expired', {
        referenceId: normalizeText(next?.jobId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_expire_anchor_failed',
          reason: normalizeText(error?.message || 'job expire anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });
}
