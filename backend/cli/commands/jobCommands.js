export function createJobCommandHandlers({
  parseJobCreateArgs,
  parseJobSubmitArgs,
  parseJobCompleteArgs,
  parseJobRejectArgs,
  parseJobValidateArgs,
  parseJobAuditArgs,
  requestJson,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  ensureReference,
  readStructuredInput,
  ensureUsableSession,
  normalizeWalletAddress,
  normalizeCapability
}) {
  async function fetchTraceAnchorStatus(runtime, { jobId = '', publicRead = false } = {}) {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return null;
    return requestJson(runtime, {
      pathname: publicRead
        ? `/api/public/jobs/${encodeURIComponent(normalizedJobId)}/trace-anchor`
        : `/api/jobs/${encodeURIComponent(normalizedJobId)}/trace-anchor`,
      apiKey: publicRead ? '' : resolveAgentTransportApiKey(runtime),
      omitRuntimeApiKey: publicRead
    });
  }

  function mergeTraceAnchorIntoJob(job = {}, traceAnchor = null) {
    if (!traceAnchor || typeof traceAnchor !== 'object') return job;
    return {
      ...job,
      guardConfigured: Boolean(traceAnchor?.guardConfigured),
      guardAddress: String(traceAnchor?.guardAddress || '').trim(),
      verificationMode: String(traceAnchor?.verificationMode || '').trim(),
      verifiedOnchain: traceAnchor?.anchor?.verifiedOnchain ?? null,
      latestAnchorIdOnChain: String(traceAnchor?.anchor?.latestAnchorIdOnChain || '').trim()
    };
  }

  async function handleJobCreate(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseJobCreateArgs(commandArgs);
    const provider = String(options.provider || '').trim();
    const capability = normalizeCapability(options.capability);
    if (!provider) {
      throw createCliError('A provider is required. Pass --provider <provider-agent-id>.', {
        code: 'provider_required'
      });
    }
    if (!capability) {
      throw createCliError('A capability is required. Pass --capability <capability>.', {
        code: 'capability_required'
      });
    }
    if (!String(options.budget || '').trim()) {
      throw createCliError('A budget is required. Pass --budget <amount>.', {
        code: 'budget_required'
      });
    }

    const wallet = normalizeWalletAddress(runtime.wallet);
    const input = await readStructuredInput(options.input);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/jobs',
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {
        provider,
        capability,
        budget: String(options.budget || '').trim(),
        ...(options.templateId ? { templateId: String(options.templateId || '').trim() } : {}),
        ...(options.evaluator ? { evaluator: String(options.evaluator || '').trim() } : {}),
        ...(options.expiresAt ? { expiresAt: String(options.expiresAt || '').trim() } : {}),
        ...(options.executor ? { executor: String(options.executor || '').trim() } : {}),
        ...(options.validator ? { validator: String(options.validator || '').trim() } : {}),
        ...(options.escrowAmount ? { escrowAmount: String(options.escrowAmount || '').trim() } : {}),
        input,
        ...(options.traceId ? { traceId: options.traceId } : {}),
        ...(wallet ? { payer: wallet } : {})
      }
    });
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'create', display: 'ktrace job create' },
      runtime,
      data: {
        job: {
          lane: 'job',
          jobId: String(job?.jobId || '').trim(),
          traceId: String(job?.traceId || '').trim(),
          state: String(job?.state || '').trim(),
          provider: String(job?.provider || provider).trim(),
          capability: String(job?.capability || capability).trim(),
          budget: String(job?.budget || options.budget || '').trim(),
          payer: String(job?.payer || wallet || '').trim(),
          executor: String(job?.executor || options.executor || '').trim(),
          validator: String(job?.validator || options.validator || '').trim(),
          escrowAmount: String(job?.escrowAmount || options.escrowAmount || '').trim(),
          templateId: String(job?.templateId || options.templateId || '').trim(),
          evaluator: String(job?.evaluator || options.evaluator || '').trim(),
          expiresAt: String(job?.expiresAt || options.expiresAt || '').trim(),
          anchorRegistry: String(job?.anchorRegistry || '').trim(),
          createAnchorId: String(job?.createAnchorId || '').trim(),
          createAnchorTxHash: String(job?.createAnchorTxHash || '').trim()
        }
      },
      message: String(job?.summary || 'Job created.').trim()
    });
  }

  async function handleJobFund(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const wallet = normalizeWalletAddress(runtime.wallet);
    const preflight = await ensureUsableSession(runtime, {
      wallet,
      strategy: runtime.sessionStrategy
    });
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/fund`,
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {
        ...(wallet ? { payer: wallet } : {})
      }
    });
    const job = payload?.job || {};
    const approval = payload?.approval && typeof payload.approval === 'object' ? payload.approval : null;
    const isPendingApproval =
      String(payload?.state || job?.state || '').trim().toLowerCase() === 'pending_approval';
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'fund', display: 'ktrace job fund' },
      runtime,
      data: {
        preflight: {
          checked: Boolean(preflight?.checked),
          created: Boolean(preflight?.created),
          reused: Boolean(preflight?.reused),
          sessionStrategy: String(preflight?.sessionStrategy || runtime.sessionStrategy || 'managed').trim(),
          traceId: String(preflight?.traceId || '').trim()
        },
        job: {
          lane: 'job',
          jobId: String(job?.jobId || jobId).trim(),
          traceId: String(job?.traceId || '').trim(),
          state: String(job?.state || '').trim(),
          fundingRef: String(job?.fundingRef || '').trim(),
          paymentRequestId: String(job?.paymentRequestId || '').trim(),
          paymentTxHash: String(job?.paymentTxHash || '').trim(),
          signerMode: String(job?.signerMode || '').trim(),
          anchorRegistry: String(job?.anchorRegistry || '').trim(),
          fundingAnchorId: String(job?.fundingAnchorId || '').trim(),
          fundingAnchorTxHash: String(job?.fundingAnchorTxHash || '').trim(),
          approvalId: String(job?.approvalId || approval?.approvalId || '').trim(),
          approvalState: String(job?.approvalState || approval?.approvalState || '').trim(),
          approvalReasonCode: String(job?.approvalReasonCode || approval?.reasonCode || '').trim(),
          approvalUrl: String(job?.approvalUrl || approval?.approvalUrl || '').trim(),
          approvalRequestedAt: Number(job?.approvalRequestedAt || approval?.createdAt || 0),
          approvalExpiresAt: Number(job?.approvalExpiresAt || approval?.expiresAt || 0),
          approvalDecidedAt: Number(job?.approvalDecidedAt || approval?.decidedAt || 0),
          approvalDecidedBy: String(job?.approvalDecidedBy || approval?.decidedBy || '').trim(),
          approvalDecisionNote: String(job?.approvalDecisionNote || approval?.decisionNote || '').trim()
        },
        ...(approval
          ? {
              approval: {
                approvalId: String(approval?.approvalId || '').trim(),
                approvalKind: String(approval?.approvalKind || '').trim(),
                approvalState: String(approval?.approvalState || '').trim(),
                approvalUrl: String(approval?.approvalUrl || '').trim(),
                expiresAt: Number(approval?.expiresAt || 0),
                requestedByAaWallet: String(approval?.requestedByAaWallet || '').trim(),
                requestedByOwnerEoa: String(approval?.requestedByOwnerEoa || '').trim(),
                reasonCode: String(approval?.reasonCode || '').trim()
              }
            }
          : {}),
        ...(isPendingApproval
          ? {
              nextStep: {
                action: 'open_approval_url',
                approvalUrl: String(job?.approvalUrl || approval?.approvalUrl || '').trim(),
                expiresAt: Number(job?.approvalExpiresAt || approval?.expiresAt || 0),
                note: 'Open the approval URL, approve or reject the job, then rerun job show or continue the lane.'
              }
            }
          : {})
      },
      message: String(
        job?.summary || (isPendingApproval ? 'Job funding is waiting for human approval.' : 'Job funded.')
      ).trim()
    });
  }

  async function handleJobAccept(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/accept`,
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {}
    });
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'accept', display: 'ktrace job accept' },
      runtime,
      data: { job },
      message: String(job?.summary || 'Job accepted.').trim()
    });
  }

  async function handleJobSubmit(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const options = parseJobSubmitArgs(commandArgs.slice(1));
    const wallet = normalizeWalletAddress(runtime.wallet);
    const preflight = await ensureUsableSession(runtime, {
      wallet,
      strategy: runtime.sessionStrategy
    });
    const body = {
      ...(wallet ? { payer: wallet } : {})
    };
    if (options.input) {
      body.input = await readStructuredInput(options.input);
    }
    let payload;
    try {
      payload = await requestJson(runtime, {
        method: 'POST',
        pathname: `/api/jobs/${encodeURIComponent(jobId)}/submit`,
        apiKey: resolveAgentTransportApiKey(runtime),
        timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 90_000),
        body
      });
    } catch (error) {
      if (['trace_anchor_publish_failed', 'trace_anchor_required_before_submit'].includes(String(error?.code || '').trim())) {
        throw createCliError('trace anchor required before submit', {
          code: String(error?.code || 'trace_anchor_publish_failed').trim(),
          statusCode: error?.statusCode,
          data: error?.data
        });
      }
      throw error;
    }
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'submit', display: 'ktrace job submit' },
      runtime,
      data: {
        preflight: {
          checked: Boolean(preflight?.checked),
          created: Boolean(preflight?.created),
          reused: Boolean(preflight?.reused),
          sessionStrategy: String(preflight?.sessionStrategy || runtime.sessionStrategy || 'managed').trim(),
          traceId: String(preflight?.traceId || '').trim()
        },
        job: {
          lane: 'job',
          jobId: String(job?.jobId || jobId).trim(),
          traceId: String(job?.traceId || '').trim(),
          state: String(job?.state || '').trim(),
          provider: String(job?.provider || '').trim(),
          capability: String(job?.capability || '').trim(),
          serviceId: String(job?.serviceId || '').trim(),
          paymentRequestId: String(job?.paymentRequestId || '').trim(),
          paymentTxHash: String(job?.paymentTxHash || '').trim(),
          submissionRef: String(job?.submissionRef || '').trim(),
          submissionHash: String(job?.submissionHash || '').trim(),
          resultRef: String(job?.resultRef || '').trim(),
          resultHash: String(job?.resultHash || '').trim(),
          receiptRef: String(job?.receiptRef || '').trim(),
          evidenceRef: String(job?.evidenceRef || '').trim(),
          anchorRegistry: String(job?.anchorRegistry || '').trim(),
          submitAnchorId: String(job?.submitAnchorId || '').trim(),
          submitAnchorTxHash: String(job?.submitAnchorTxHash || '').trim(),
          submitAnchorConfirmedAt: String(job?.submitAnchorConfirmedAt || '').trim(),
          escrowSubmitTxHash: String(job?.escrowSubmitTxHash || '').trim(),
          summary: String(job?.summary || '').trim(),
          error: String(job?.error || '').trim()
        },
        workflow: payload?.workflow || null,
        receipt: payload?.receipt || null
      },
      message: String(job?.summary || 'Job submitted.').trim()
    });
  }

  async function handleJobShow(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const payload = await requestJson(runtime, {
      pathname: `/api/jobs/${encodeURIComponent(jobId)}`,
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    const traceAnchor = await fetchTraceAnchorStatus(runtime, { jobId });
    const job = mergeTraceAnchorIntoJob(payload?.job || {}, traceAnchor);
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'show', display: 'ktrace job show' },
      runtime,
      data: { job, traceAnchor },
      message: String(job?.summary || `Job ${jobId}`).trim()
    });
  }

  async function handleJobAudit(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseJobAuditArgs(commandArgs);
    const reference = ensureReference(commandArgs, 'job-id');
    const jobId = options.trace ? '' : reference;
    const traceId = options.trace ? reference : '';
    const pathname = options.public
      ? options.trace
        ? `/api/public/jobs/by-trace/${encodeURIComponent(traceId)}/audit`
        : `/api/public/jobs/${encodeURIComponent(jobId)}/audit`
      : `/api/jobs/${encodeURIComponent(jobId)}/audit`;
    const payload = await requestJson(runtime, {
      pathname,
      apiKey: options.public ? '' : resolveAgentTransportApiKey(runtime),
      omitRuntimeApiKey: options.public
    });
    const traceAnchor = await fetchTraceAnchorStatus(runtime, {
      jobId: String(payload?.audit?.jobId || jobId).trim(),
      publicRead: options.public
    });
    const audit = {
      ...(payload?.audit || {}),
      traceAnchor
    };
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'audit', display: 'ktrace job audit' },
      runtime,
      data: { audit, traceAnchor },
      message: String(audit?.summary?.state || '').trim()
        ? `Job audit loaded for ${options.trace ? traceId : jobId}.`
        : `Job audit loaded.`
    });
  }

  async function handleJobValidate(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const options = parseJobValidateArgs(commandArgs.slice(1));
    if (typeof options.approved !== 'boolean') {
      throw createCliError('Pass exactly one of --approve or --reject.', {
        code: 'validation_decision_required'
      });
    }
    const wallet = normalizeWalletAddress(runtime.wallet);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/validate`,
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {
        approved: options.approved,
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.summary ? { summary: options.summary } : {}),
        ...(options.validator ? { validatorAddress: options.validator } : wallet ? { validatorAddress: wallet } : {})
      }
    });
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'validate', display: 'ktrace job validate' },
      runtime,
      data: { job },
      message: String(job?.summary || 'Job validated.').trim()
    });
  }

  async function handleJobComplete(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const options = parseJobCompleteArgs(commandArgs.slice(1));
    const body = options.input ? await readStructuredInput(options.input) : {};
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/complete`,
      apiKey: resolveAgentTransportApiKey(runtime),
      body
    });
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'complete', display: 'ktrace job complete' },
      runtime,
      data: { job },
      message: String(job?.summary || 'Job completed.').trim()
    });
  }

  async function handleJobReject(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const options = parseJobRejectArgs(commandArgs.slice(1));
    const body = options.input ? await readStructuredInput(options.input) : {};
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/reject`,
      apiKey: resolveAgentTransportApiKey(runtime),
      body
    });
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'reject', display: 'ktrace job reject' },
      runtime,
      data: { job },
      message: String(job?.summary || 'Job rejected.').trim()
    });
  }

  async function handleJobExpire(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const jobId = ensureReference(commandArgs, 'job-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/expire`,
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {}
    });
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'expire', display: 'ktrace job expire' },
      runtime,
      data: { job },
      message: String(job?.summary || 'Job expired.').trim()
    });
  }

  return {
    handleJobCreate,
    handleJobFund,
    handleJobAccept,
    handleJobSubmit,
    handleJobShow,
    handleJobAudit,
    handleJobValidate,
    handleJobComplete,
    handleJobReject,
    handleJobExpire
  };
}
