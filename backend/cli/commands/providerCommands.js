export function createProviderCommandHandlers({
  parseProviderListArgs,
  parseProviderRegisterArgs,
  parseCapabilityListArgs,
  parseCapabilityPublishArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  ensureReference,
  readStructuredInput,
  resolveAdminTransportApiKey
}) {
  async function handleProviderList(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseProviderListArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/providers', {
        role: options.role,
        mode: options.mode,
        capability: options.capability,
        active: options.active,
        verified: options.verified,
        identityLinked: options.identityLinked,
        approvalStatus: options.approvalStatus,
        discoverable: options.discoverable,
        q: options.q,
        limit: options.limit || '50'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'list', display: 'ktrace provider list' },
      runtime,
      data: {
        providers: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total || 0)
      },
      message: `Loaded ${Array.isArray(payload?.items) ? payload.items.length : 0} provider(s).`
    });
  }

  async function handleProviderRegister(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseProviderRegisterArgs(commandArgs);
    const body = options.input ? await readStructuredInput(options.input) : {};
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/providers',
      apiKey: resolveAdminTransportApiKey(runtime),
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'register', display: 'ktrace provider register' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        provider: payload?.provider || null
      },
      message: `Provider ${String(payload?.provider?.providerId || '').trim() || 'updated'}.`
    });
  }

  async function handleProviderShow(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const providerId = ensureReference(commandArgs, 'provider-id');
    const payload = await requestJson(runtime, {
      pathname: `/api/v1/providers/${encodeURIComponent(providerId)}`,
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'show', display: 'ktrace provider show' },
      runtime,
      data: {
        provider: payload?.provider || null
      },
      message: `Provider ${providerId}.`
    });
  }

  async function handleProviderIdentityChallenge(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseProviderRegisterArgs(commandArgs);
    const body = await readStructuredInput(options.input);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/providers/identity-challenge',
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'identity-challenge', display: 'ktrace provider identity-challenge' },
      runtime,
      data: {
        challenge: payload?.challenge || null,
        providerDraft: payload?.providerDraft || null
      },
      message: `Identity challenge ${String(payload?.challenge?.challengeId || '').trim() || 'issued'}.`
    });
  }

  async function handleProviderRegisterIdentity(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseProviderRegisterArgs(commandArgs);
    const body = await readStructuredInput(options.input);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/providers/register-identity',
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'register-identity', display: 'ktrace provider register-identity' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        provider: payload?.provider || null,
        identity: payload?.identity || null,
        verification: payload?.verification || null
      },
      message: `Provider ${String(payload?.provider?.providerId || '').trim() || 'registered'} verified via identity.`
    });
  }

  async function handleProviderImportIdentity(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseProviderRegisterArgs(commandArgs);
    const body = await readStructuredInput(options.input);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/providers/import-identity',
      apiKey: resolveAdminTransportApiKey(runtime),
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'import-identity', display: 'ktrace provider import-identity' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        provider: payload?.provider || null,
        identity: payload?.identity || null
      },
      message: `Provider ${String(payload?.provider?.providerId || '').trim() || 'imported'} imported from identity.`
    });
  }

  async function handleProviderApprove(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const providerId = ensureReference(commandArgs, 'provider-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/v1/providers/${encodeURIComponent(providerId)}/approve`,
      apiKey: resolveAdminTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'approve', display: 'ktrace provider approve' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        provider: payload?.provider || null
      },
      message: `Provider ${String(payload?.provider?.providerId || providerId).trim()} approved.`
    });
  }

  async function handleProviderSuspend(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const providerId = ensureReference(commandArgs, 'provider-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/v1/providers/${encodeURIComponent(providerId)}/suspend`,
      apiKey: resolveAdminTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'provider', action: 'suspend', display: 'ktrace provider suspend' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        provider: payload?.provider || null
      },
      message: `Provider ${String(payload?.provider?.providerId || providerId).trim()} suspended.`
    });
  }

  async function handleCapabilityList(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseCapabilityListArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/capabilities', {
        provider: options.provider,
        action: options.action,
        lane: options.lane,
        providerVerified: options.providerVerified,
        providerDiscoverable: options.providerDiscoverable,
        active: options.active,
        q: options.q,
        limit: options.limit || '50'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'capability', action: 'list', display: 'ktrace capability list' },
      runtime,
      data: {
        capabilities: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total || 0)
      },
      message: `Loaded ${Array.isArray(payload?.items) ? payload.items.length : 0} capability record(s).`
    });
  }

  async function handleCapabilityPublish(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseCapabilityPublishArgs(commandArgs);
    const body = options.input ? await readStructuredInput(options.input) : {};
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/capabilities',
      apiKey: resolveAdminTransportApiKey(runtime),
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'capability', action: 'publish', display: 'ktrace capability publish' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        capability: payload?.capability || null
      },
      message: `Capability ${String(payload?.capability?.capabilityId || '').trim() || 'updated'}.`
    });
  }

  async function handleCapabilityShow(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const capabilityId = ensureReference(commandArgs, 'capability-id');
    const payload = await requestJson(runtime, {
      pathname: `/api/v1/capabilities/${encodeURIComponent(capabilityId)}`,
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'capability', action: 'show', display: 'ktrace capability show' },
      runtime,
      data: {
        capability: payload?.capability || null
      },
      message: `Capability ${capabilityId}.`
    });
  }

  return {
    handleProviderList,
    handleProviderRegister,
    handleProviderShow,
    handleProviderIdentityChallenge,
    handleProviderRegisterIdentity,
    handleProviderImportIdentity,
    handleProviderApprove,
    handleProviderSuspend,
    handleCapabilityList,
    handleCapabilityPublish,
    handleCapabilityShow
  };
}
