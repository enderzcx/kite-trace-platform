import { createCliError } from './errors.js';
import { buildQueryPath, requestJson, requestOptionalJson, resolveAgentTransportApiKey } from './httpRuntime.js';
import { normalizeLifecycleState } from './inputRuntime.js';

export async function resolveInvocationRecord(runtime, reference = '') {
  const agentApiKey = resolveAgentTransportApiKey(runtime);
  const byTrace = await requestJson(runtime, {
    pathname: buildQueryPath('/api/service-invocations', { traceId: reference, limit: '1' }),
    apiKey: agentApiKey
  });
  if (Array.isArray(byTrace?.items) && byTrace.items.length > 0) {
    return byTrace.items[0];
  }
  const byRequest = await requestJson(runtime, {
    pathname: buildQueryPath('/api/service-invocations', { requestId: reference, limit: '1' }),
    apiKey: agentApiKey
  });
  if (Array.isArray(byRequest?.items) && byRequest.items.length > 0) {
    return byRequest.items[0];
  }
  throw createCliError(`No flow matched reference=${reference}.`, {
    code: 'flow_not_found'
  });
}

export async function resolveFlowReference(runtime, reference = '') {
  const normalizedReference = String(reference || '').trim();
  const agentApiKey = resolveAgentTransportApiKey(runtime);

  const [purchaseById, purchaseByTrace, jobById, jobByTrace] = await Promise.all([
    requestOptionalJson(runtime, {
      pathname: buildQueryPath('/api/purchases', { purchaseId: normalizedReference, limit: '1' }),
      apiKey: agentApiKey
    }),
    requestOptionalJson(runtime, {
      pathname: buildQueryPath('/api/purchases', { traceId: normalizedReference, limit: '1' }),
      apiKey: agentApiKey
    }),
    requestOptionalJson(runtime, {
      pathname: buildQueryPath('/api/jobs', { jobId: normalizedReference, limit: '1' }),
      apiKey: agentApiKey
    }),
    requestOptionalJson(runtime, {
      pathname: buildQueryPath('/api/jobs', { traceId: normalizedReference, limit: '1' }),
      apiKey: agentApiKey
    })
  ]);

  const purchaseItem =
    (Array.isArray(purchaseById?.items) && purchaseById.items[0]) ||
    (Array.isArray(purchaseByTrace?.items) && purchaseByTrace.items[0]) ||
    null;
  if (purchaseItem) {
    return {
      lane: 'buy',
      kind: 'purchase',
      traceId: String(purchaseItem?.traceId || '').trim(),
      paymentRequestId: String(purchaseItem?.paymentId || '').trim(),
      referenceId: String(purchaseItem?.purchaseId || '').trim(),
      provider: String(purchaseItem?.providerAgentId || '').trim(),
      capability: String(purchaseItem?.capabilityId || '').trim(),
      serviceId: String(purchaseItem?.serviceId || '').trim(),
      invocationId: '',
      paymentTxHash: String(purchaseItem?.paymentTxHash || '').trim(),
      summary: String(purchaseItem?.summary || '').trim(),
      error: String(purchaseItem?.error || '').trim(),
      state: normalizeLifecycleState(purchaseItem?.state),
      createdAt: String(purchaseItem?.createdAt || '').trim(),
      updatedAt: String(purchaseItem?.updatedAt || '').trim(),
      receiptRef: String(purchaseItem?.receiptRef || '').trim(),
      evidenceRef: String(purchaseItem?.evidenceRef || '').trim(),
      raw: purchaseItem
    };
  }

  const jobItem =
    (Array.isArray(jobById?.items) && jobById.items[0]) ||
    (Array.isArray(jobByTrace?.items) && jobByTrace.items[0]) ||
    null;
  if (jobItem) {
    return {
      lane: 'job',
      kind: 'job',
      traceId: String(jobItem?.traceId || '').trim(),
      paymentRequestId: String(jobItem?.paymentRequestId || '').trim(),
      referenceId: String(jobItem?.jobId || '').trim(),
      provider: String(jobItem?.provider || '').trim(),
      capability: String(jobItem?.capability || '').trim(),
      serviceId: String(jobItem?.serviceId || '').trim(),
      invocationId: '',
      paymentTxHash: String(jobItem?.paymentTxHash || '').trim(),
      summary: String(jobItem?.summary || '').trim(),
      error: String(jobItem?.error || '').trim(),
      state: normalizeLifecycleState(jobItem?.state),
      createdAt: String(jobItem?.createdAt || '').trim(),
      updatedAt: String(jobItem?.updatedAt || '').trim(),
      receiptRef: String(jobItem?.receiptRef || '').trim(),
      evidenceRef: String(jobItem?.evidenceRef || '').trim(),
      raw: jobItem
    };
  }

  const invocation = await resolveInvocationRecord(runtime, normalizedReference);
  return {
    lane: 'buy',
    kind: 'invocation',
    traceId: String(invocation?.traceId || '').trim(),
    paymentRequestId: String(invocation?.requestId || '').trim(),
    referenceId: String(invocation?.invocationId || '').trim(),
    provider: String(invocation?.providerAgentId || '').trim(),
    capability: String(invocation?.capability || '').trim(),
    serviceId: String(invocation?.serviceId || '').trim(),
    invocationId: String(invocation?.invocationId || '').trim(),
    paymentTxHash: String(invocation?.txHash || '').trim(),
    summary: String(invocation?.summary || '').trim(),
    error: String(invocation?.error || '').trim(),
    state: normalizeLifecycleState(invocation?.state),
    createdAt: String(invocation?.createdAt || '').trim(),
    updatedAt: String(invocation?.updatedAt || '').trim(),
    receiptRef: '',
    evidenceRef: '',
    raw: invocation
  };
}
