import { sendErrorResponse } from '../../lib/errorResponse.js';
import { createRequestLogger } from '../../lib/logger.js';
import {
  deriveDeliverySummary,
  normalizeDeliveryEvidence,
  validateDeliveryPayload
} from '../../lib/deliverySchemas/index.js';

const logger = createRequestLogger('job-mutation-route');

function detailObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTextList(values = []) {
  return Array.isArray(values) ? values.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
}

function sendJobRouteError(req, res, status, code, message, detail = {}) {
  const log = Number(status || 0) >= 500 ? logger.error : logger.warn;
  log(code, {
    route: req?.path || '',
    method: req?.method || '',
    error: message,
    detail
  }, req);
  return sendErrorResponse(req, res, {
    status,
    code,
    message,
    detail: detailObject(detail)
  });
}

function mapJobLaneExecutionError(error, fallbackCode = 'job_lane_execution_failed', fallbackMessage = 'job lane execution failed') {
  const detail = detailObject(error?.detail);
  const errorCode = String(error?.code || '').trim();
  const message = String(error?.message || '').trim() || fallbackMessage;
  if (errorCode === 'aa_session_execute_not_supported') {
    return {
      status: 409,
      code: 'aa_session_execute_not_supported',
      message,
      detail: {
        ...detail,
        upgradeRequired: detail.upgradeRequired !== false,
        aaAccountUpgradeRequired: detail.aaAccountUpgradeRequired !== false
      }
    };
  }
  if (errorCode === 'aa_version_mismatch') {
    return {
      status: 409,
      code: 'aa_account_upgrade_required',
      message,
      detail: {
        ...detail,
        upgradeRequired: true,
        aaAccountUpgradeRequired: true
      }
    };
  }
  if (errorCode === 'aa_account_upgrade_required') {
    return {
      status: 409,
      code: 'aa_account_upgrade_required',
      message,
      detail: {
        ...detail,
        upgradeRequired: true,
        aaAccountUpgradeRequired: true
      }
    };
  }
  if (
    [
      'runtime_not_found',
      'session_authorization_missing',
      'role_runtime_address_mismatch',
      'aa_role_not_deployed',
      'aa_session_permission_setup_required',
      'aa_allowance_required',
      'insufficient_kite_gas'
    ].includes(errorCode)
  ) {
    return {
      status: 409,
      code: errorCode,
      message,
      detail
    };
  }
  return {
    status: 500,
    code: fallbackCode,
    message,
    detail
  };
}

function normalizeAddressLike(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : '';
}

function addressesEqual(left = '', right = '') {
  const normalizedLeft = normalizeAddressLike(left);
  const normalizedRight = normalizeAddressLike(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function firstExplicitAddress(...values) {
  for (const value of values) {
    const normalized = normalizeAddressLike(value);
    if (normalized) return normalized;
  }
  return '';
}

function resolveRuntimeForAaWallet({
  aaWallet = '',
  readSessionRuntime,
  resolveSessionOwnerByAaWallet,
  resolveSessionRuntime
} = {}) {
  const normalizedAaWallet = normalizeAddressLike(aaWallet);
  const currentRuntime = readSessionRuntime?.() || {};
  if (!normalizedAaWallet) {
    return currentRuntime;
  }
  const inferredOwner = normalizeAddressLike(resolveSessionOwnerByAaWallet?.(normalizedAaWallet) || '');
  if (typeof resolveSessionRuntime === 'function') {
    const resolved = resolveSessionRuntime({
      owner: inferredOwner,
      aaWallet: normalizedAaWallet,
      strictOwnerMatch: Boolean(inferredOwner)
    });
    if (normalizeAddressLike(resolved?.aaWallet || '') === normalizedAaWallet) {
      return resolved;
    }
  }
  if (normalizeAddressLike(currentRuntime?.aaWallet || '') === normalizedAaWallet) {
    return currentRuntime;
  }
  if (inferredOwner && normalizeAddressLike(currentRuntime?.owner || '') === inferredOwner) {
    return currentRuntime;
  }
  return {};
}

export function registerJobMutationRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    ERC8183_DEFAULT_JOB_TIMEOUT_SEC,
    ERC8183_EXECUTOR_AA_ADDRESS,
    ERC8183_EXECUTOR_OWNER_ADDRESS,
    ERC8183_EXECUTOR_STAKE_DEFAULT,
    ERC8183_REQUESTER_AA_ADDRESS,
    ERC8183_REQUESTER_OWNER_ADDRESS,
    ERC8183_VALIDATOR_AA_ADDRESS,
    ERC8183_VALIDATOR_OWNER_ADDRESS,
    KTRACE_JOB_APPROVAL_THRESHOLD,
    KTRACE_JOB_APPROVAL_TTL_MS,
    PORT,
    beginConsumerIntent,
    buildAuthorityPublicSummary,
    buildAuthoritySnapshot,
    buildPolicySnapshotHash,
    createTraceId,
    digestStableObject,
    ensureServiceCatalog,
    finalizeConsumerIntent,
    getInternalAgentApiKey,
    lockEscrowFunds,
    preflightJobLaneCapability,
    prepareEscrowFunding,
    findConsumerIntent,
    readSessionRuntime,
    requireRole,
    resolveSessionOwnerByAaWallet,
    resolveSessionRuntime,
    resolveWorkflowTraceId,
    submitEscrowResult,
    upsertJobRecord,
    validateConsumerAuthority,
    validateEscrowJob,
    acceptEscrowJob
  } = deps;
  const {
    anchorJobLifecycle,
    appendApprovalRequest,
    appendJobTrustSignals,
    applyEscrowOutcome,
    buildApprovalPolicySnapshot,
    buildApprovalRequestToken,
    buildJobApprovalEnvelope,
    buildJobFundResumeToken,
    buildJobView,
    executeJobExpiry,
    findActiveJobApproval,
    findApprovalRequest,
    findJob,
    hasEscrowBacking,
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
    selectService,
    updateApprovalRequest
  } = helpers;

  function buildAuthorityErrorPayload(result = {}) {
    return {
      ok: false,
      error: normalizeText(result?.code || 'authority_validation_failed'),
      reason: normalizeText(result?.reason || 'authority validation failed'),
      authority: result?.authorityPublic || null,
      policySnapshotHash: normalizeText(result?.policySnapshotHash || ''),
      detail: detailObject(result?.detail)
    };
  }

  function buildIntentConflictDetail(result = {}) {
    const existing = result?.existing && typeof result.existing === 'object' ? result.existing : null;
    const existingJob = existing?.resultRef ? findJob(normalizeText(existing.resultRef)) : null;
    return {
      intent: existing,
      job: existingJob ? buildJobView(existingJob) : null
    };
  }

  app.post('/api/jobs', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const provider = normalizeText(body.provider);
    const capability = normalizeCapability(body.capability);
    const budget = normalizeText(body.budget);
    const explicitPayer = firstExplicitAddress(body.requesterAddress, body.requester, body.payer);
    const runtime = explicitPayer
      ? resolveRuntimeForAaWallet({
          aaWallet: explicitPayer,
          readSessionRuntime,
          resolveSessionOwnerByAaWallet,
          resolveSessionRuntime
        })
      : readSessionRuntime();
    const explicitExecutor = firstExplicitAddress(body.executorAddress, body.executor);
    const explicitValidator = firstExplicitAddress(body.validatorAddress, body.validator);
    const requesterRuntimeByOwner = typeof resolveSessionRuntime === 'function'
      ? resolveSessionRuntime({
          owner: ERC8183_REQUESTER_OWNER_ADDRESS,
          strictOwnerMatch: true
        })
      : {};
    const executorRuntimeByOwner = typeof resolveSessionRuntime === 'function'
      ? resolveSessionRuntime({
          owner: ERC8183_EXECUTOR_OWNER_ADDRESS,
          strictOwnerMatch: true
        })
      : {};
    const validatorRuntimeByOwner = typeof resolveSessionRuntime === 'function'
      ? resolveSessionRuntime({
          owner: ERC8183_VALIDATOR_OWNER_ADDRESS,
          strictOwnerMatch: true
        })
      : {};
    const requesterAaDefault = firstExplicitAddress(
      runtime?.aaWallet,
      requesterRuntimeByOwner?.aaWallet,
      ERC8183_REQUESTER_AA_ADDRESS
    );
    const executorAaDefault = firstExplicitAddress(
      executorRuntimeByOwner?.aaWallet,
      ERC8183_EXECUTOR_AA_ADDRESS
    );
    const validatorAaDefault = firstExplicitAddress(
      validatorRuntimeByOwner?.aaWallet,
      ERC8183_VALIDATOR_AA_ADDRESS
    );
    if (explicitPayer && addressesEqual(explicitPayer, runtime?.owner) && normalizeAddressLike(runtime?.aaWallet || '')) {
      return sendJobRouteError(
        req,
        res,
        400,
        'owner_eoa_submitted_for_aa_role',
        'payer must use the consumer AA wallet, not the owner EOA',
        {
          field: 'payer',
          expectedAa: normalizeText(runtime?.aaWallet || '')
        }
      );
    }
    if (
      explicitPayer &&
      addressesEqual(explicitPayer, ERC8183_REQUESTER_OWNER_ADDRESS) &&
      requesterAaDefault
    ) {
      return sendJobRouteError(
        req,
        res,
        400,
        'owner_eoa_submitted_for_aa_role',
        'payer must use the requester AA wallet, not the owner EOA',
        {
          field: 'payer',
          expectedAa: normalizeText(requesterAaDefault)
        }
      );
    }
    if (
      explicitExecutor &&
      addressesEqual(explicitExecutor, ERC8183_EXECUTOR_OWNER_ADDRESS) &&
      executorAaDefault
    ) {
      return sendJobRouteError(
        req,
        res,
        400,
        'owner_eoa_submitted_for_aa_role',
        'executor must use the executor AA wallet, not the owner EOA',
        {
          field: 'executor',
          expectedAa: normalizeText(executorAaDefault)
        }
      );
    }
    if (
      explicitValidator &&
      addressesEqual(explicitValidator, ERC8183_VALIDATOR_OWNER_ADDRESS) &&
      validatorAaDefault
    ) {
      return sendJobRouteError(
        req,
        res,
        400,
        'owner_eoa_submitted_for_aa_role',
        'validator must use the validator AA wallet, not the owner EOA',
        {
          field: 'validator',
          expectedAa: normalizeText(validatorAaDefault)
        }
      );
    }
    const payer = pickAddress(
      body.requesterAddress,
      body.requester,
      body.payer,
      runtime?.aaWallet,
      requesterAaDefault
    );
    const executor = pickAddress(
      body.executorAddress,
      body.executor,
      executorAaDefault
    );
    const validator = pickAddress(
      body.validatorAddress,
      body.validator,
      validatorAaDefault
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
      return sendJobRouteError(req, res, 400, 'provider_required', 'provider is required');
    }
    if (!capability) {
      return sendJobRouteError(req, res, 400, 'capability_required', 'capability is required');
    }
    if (!budget) {
      return sendJobRouteError(req, res, 400, 'budget_required', 'budget is required');
    }
    if (!payer) {
      return sendJobRouteError(req, res, 400, 'payer_required', 'payer is required');
    }
    if (!executor) {
      return sendJobRouteError(req, res, 400, 'executor_required', 'executor is required');
    }
    if (!validator) {
      return sendJobRouteError(req, res, 400, 'validator_required', 'validator is required');
    }
    if (!escrowAmount) {
      return sendJobRouteError(req, res, 400, 'escrow_amount_required', 'escrowAmount is required');
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
      executionMode: 'aa-native',
      requesterRuntimeAddress: normalizeText(payer),
      executorRuntimeAddress: normalizeText(executor),
      validatorRuntimeAddress: normalizeText(validator),
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
      submitAnchorConfirmedAt: '',
      outcomeAnchorId: '',
      outcomeAnchorTxHash: '',
      escrowFundUserOpHash: '',
      escrowFundTxHash: '',
      escrowAcceptUserOpHash: '',
      escrowAcceptTxHash: '',
      escrowSubmitUserOpHash: '',
      escrowSubmitTxHash: '',
      escrowValidateUserOpHash: '',
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
      logger.warn('job_create_anchor_skipped', {
        jobId: normalizeText(job?.jobId),
        error: normalizeText(error?.message || 'job create anchor failed')
      });
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
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (!['created', 'funding_pending', 'funding_failed', 'pending_approval'].includes(normalizeJobState(job.state))) {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_fundable',
        `job state ${normalizeJobState(job.state)} cannot be funded`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
    }

    const body = req.body || {};
    const approvalPolicy = buildApprovalPolicySnapshot(job, {
      ttlMs: Math.max(60000, Number(KTRACE_JOB_APPROVAL_TTL_MS || 0) || 24 * 60 * 60 * 1000),
      amount: normalizePositiveNumber(job.escrowAmount, normalizePositiveNumber(job.budget, 0)),
      currency: normalizeText(job.escrowTokenAddress || process.env.KITE_SETTLEMENT_TOKEN || '')
    });
    const approvalThreshold = normalizePositiveNumber(approvalPolicy?.threshold, 0);
    const approvalTtlMs = Math.max(60000, Number(approvalPolicy?.ttlMs || 0) || 24 * 60 * 60 * 1000);
    const escrowAmountNumeric = normalizePositiveNumber(job.escrowAmount, normalizePositiveNumber(job.budget, 0));
    const approvalId = normalizeText(body.approvalId || body.approvalRequestId);
    const approvalToken = normalizeText(body.token || body.approvalToken);
    const nowMs = Date.now();
    const fundIntentId = normalizeText(body.intentId || body.idempotencyKey || '');
    const authorityRuntime = resolveRuntimeForAaWallet({
      aaWallet: normalizeText(job?.payer || ''),
      readSessionRuntime,
      resolveSessionOwnerByAaWallet,
      resolveSessionRuntime
    });
    const authorityResult = validateConsumerAuthority?.({
      runtime: authorityRuntime,
      payer: normalizeText(job?.payer || ''),
      provider: normalizeText(job?.provider || ''),
      capability: normalizeText(job?.capability || ''),
      recipient: normalizeText(job?.escrowAddress || ''),
      amount: normalizeText(job?.escrowAmount || job?.budget || ''),
      intentId: fundIntentId,
      actionKind: 'job_fund',
      referenceId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId)
    });
    if (authorityResult && authorityResult.ok === false) {
      return sendJobRouteError(
        req,
        res,
        Number(authorityResult.statusCode || 403),
        normalizeText(authorityResult.code || 'authority_validation_failed'),
        normalizeText(authorityResult.reason || 'authority validation failed'),
        buildAuthorityErrorPayload(authorityResult)
      );
    }
    const fundAuthority =
      authorityResult?.authority && typeof authorityResult.authority === 'object'
        ? buildAuthoritySnapshot(authorityResult.authority)
        : null;
    const fundAuthorityPublic =
      authorityResult?.authorityPublic && typeof authorityResult.authorityPublic === 'object'
        ? buildAuthorityPublicSummary(authorityResult.authorityPublic)
        : fundAuthority
          ? buildAuthorityPublicSummary(fundAuthority)
          : null;
    const fundPolicySnapshotHash = normalizeText(
      authorityResult?.policySnapshotHash || (fundAuthority ? buildPolicySnapshotHash(fundAuthority) : '')
    );

    if (normalizeJobState(job.state) === 'pending_approval') {
      const approvalRecord = findApprovalRequest(approvalId || job.approvalId);
      if (!approvalRecord || normalizeText(approvalRecord?.approvalKind || 'session') !== 'job') {
        return sendJobRouteError(req, res, 409, 'approval_required', 'Job funding is waiting for human approval.', {
          jobId: normalizeText(job.jobId)
        });
      }
      if (approvalToken && approvalToken !== normalizeText(approvalRecord?.approvalToken)) {
        return sendJobRouteError(req, res, 403, 'approval_token_invalid', 'approval token is invalid', {
          approvalId: normalizeText(approvalRecord?.approvalRequestId || approvalRecord?.approvalId)
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
        return sendJobRouteError(req, res, 409, 'approval_expired', 'Job approval expired before funding.', {
          approval: buildJobApprovalEnvelope(expiredRecord || approvalRecord),
          job: buildJobView(expiredJob)
        });
      }
      if (!['approved', 'completed'].includes(approvalStatus)) {
        return sendJobRouteError(req, res, 409, 'approval_required', 'Job funding is waiting for human approval.', {
          approval: buildJobApprovalEnvelope(approvalRecord),
          job: buildJobView(job)
        });
      }
    } else if (approvalThreshold > 0 && escrowAmountNumeric > approvalThreshold) {
      const existingApproval = findActiveJobApproval(job.jobId);
      if (existingApproval) {
        const approval = buildJobApprovalEnvelope(existingApproval);
        const pendingJob = {
          ...job,
          state: 'pending_approval',
          approvalId: normalizeText(existingApproval?.approvalRequestId),
          approvalState: normalizeText(existingApproval?.status),
          approvalReasonCode: normalizeText(existingApproval?.reasonCode || 'amount_threshold'),
          approvalUrl: approval.approvalUrl,
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
        return res.status(202).json({ ok: true, traceId: req.traceId || '', state: 'pending_approval', approval, job: buildJobView(pendingJob) });
      }

      const runtime = authorityRuntime && typeof authorityRuntime === 'object' && Object.keys(authorityRuntime).length > 0
        ? authorityRuntime
        : readSessionRuntime() || {};
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
        policySnapshot: { ...approvalPolicy },
        jobSnapshot: buildJobView(job),
        resumeToken: buildJobFundResumeToken({ approvalId: approvalRequestId, createdAt, job, payerAaWallet: requestedByAaWallet, sessionAuthorizationRef: normalizeText(job.authorizationId) }),
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
      return res.status(202).json({ ok: true, traceId: req.traceId || '', state: 'pending_approval', approval, job: buildJobView(pendingJob) });
    }

    const now = new Date().toISOString();
    const fundingRef = createTraceId('job_fund');
    const paymentRequestId = normalizeText(job?.paymentRequestId || createTraceId('job_payment'));
    let next = {
      ...job,
      state: 'funded',
      fundIntentId,
      fundAuthority,
      fundAuthorityPublic,
      fundPolicySnapshotHash,
      fundingRef,
      paymentRequestId,
      paymentTxHash: '',
      signerMode: 'aa-runtime-escrow',
      executionMode: 'aa-native',
      approvalState: job.approvalId ? 'completed' : job.approvalState,
      summary: 'Job funds locked in escrow.',
      error: '',
      fundedAt: now,
      updatedAt: now
    };

    try {
      deps.preflightJobLaneCapability?.({ role: 'requester', roleAddress: next.payer });
    } catch (error) {
      const mapped = mapJobLaneExecutionError(error, 'job_fund_failed', 'job fund failed');
      return sendJobRouteError(
        req,
        res,
        mapped.status,
        mapped.code,
        mapped.message,
        {
          jobId: normalizeText(job?.jobId),
          ...mapped.detail
        }
      );
    }

    const asyncMode = body.async === true || normalizeText(req.query?.async) === 'true';

    async function executeFundChainWork() {
      const intentState = beginConsumerIntent?.({
        intentId: fundIntentId,
        payer: normalizeText(job?.payer || ''),
        provider: normalizeText(job?.provider || ''),
        capability: normalizeText(job?.capability || ''),
        recipient: normalizeText(job?.escrowAddress || ''),
        amount: normalizeText(job?.escrowAmount || job?.budget || ''),
        actionKind: 'job_fund',
        referenceId: normalizeText(job?.jobId),
        traceId: normalizeText(job?.traceId)
      });
      if (intentState && intentState.ok === false) {
        throw Object.assign(new Error(normalizeText(intentState.reason || 'intent conflict')), {
          code: normalizeText(intentState.code || 'intent_conflict'),
          intentConflict: true,
          intentState
        });
      }
      const escrow = await deps.lockEscrowFunds?.({
        jobId: next.jobId,
        requester: next.payer,
        executor: next.executor,
        validator: next.validator,
        amount: next.escrowAmount,
        deadlineAt: isoToUnixSeconds(next.expiresAt),
        executorStakeAmount: next.executorStakeAmount
      });
      next = applyEscrowOutcome(
        {
          ...next,
          signerMode: escrow?.configured ? 'aa-runtime-escrow' : 'degraded-local',
          executionMode: normalizeText(escrow?.executionMode || next.executionMode || 'aa-native'),
          aaMethod: normalizeText(escrow?.aaMethod || next.aaMethod || ''),
          accountVersionTag: normalizeText(escrow?.accountVersionTag || next.accountVersionTag || ''),
          accountCapabilities: detailObject(escrow?.accountCapabilities || next.accountCapabilities),
          requesterRuntimeAddress: normalizeText(escrow?.runtimeAddress || next.requesterRuntimeAddress || next.payer),
          executorRuntimeAddress: normalizeText(next.executorRuntimeAddress || next.executor),
          validatorRuntimeAddress: normalizeText(next.validatorRuntimeAddress || next.validator),
          summary: escrow?.configured ? 'Job funds locked in escrow.' : 'Job funded locally. Escrow not configured.',
          escrowFundUserOpHash: normalizeText(escrow?.userOpHash),
          escrowFundTxHash: normalizeText(escrow?.txHash),
          paymentTxHash: normalizeText(escrow?.txHash || next.paymentTxHash)
        },
        escrow,
        escrow?.configured ? 'funded' : 'not_configured'
      );
      try {
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
      } catch (anchorError) {
        logger.warn('fund_anchor_skipped', {
          jobId: normalizeText(next?.jobId),
          error: normalizeText(anchorError?.message || 'fund anchor failed')
        });
      }
      if (normalizeText(job?.approvalId)) {
        updateApprovalRequest(normalizeText(job.approvalId), {
          status: 'completed',
          updatedAt: Date.now(),
          completedAt: Date.now(),
          resumeStatus: 'completed',
          resumeError: '',
          decisionNote: normalizeText(job?.approvalDecisionNote)
        });
        next = { ...next, approvalState: 'completed' };
      }
      finalizeConsumerIntent?.(fundIntentId, {
        status: 'completed',
        resultRef: normalizeText(next.jobId),
        requestId: normalizeText(next.paymentRequestId),
        traceId: normalizeText(next.traceId)
      });
      next = { ...next, state: 'funded' };
      upsertJobRecord(next);
      return next;
    }

    if (asyncMode) {
      const pendingJob = {
        ...next,
        state: 'funding_pending',
        summary: 'Job funding submitted. Chain confirmation in progress.',
        fundedAt: '',
        updatedAt: now
      };
      upsertJobRecord(pendingJob);

      executeFundChainWork().catch((error) => {
        logger.error('async_fund_failed', {
          jobId: normalizeText(job?.jobId),
          error: normalizeText(error?.message || 'async fund failed')
        });
        finalizeConsumerIntent?.(fundIntentId, {
          status: 'failed',
          resultRef: normalizeText(job?.jobId),
          traceId: normalizeText(job?.traceId),
          failureReason: normalizeText(error?.message || 'async fund failed')
        });
        if (normalizeText(job?.approvalId)) {
          updateApprovalRequest(normalizeText(job.approvalId), {
            status: normalizeText(job?.approvalState || 'approved') || 'approved',
            updatedAt: Date.now(),
            resumeStatus: 'failed',
            resumeError: normalizeText(error?.message || 'async fund failed')
          });
        }
        const failedJob = {
          ...pendingJob,
          state: 'funding_failed',
          summary: normalizeText(error?.message || 'Job funding failed.'),
          error: normalizeText(error?.message || 'job fund failed'),
          updatedAt: new Date().toISOString()
        };
        upsertJobRecord(failedJob);
      });

      return res.status(202).json({
        ok: true,
        traceId: req.traceId || '',
        state: 'funding_pending',
        job: buildJobView(pendingJob)
      });
    }

    try {
      await executeFundChainWork();
    } catch (error) {
      const mapped = mapJobLaneExecutionError(error, 'job_fund_failed', 'job fund failed');
      finalizeConsumerIntent?.(fundIntentId, {
        status: 'failed',
        resultRef: normalizeText(job?.jobId),
        traceId: normalizeText(job?.traceId),
        failureReason: normalizeText(mapped.message || 'job fund failed')
      });
      if (normalizeText(job?.approvalId)) {
        updateApprovalRequest(normalizeText(job.approvalId), {
          status: normalizeText(job?.approvalState || 'approved') || 'approved',
          updatedAt: Date.now(),
          resumeStatus: 'failed',
          resumeError: normalizeText(mapped.message || 'job fund failed')
        });
      }
      return sendJobRouteError(
        req,
        res,
        mapped.status,
        mapped.code,
        mapped.message,
        { jobId: normalizeText(job?.jobId), ...mapped.detail }
      );
    }
    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
  });

  app.post('/api/jobs/:jobId/prepare-funding', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (!['created', 'funding_failed', 'funded', 'accepted', 'submitted'].includes(normalizeJobState(job.state))) {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_preparable',
        `job state ${normalizeJobState(job.state)} cannot prepare escrow funding`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
    }

    try {
      const preparation = await prepareEscrowFunding?.({
        requester: normalizeText(job?.payer || ''),
        executor: normalizeText(job?.executor || ''),
        escrowAmount: normalizeText(job?.escrowAmount || job?.budget || ''),
        executorStakeAmount: normalizeText(job?.executorStakeAmount || '')
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        job: buildJobView(job),
        preparation: preparation || null
      });
    } catch (error) {
      const mapped = mapJobLaneExecutionError(
        error,
        'job_prepare_funding_failed',
        'job funding preparation failed'
      );
      return sendJobRouteError(req, res, mapped.status, mapped.code, mapped.message, {
        job: buildJobView(job),
        ...mapped.detail
      });
    }
  });
}

export function registerJobMutationContinuation(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    ERC8183_EXECUTOR_AA_ADDRESS,
    ERC8183_EXECUTOR_OWNER_ADDRESS,
    ERC8183_VALIDATOR_AA_ADDRESS,
    ERC8183_VALIDATOR_OWNER_ADDRESS,
    digestStableObject,
    beginConsumerIntent,
    buildAuthorityPublicSummary,
    buildAuthoritySnapshot,
    buildPolicySnapshotHash,
    finalizeConsumerIntent,
    getInternalAgentApiKey,
    findConsumerIntent,
    requireRole,
    resolveSessionRuntime,
    submitEscrowResult,
    upsertJobRecord,
    validateConsumerAuthority,
    validateEscrowJob,
    acceptEscrowJob
  } = deps;
  const {
    anchorJobLifecycle,
    appendJobTrustSignals,
    applyEscrowOutcome,
    buildJobView,
    executeJobExpiry,
    findJob,
    hasEscrowBacking,
    invokeServiceWithRetry,
    materializeJob,
    normalizeJobState,
    normalizeText,
    parseApprovedFlag,
    pickAddress,
    selectService
  } = helpers;

  function buildAuthorityErrorPayload(result = {}) {
    return {
      ok: false,
      error: normalizeText(result?.code || 'authority_validation_failed'),
      reason: normalizeText(result?.reason || 'authority validation failed'),
      authority: result?.authorityPublic || null,
      policySnapshotHash: normalizeText(result?.policySnapshotHash || ''),
      detail: detailObject(result?.detail)
    };
  }

  function buildIntentConflictDetail(result = {}) {
    const existing = result?.existing && typeof result.existing === 'object' ? result.existing : null;
    const existingJob = existing?.resultRef ? findJob(normalizeText(existing.resultRef)) : null;
    return {
      intent: existing,
      job: existingJob ? buildJobView(existingJob) : null
    };
  }

  app.post('/api/jobs/:jobId/claim', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (normalizeJobState(job.state) !== 'funded') {
      return sendJobRouteError(req, res, 409, 'job_not_claimable', `job state ${normalizeJobState(job.state)} cannot be claimed`, {
        jobId: normalizeText(job.jobId), state: normalizeJobState(job.state)
      });
    }
    const currentExecutor = normalizeText(job.executor || '').toLowerCase();
    if (currentExecutor && currentExecutor !== '0x0000000000000000000000000000000000000000') {
      return sendJobRouteError(req, res, 409, 'executor_already_set', 'Job already has an assigned executor. Use accept instead.', {
        jobId: normalizeText(job.jobId), executor: job.executor
      });
    }
    const body = req.body || {};
    const currentRuntime = typeof readSessionRuntime === 'function' ? readSessionRuntime() : {};
    const claimerAddress = firstExplicitAddress(
      body.executorAddress,
      body.executor,
      currentRuntime?.aaWallet
    );
    if (!claimerAddress) {
      return sendJobRouteError(req, res, 400, 'executor_required', 'executor address is required for claim');
    }
    const now = new Date().toISOString();
    let next = { ...job, executor: claimerAddress, executorRuntimeAddress: claimerAddress, updatedAt: now };
    try {
      if (typeof deps.claimEscrowJob === 'function') {
        const escrow = await deps.claimEscrowJob({ jobId: next.jobId, executor: claimerAddress });
        if (escrow?.claimed) {
          next.escrowState = 'claimed';
        }
      }
    } catch (error) {
      const mapped = mapJobLaneExecutionError(error, 'job_claim_failed', 'job claim failed');
      return sendJobRouteError(req, res, mapped.status, mapped.code, mapped.message, {
        jobId: normalizeText(job?.jobId), ...mapped.detail
      });
    }
    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
  });

  app.post('/api/jobs/:jobId/accept', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (normalizeJobState(job.state) !== 'funded') {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_acceptable',
        `job state ${normalizeJobState(job.state)} cannot be accepted`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
    }

    const now = new Date().toISOString();
    let next = { ...job, state: 'accepted', summary: 'Job accepted by executor.', error: '', acceptedAt: now, updatedAt: now };

    try {
      deps.preflightJobLaneCapability?.({ role: 'executor', roleAddress: next.executor });
      const escrow = await deps.acceptEscrowJob?.({ jobId: next.jobId, executor: next.executor });
      next = applyEscrowOutcome(
        {
          ...next,
          signerMode: escrow?.configured ? 'aa-runtime-escrow' : normalizeText(next.signerMode || 'aa-runtime-escrow'),
          executionMode: normalizeText(escrow?.executionMode || next.executionMode || 'aa-native'),
          aaMethod: normalizeText(escrow?.aaMethod || next.aaMethod || ''),
          accountVersionTag: normalizeText(escrow?.accountVersionTag || next.accountVersionTag || ''),
          accountCapabilities: detailObject(escrow?.accountCapabilities || next.accountCapabilities),
          executorRuntimeAddress: normalizeText(escrow?.runtimeAddress || next.executorRuntimeAddress || next.executor),
          escrowAcceptUserOpHash: normalizeText(escrow?.userOpHash),
          escrowAcceptTxHash: normalizeText(escrow?.txHash)
        },
        escrow,
        escrow?.configured ? 'accepted' : 'not_configured'
      );
      try {
        const anchor = await anchorJobLifecycle(next, 'accepted', {
          referenceId: normalizeText(next?.escrowAcceptTxHash || next?.jobId),
          paymentTxHash: normalizeText(next?.escrowAcceptTxHash || next?.paymentTxHash)
        });
        next = {
          ...next,
          anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
          acceptAnchorId: normalizeText(anchor?.anchorId || next.acceptAnchorId),
          acceptAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.acceptAnchorTxHash)
        };
      } catch (anchorError) {
        logger.warn('accept_anchor_skipped', {
          jobId: normalizeText(next?.jobId),
          error: normalizeText(anchorError?.message || 'accept anchor failed')
        });
      }
    } catch (error) {
      const mapped = mapJobLaneExecutionError(error, 'job_accept_failed', 'job accept failed');
      return sendJobRouteError(
        req,
        res,
        mapped.status,
        mapped.code,
        mapped.message,
        { jobId: normalizeText(job?.jobId), ...mapped.detail }
      );
    }

    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
  });

  app.post('/api/jobs/:jobId/submit', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (normalizeJobState(job.state) !== 'accepted') {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_submittable',
        `job state ${normalizeJobState(job.state)} cannot be submitted`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
    }

    const input = req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input) ? req.body.input : job.input || {};
    const submittedDelivery = detailObject(req.body?.delivery);
    const hasDirectDelivery = Object.keys(submittedDelivery).length > 0;
    const submitIntentId = normalizeText(req.body?.intentId || req.body?.idempotencyKey || '');
    const directDeliveryValidation = hasDirectDelivery ? validateDeliveryPayload(submittedDelivery) : null;
    if (hasDirectDelivery && !directDeliveryValidation?.ok) {
      return sendJobRouteError(req, res, 400, 'invalid_delivery_payload', 'delivery payload did not match a supported ktrace delivery schema', {
        jobId: normalizeText(job.jobId),
        schema: normalizeText(submittedDelivery?.schema || ''),
        errors: Array.isArray(directDeliveryValidation?.errors) ? directDeliveryValidation.errors : []
      });
    }
    const service = hasDirectDelivery ? null : selectService(job.provider, job.capability);
    if (!hasDirectDelivery && !service) {
      return sendJobRouteError(
        req,
        res,
        404,
        'service_not_found',
        `No active service matched provider=${job.provider} capability=${job.capability}.`,
        {
          jobId: normalizeText(job.jobId),
          provider: normalizeText(job.provider),
          capability: normalizeText(job.capability)
        }
      );
    }

    const internalApiKey = getInternalAgentApiKey();
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (internalApiKey) headers['x-api-key'] = internalApiKey;

    const authorityResult = hasDirectDelivery
      ? null
      : validateConsumerAuthority?.({
          payer: normalizeText(job?.payer || ''),
          provider: normalizeText(service?.providerAgentId || job?.provider || ''),
          capability: normalizeText(service?.id || service?.action || job?.capability || ''),
          recipient: normalizeText(service?.recipient || ''),
          amount: normalizeText(service?.price || ''),
          intentId: submitIntentId,
          actionKind: 'job_submit',
          referenceId: normalizeText(job?.jobId),
          traceId: normalizeText(job?.traceId)
        });
    if (authorityResult && authorityResult.ok === false) {
      return sendJobRouteError(
        req,
        res,
        Number(authorityResult.statusCode || 403),
        normalizeText(authorityResult.code || 'authority_validation_failed'),
        normalizeText(authorityResult.reason || 'authority validation failed'),
        buildAuthorityErrorPayload(authorityResult)
      );
    }
    const submitAuthority =
      authorityResult?.authority && typeof authorityResult.authority === 'object'
        ? buildAuthoritySnapshot(authorityResult.authority)
        : null;
    const submitAuthorityPublic =
      authorityResult?.authorityPublic && typeof authorityResult.authorityPublic === 'object'
        ? buildAuthorityPublicSummary(authorityResult.authorityPublic)
        : submitAuthority
          ? buildAuthorityPublicSummary(submitAuthority)
          : null;
    const submitPolicySnapshotHash = normalizeText(
      authorityResult?.policySnapshotHash || (submitAuthority ? buildPolicySnapshotHash(submitAuthority) : '')
    );
    const submitExecutionPatch = {
      submitIntentId,
      submitAuthority,
      submitAuthorityPublic,
      submitPolicySnapshotHash
    };
    const invokeBody = { ...input, traceId: job.traceId, payer: job.payer };
    const anchorRequired = Boolean(process.env.ERC8183_JOB_ANCHOR_REGISTRY);

    if (hasDirectDelivery) {
      const directEvidence = normalizeDeliveryEvidence(submittedDelivery, {
        primaryTraceId: normalizeText(req.body?.primaryTraceId || job.traceId),
        primaryEvidenceRef: normalizeText(req.body?.evidenceRef || job.evidenceRef),
        paymentRequestId: normalizeText(req.body?.paymentRequestId || job.paymentRequestId),
        paymentTxHash: normalizeText(req.body?.paymentTxHash || job.paymentTxHash),
        dataSourceTraceIds: normalizeTextList(req.body?.dataSourceTraceIds),
        receiptRefs: normalizeTextList(req.body?.receiptRefs),
        deliveredAt: normalizeText(req.body?.deliveredAt),
        trustTxHash: normalizeText(req.body?.trustTxHash || '')
      });
      const directProvider = (() => {
        const currentProvider = normalizeText(job?.provider || '');
        if (!currentProvider || currentProvider.toLowerCase() === 'any') {
          return normalizeText(job?.executor || currentProvider);
        }
        return currentProvider;
      })();
      const now = new Date().toISOString();
      let next = {
        ...job,
        ...submitExecutionPatch,
        state: 'accepted',
        traceId: directEvidence.primaryTraceId || job.traceId,
        provider: directProvider,
        submissionRef: `/api/jobs/${encodeURIComponent(job.jobId)}`,
        summary: deriveDeliverySummary(submittedDelivery, normalizeText(req.body?.summary || 'Job submitted for validation.')),
        error: '',
        updatedAt: now,
        paymentRequestId: directEvidence.paymentRequestId || job.paymentRequestId,
        paymentTxHash: directEvidence.paymentTxHash || job.paymentTxHash,
        receiptRef:
          directEvidence.receiptRefs[0] ||
          normalizeText(job.receiptRef) ||
          (directEvidence.paymentRequestId ? `/api/receipt/${encodeURIComponent(directEvidence.paymentRequestId)}` : ''),
        evidenceRef: directEvidence.primaryEvidenceRef || normalizeText(job.evidenceRef),
        resultRef: normalizeText(req.body?.resultRef || '') || `/api/jobs/${encodeURIComponent(job.jobId)}/audit`,
        resultHash:
          normalizeText(req.body?.resultHash || '') ||
          (digestStableObject?.({
            scope: 'ktrace-job-direct-delivery-v1',
            jobId: job.jobId,
            traceId: directEvidence.primaryTraceId || job.traceId,
            delivery: submittedDelivery
          })?.value || ''),
        submissionHash:
          digestStableObject?.({
            scope: 'ktrace-job-submission-v4',
            jobId: job.jobId,
            traceId: directEvidence.primaryTraceId || job.traceId,
            delivery: submittedDelivery,
            evidence: directEvidence
          })?.value || '',
        delivery: submittedDelivery,
        deliverySchema: normalizeText(submittedDelivery?.schema || ''),
        deliverySchemaConformant: Boolean(directDeliveryValidation?.conformant),
        deliverySchemaErrors: Array.isArray(directDeliveryValidation?.errors) ? directDeliveryValidation.errors : [],
        deliveryEvidence: directEvidence,
        input
      };

      if (anchorRequired && !normalizeText(next?.submitAnchorTxHash)) {
        try {
          const anchor = await anchorJobLifecycle(next, 'submitted', {
            referenceId: normalizeText(next?.resultRef || next?.submissionRef || next?.jobId),
            paymentTxHash: normalizeText(next?.paymentTxHash)
          });
          if (!anchor?.configured || anchor?.published !== true) {
            throw new Error('trace anchor required before submit');
          }
          next = {
            ...next,
            anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
            submitAnchorId: normalizeText(anchor?.anchorId || next.submitAnchorId),
            submitAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.submitAnchorTxHash),
            submitAnchorConfirmedAt: now,
            updatedAt: new Date().toISOString()
          };
          upsertJobRecord(next);
        } catch (error) {
          const failed = {
            ...next,
            state: 'accepted',
            error: normalizeText(error?.message || 'trace anchor publish failed'),
            summary: normalizeText(error?.message || 'trace anchor required before submit'),
            updatedAt: new Date().toISOString()
          };
          upsertJobRecord(failed);
          return sendJobRouteError(
            req,
            res,
            500,
            anchorRequired ? 'trace_anchor_publish_failed' : 'job_submit_failed',
            failed.error,
            {
              job: buildJobView(failed)
            }
          );
        }
      }

      try {
        deps.preflightJobLaneCapability?.({ role: 'executor', roleAddress: next.executor });
        const escrow = await deps.submitEscrowResult?.({
          jobId: next.jobId,
          resultHash: next.resultHash,
          executor: next.executor
        });
        next = applyEscrowOutcome(
          {
            ...next,
            signerMode: escrow?.configured ? 'aa-runtime-escrow' : normalizeText(next.signerMode || 'aa-runtime-escrow'),
            executionMode: normalizeText(escrow?.executionMode || next.executionMode || 'aa-native'),
            aaMethod: normalizeText(escrow?.aaMethod || next.aaMethod || ''),
            accountVersionTag: normalizeText(escrow?.accountVersionTag || next.accountVersionTag || ''),
            accountCapabilities: detailObject(escrow?.accountCapabilities || next.accountCapabilities),
            executorRuntimeAddress: normalizeText(escrow?.runtimeAddress || next.executorRuntimeAddress || next.executor),
            state: 'submitted',
            summary: escrow?.configured ? next.summary : `${next.summary} Escrow not configured.`,
            escrowSubmitUserOpHash: normalizeText(escrow?.userOpHash),
            escrowSubmitTxHash: normalizeText(escrow?.txHash),
            submittedAt: now,
            updatedAt: new Date().toISOString()
          },
          escrow,
          escrow?.configured ? 'submitted' : 'not_configured'
        );
      } catch (error) {
        const mapped =
          normalizeText(error?.code) === 'trace_anchor_required'
            ? {
                status: 500,
                code: 'trace_anchor_required_before_submit',
                message: 'trace anchor required before submit',
                detail: {}
              }
            : mapJobLaneExecutionError(error, 'job_submit_failed', 'job submit failed');
        const reason = normalizeText(mapped.message || 'job submit failed');
        const failed = {
          ...next,
          state: 'accepted',
          error: reason,
          summary:
            errorCode === 'trace_anchor_required_before_submit'
              ? 'trace anchor required before submit'
              : reason || 'trace anchor published but escrow submit failed',
          updatedAt: new Date().toISOString()
        };
        upsertJobRecord(failed);
        return sendJobRouteError(req, res, mapped.status, mapped.code, failed.error, {
          job: buildJobView(failed),
          ...mapped.detail
        });
      }

      upsertJobRecord(next);
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        job: buildJobView(next)
      });
    }

    try {
      const intentState = beginConsumerIntent?.({
        intentId: submitIntentId,
        payer: normalizeText(job?.payer || ''),
        provider: normalizeText(service?.providerAgentId || job?.provider || ''),
        capability: normalizeText(service?.id || service?.action || job?.capability || ''),
        recipient: normalizeText(service?.recipient || ''),
        amount: normalizeText(service?.price || ''),
        actionKind: 'job_submit',
        referenceId: normalizeText(job?.jobId),
        traceId: normalizeText(job?.traceId)
      });
      if (intentState && intentState.ok === false) {
        return sendJobRouteError(
          req,
          res,
          409,
          normalizeText(intentState.code || 'intent_conflict'),
          normalizeText(intentState.reason || 'intent conflict'),
          buildIntentConflictDetail(intentState)
        );
      }
      const invokeResult = await invokeServiceWithRetry(normalizeText(service.id), headers, invokeBody);
      const response = { ok: invokeResult.ok, status: invokeResult.status };
      const payload = invokeResult.payload || {};
      const workflow = payload?.workflow || {};
      const requestId = normalizeText(payload?.requestId || workflow?.requestId);
      const traceId = normalizeText(payload?.traceId || workflow?.traceId || job.traceId);
      const txHash = normalizeText(payload?.txHash || workflow?.txHash);
      const summary = normalizeText(workflow?.result?.summary || payload?.receipt?.result?.summary || payload?.reason || '') || 'Job submitted for validation.';
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
          ...submitExecutionPatch,
          state: 'accepted',
          error: normalizeText(payload?.reason || payload?.error || 'job submit failed'),
          summary: normalizeText(payload?.reason || payload?.error || 'job submit failed'),
          updatedAt: new Date().toISOString(),
          input
        };
        upsertJobRecord(failed);
        return sendJobRouteError(req, res, response.status, 'job_submit_failed', failed.error, {
          job: buildJobView(failed),
          workflow: detailObject(workflow),
          receipt: detailObject(payload?.receipt)
        });
      }

      const now = new Date().toISOString();
      let next = {
        ...job,
        ...submitExecutionPatch,
        traceId: traceId || job.traceId,
        state: 'accepted',
        provider: normalizeText(service.providerAgentId || job.provider),
        capability: normalizeText(service.action || job.capability),
        serviceId: normalizeText(service.id),
        submitIntentId,
        submitAuthority,
        submitAuthorityPublic,
        submitPolicySnapshotHash,
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
        updatedAt: now,
        resultRef: normalizeText(payload?.resultRef || '') || `/api/jobs/${encodeURIComponent(job.jobId)}`,
        resultHash,
        input
      };

      const shouldPublishAnchor = anchorRequired && !normalizeText(next?.submitAnchorTxHash);
      if (shouldPublishAnchor) {
        try {
          const anchor = await anchorJobLifecycle(next, 'submitted', {
            referenceId: normalizeText(next?.resultRef || next?.submissionRef || next?.jobId),
            paymentTxHash: normalizeText(next?.paymentTxHash)
          });
          if (!anchor?.configured || anchor?.published !== true) {
            throw new Error('trace anchor required before submit');
          }
          next = {
            ...next,
            anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
            submitAnchorId: normalizeText(anchor?.anchorId || next.submitAnchorId),
            submitAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.submitAnchorTxHash),
            submitAnchorConfirmedAt: now,
            updatedAt: new Date().toISOString()
          };
          upsertJobRecord(next);
        } catch (error) {
          const failed = {
            ...next,
            state: 'accepted',
            error: normalizeText(error?.message || 'trace anchor publish failed'),
            summary: normalizeText(error?.message || 'trace anchor required before submit'),
            updatedAt: new Date().toISOString()
          };
          upsertJobRecord(failed);
          return sendJobRouteError(
            req,
            res,
            500,
            anchorRequired ? 'trace_anchor_publish_failed' : 'job_submit_failed',
            failed.error,
            {
              job: buildJobView(failed),
              workflow: detailObject(workflow),
              receipt: detailObject(payload?.receipt)
            }
          );
        }
      }

      try {
        deps.preflightJobLaneCapability?.({ role: 'executor', roleAddress: next.executor });
        const escrow = await deps.submitEscrowResult?.({
          jobId: next.jobId,
          resultHash: next.resultHash,
          executor: next.executor
        });
        next = applyEscrowOutcome(
          {
            ...next,
            signerMode: escrow?.configured ? 'aa-runtime-escrow' : normalizeText(next.signerMode || 'aa-runtime-escrow'),
            executionMode: normalizeText(escrow?.executionMode || next.executionMode || 'aa-native'),
            aaMethod: normalizeText(escrow?.aaMethod || next.aaMethod || ''),
            accountVersionTag: normalizeText(escrow?.accountVersionTag || next.accountVersionTag || ''),
            accountCapabilities: detailObject(escrow?.accountCapabilities || next.accountCapabilities),
            executorRuntimeAddress: normalizeText(escrow?.runtimeAddress || next.executorRuntimeAddress || next.executor),
            state: 'submitted',
            summary: escrow?.configured ? summary : `${summary} Escrow not configured.`,
            escrowSubmitUserOpHash: normalizeText(escrow?.userOpHash),
            escrowSubmitTxHash: normalizeText(escrow?.txHash),
            submittedAt: now,
            updatedAt: new Date().toISOString()
          },
          escrow,
          escrow?.configured ? 'submitted' : 'not_configured'
        );
      } catch (error) {
        const mapped =
          normalizeText(error?.code) === 'trace_anchor_required'
            ? {
                status: 500,
                code: 'trace_anchor_required_before_submit',
                message: 'trace anchor required before submit',
                detail: {}
              }
            : mapJobLaneExecutionError(error, 'job_submit_failed', 'job submit failed');
        const reason = normalizeText(mapped.message || 'job submit failed');
        const failed = {
          ...next,
          state: 'accepted',
          error: reason,
          summary:
            errorCode === 'trace_anchor_required_before_submit'
              ? 'trace anchor required before submit'
              : reason || 'trace anchor published but escrow submit failed',
          updatedAt: new Date().toISOString()
        };
        upsertJobRecord(failed);
        return sendJobRouteError(req, res, mapped.status, mapped.code, failed.error, {
          job: buildJobView(failed),
          workflow: detailObject(workflow),
          receipt: detailObject(payload?.receipt),
          ...mapped.detail
        });
      }

      upsertJobRecord(next);
      finalizeConsumerIntent?.(submitIntentId, {
        status: 'completed',
        resultRef: normalizeText(next.jobId),
        requestId: normalizeText(next.paymentRequestId),
        traceId: normalizeText(next.traceId)
      });

      return res.status(response.status).json({ ok: true, traceId: req.traceId || '', job: buildJobView(next), workflow: workflow && typeof workflow === 'object' ? workflow : null, receipt: payload?.receipt || null });
    } catch (error) {
      const mapped = mapJobLaneExecutionError(error, 'job_submit_failed', 'job submit failed');
      finalizeConsumerIntent?.(submitIntentId, {
        status: 'failed',
        resultRef: normalizeText(job?.jobId),
        traceId: normalizeText(job?.traceId),
        failureReason: normalizeText(mapped.message || 'job submit failed')
      });
      const next = {
        ...job,
        ...submitExecutionPatch,
        state: 'accepted',
        error: normalizeText(mapped.message || 'job submit failed'),
        summary: normalizeText(mapped.message || 'job submit failed'),
        updatedAt: new Date().toISOString()
      };
      upsertJobRecord(next);
      return sendJobRouteError(req, res, mapped.status, mapped.code, next.error, {
        job: buildJobView(next),
        ...mapped.detail
      });
    }
  });

  app.post('/api/jobs/:jobId/validate', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (normalizeJobState(job.state) !== 'submitted') {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_validatable',
        `job state ${normalizeJobState(job.state)} cannot be validated`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
    }

    const body = req.body || {};
    const approved = parseApprovedFlag(body.approved);
    if (approved === null) {
      return sendJobRouteError(req, res, 400, 'validation_decision_required', 'approved must be true or false');
    }

    const explicitValidatorAddress = firstExplicitAddress(body.validatorAddress, body.validator);
    const validatorRuntimeByOwner = typeof resolveSessionRuntime === 'function'
      ? resolveSessionRuntime({
          owner: ERC8183_VALIDATOR_OWNER_ADDRESS,
          strictOwnerMatch: true
        })
      : {};
    const validatorAaDefault = firstExplicitAddress(
      job.validator,
      validatorRuntimeByOwner?.aaWallet,
      ERC8183_VALIDATOR_AA_ADDRESS
    );
    if (
      explicitValidatorAddress &&
      addressesEqual(explicitValidatorAddress, ERC8183_VALIDATOR_OWNER_ADDRESS) &&
      validatorAaDefault
    ) {
      return sendJobRouteError(req, res, 400, 'owner_eoa_submitted_for_aa_role', 'validatorAddress must use the validator AA wallet, not the owner EOA', {
        jobId: normalizeText(job.jobId),
        expectedAa: normalizeText(validatorAaDefault)
      });
    }

    const validatorAddress = pickAddress(body.validatorAddress, body.validator, validatorAaDefault);
    if (!validatorAddress || !addressesEqual(validatorAddress, job.validator)) {
      return sendJobRouteError(req, res, 403, 'validator_mismatch', 'validatorAddress must match the job validator', {
        jobId: normalizeText(job.jobId)
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
      deps.preflightJobLaneCapability?.({ role: 'validator', roleAddress: next.validator });
      const escrow = await deps.validateEscrowJob?.({ jobId: next.jobId, approved, validator: next.validator });
      next = applyEscrowOutcome(
        {
          ...next,
          signerMode: escrow?.configured ? 'aa-runtime-escrow' : normalizeText(next.signerMode || 'aa-runtime-escrow'),
          executionMode: normalizeText(escrow?.executionMode || next.executionMode || 'aa-native'),
          aaMethod: normalizeText(escrow?.aaMethod || next.aaMethod || ''),
          accountVersionTag: normalizeText(escrow?.accountVersionTag || next.accountVersionTag || ''),
          accountCapabilities: detailObject(escrow?.accountCapabilities || next.accountCapabilities),
          validatorRuntimeAddress: normalizeText(escrow?.runtimeAddress || next.validatorRuntimeAddress || next.validator),
          escrowValidateUserOpHash: normalizeText(escrow?.userOpHash),
          escrowValidateTxHash: normalizeText(escrow?.txHash)
        },
        escrow,
        approved ? 'completed' : 'rejected'
      );
      const trust = appendJobTrustSignals(next, { outcome: next.state, evaluator: next.evaluator, evaluatorRef: next.evaluatorRef });
      next = { ...next, validationId: trust.validationId || next.validationId };
      try {
        const anchor = await anchorJobLifecycle(next, approved ? 'completed' : 'rejected', {
          referenceId: normalizeText(next?.resultRef || next?.jobId),
          validationId: normalizeText(next?.validationId),
          paymentTxHash: normalizeText(next?.escrowValidateTxHash || next?.paymentTxHash)
        });
        next = { ...next, anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry), outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId), outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash) };
      } catch (anchorError) {
        logger.warn('validate_anchor_skipped', {
          jobId: normalizeText(next?.jobId),
          error: normalizeText(anchorError?.message || 'validate anchor failed')
        });
      }
    } catch (error) {
      const mapped = mapJobLaneExecutionError(error, 'job_validate_failed', 'job validate failed');
      return sendJobRouteError(
        req,
        res,
        mapped.status,
        mapped.code,
        mapped.message,
        { jobId: normalizeText(job?.jobId), ...mapped.detail }
      );
    }

    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
  });

  app.post('/api/jobs/:jobId/complete', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (hasEscrowBacking(job)) {
      return sendJobRouteError(req, res, 409, 'job_requires_validation', 'Escrow-backed jobs must use /api/jobs/:jobId/validate.', {
        jobId: normalizeText(job.jobId)
      });
    }
    if (!['funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_completable',
        `job state ${normalizeJobState(job.state)} cannot be completed`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
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
        (digestStableObject?.({
          scope: 'ktrace-job-manual-complete-v1',
          jobId: job.jobId,
          traceId: job.traceId,
          summary: normalizeText(body.summary || job.summary || 'Job completed.')
        })?.value ||
          ''),
      evaluator: normalizeText(body.evaluator || job.evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(body.evaluatorRef || job.evaluatorRef || ''),
      error: '',
      completedAt: now,
      updatedAt: now
    };
    const trust = appendJobTrustSignals(next, { outcome: 'completed', evaluator: next.evaluator, evaluatorRef: next.evaluatorRef });
    next = { ...next, validationId: trust.validationId || next.validationId };
    try {
      const anchor = await anchorJobLifecycle(next, 'completed', { referenceId: normalizeText(next?.resultRef || next?.jobId), validationId: normalizeText(next?.validationId) });
      next = { ...next, anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry), outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId), outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash) };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return sendJobRouteError(
          req,
          res,
          500,
          'job_complete_anchor_failed',
          normalizeText(error?.message || 'job complete anchor failed'),
          { jobId: normalizeText(job?.jobId) }
        );
      }
    }
    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
  });

  app.post('/api/jobs/:jobId/reject', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (hasEscrowBacking(job)) {
      return sendJobRouteError(req, res, 409, 'job_requires_validation', 'Escrow-backed jobs must use /api/jobs/:jobId/validate.', {
        jobId: normalizeText(job.jobId)
      });
    }
    if (!['created', 'funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return sendJobRouteError(
        req,
        res,
        409,
        'job_not_rejectable',
        `job state ${normalizeJobState(job.state)} cannot be rejected`,
        {
          jobId: normalizeText(job.jobId),
          state: normalizeJobState(job.state)
        }
      );
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
    const trust = appendJobTrustSignals(next, { outcome: 'rejected', evaluator: next.evaluator, evaluatorRef: next.evaluatorRef });
    next = { ...next, validationId: trust.validationId || next.validationId };
    try {
      const anchor = await anchorJobLifecycle(next, 'rejected', { referenceId: normalizeText(next?.jobId), validationId: normalizeText(next?.validationId) });
      next = { ...next, anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry), outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId), outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash) };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return sendJobRouteError(
          req,
          res,
          500,
          'job_reject_anchor_failed',
          normalizeText(error?.message || 'job reject anchor failed'),
          { jobId: normalizeText(job?.jobId) }
        );
      }
    }
    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
  });

  app.post('/api/jobs/:jobId/expire', requireRole('agent'), async (req, res) => {
    const result = await executeJobExpiry(req.params.jobId, { summary: req.body?.summary });
    if (!result?.ok) {
      return sendJobRouteError(
        req,
        res,
        Number(result?.statusCode || 400),
        normalizeText(result?.error || 'job_expire_failed'),
        normalizeText(result?.reason || 'job expire failed'),
        { jobId: normalizeText(req.params.jobId) }
      );
    }
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(result.job || {}) });
  });
}
