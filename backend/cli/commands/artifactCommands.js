export function createArtifactCommandHandlers({
  parseArtifactArgs,
  parseEvidenceGetArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  ensureReference,
  resolveFlowReference,
  writeArtifactDownload
}) {
  async function handleArtifactReceipt(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const reference = ensureReference(commandArgs);
    const options = parseArtifactArgs(commandArgs.slice(1));
    const record = await resolveFlowReference(runtime, reference);
    const requestId = String(record?.paymentRequestId || '').trim();
    if (!requestId) {
      throw createCliError(`No payment request is linked to reference=${reference}.`, {
        code: 'receipt_unavailable'
      });
    }
    const payload = await requestJson(runtime, {
      pathname: `/api/receipt/${encodeURIComponent(requestId)}`,
      apiKey: String(runtime.apiKey || '').trim() || resolveAgentTransportApiKey(runtime)
    });
    const downloadPath = options.download ? await writeArtifactDownload('receipt', requestId, payload.receipt || payload) : '';
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'artifact', action: 'receipt', display: 'ktrace artifact receipt' },
      runtime,
      data: {
        requestId,
        downloadPath,
        receipt: payload?.receipt || null
      },
      message: downloadPath ? `Receipt saved to ${downloadPath}.` : `Receipt loaded for ${requestId}.`
    });
  }

  async function handleArtifactEvidence(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const reference = ensureReference(commandArgs);
    const options = parseArtifactArgs(commandArgs.slice(1));
    const record = await resolveFlowReference(runtime, reference);
    const traceId = String(record?.traceId || '').trim();
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/evidence/export', { traceId }),
      apiKey: String(runtime.apiKey || '').trim() || resolveAgentTransportApiKey(runtime)
    });
    const downloadPath = options.download ? await writeArtifactDownload('evidence', traceId, payload.evidence || payload) : '';
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'artifact', action: 'evidence', display: 'ktrace artifact evidence' },
      runtime,
      data: {
        traceId,
        downloadPath,
        evidence: payload?.evidence || null
      },
      message: downloadPath ? `Evidence saved to ${downloadPath}.` : `Evidence loaded for ${traceId}.`
    });
  }

  async function handleEvidenceGet(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const traceId = ensureReference(commandArgs);
    const options = parseEvidenceGetArgs(commandArgs.slice(1));
    if (!options.public) {
      throw createCliError('ktrace evidence get currently requires --public.', {
        code: 'public_flag_required'
      });
    }
    const payload = await requestJson(runtime, {
      pathname: `/api/public/evidence/${encodeURIComponent(traceId)}`,
      omitRuntimeApiKey: true
    });
    const downloadPath = options.download ? await writeArtifactDownload('public-evidence', traceId, payload.evidence || payload) : '';
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'evidence', action: 'get', display: 'ktrace evidence get' },
      runtime,
      data: {
        traceId,
        downloadPath,
        public: true,
        evidence: payload?.evidence || null
      },
      message: downloadPath ? `Public evidence saved to ${downloadPath}.` : `Public evidence loaded for ${traceId}.`
    });
  }

  return {
    handleArtifactReceipt,
    handleArtifactEvidence,
    handleEvidenceGet
  };
}
