import { createPlatformV1Shared } from './platformV1Shared.js';

export function registerTemplatesV1Routes(app, deps) {
  const {
    ensureNetworkAgents,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    requireRole,
    normalizeText,
    normalizeLower,
    templateMatchesCapability,
    normalizeBool,
    clampLimit,
    sendV1Success,
    sendV1Error,
    ensureTemplatePublishPolicy,
    buildTemplateView,
    callInternalTemplatePublish,
    callInternalTemplateRoute
  } = createPlatformV1Shared(deps);

  app.get('/api/v1/templates', requireRole('viewer'), (req, res) => {
    const providerId = normalizeLower(req.query.provider);
    const capabilityId = normalizeLower(req.query.capability);
    const activeFilter = normalizeText(req.query.active);
    const limit = clampLimit(req.query.limit, 100);
    const items = ensureTemplateCatalog()
      .filter((template) => {
        if (providerId && normalizeLower(template?.providerAgentId) !== providerId) return false;
        if (capabilityId && !templateMatchesCapability(template, capabilityId)) return false;
        if (activeFilter) {
          const expected = normalizeBool(activeFilter, true);
          if ((template?.active !== false) !== expected) return false;
        }
        return true;
      })
      .sort((left, right) => Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0))
      .slice(0, limit)
      .map((template) => buildTemplateView(template));
    return sendV1Success(res, req, {
      total: items.length,
      items
    });
  });

  app.get('/api/v1/templates/resolve', requireRole('viewer'), async (req, res) => {
    const result = await callInternalTemplateRoute({
      pathname: `/api/templates/resolve?${new URLSearchParams({
        ...(normalizeText(req.query.provider) ? { provider: normalizeText(req.query.provider) } : {}),
        ...(normalizeText(req.query.capability) ? { capability: normalizeText(req.query.capability) } : {})
      }).toString()}`
    });
    if (!result.ok) {
      return sendV1Error(
        res,
        req,
        result.status || 400,
        result?.payload?.error || 'template_resolution_failed',
        result?.payload?.reason || 'template resolution failed'
      );
    }
    return sendV1Success(res, req, {
      template: buildTemplateView(result?.payload?.template || {}),
      service: result?.payload?.service || null
    });
  });

  app.get('/api/v1/templates/:templateId', requireRole('viewer'), async (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const result = await callInternalTemplateRoute({
      pathname: `/api/templates/${encodeURIComponent(templateId)}`
    });
    if (!result.ok) {
      return sendV1Error(
        res,
        req,
        result.status || 404,
        result?.payload?.error || 'template_not_found',
        result?.payload?.reason || `Template ${templateId} was not found.`,
        { templateId }
      );
    }
    return sendV1Success(res, req, {
      template: buildTemplateView(result?.payload?.template || {}),
      service: result?.payload?.service || null
    });
  });

  app.post('/api/v1/templates', requireRole('admin'), async (req, res) => {
    const providers = ensureNetworkAgents().map((item) => ({ ...item }));
    const capabilities = ensureServiceCatalog().map((item) => ({ ...item }));
    try {
      ensureTemplatePublishPolicy(req.body || {}, providers, capabilities);
    } catch (error) {
      return sendV1Error(res, req, 400, 'invalid_template', error?.message || 'invalid template payload');
    }
    const result = await callInternalTemplatePublish(req.body || {});
    if (!result.ok) {
      return sendV1Error(
        res,
        req,
        result.status || 400,
        result?.payload?.error || 'template_publish_failed',
        result?.payload?.reason || 'template publish failed'
      );
    }
    return sendV1Success(res, req, {
      mode: normalizeText(result?.payload?.mode || 'updated'),
      template: buildTemplateView(result?.payload?.template || {})
    });
  });

  app.post('/api/v1/templates/:templateId/revoke', requireRole('admin'), async (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const result = await callInternalTemplateRoute({
      method: 'POST',
      pathname: `/api/templates/${encodeURIComponent(templateId)}/revoke`,
      body: {}
    });
    if (!result.ok) {
      return sendV1Error(
        res,
        req,
        result.status || 404,
        result?.payload?.error || 'template_revoke_failed',
        result?.payload?.reason || `Template ${templateId} could not be revoked.`,
        { templateId }
      );
    }
    return sendV1Success(res, req, {
      template: buildTemplateView(result?.payload?.template || {})
    });
  });

  app.post('/api/v1/templates/:templateId/activate', requireRole('admin'), async (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const result = await callInternalTemplateRoute({
      method: 'POST',
      pathname: `/api/templates/${encodeURIComponent(templateId)}/activate`,
      body: {}
    });
    if (!result.ok) {
      return sendV1Error(
        res,
        req,
        result.status || 404,
        result?.payload?.error || 'template_activate_failed',
        result?.payload?.reason || `Template ${templateId} could not be activated.`,
        { templateId }
      );
    }
    return sendV1Success(res, req, {
      template: buildTemplateView(result?.payload?.template || {})
    });
  });

  app.post('/api/v1/templates/:templateId/expire', requireRole('admin'), async (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const result = await callInternalTemplateRoute({
      method: 'POST',
      pathname: `/api/templates/${encodeURIComponent(templateId)}/expire`,
      body: {}
    });
    if (!result.ok) {
      return sendV1Error(
        res,
        req,
        result.status || 404,
        result?.payload?.error || 'template_expire_failed',
        result?.payload?.reason || `Template ${templateId} could not be expired.`,
        { templateId }
      );
    }
    return sendV1Success(res, req, {
      template: buildTemplateView(result?.payload?.template || {})
    });
  });
}
