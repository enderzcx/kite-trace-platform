export function createTemplateCommandHandlers({
  parseTemplateListArgs,
  parseTemplateResolveArgs,
  parseTemplatePublishArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  ensureReference,
  readStructuredInput,
  resolveAdminTransportApiKey
}) {
  async function handleTemplateList(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTemplateListArgs(commandArgs);
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/templates', {
        provider: options.provider,
        capability: options.capability,
        active: options.active,
        limit: options.limit || '20'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'list', display: 'ktrace template list' },
      runtime,
      data: {
        templates: items.map((item) => ({
          templateId: String(item?.templateId || '').trim(),
          templateVersion: Number(item?.templateVersion || 0),
          providerAgentId: String(item?.providerAgentId || '').trim(),
          capabilityId: String(item?.capabilityId || '').trim(),
          serviceId: String(item?.serviceId || '').trim(),
          status: String(item?.status || '').trim(),
          active: item?.active !== false,
          amount: String(item?.pricingTerms?.amount || '').trim()
        }))
      },
      message: `Found ${items.length} template(s).`
    });
  }

  async function handleTemplateResolve(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTemplateResolveArgs(commandArgs);
    if (!String(options.provider || '').trim() && !String(options.capability || '').trim()) {
      throw createCliError('provider or capability is required to resolve a template.', {
        code: 'template_resolution_inputs_required'
      });
    }
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/templates/resolve', {
        provider: options.provider,
        capability: options.capability
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'resolve', display: 'ktrace template resolve' },
      runtime,
      data: {
        template: payload?.template || null,
        service: payload?.service || null
      },
      message: `Resolved template ${String(payload?.template?.templateId || '').trim() || '-'}.`
    });
  }

  async function handleTemplateShow(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const templateId = ensureReference(commandArgs, 'template-id');
    const payload = await requestJson(runtime, {
      pathname: `/api/v1/templates/${encodeURIComponent(templateId)}`,
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'show', display: 'ktrace template show' },
      runtime,
      data: {
        template: payload?.template || null,
        service: payload?.service || null
      },
      message: String(payload?.template?.name || templateId).trim()
    });
  }

  async function handleTemplatePublish(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseTemplatePublishArgs(commandArgs);
    const body = await readStructuredInput(options.input);
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: '/api/v1/templates',
      apiKey: resolveAdminTransportApiKey(runtime),
      body
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'publish', display: 'ktrace template publish' },
      runtime,
      data: {
        mode: String(payload?.mode || '').trim(),
        template: payload?.template || null
      },
      message: `Template ${String(payload?.mode || 'saved').trim() || 'saved'}.`
    });
  }

  async function handleTemplateRevoke(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const templateId = ensureReference(commandArgs, 'template-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/v1/templates/${encodeURIComponent(templateId)}/revoke`,
      apiKey: resolveAdminTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'revoke', display: 'ktrace template revoke' },
      runtime,
      data: {
        template: payload?.template || null
      },
      message: `Template ${templateId} revoked.`
    });
  }

  async function handleTemplateActivate(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const templateId = ensureReference(commandArgs, 'template-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/v1/templates/${encodeURIComponent(templateId)}/activate`,
      apiKey: resolveAdminTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'activate', display: 'ktrace template activate' },
      runtime,
      data: {
        template: payload?.template || null
      },
      message: `Template ${templateId} activated.`
    });
  }

  async function handleTemplateExpire(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const templateId = ensureReference(commandArgs, 'template-id');
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: `/api/v1/templates/${encodeURIComponent(templateId)}/expire`,
      apiKey: resolveAdminTransportApiKey(runtime)
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'template', action: 'expire', display: 'ktrace template expire' },
      runtime,
      data: {
        template: payload?.template || null
      },
      message: `Template ${templateId} expired.`
    });
  }

  return {
    handleTemplateList,
    handleTemplateResolve,
    handleTemplateShow,
    handleTemplatePublish,
    handleTemplateRevoke,
    handleTemplateActivate,
    handleTemplateExpire
  };
}
