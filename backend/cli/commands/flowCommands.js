export function createFlowCommandHandlers({
  parseFlowHistoryArgs,
  requestJson,
  requestOptionalJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  ensureReference,
  resolveFlowReference,
  normalizeLifecycleState
}) {
  async function handleFlowStatus(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const reference = ensureReference(commandArgs);
    const record = await resolveFlowReference(runtime, reference);
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'flow', action: 'status', display: 'ktrace flow status' },
      runtime,
      data: {
        flow: {
          traceId: String(record?.traceId || '').trim(),
          lane: String(record?.lane || '').trim(),
          state: String(record?.state || '').trim(),
          provider: String(record?.provider || '').trim(),
          capability: String(record?.capability || '').trim(),
          updatedAt: String(record?.updatedAt || '').trim(),
          summary: String(record?.summary || '').trim(),
          serviceId: String(record?.serviceId || '').trim(),
          invocationId: String(record?.invocationId || '').trim(),
          paymentRequestId: String(record?.paymentRequestId || '').trim(),
          referenceId: String(record?.referenceId || '').trim()
        }
      },
      message: String(record?.summary || '').trim() || `Flow ${String(record?.traceId || reference).trim()}`
    });
  }

  async function handleFlowShow(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const reference = ensureReference(commandArgs);
    const record = await resolveFlowReference(runtime, reference);
    const traceId = String(record?.traceId || '').trim();
    const requestId = String(record?.paymentRequestId || '').trim();
    const transportApiKey = String(runtime.apiKey || '').trim() || resolveAgentTransportApiKey(runtime);

    const [workflowPayload, auditPayload, receiptPayload, evidencePayload] = await Promise.all([
      requestOptionalJson(runtime, { pathname: `/api/workflow/${encodeURIComponent(traceId)}`, apiKey: transportApiKey }),
      requestOptionalJson(runtime, { pathname: `/api/network/audit/${encodeURIComponent(traceId)}`, apiKey: transportApiKey }),
      requestId ? requestOptionalJson(runtime, { pathname: `/api/receipt/${encodeURIComponent(requestId)}`, apiKey: transportApiKey }) : Promise.resolve(null),
      requestOptionalJson(runtime, { pathname: buildQueryPath('/api/evidence/export', { traceId }), apiKey: transportApiKey })
    ]);

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'flow', action: 'show', display: 'ktrace flow show' },
      runtime,
      data: {
        flow: {
          traceId,
          lane: String(record?.lane || '').trim(),
          kind: String(record?.kind || '').trim(),
          referenceId: String(record?.referenceId || '').trim(),
          state: String(record?.state || '').trim(),
          provider: String(record?.provider || '').trim(),
          capability: String(record?.capability || '').trim(),
          serviceId: String(record?.serviceId || '').trim(),
          serviceName: String(record?.raw?.serviceName || '').trim(),
          invocationId: String(record?.invocationId || '').trim(),
          paymentRequestId: requestId,
          txHash: String(record?.paymentTxHash || '').trim(),
          summary: String(record?.summary || '').trim(),
          error: String(record?.error || '').trim(),
          workflow: workflowPayload?.workflow || null,
          audit: auditPayload || null,
          receipt: receiptPayload?.receipt || null,
          evidence: evidencePayload?.evidence || null
        }
      }
    });
  }

  async function handleFlowHistory(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseFlowHistoryArgs(commandArgs);
    const apiKey = resolveAgentTransportApiKey(runtime);
    const [invocationsPayload, purchasesPayload, jobsPayload] = await Promise.all([
      requestJson(runtime, {
        pathname: buildQueryPath('/api/service-invocations', {
          state: options.status,
          provider: options.provider,
          capability: options.capability,
          limit: options.limit || '20'
        }),
        apiKey
      }),
      requestJson(runtime, {
        pathname: buildQueryPath('/api/purchases', {
          state: options.status,
          provider: options.provider,
          capability: options.capability,
          limit: options.limit || '20'
        }),
        apiKey
      }),
      requestJson(runtime, {
        pathname: buildQueryPath('/api/jobs', {
          state: options.status,
          provider: options.provider,
          capability: options.capability,
          limit: options.limit || '20'
        }),
        apiKey
      })
    ]);
    const invocationItems = Array.isArray(invocationsPayload?.items) ? invocationsPayload.items : [];
    const purchaseItems = Array.isArray(purchasesPayload?.items) ? purchasesPayload.items : [];
    const jobItems = Array.isArray(jobsPayload?.items) ? jobsPayload.items : [];
    const purchaseTraceIds = new Set(purchaseItems.map((item) => String(item?.traceId || '').trim()).filter(Boolean));
    const history = [
      ...jobItems.map((item) => ({
        traceId: String(item?.traceId || '').trim(),
        lane: 'job',
        state: normalizeLifecycleState(item?.state),
        provider: String(item?.provider || '').trim(),
        capability: String(item?.capability || '').trim(),
        createdAt: String(item?.createdAt || '').trim(),
        updatedAt: String(item?.updatedAt || '').trim(),
        summary: String(item?.summary || '').trim(),
        paymentRequestId: String(item?.paymentRequestId || '').trim(),
        referenceId: String(item?.jobId || '').trim()
      })),
      ...purchaseItems.map((item) => ({
        traceId: String(item?.traceId || '').trim(),
        lane: 'buy',
        state: normalizeLifecycleState(item?.state),
        provider: String(item?.providerAgentId || '').trim(),
        capability: String(item?.capabilityId || '').trim(),
        createdAt: String(item?.createdAt || '').trim(),
        updatedAt: String(item?.updatedAt || '').trim(),
        summary: String(item?.summary || '').trim(),
        paymentRequestId: String(item?.paymentId || '').trim(),
        referenceId: String(item?.purchaseId || '').trim()
      })),
      ...invocationItems
        .filter((item) => !purchaseTraceIds.has(String(item?.traceId || '').trim()))
        .map((item) => ({
          traceId: String(item?.traceId || '').trim(),
          lane: 'buy',
          state: normalizeLifecycleState(item?.state),
          provider: String(item?.providerAgentId || '').trim(),
          capability: String(item?.capability || '').trim(),
          createdAt: String(item?.createdAt || '').trim(),
          updatedAt: String(item?.updatedAt || '').trim(),
          summary: String(item?.summary || '').trim(),
          paymentRequestId: String(item?.requestId || '').trim(),
          referenceId: String(item?.invocationId || '').trim()
        }))
    ]
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, Math.max(1, Math.min(Number(options.limit || 20), 100)));

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'flow', action: 'history', display: 'ktrace flow history' },
      runtime,
      data: {
        history
      },
      message: `Found ${history.length} flow item(s).`
    });
  }

  return {
    handleFlowStatus,
    handleFlowShow,
    handleFlowHistory
  };
}
