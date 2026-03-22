import * as z from 'zod/v4';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeState(value = '') {
  return normalizeText(value).toLowerCase();
}

function normalizeAddress(value = '') {
  return normalizeText(value).toLowerCase();
}

function isConnectorScopedRequest(requestContext = {}) {
  return normalizeText(requestContext?.authSource || '') === 'connector-grant';
}

function buildVisibleAddressSet(requestContext = {}) {
  return new Set(
    [requestContext?.ownerEoa, requestContext?.aaWallet]
      .map((value) => normalizeAddress(value))
      .filter(Boolean)
  );
}

function recordMatchesVisibleAddresses(record = {}, requestContext = {}) {
  if (!isConnectorScopedRequest(requestContext)) return true;
  const visible = buildVisibleAddressSet(requestContext);
  if (visible.size === 0) return false;
  const candidates = new Set();
  const pushCandidate = (value = '') => {
    const normalized = normalizeAddress(value);
    if (normalized) candidates.add(normalized);
  };
  pushCandidate(record?.payer);
  pushCandidate(record?.requester);
  pushCandidate(record?.requesterAddress);
  pushCandidate(record?.requesterRuntimeAddress);
  pushCandidate(record?.ownerEoa);
  pushCandidate(record?.aaWallet);
  pushCandidate(record?.authority?.payer);
  pushCandidate(record?.authorityPublic?.payer);
  pushCandidate(record?.payment?.payer);
  pushCandidate(record?.summary?.requester);
  pushCandidate(record?.summary?.requesterAddress);
  pushCandidate(record?.summary?.requesterRuntimeAddress);
  pushCandidate(record?.contractPrimitives?.roleEnforcement?.requesterAddress);
  pushCandidate(record?.contractPrimitives?.roleEnforcement?.roleRuntimeSummary?.requesterRuntimeAddress);
  return Array.from(candidates).some((value) => visible.has(value));
}

async function fetchJson(fetchLoopbackJson, pathname = '', traceId = '') {
  return fetchLoopback(fetchLoopbackJson, { pathname, traceId });
}

async function resolveInvocationByRequestId(fetchLoopbackJson, requestId = '', traceId = '') {
  if (!normalizeText(requestId)) return null;
  const result = await fetchJson(
    fetchLoopbackJson,
    buildQueryPath('/api/service-invocations', { requestId, limit: 1 }),
    traceId
  );
  if (result.status >= 400 || result.payload?.ok === false) return null;
  return Array.isArray(result.payload?.items) ? result.payload.items[0] || null : null;
}

async function resolveInvocationByTraceId(fetchLoopbackJson, effectiveTraceId = '', traceId = '') {
  if (!normalizeText(effectiveTraceId)) return null;
  const result = await fetchJson(
    fetchLoopbackJson,
    buildQueryPath('/api/service-invocations', { traceId: effectiveTraceId, limit: 1 }),
    traceId
  );
  if (result.status >= 400 || result.payload?.ok === false) return null;
  return Array.isArray(result.payload?.items) ? result.payload.items[0] || null : null;
}

async function resolvePurchaseByTraceId(fetchLoopbackJson, effectiveTraceId = '', traceId = '') {
  if (!normalizeText(effectiveTraceId)) return null;
  const result = await fetchJson(
    fetchLoopbackJson,
    buildQueryPath('/api/purchases', { traceId: effectiveTraceId, limit: 1 }),
    traceId
  );
  if (result.status >= 400 || result.payload?.ok === false) return null;
  return Array.isArray(result.payload?.items) ? result.payload.items[0] || null : null;
}

async function resolveJobById(fetchLoopbackJson, jobId = '', traceId = '') {
  if (!normalizeText(jobId)) return null;
  const result = await fetchJson(fetchLoopbackJson, `/api/jobs/${encodeURIComponent(jobId)}`, traceId);
  if (result.status >= 400 || result.payload?.ok === false) return null;
  return result.payload?.job || null;
}

async function resolveJobByTraceId(fetchLoopbackJson, effectiveTraceId = '', traceId = '') {
  if (!normalizeText(effectiveTraceId)) return null;
  const result = await fetchJson(
    fetchLoopbackJson,
    buildQueryPath('/api/jobs', { traceId: effectiveTraceId, limit: 1 }),
    traceId
  );
  if (result.status >= 400 || result.payload?.ok === false) return null;
  return Array.isArray(result.payload?.items) ? result.payload.items[0] || null : null;
}

function assertRecordVisible(tool = {}, record = null, requestContext = {}) {
  if (!isConnectorScopedRequest(requestContext)) return null;
  if (!recordMatchesVisibleAddresses(record || {}, requestContext)) {
    return buildToolError(
      tool,
      403,
      { code: 'forbidden', reason: 'Connector grant cannot access records outside its owner scope.' },
      'Connector grant cannot access records outside its owner scope.'
    );
  }
  return null;
}

function buildQueryPath(pathname = '', params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(isPlainObject(params) ? params : {})) {
    if (value === null || value === undefined) continue;
    const normalized = typeof value === 'number' ? String(value) : normalizeText(value);
    if (!normalized) continue;
    search.set(key, normalized);
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function buildToolResponse(summary = '', structuredContent = {}) {
  const message = normalizeText(summary) || 'KTrace MCP action completed.';
  return {
    content: [
      {
        type: 'text',
        text: message
      }
    ],
    structuredContent
  };
}

function buildToolError(tool = {}, status = 500, payload = {}, fallbackReason = '') {
  const reason =
    normalizeText(payload?.reason || payload?.message || payload?.error || fallbackReason || '') ||
    'KTrace MCP action failed.';
  const code =
    normalizeText(payload?.code || payload?.error || '') ||
    (status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'ktrace_action_failed');
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: reason
      }
    ],
    structuredContent: {
      action: normalizeText(tool?.builtinId || tool?.name || ''),
      error: code,
      reason,
      status,
      detail: isPlainObject(payload?.detail) ? payload.detail : null
    }
  };
}

function summarizePayload(tool = {}, payload = {}, fallback = '') {
  return (
    normalizeText(payload?.message || '') ||
    normalizeText(payload?.job?.summary || '') ||
    normalizeText(payload?.flow?.summary || '') ||
    normalizeText(payload?.summary || '') ||
    fallback ||
    `${normalizeText(tool?.title || tool?.name || 'KTrace action')} completed.`
  );
}

function buildRecord(traceId = '', lane = '', state = '', provider = '', capability = '', createdAt = '', updatedAt = '', summary = '', paymentRequestId = '', referenceId = '') {
  return {
    traceId: normalizeText(traceId),
    lane: normalizeText(lane),
    state: normalizeState(state),
    provider: normalizeText(provider),
    capability: normalizeText(capability),
    createdAt: normalizeText(createdAt),
    updatedAt: normalizeText(updatedAt),
    summary: normalizeText(summary),
    paymentRequestId: normalizeText(paymentRequestId),
    referenceId: normalizeText(referenceId)
  };
}

function mergeFlowHistory(invocations = [], purchases = [], jobs = [], limit = 20) {
  const purchaseTraceIds = new Set(
    purchases.map((item) => normalizeText(item?.traceId)).filter(Boolean)
  );

  return [
    ...jobs.map((item) =>
      buildRecord(
        item?.traceId,
        'job',
        item?.state,
        item?.provider,
        item?.capability,
        item?.createdAt,
        item?.updatedAt,
        item?.summary,
        item?.paymentRequestId,
        item?.jobId
      )
    ),
    ...purchases.map((item) =>
      buildRecord(
        item?.traceId,
        'buy',
        item?.state,
        item?.providerAgentId,
        item?.capabilityId,
        item?.createdAt,
        item?.updatedAt,
        item?.summary,
        item?.paymentId,
        item?.purchaseId
      )
    ),
    ...invocations
      .filter((item) => !purchaseTraceIds.has(normalizeText(item?.traceId)))
      .map((item) =>
        buildRecord(
          item?.traceId,
          'buy',
          item?.state,
          item?.providerAgentId,
          item?.capability,
          item?.createdAt,
          item?.updatedAt,
          item?.summary,
          item?.requestId,
          item?.invocationId
        )
      )
  ]
    .sort(
      (left, right) =>
        Date.parse(right?.updatedAt || right?.createdAt || 0) -
        Date.parse(left?.updatedAt || left?.createdAt || 0)
    )
    .slice(0, Math.max(1, Math.min(Number(limit || 20) || 20, 100)));
}

async function fetchLoopback(fetchLoopbackJson, options = {}) {
  const { status, payload } = await fetchLoopbackJson(options);
  return {
    status: Number(status || 0) || 500,
    payload: isPlainObject(payload) ? payload : {}
  };
}

async function invokeFlowHistory(fetchLoopbackJson, args = {}, traceId = '', requestContext = {}) {
  const limit = Math.max(1, Math.min(Number(args?.limit || 20) || 20, 100));
  const filters = {
    state: normalizeText(args?.state || ''),
    provider: normalizeText(args?.provider || ''),
    capability: normalizeText(args?.capability || ''),
    limit
  };
  const [invocationsResult, purchasesResult, jobsResult] = await Promise.all([
    fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/service-invocations', filters),
      traceId
    }),
    fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/purchases', filters),
      traceId
    }),
    fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/jobs', filters),
      traceId
    })
  ]);

  for (const result of [invocationsResult, purchasesResult, jobsResult]) {
    if (result.status >= 400 || result.payload?.ok === false) {
      return buildToolError(
        { builtinId: 'flow_history', title: 'KTrace Flow History' },
        result.status,
        result.payload,
        'Failed to load KTrace flow history.'
      );
    }
  }

  const visibleInvocations = (Array.isArray(invocationsResult.payload?.items) ? invocationsResult.payload.items : [])
    .filter((item) => recordMatchesVisibleAddresses(item, requestContext));
  const visiblePurchases = (Array.isArray(purchasesResult.payload?.items) ? purchasesResult.payload.items : [])
    .filter((item) => recordMatchesVisibleAddresses(item, requestContext));
  const visibleJobs = (Array.isArray(jobsResult.payload?.items) ? jobsResult.payload.items : [])
    .filter((item) => recordMatchesVisibleAddresses(item, requestContext));
  const history = mergeFlowHistory(
    visibleInvocations,
    visiblePurchases,
    visibleJobs,
    limit
  );

  return buildToolResponse(`Loaded ${history.length} KTrace flow item(s).`, {
    action: 'flow_history',
    traceId,
    filters,
    history
  });
}

async function resolveFlowReference(fetchLoopbackJson, args = {}, traceId = '', requestContext = {}) {
  let effectiveTraceId = normalizeText(args?.traceId || '');
  let effectiveRequestId = normalizeText(args?.requestId || '');
  let effectiveJobId = normalizeText(args?.jobId || '');

  let job = null;
  let purchase = null;
  let invocation = null;

  if (effectiveJobId) {
    const jobResult = await fetchLoopback(fetchLoopbackJson, {
      pathname: `/api/jobs/${encodeURIComponent(effectiveJobId)}`,
      traceId
    });
    if (jobResult.status >= 400 || jobResult.payload?.ok === false) {
      return {
        error: buildToolError(
          { builtinId: 'flow_show', title: 'KTrace Flow Details' },
          jobResult.status,
          jobResult.payload,
          'Job was not found.'
        )
      };
    }
    job = jobResult.payload?.job || null;
    const visibilityError = job
      ? assertRecordVisible({ builtinId: 'flow_show', title: 'KTrace Flow Details' }, job, requestContext)
      : null;
    if (visibilityError) return { error: visibilityError };
    effectiveTraceId = normalizeText(job?.traceId || effectiveTraceId);
    effectiveRequestId = normalizeText(job?.paymentRequestId || effectiveRequestId);
  }

  if (effectiveRequestId && !effectiveTraceId) {
    const invocationResult = await fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/service-invocations', { requestId: effectiveRequestId, limit: 1 }),
      traceId
    });
    if (invocationResult.status < 400 && invocationResult.payload?.ok !== false) {
      invocation = Array.isArray(invocationResult.payload?.items) ? invocationResult.payload.items[0] || null : null;
      const visibilityError = invocation
        ? assertRecordVisible({ builtinId: 'flow_show', title: 'KTrace Flow Details' }, invocation, requestContext)
        : null;
      if (visibilityError) return { error: visibilityError };
      effectiveTraceId = normalizeText(invocation?.traceId || effectiveTraceId);
    }
  }

  if (effectiveTraceId && !job) {
    const jobListResult = await fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/jobs', { traceId: effectiveTraceId, limit: 1 }),
      traceId
    });
    if (jobListResult.status < 400 && jobListResult.payload?.ok !== false) {
      job = Array.isArray(jobListResult.payload?.items) ? jobListResult.payload.items[0] || null : null;
      const visibilityError = job
        ? assertRecordVisible({ builtinId: 'flow_show', title: 'KTrace Flow Details' }, job, requestContext)
        : null;
      if (visibilityError) return { error: visibilityError };
      effectiveJobId = normalizeText(job?.jobId || effectiveJobId);
      effectiveRequestId = normalizeText(job?.paymentRequestId || effectiveRequestId);
    }
  }

  if (effectiveTraceId && !purchase) {
    const purchaseResult = await fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/purchases', { traceId: effectiveTraceId, limit: 1 }),
      traceId
    });
    if (purchaseResult.status < 400 && purchaseResult.payload?.ok !== false) {
      purchase = Array.isArray(purchaseResult.payload?.items) ? purchaseResult.payload.items[0] || null : null;
      const visibilityError = purchase
        ? assertRecordVisible({ builtinId: 'flow_show', title: 'KTrace Flow Details' }, purchase, requestContext)
        : null;
      if (visibilityError) return { error: visibilityError };
    }
  }

  if (effectiveTraceId && !invocation) {
    const invocationResult = await fetchLoopback(fetchLoopbackJson, {
      pathname: buildQueryPath('/api/service-invocations', { traceId: effectiveTraceId, limit: 1 }),
      traceId
    });
    if (invocationResult.status < 400 && invocationResult.payload?.ok !== false) {
      invocation = Array.isArray(invocationResult.payload?.items) ? invocationResult.payload.items[0] || null : null;
      const visibilityError = invocation
        ? assertRecordVisible({ builtinId: 'flow_show', title: 'KTrace Flow Details' }, invocation, requestContext)
        : null;
      if (visibilityError) return { error: visibilityError };
      effectiveRequestId = normalizeText(invocation?.requestId || effectiveRequestId);
    }
  }

  if (!effectiveTraceId && !effectiveRequestId && !effectiveJobId) {
    return {
      error: buildToolError(
        { builtinId: 'flow_show', title: 'KTrace Flow Details' },
        400,
        { code: 'reference_required', reason: 'Provide traceId, requestId, or jobId.' },
        'Provide traceId, requestId, or jobId.'
      )
    };
  }

  return {
    traceId: effectiveTraceId,
    requestId: effectiveRequestId,
    jobId: effectiveJobId,
    job,
    purchase,
    invocation
  };
}

async function invokeFlowShow(fetchLoopbackJson, args = {}, traceId = '', requestContext = {}) {
  const resolved = await resolveFlowReference(fetchLoopbackJson, args, traceId, requestContext);
  if (resolved.error) return resolved.error;

  const { traceId: effectiveTraceId, requestId, jobId, job, purchase, invocation } = resolved;

  const [workflowResult, auditResult, receiptResult, evidenceResult] = await Promise.all([
    effectiveTraceId
      ? fetchLoopback(fetchLoopbackJson, {
          pathname: `/api/workflow/${encodeURIComponent(effectiveTraceId)}`,
          traceId
        })
      : Promise.resolve({ status: 204, payload: {} }),
    effectiveTraceId
      ? fetchLoopback(fetchLoopbackJson, {
          pathname: `/api/network/audit/${encodeURIComponent(effectiveTraceId)}`,
          traceId
        })
      : Promise.resolve({ status: 204, payload: {} }),
    requestId
      ? fetchLoopback(fetchLoopbackJson, {
          pathname: `/api/receipt/${encodeURIComponent(requestId)}`,
          traceId
        })
      : Promise.resolve({ status: 204, payload: {} }),
    effectiveTraceId
      ? fetchLoopback(fetchLoopbackJson, {
          pathname: buildQueryPath('/api/evidence/export', { traceId: effectiveTraceId }),
          traceId
        })
      : Promise.resolve({ status: 204, payload: {} })
  ]);

  for (const result of [workflowResult, auditResult, receiptResult, evidenceResult]) {
    if (result.status >= 400 && result.status !== 404) {
      return buildToolError(
        { builtinId: 'flow_show', title: 'KTrace Flow Details' },
        result.status,
        result.payload,
        'Failed to load KTrace flow details.'
      );
    }
  }

  const summary =
    normalizeText(job?.summary || purchase?.summary || invocation?.summary || workflowResult.payload?.workflow?.result?.summary || '') ||
    `Loaded KTrace flow ${effectiveTraceId || requestId || jobId}.`;

  return buildToolResponse(summary, {
    action: 'flow_show',
    traceId: effectiveTraceId,
    requestId,
    jobId,
    job: job || null,
    purchase: purchase || null,
    invocation: invocation || null,
    workflow: workflowResult.payload?.workflow || null,
    audit: auditResult.payload?.ok === false ? null : auditResult.payload || null,
    receipt: receiptResult.payload?.receipt || null,
    evidence: evidenceResult.payload?.evidence || null
  });
}

async function invokeArtifactReceipt(fetchLoopbackJson, args = {}, traceId = '', requestContext = {}) {
  const requestId = normalizeText(args?.requestId || '');
  if (!requestId) {
    return buildToolError(
      { builtinId: 'artifact_receipt', title: 'KTrace Receipt' },
      400,
      { code: 'request_id_required', reason: 'requestId is required.' },
      'requestId is required.'
    );
  }
  const invocation = await resolveInvocationByRequestId(fetchLoopbackJson, requestId, traceId);
  const result = await fetchLoopback(fetchLoopbackJson, {
    pathname: `/api/receipt/${encodeURIComponent(requestId)}`,
    traceId
  });
  if (result.status >= 400 || result.payload?.ok === false) {
    return buildToolError(
      { builtinId: 'artifact_receipt', title: 'KTrace Receipt' },
      result.status,
      result.payload,
      `Failed to load receipt for ${requestId}.`
    );
  }
  const visibilityError = assertRecordVisible(
    { builtinId: 'artifact_receipt', title: 'KTrace Receipt' },
    invocation || result.payload?.receipt || {},
    requestContext
  );
  if (visibilityError) return visibilityError;
  return buildToolResponse(`Loaded receipt for ${requestId}.`, {
    action: 'artifact_receipt',
    requestId,
    receipt: result.payload?.receipt || null
  });
}

async function invokeArtifactEvidence(fetchLoopbackJson, args = {}, traceId = '', requestContext = {}) {
  const effectiveTraceId = normalizeText(args?.traceId || '');
  if (!effectiveTraceId) {
    return buildToolError(
      { builtinId: 'artifact_evidence', title: 'KTrace Evidence' },
      400,
      { code: 'trace_id_required', reason: 'traceId is required.' },
      'traceId is required.'
    );
  }
  const [job, purchase, invocation] = await Promise.all([
    resolveJobByTraceId(fetchLoopbackJson, effectiveTraceId, traceId),
    resolvePurchaseByTraceId(fetchLoopbackJson, effectiveTraceId, traceId),
    resolveInvocationByTraceId(fetchLoopbackJson, effectiveTraceId, traceId)
  ]);
  const visibleRecord = job || purchase || invocation;
  const visibilityError = assertRecordVisible(
    { builtinId: 'artifact_evidence', title: 'KTrace Evidence' },
    visibleRecord,
    requestContext
  );
  if (visibilityError) return visibilityError;
  const result = await fetchLoopback(fetchLoopbackJson, {
    pathname: buildQueryPath('/api/evidence/export', { traceId: effectiveTraceId }),
    traceId
  });
  if (result.status >= 400 || result.payload?.ok === false) {
    return buildToolError(
      { builtinId: 'artifact_evidence', title: 'KTrace Evidence' },
      result.status,
      result.payload,
      `Failed to load evidence for ${effectiveTraceId}.`
    );
  }
  return buildToolResponse(`Loaded evidence for ${effectiveTraceId}.`, {
    action: 'artifact_evidence',
    traceId: effectiveTraceId,
    evidence: result.payload?.evidence || null
  });
}

async function invokeJobCreate(fetchLoopbackJson, args = {}, traceId = '', requestContext = {}) {
  const provider = normalizeText(args?.provider || '');
  const capability = normalizeText(args?.capability || '');
  const budget = normalizeText(args?.budget || '');
  if (!provider || !capability || !budget) {
    return buildToolError(
      { builtinId: 'job_create', title: 'KTrace Job Create' },
      400,
      {
        code: 'job_create_fields_required',
        reason: 'provider, capability, and budget are required.'
      },
      'provider, capability, and budget are required.'
    );
  }
  const runtimeAaWallet = normalizeText(requestContext?.aaWallet || '');
  const runtimeOwnerEoa = normalizeText(requestContext?.ownerEoa || '');
  const body = {
    provider,
    capability,
    budget,
    ...(isPlainObject(args?.input) ? { input: args.input } : {}),
    ...(normalizeText(args?.templateId || '') ? { templateId: normalizeText(args.templateId) } : {}),
    ...(normalizeText(args?.evaluator || '') ? { evaluator: normalizeText(args.evaluator) } : {}),
    ...(normalizeText(args?.expiresAt || '') ? { expiresAt: normalizeText(args.expiresAt) } : {}),
    ...(normalizeText(args?.executor || '') ? { executor: normalizeText(args.executor) } : {}),
    ...(normalizeText(args?.validator || '') ? { validator: normalizeText(args.validator) } : {}),
    ...(normalizeText(args?.escrowAmount || '') ? { escrowAmount: normalizeText(args.escrowAmount) } : {}),
    ...(normalizeText(args?.executorStakeAmount || '') ? { executorStakeAmount: normalizeText(args.executorStakeAmount) } : {}),
    ...(normalizeText(args?.traceId || '') ? { traceId: normalizeText(args.traceId) } : {}),
    ...(runtimeAaWallet && runtimeAaWallet.toLowerCase() !== runtimeOwnerEoa.toLowerCase()
      ? { requesterAddress: runtimeAaWallet }
      : {})
  };
  const result = await fetchLoopback(fetchLoopbackJson, {
    pathname: '/api/jobs',
    method: 'POST',
    body,
    traceId
  });
  if (result.status >= 400 || result.payload?.ok === false) {
    return buildToolError(
      { builtinId: 'job_create', title: 'KTrace Job Create' },
      result.status,
      result.payload,
      'Failed to create job.'
    );
  }
  return buildToolResponse(summarizePayload({ title: 'KTrace Job Create' }, result.payload, 'Job created.'), {
    action: 'job_create',
    traceId: normalizeText(result.payload?.traceId || ''),
    job: result.payload?.job || null
  });
}

async function invokeJobMutation(fetchLoopbackJson, tool = {}, args = {}, traceId = '', requestContext = {}) {
  const jobId = normalizeText(args?.jobId || '');
  if (!jobId) {
    return buildToolError(
      tool,
      400,
      { code: 'job_id_required', reason: 'jobId is required.' },
      'jobId is required.'
    );
  }

  const builtinId = normalizeText(tool?.builtinId || '');
  const pathnameByAction = {
    job_prepare_funding: `/api/jobs/${encodeURIComponent(jobId)}/prepare-funding`,
    job_fund: `/api/jobs/${encodeURIComponent(jobId)}/fund`,
    job_claim: `/api/jobs/${encodeURIComponent(jobId)}/claim`,
    job_accept: `/api/jobs/${encodeURIComponent(jobId)}/accept`,
    job_submit: `/api/jobs/${encodeURIComponent(jobId)}/submit`,
    job_validate: `/api/jobs/${encodeURIComponent(jobId)}/validate`,
    job_complete: `/api/jobs/${encodeURIComponent(jobId)}/complete`,
    job_reject: `/api/jobs/${encodeURIComponent(jobId)}/reject`,
    job_expire: `/api/jobs/${encodeURIComponent(jobId)}/expire`
  };
  const pathname = pathnameByAction[builtinId];
  if (!pathname) {
    return buildToolError(tool, 500, { code: 'unsupported_job_action', reason: builtinId }, 'Unsupported job action.');
  }

  const body = {};
  if (builtinId === 'job_claim') {
    if (normalizeText(args?.executor || '')) body.executor = normalizeText(args.executor);
    if (normalizeText(args?.executorAddress || '')) body.executorAddress = normalizeText(args.executorAddress);
  } else if (builtinId === 'job_prepare_funding') {
    if (normalizeText(args?.intentId || '')) body.intentId = normalizeText(args.intentId);
  } else if (builtinId === 'job_fund') {
    if (typeof args?.async === 'boolean') body.async = args.async;
    if (normalizeText(args?.intentId || '')) body.intentId = normalizeText(args.intentId);
  } else if (builtinId === 'job_submit') {
    if (isPlainObject(args?.input)) body.input = args.input;
    if (isPlainObject(args?.delivery)) body.delivery = args.delivery;
    for (const key of ['intentId', 'summary', 'resultRef', 'resultHash', 'primaryTraceId', 'evidenceRef', 'paymentRequestId', 'paymentTxHash', 'deliveredAt']) {
      if (normalizeText(args?.[key] || '')) body[key] = normalizeText(args[key]);
    }
    if (Array.isArray(args?.dataSourceTraceIds)) body.dataSourceTraceIds = args.dataSourceTraceIds.map((item) => normalizeText(item)).filter(Boolean);
    if (Array.isArray(args?.receiptRefs)) body.receiptRefs = args.receiptRefs.map((item) => normalizeText(item)).filter(Boolean);
  } else if (builtinId === 'job_validate') {
    if (typeof args?.approved !== 'boolean') {
      return buildToolError(
        tool,
        400,
        { code: 'validation_decision_required', reason: 'approved must be true or false.' },
        'approved must be true or false.'
      );
    }
    body.approved = args.approved;
    for (const key of ['reason', 'summary', 'validatorAddress', 'validator', 'evaluator', 'evaluatorRef']) {
      if (normalizeText(args?.[key] || '')) body[key] = normalizeText(args[key]);
    }
    if (!body.validatorAddress && !body.validator && normalizeText(requestContext?.aaWallet || '')) {
      body.validatorAddress = normalizeText(requestContext.aaWallet);
    }
  } else if (builtinId === 'job_complete' || builtinId === 'job_reject' || builtinId === 'job_expire') {
    if (isPlainObject(args?.input)) Object.assign(body, args.input);
    for (const key of ['summary', 'reason', 'resultRef', 'resultHash', 'evaluator', 'evaluatorRef']) {
      if (normalizeText(args?.[key] || '')) body[key] = normalizeText(args[key]);
    }
  }

  const result = await fetchLoopback(fetchLoopbackJson, {
    pathname,
    method: 'POST',
    body,
    traceId
  });
  if (result.status >= 400 || result.payload?.ok === false) {
    return buildToolError(
      tool,
      result.status,
      result.payload,
      `${normalizeText(tool?.title || tool?.name || 'KTrace job action')} failed.`
    );
  }
  return buildToolResponse(
    summarizePayload(tool, result.payload, `${normalizeText(tool?.title || tool?.name || 'KTrace job action')} completed.`),
    {
      action: builtinId,
      traceId: normalizeText(result.payload?.traceId || ''),
      state: normalizeText(result.payload?.state || ''),
      job: result.payload?.job || null,
      preparation: result.payload?.preparation || null,
      workflow: result.payload?.workflow || null,
      receipt: result.payload?.receipt || null,
      approval: result.payload?.approval || null
    }
  );
}

async function invokeJobRead(fetchLoopbackJson, tool = {}, args = {}, traceId = '', requestContext = {}) {
  const jobId = normalizeText(args?.jobId || '');
  if (!jobId) {
    return buildToolError(
      tool,
      400,
      { code: 'job_id_required', reason: 'jobId is required.' },
      'jobId is required.'
    );
  }
  const pathnameByAction = {
    job_show: `/api/jobs/${encodeURIComponent(jobId)}`,
    job_audit: `/api/jobs/${encodeURIComponent(jobId)}/audit`
  };
  const pathname = pathnameByAction[normalizeText(tool?.builtinId || '')];
  const result = await fetchLoopback(fetchLoopbackJson, { pathname, traceId });
  if (result.status >= 400 || result.payload?.ok === false) {
    return buildToolError(
      tool,
      result.status,
      result.payload,
      `${normalizeText(tool?.title || tool?.name || 'KTrace job read')} failed.`
    );
  }
  const visibilityError = assertRecordVisible(tool, result.payload?.job || result.payload?.audit || {}, requestContext);
  if (visibilityError) return visibilityError;
  return buildToolResponse(
    summarizePayload(tool, result.payload, `${normalizeText(tool?.title || tool?.name || 'KTrace job read')} loaded.`),
    {
      action: normalizeText(tool?.builtinId || ''),
      traceId: normalizeText(result.payload?.traceId || ''),
      job: result.payload?.job || null,
      audit: result.payload?.audit || null
    }
  );
}

function resolveBuiltinMetadata(builtinId = '') {
  const normalized = normalizeText(builtinId).toLowerCase();
  if (['flow_history', 'flow_show', 'artifact_receipt', 'artifact_evidence'].includes(normalized)) {
    return { audience: 'public_product', scopeMode: 'scoped', riskLevel: 'low' };
  }
  if (['job_create', 'job_show', 'job_audit'].includes(normalized)) {
    return { audience: 'trusted_integration', scopeMode: 'scoped', riskLevel: 'high' };
  }
  return { audience: 'internal_ops', scopeMode: 'scoped', riskLevel: 'critical' };
}

const passthroughObject = () => z.object({}).passthrough();

export const KTRACE_BUILTIN_TOOLS = [
  {
    name: 'ktrace__flow_history',
    title: 'KTrace Flow History',
    description: 'List recent KTrace buy flows and job flows with optional filters.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z
      .object({
        limit: z.number().int().min(1).max(100).optional(),
        state: z.string().optional(),
        provider: z.string().optional(),
        capability: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'flow_history'
  },
  {
    name: 'ktrace__flow_show',
    title: 'KTrace Flow Details',
    description: 'Load workflow, audit, receipt, and evidence context for a traceId, requestId, or jobId.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z
      .object({
        traceId: z.string().optional(),
        requestId: z.string().optional(),
        jobId: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'flow_show'
  },
  {
    name: 'ktrace__artifact_receipt',
    title: 'KTrace Receipt',
    description: 'Load the payment receipt for a KTrace requestId.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ requestId: z.string() }).passthrough(),
    kind: 'builtin',
    builtinId: 'artifact_receipt'
  },
  {
    name: 'ktrace__artifact_evidence',
    title: 'KTrace Evidence',
    description: 'Load the evidence export for a KTrace traceId.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ traceId: z.string() }).passthrough(),
    kind: 'builtin',
    builtinId: 'artifact_evidence'
  },
  {
    name: 'ktrace__job_create',
    title: 'KTrace Job Create',
    description: 'Create a new KTrace job lane item.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        provider: z.string(),
        capability: z.string(),
        budget: z.union([z.string(), z.number()]),
        input: passthroughObject().optional(),
        templateId: z.string().optional(),
        evaluator: z.string().optional(),
        expiresAt: z.string().optional(),
        executor: z.string().optional(),
        validator: z.string().optional(),
        escrowAmount: z.union([z.string(), z.number()]).optional(),
        executorStakeAmount: z.union([z.string(), z.number()]).optional(),
        traceId: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_create'
  },
  {
    name: 'ktrace__job_prepare_funding',
    title: 'KTrace Job Prepare Funding',
    description: 'Prepare the requester and executor AA wallets for escrow-backed job execution by approving settlement token allowances.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        intentId: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_prepare_funding'
  },
  {
    name: 'ktrace__job_fund',
    title: 'KTrace Job Fund',
    description: 'Fund a created KTrace job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        async: z.boolean().optional(),
        intentId: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_fund'
  },
  {
    name: 'ktrace__job_claim',
    title: 'KTrace Job Claim',
    description: 'Claim an open KTrace job (executor not yet assigned). First come first served.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({ jobId: z.string(), executor: z.string().optional().describe('Executor AA wallet address. If omitted uses default executor runtime.') }).passthrough(),
    kind: 'builtin',
    builtinId: 'job_claim'
  },
  {
    name: 'ktrace__job_accept',
    title: 'KTrace Job Accept',
    description: 'Accept a funded KTrace job (executor must be assigned first, use job_claim for open jobs).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({ jobId: z.string() }).passthrough(),
    kind: 'builtin',
    builtinId: 'job_accept'
  },
  {
    name: 'ktrace__job_submit',
    title: 'KTrace Job Submit',
    description: 'Submit execution results for an accepted KTrace job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        intentId: z.string().optional(),
        input: passthroughObject().optional(),
        delivery: passthroughObject().optional(),
        summary: z.string().optional(),
        resultRef: z.string().optional(),
        resultHash: z.string().optional(),
        primaryTraceId: z.string().optional(),
        evidenceRef: z.string().optional(),
        paymentRequestId: z.string().optional(),
        paymentTxHash: z.string().optional(),
        deliveredAt: z.string().optional(),
        dataSourceTraceIds: z.array(z.string()).optional(),
        receiptRefs: z.array(z.string()).optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_submit'
  },
  {
    name: 'ktrace__job_validate',
    title: 'KTrace Job Validate',
    description: 'Approve or reject a submitted escrow-backed KTrace job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        approved: z.boolean(),
        reason: z.string().optional(),
        summary: z.string().optional(),
        validatorAddress: z.string().optional(),
        evaluator: z.string().optional(),
        evaluatorRef: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_validate'
  },
  {
    name: 'ktrace__job_show',
    title: 'KTrace Job Show',
    description: 'Load the current state of a KTrace job.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ jobId: z.string() }).passthrough(),
    kind: 'builtin',
    builtinId: 'job_show'
  },
  {
    name: 'ktrace__job_audit',
    title: 'KTrace Job Audit',
    description: 'Load the audit view for a KTrace job.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: z.object({ jobId: z.string() }).passthrough(),
    kind: 'builtin',
    builtinId: 'job_audit'
  },
  {
    name: 'ktrace__job_complete',
    title: 'KTrace Job Complete',
    description: 'Complete a non-escrow KTrace job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        input: passthroughObject().optional(),
        summary: z.string().optional(),
        resultRef: z.string().optional(),
        resultHash: z.string().optional(),
        evaluator: z.string().optional(),
        evaluatorRef: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_complete'
  },
  {
    name: 'ktrace__job_reject',
    title: 'KTrace Job Reject',
    description: 'Reject a non-escrow KTrace job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        input: passthroughObject().optional(),
        summary: z.string().optional(),
        reason: z.string().optional(),
        evaluator: z.string().optional(),
        evaluatorRef: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_reject'
  },
  {
    name: 'ktrace__job_expire',
    title: 'KTrace Job Expire',
    description: 'Force expiry for an eligible KTrace job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z
      .object({
        jobId: z.string(),
        summary: z.string().optional()
      })
      .passthrough(),
    kind: 'builtin',
    builtinId: 'job_expire'
  }
].map((tool) => ({
  ...tool,
  ...resolveBuiltinMetadata(tool?.builtinId)
}));

export async function invokeBuiltinTool({
  tool = {},
  args = {},
  fetchLoopbackJson,
  traceId = '',
  requestContext = {}
} = {}) {
  const builtinId = normalizeText(tool?.builtinId || '');

  if (builtinId === 'flow_history') {
    return invokeFlowHistory(fetchLoopbackJson, args, traceId, requestContext);
  }
  if (builtinId === 'flow_show') {
    return invokeFlowShow(fetchLoopbackJson, args, traceId, requestContext);
  }
  if (builtinId === 'artifact_receipt') {
    return invokeArtifactReceipt(fetchLoopbackJson, args, traceId, requestContext);
  }
  if (builtinId === 'artifact_evidence') {
    return invokeArtifactEvidence(fetchLoopbackJson, args, traceId, requestContext);
  }
  if (builtinId === 'job_create') {
    return invokeJobCreate(fetchLoopbackJson, args, traceId, requestContext);
  }
  if (['job_prepare_funding', 'job_fund', 'job_accept', 'job_submit', 'job_validate', 'job_complete', 'job_reject', 'job_expire'].includes(builtinId)) {
    return invokeJobMutation(fetchLoopbackJson, tool, args, traceId, requestContext);
  }
  if (['job_show', 'job_audit'].includes(builtinId)) {
    return invokeJobRead(fetchLoopbackJson, tool, args, traceId, requestContext);
  }

  return buildToolError(
    tool,
    500,
    { code: 'unsupported_builtin_tool', reason: builtinId || normalizeText(tool?.name || '') },
    'Unsupported KTrace builtin tool.'
  );
}
