import { mergeJobWithEscrowRead } from '../../lib/escrowReadModel.js';
import {
  buildDeliveryStandard,
  normalizeDeliveryEvidence
} from '../../lib/deliverySchemas/index.js';

export function normalizeText(value = '') {
  return String(value || '').trim();
}

export function normalizeEscrowState(value = '') {
  const raw = normalizeText(value).toLowerCase();
  if (['not_configured', 'funded', 'accepted', 'submitted', 'completed', 'rejected', 'expired'].includes(raw)) {
    return raw;
  }
  return '';
}

export function normalizeJobState(value = '') {
  const raw = normalizeText(value).toLowerCase();
  if (
    [
      'created',
      'funding_pending',
      'funding_failed',
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

export function hasEscrowBacking(job = {}) {
  return Boolean(normalizeText(job?.escrowAmount) && normalizeText(job?.executor) && normalizeText(job?.validator));
}

export function isTerminalJobState(state = '') {
  return ['completed', 'rejected', 'approval_rejected', 'approval_expired', 'expired', 'failed', 'funding_failed'].includes(
    normalizeJobState(state)
  );
}

export function createSharedJobStateHelpers(deps = {}) {
  const {
    PORT,
    appendReputationSignal,
    appendValidationRecord,
    createTraceId,
    ensureServiceCatalog,
    getEscrowJob,
    normalizeAddress,
    publishJobLifecycleAnchorOnChain,
    readJobs
  } = deps;

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

  function parseApprovedFlag(value) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (['1', 'true', 'yes', 'on', 'approve', 'approved'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'reject', 'rejected'].includes(normalized)) return false;
    return null;
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

  function buildJobView(job = {}, buildApprovalPolicySnapshot = () => ({})) {
    const materialized = materializeJob(job);
    const approvalPolicy = buildApprovalPolicySnapshot(materialized, materialized?.approvalPolicy);
    const delivery =
      materialized?.delivery && typeof materialized.delivery === 'object' && !Array.isArray(materialized.delivery)
        ? materialized.delivery
        : null;
    const deliveryEvidence = normalizeDeliveryEvidence(delivery, {
      primaryTraceId: normalizeText(materialized?.traceId),
      primaryEvidenceRef:
        normalizeText(materialized?.evidenceRef) ||
        (normalizeText(materialized?.traceId)
          ? `/api/evidence/export?traceId=${encodeURIComponent(normalizeText(materialized.traceId))}`
          : ''),
      paymentRequestId: normalizeText(materialized?.paymentRequestId),
      paymentTxHash: normalizeText(materialized?.paymentTxHash),
      receiptRefs: [
        normalizeText(materialized?.receiptRef) ||
          (normalizeText(materialized?.paymentRequestId)
            ? `/api/receipt/${encodeURIComponent(normalizeText(materialized.paymentRequestId))}`
            : '')
      ]
    });
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
      fundIntentId: normalizeText(materialized?.fundIntentId),
      fundPolicySnapshotHash: normalizeText(materialized?.fundPolicySnapshotHash),
      fundAuthority:
        materialized?.fundAuthorityPublic && typeof materialized.fundAuthorityPublic === 'object'
          ? materialized.fundAuthorityPublic
          : materialized?.fundAuthority && typeof materialized.fundAuthority === 'object'
            ? materialized.fundAuthority
            : null,
      paymentRequestId: normalizeText(materialized?.paymentRequestId),
      paymentTxHash: normalizeText(materialized?.paymentTxHash),
      signerMode: normalizeText(materialized?.signerMode),
      executionMode: normalizeText(materialized?.executionMode),
      aaMethod: normalizeText(materialized?.aaMethod),
      accountVersionTag: normalizeText(materialized?.accountVersionTag),
      accountCapabilities:
        materialized?.accountCapabilities &&
        typeof materialized.accountCapabilities === 'object' &&
        !Array.isArray(materialized.accountCapabilities)
          ? materialized.accountCapabilities
          : {},
      requesterRuntimeAddress: normalizeText(materialized?.requesterRuntimeAddress),
      executorRuntimeAddress: normalizeText(materialized?.executorRuntimeAddress),
      validatorRuntimeAddress: normalizeText(materialized?.validatorRuntimeAddress),
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
      submitIntentId: normalizeText(materialized?.submitIntentId),
      submitPolicySnapshotHash: normalizeText(materialized?.submitPolicySnapshotHash),
      submitAuthority:
        materialized?.submitAuthorityPublic && typeof materialized.submitAuthorityPublic === 'object'
          ? materialized.submitAuthorityPublic
          : materialized?.submitAuthority && typeof materialized.submitAuthority === 'object'
            ? materialized.submitAuthority
            : null,
      resultRef: normalizeText(materialized?.resultRef),
      resultHash: normalizeText(materialized?.resultHash),
      delivery,
      deliverySchema: normalizeText(materialized?.deliverySchema || delivery?.schema || ''),
      deliverySchemaConformant:
        typeof materialized?.deliverySchemaConformant === 'boolean' ? materialized.deliverySchemaConformant : null,
      deliverySchemaErrors: Array.isArray(materialized?.deliverySchemaErrors) ? materialized.deliverySchemaErrors : [],
      deliveryEvidence,
      receiptRef:
        normalizeText(materialized?.receiptRef) ||
        (normalizeText(materialized?.paymentRequestId)
          ? `/api/receipt/${encodeURIComponent(normalizeText(materialized.paymentRequestId))}`
          : ''),
      evidenceRef:
        normalizeText(materialized?.evidenceRef) ||
        (normalizeText(materialized?.traceId)
          ? `/api/evidence/export?traceId=${encodeURIComponent(normalizeText(materialized.traceId))}`
          : ''),
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
      submitAnchorConfirmedAt: normalizeText(materialized?.submitAnchorConfirmedAt),
      outcomeAnchorId: normalizeText(materialized?.outcomeAnchorId),
      outcomeAnchorTxHash: normalizeText(materialized?.outcomeAnchorTxHash),
      escrowFundUserOpHash: normalizeText(materialized?.escrowFundUserOpHash),
      escrowFundTxHash: normalizeText(materialized?.escrowFundTxHash),
      escrowAcceptUserOpHash: normalizeText(materialized?.escrowAcceptUserOpHash),
      escrowAcceptTxHash: normalizeText(materialized?.escrowAcceptTxHash),
      escrowSubmitUserOpHash: normalizeText(materialized?.escrowSubmitUserOpHash),
      escrowSubmitTxHash: normalizeText(materialized?.escrowSubmitTxHash),
      escrowValidateUserOpHash: normalizeText(materialized?.escrowValidateUserOpHash),
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

  function buildJobAuditView(job = {}, buildApprovalPolicySnapshot = () => ({})) {
    const view = buildJobView(job, buildApprovalPolicySnapshot);
    const hasEscrow =
      hasEscrowBacking(view) ||
      view.escrowAddress ||
      view.escrowFundTxHash ||
      view.escrowAcceptTxHash ||
      view.escrowSubmitTxHash;
    const hasStake = Boolean(view.executorStakeAmount && Number(view.executorStakeAmount) > 0);
    const deadline = {
      expiresAt: view.expiresAt,
      expiredAt: view.expiredAt,
      isExpired: ['expired', 'approval_expired'].includes(view.state),
      autoExpireEligible: canAutoExpireJob(view),
      onchainEnforced: hasEscrowBacking(view),
      enforcementMode: hasEscrowBacking(view) ? 'onchain_job_escrow_v1' : 'backend_materialized'
    };
    const deliveryStandard = buildDeliveryStandard({
      delivery: view.delivery,
      resultHash: view.resultHash || view.submissionHash,
      outcomeAnchored: Boolean(view.outcomeAnchorTxHash),
      validatorApproved: view.state === 'completed'
    });
    const contractPrimitives = {
      escrow: {
        present: Boolean(hasEscrow),
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
        executionMode:
          view.executionMode === 'aa-native' || view.requesterRuntimeAddress || view.executorRuntimeAddress || view.validatorRuntimeAddress
            ? 'aa_account_role_enforced'
            : hasEscrowBacking(view)
              ? 'requester_executor_validator_signers'
              : 'backend_owner_only',
        requesterAddress: view.payer,
        executorAddress: view.executor,
        validatorAddress: view.validator,
        roleRuntimeSummary:
          view.executionMode === 'aa-native' || view.requesterRuntimeAddress || view.executorRuntimeAddress || view.validatorRuntimeAddress
            ? {
                requesterRuntimeAddress: view.requesterRuntimeAddress || view.payer,
                executorRuntimeAddress: view.executorRuntimeAddress || view.executor,
                validatorRuntimeAddress: view.validatorRuntimeAddress || view.validator
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
    const lifecycle = [
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
      lifecycle,
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
        primaryTraceId: view.deliveryEvidence?.primaryTraceId || view.traceId,
        primaryEvidenceRef: view.deliveryEvidence?.primaryEvidenceRef || view.evidenceRef,
        paymentRequestId: view.deliveryEvidence?.paymentRequestId || view.paymentRequestId,
        paymentTxHash: view.deliveryEvidence?.paymentTxHash || view.paymentTxHash,
        dataSourceTraceIds: Array.isArray(view.deliveryEvidence?.dataSourceTraceIds)
          ? view.deliveryEvidence.dataSourceTraceIds
          : [],
        receiptRefs: Array.isArray(view.deliveryEvidence?.receiptRefs)
          ? view.deliveryEvidence.receiptRefs
          : [view.receiptRef].filter(Boolean),
        deliveredAt: view.deliveryEvidence?.deliveredAt || view.submittedAt || '',
        receiptRef: view.receiptRef,
        evidenceRef: view.evidenceRef,
        resultRef: view.resultRef,
        resultHash: view.resultHash,
        inputHash: view.inputHash
      },
      delivery: view.delivery
    };
  }

  function buildPublicJobAuditView(job = {}, buildApprovalPolicySnapshot = () => ({})) {
    const audit = buildJobAuditView(job, buildApprovalPolicySnapshot);
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

  return {
    anchorJobLifecycle,
    appendJobTrustSignals,
    applyEscrowOutcome,
    buildJobAuditView,
    buildJobView,
    buildPublicJobAuditView,
    canAutoExpireJob,
    findJob,
    findJobByTraceId,
    hasEscrowBacking,
    hydrateJobForRead,
    invokeServiceWithRetry,
    isoToUnixSeconds,
    materializeJob,
    normalizeCapability,
    normalizeFutureIsoTimestamp,
    normalizeJobState,
    normalizePositiveNumber,
    normalizeText,
    parseApprovedFlag,
    pickAddress,
    selectService
  };
}
