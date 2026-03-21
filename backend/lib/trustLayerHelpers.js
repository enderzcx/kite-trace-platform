function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeAddress(value = '') {
  return normalizeText(value).toLowerCase();
}

function buildTrustSummary(subject = {}, baseSummary = '') {
  const agentId = normalizeText(subject?.agentId || '');
  const identityRegistry = normalizeText(subject?.identityRegistry || '');
  const detail = agentId && identityRegistry ? `${agentId}@${identityRegistry}` : agentId || identityRegistry;
  if (!detail) return normalizeText(baseSummary || 'Trust signal recorded.');
  return `${normalizeText(baseSummary || 'Trust signal recorded.')} [${detail}]`;
}

function resolveProviderTrustSubject(service = {}, providers = []) {
  const providerId = normalizeText(service?.providerAgentId || '');
  if (!providerId) return null;
  const provider =
    (Array.isArray(providers) ? providers : []).find(
      (item) => normalizeText(item?.id || '').toLowerCase() === providerId.toLowerCase()
    ) || null;
  if (!provider) return null;
  const identityRegistry = normalizeText(provider?.identityRegistry || '');
  const agentId = normalizeText(provider?.identityAgentId || '');
  if (!identityRegistry || !agentId) return null;
  return {
    agentId,
    identityRegistry,
    providerId
  };
}

export function createTrustLayerHelpers({
  appendReputationSignal,
  appendTrustPublication,
  createTraceId,
  ensureNetworkAgents,
  publishTrustPublicationOnChain
} = {}) {
  async function publishSignalRecord(signal = {}, subject = {}) {
    if (typeof appendTrustPublication !== 'function') return null;
    const now = new Date().toISOString();
    const publicationId = typeof createTraceId === 'function' ? createTraceId('pub') : `pub_${Date.now()}`;
    const fallbackPublicationRef = `ktrace://trust/reputation/${encodeURIComponent(normalizeText(signal?.signalId || ''))}`;
    const draftRecord = {
      publicationId,
      publicationType: 'reputation',
      sourceId: normalizeText(signal?.signalId || ''),
      agentId: normalizeText(subject?.agentId || ''),
      targetRegistry: '',
      status: 'pending',
      referenceId: normalizeText(signal?.referenceId || ''),
      traceId: normalizeText(signal?.traceId || ''),
      publicationRef: fallbackPublicationRef,
      anchorTxHash: '',
      summary: buildTrustSummary(subject, signal?.summary || 'Prepared reputation publication.'),
      createdAt: now,
      updatedAt: now
    };
    try {
      const anchorResult =
        typeof publishTrustPublicationOnChain === 'function'
          ? await publishTrustPublicationOnChain({
              publicationType: draftRecord.publicationType,
              sourceId: draftRecord.sourceId,
              agentId: draftRecord.agentId,
              referenceId: draftRecord.referenceId,
              traceId: draftRecord.traceId,
              publicationRef: draftRecord.publicationRef
            })
          : { configured: false, published: false, registryAddress: '' };
      const status = anchorResult?.published
        ? 'published'
        : anchorResult?.configured
          ? 'failed'
          : 'pending';
      return appendTrustPublication({
        ...draftRecord,
        targetRegistry: normalizeText(anchorResult?.registryAddress || ''),
        status,
        publicationRef: normalizeText(anchorResult?.anchorId || draftRecord.publicationRef),
        anchorTxHash: normalizeText(anchorResult?.anchorTxHash || ''),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      return appendTrustPublication({
        ...draftRecord,
        status: 'failed',
        summary: `${draftRecord.summary} (${normalizeText(error?.message || 'publish_failed') || 'publish_failed'})`,
        updatedAt: new Date().toISOString()
      });
    }
  }

  async function appendSubjectTrustSignal(subject = {}, input = {}) {
    const agentId = normalizeText(subject?.agentId || '');
    const identityRegistry = normalizeText(subject?.identityRegistry || '');
    if (!agentId || !identityRegistry || typeof appendReputationSignal !== 'function') {
      return null;
    }
    const signal = appendReputationSignal({
      signalId: typeof createTraceId === 'function' ? createTraceId('rep') : `rep_${Date.now()}`,
      agentId,
      identityRegistry,
      sourceLane: normalizeText(input?.sourceLane || 'buy'),
      sourceKind: normalizeText(input?.sourceKind || 'x402-invoke'),
      referenceId: normalizeText(input?.referenceId || ''),
      traceId: normalizeText(input?.traceId || ''),
      paymentRequestId: normalizeText(input?.paymentRequestId || ''),
      verdict: 'positive',
      score: 1,
      summary: buildTrustSummary(subject, input?.summary || 'Paid invoke completed successfully.'),
      evaluator: normalizeText(input?.evaluator || ''),
      createdAt: normalizeText(input?.createdAt || new Date().toISOString())
    });
    const publication = await publishSignalRecord(signal, subject);
    return {
      signal,
      publication
    };
  }

  async function appendInvokeTrustArtifacts({
    consumerSubject = null,
    service = {},
    sourceLane = 'buy',
    sourceKind = 'x402-invoke',
    referenceId = '',
    traceId = '',
    paymentRequestId = '',
    summary = '',
    evaluator = ''
  } = {}) {
    const providers = typeof ensureNetworkAgents === 'function' ? ensureNetworkAgents() : [];
    const providerSubject = resolveProviderTrustSubject(service, providers);
    const artifacts = [];
    const createdAt = new Date().toISOString();

    const consumerArtifact = await appendSubjectTrustSignal(consumerSubject || {}, {
      sourceLane,
      sourceKind,
      referenceId,
      traceId,
      paymentRequestId,
      summary,
      evaluator,
      createdAt
    });
    if (consumerArtifact) artifacts.push({ subject: 'consumer', ...consumerArtifact });

    const providerArtifact = await appendSubjectTrustSignal(providerSubject || {}, {
      sourceLane,
      sourceKind: `${normalizeText(sourceKind || 'x402-invoke')}:provider`,
      referenceId,
      traceId,
      paymentRequestId,
      summary,
      evaluator,
      createdAt
    });
    if (providerArtifact) artifacts.push({ subject: 'provider', ...providerArtifact });

    return {
      items: artifacts
    };
  }

  return {
    appendInvokeTrustArtifacts,
    resolveProviderTrustSubject
  };
}
