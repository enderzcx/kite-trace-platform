export function createJobCommandHandlers({
  parseJobCreateArgs,
  parseJobSubmitArgs,
  parseJobCompleteArgs,
  parseJobRejectArgs,
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
          fundingAnchorTxHash: String(job?.fundingAnchorTxHash || '').trim()
        }
      },
      message: String(job?.summary || 'Job funded.').trim()
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
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/jobs/${encodeURIComponent(jobId)}/submit`,
      apiKey: resolveAgentTransportApiKey(runtime),
      timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 90_000),
      body
    });
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
          receiptRef: String(job?.receiptRef || '').trim(),
          evidenceRef: String(job?.evidenceRef || '').trim(),
          anchorRegistry: String(job?.anchorRegistry || '').trim(),
          outcomeAnchorId: String(job?.outcomeAnchorId || '').trim(),
          outcomeAnchorTxHash: String(job?.outcomeAnchorTxHash || '').trim(),
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
    const job = payload?.job || {};
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'job', action: 'show', display: 'ktrace job show' },
      runtime,
      data: { job },
      message: String(job?.summary || `Job ${jobId}`).trim()
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
    handleJobSubmit,
    handleJobShow,
    handleJobComplete,
    handleJobReject,
    handleJobExpire
  };
}
