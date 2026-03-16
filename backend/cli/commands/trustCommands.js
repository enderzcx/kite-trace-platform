export function createTrustCommandHandlers({
  parseTrustReputationArgs,
  parseTrustValidationsArgs,
  parseTrustPublicationsArgs,
  parseTrustPublishArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  readStructuredInput,
  resolveAdminTransportApiKey
}) {
  async function handleTrustReputation(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTrustReputationArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/trust/reputation', {
        agentId: options.agentId,
        lane: options.lane,
        referenceId: options.referenceId,
        limit: options.limit || '20'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'trust', action: 'reputation', display: 'ktrace trust reputation' },
      runtime,
      data: {
        aggregate: payload?.aggregate || {},
        items: Array.isArray(payload?.items) ? payload.items : []
      },
      message: `Loaded ${Array.isArray(payload?.items) ? payload.items.length : 0} reputation signal(s).`
    });
  }

  async function handleTrustValidations(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTrustValidationsArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/trust/validations', {
        agentId: options.agentId,
        referenceId: options.referenceId,
        status: options.status,
        limit: options.limit || '20'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'trust', action: 'validations', display: 'ktrace trust validations' },
      runtime,
      data: {
        items: Array.isArray(payload?.items) ? payload.items : []
      },
      message: `Loaded ${Array.isArray(payload?.items) ? payload.items.length : 0} validation record(s).`
    });
  }

  async function handleTrustPublications(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTrustPublicationsArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/trust/publications', {
        agentId: options.agentId,
        type: options.publicationType,
        status: options.status,
        limit: options.limit || '20'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'trust', action: 'publications', display: 'ktrace trust publications' },
      runtime,
      data: {
        items: Array.isArray(payload?.items) ? payload.items : []
      },
      message: `Loaded ${Array.isArray(payload?.items) ? payload.items.length : 0} trust publication record(s).`
    });
  }

  async function handleTrustPublish(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTrustPublishArgs(commandArgs);
    const body = await readStructuredInput(options.input);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/trust/publications',
      apiKey: resolveAdminTransportApiKey(runtime),
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'trust', action: 'publish', display: 'ktrace trust publish' },
      runtime,
      data: {
        publication: payload?.publication || null,
        anchor: payload?.anchor || null
      },
      message: `Trust publication ${String(payload?.publication?.publicationId || 'created').trim()} prepared.`
    });
  }

  return {
    handleTrustReputation,
    handleTrustValidations,
    handleTrustPublications,
    handleTrustPublish
  };
}
