import { sendErrorResponse } from '../../lib/errorResponse.js';
import { createRequestLogger } from '../../lib/logger.js';

const logger = createRequestLogger('job-mutation-route');

function detailObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
    createTraceId,
    digestStableObject,
    ensureServiceCatalog,
    getInternalAgentApiKey,
    lockEscrowFunds,
    readSessionRuntime,
    requireRole,
    resolveSessionOwnerByAaWallet,
    resolveWorkflowTraceId,
    submitEscrowResult,
    upsertJobRecord,
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
        return sendJobRouteError(
          req,
          res,
          500,
          'job_create_anchor_failed',
          normalizeText(error?.message || 'job create anchor failed')
        );
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
      return sendJobRouteError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    if (!['created', 'funding_pending', 'pending_approval'].includes(normalizeJobState(job.state))) {
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
        next = { ...next, approvalState: 'completed' };
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
      return sendJobRouteError(
        req,
        res,
        500,
        'job_fund_failed',
        normalizeText(error?.message || 'job fund failed'),
        { jobId: normalizeText(job?.jobId) }
      );
    }
    upsertJobRecord(next);
    return res.json({ ok: true, traceId: req.traceId || '', job: buildJobView(next) });
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
    getInternalAgentApiKey,
    requireRole,
    submitEscrowResult,
    upsertJobRecord,
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
      const escrow = await acceptEscrowJob?.({ jobId: next.jobId });
      next = applyEscrowOutcome({ ...next, escrowAcceptTxHash: normalizeText(escrow?.txHash) }, escrow, escrow?.configured ? 'accepted' : 'not_configured');
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
    } catch (error) {
      return sendJobRouteError(
        req,
        res,
        500,
        'job_accept_failed',
        normalizeText(error?.message || 'job accept failed'),
        { jobId: normalizeText(job?.jobId) }
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
    const service = selectService(job.provider, job.capability);
    if (!service) {
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

    const invokeBody = { ...input, traceId: job.traceId, payer: job.payer };
    const anchorRequired = Boolean(process.env.ERC8183_JOB_ANCHOR_REGISTRY);

    try {
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
        const failed = { ...job, state: 'accepted', error: normalizeText(payload?.reason || payload?.error || 'job submit failed'), summary: normalizeText(payload?.reason || payload?.error || 'job submit failed'), updatedAt: new Date().toISOString(), input };
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
        traceId: traceId || job.traceId,
        state: 'accepted',
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
        const escrow = await submitEscrowResult?.({ jobId: next.jobId, resultHash: next.resultHash });
        next = applyEscrowOutcome(
          {
            ...next,
            state: 'submitted',
            summary: escrow?.configured ? summary : `${summary} Escrow not configured.`,
            escrowSubmitTxHash: normalizeText(escrow?.txHash),
            submittedAt: now,
            updatedAt: new Date().toISOString()
          },
          escrow,
          escrow?.configured ? 'submitted' : 'not_configured'
        );
      } catch (error) {
        const errorCode =
          normalizeText(error?.code) === 'trace_anchor_required'
            ? 'trace_anchor_required_before_submit'
            : 'job_submit_failed';
        const reason =
          normalizeText(error?.message || '') === 'trace_anchor_required'
            ? 'trace anchor required before submit'
            : normalizeText(error?.message || 'job submit failed');
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
        return sendJobRouteError(req, res, 500, errorCode, failed.error, {
          job: buildJobView(failed),
          workflow: detailObject(workflow),
          receipt: detailObject(payload?.receipt)
        });
      }

      upsertJobRecord(next);

      return res.status(response.status).json({ ok: true, traceId: req.traceId || '', job: buildJobView(next), workflow: workflow && typeof workflow === 'object' ? workflow : null, receipt: payload?.receipt || null });
    } catch (error) {
      const next = { ...job, state: 'accepted', error: normalizeText(error?.message || 'job submit failed'), summary: normalizeText(error?.message || 'job submit failed'), updatedAt: new Date().toISOString() };
      upsertJobRecord(next);
      return sendJobRouteError(req, res, 500, 'job_submit_failed', next.error, {
        job: buildJobView(next)
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

    const validatorAddress = pickAddress(body.validatorAddress, body.validator, ERC8183_VALIDATOR_OWNER_ADDRESS, ERC8183_VALIDATOR_AA_ADDRESS);
    if (!validatorAddress || validatorAddress !== pickAddress(job.validator, ERC8183_VALIDATOR_OWNER_ADDRESS, ERC8183_VALIDATOR_AA_ADDRESS)) {
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
      const escrow = await validateEscrowJob?.({ jobId: next.jobId, approved });
      next = applyEscrowOutcome({ ...next, escrowValidateTxHash: normalizeText(escrow?.txHash) }, escrow, approved ? 'completed' : 'rejected');
      const trust = appendJobTrustSignals(next, { outcome: next.state, evaluator: next.evaluator, evaluatorRef: next.evaluatorRef });
      next = { ...next, validationId: trust.validationId || next.validationId };
      const anchor = await anchorJobLifecycle(next, approved ? 'completed' : 'rejected', {
        referenceId: normalizeText(next?.resultRef || next?.jobId),
        validationId: normalizeText(next?.validationId),
        paymentTxHash: normalizeText(next?.escrowValidateTxHash || next?.paymentTxHash)
      });
      next = { ...next, anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry), outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId), outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash) };
    } catch (error) {
      return sendJobRouteError(
        req,
        res,
        500,
        'job_validate_failed',
        normalizeText(error?.message || 'job validate failed'),
        { jobId: normalizeText(job?.jobId) }
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
