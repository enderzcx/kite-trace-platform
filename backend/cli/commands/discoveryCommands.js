export function createDiscoveryCommandHandlers({
  parseDiscoverySelectArgs,
  parseDiscoveryRecommendArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError
}) {
  async function handleDiscoverySelect(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseDiscoverySelectArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/discovery/select', {
        capability: options.capability,
        provider: options.provider,
        lane: options.lane,
        verified: options.verified,
        discoverable: options.discoverable,
        limit: options.limit || '10'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'discovery', action: 'select', display: 'ktrace discovery select' },
      runtime,
      data: {
        items: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total || 0)
      },
      message: `Loaded ${Array.isArray(payload?.items) ? payload.items.length : 0} ranked discovery candidate(s).`
    });
  }

  async function handleDiscoveryCompare(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseDiscoverySelectArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/discovery/compare', {
        capability: options.capability,
        provider: options.provider,
        lane: options.lane,
        verified: options.verified,
        discoverable: options.discoverable,
        limit: options.limit || '5'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'discovery', action: 'compare', display: 'ktrace discovery compare' },
      runtime,
      data: {
        criteria: payload?.criteria || {},
        top: payload?.top || null,
        items: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total || 0)
      },
      message: `Compared ${Array.isArray(payload?.items) ? payload.items.length : 0} ranked discovery candidate(s).`
    });
  }

  async function handleDiscoveryRecommendBuy(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseDiscoveryRecommendArgs(commandArgs);
    if (!String(options.capability || '').trim() && !String(options.provider || '').trim()) {
      throw createCliError('A capability or provider is required to recommend a direct-buy path.', {
        code: 'direct_buy_recommendation_inputs_required'
      });
    }
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/discovery/recommend-direct-buy', {
        capability: options.capability,
        provider: options.provider,
        verified: options.verified,
        discoverable: options.discoverable
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'discovery', action: 'recommend-buy', display: 'ktrace discovery recommend-buy' },
      runtime,
      data: {
        selection: payload?.selection || null,
        template: payload?.template || null,
        purchaseReady: Boolean(payload?.purchaseReady)
      },
      message: `Recommended direct-buy template ${String(payload?.template?.templateId || '').trim() || '-'}.`
    });
  }

  return {
    handleDiscoverySelect,
    handleDiscoveryCompare,
    handleDiscoveryRecommendBuy
  };
}
