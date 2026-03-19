export function registerTemplateRoutes(app, deps) {
  const {
    appendReputationSignal,
    beginConsumerIntent,
    buildAuthorityPublicSummary,
    buildAuthoritySnapshot,
    buildPolicySnapshotHash,
    createTraceId,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    finalizeConsumerIntent,
    findConsumerIntent,
    getInternalAgentApiKey,
    normalizeAddress,
    PORT,
    readPurchases,
    readSessionRuntime,
    requireRole,
    upsertWorkflow,
    upsertPurchaseRecord,
    validateConsumerAuthority,
    writeTemplates
  } = deps;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function normalizeCapability(value = '') {
    return normalizeText(value).toLowerCase();
  }

  function capabilityAliases(value = '') {
    const normalized = normalizeCapability(value);
    const aliases = new Set();
    if (normalized) {
      aliases.add(normalized);
      if (normalized.startsWith('cap-') && normalized.length > 4) aliases.add(normalized.slice(4));
      else aliases.add(`cap-${normalized}`);
    }
    if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
      aliases.add('technical-analysis-feed');
      aliases.add('risk-score-feed');
      aliases.add('volatility-snapshot');
    }
    if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
      aliases.add('info-analysis-feed');
      aliases.add('x-reader-feed');
      aliases.add('url-digest');
    }
    if (['btc-price-feed', 'market-quote'].includes(normalized)) {
      aliases.add('btc-price-feed');
      aliases.add('market-quote');
    }
    if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
      aliases.add('hyperliquid-order-testnet');
      aliases.add('trade-order-feed');
      aliases.add('execute-plan');
    }
    return Array.from(aliases).filter(Boolean);
  }

  function capabilityMatchesValue(value = '', capability = '') {
    const normalizedValue = normalizeCapability(value);
    if (!capability) return true;
    if (!normalizedValue) return false;
    return capabilityAliases(capability).includes(normalizedValue);
  }

  function serviceMatchesCapability(service = {}, capability = '') {
    if (!capability) return true;
    return [service?.id, service?.capabilityId, service?.action].some((value) =>
      capabilityMatchesValue(value, capability)
    );
  }

  function resolveServiceCapabilityId(service = {}) {
    const serviceId = normalizeText(service?.id || '');
    if (serviceId && normalizeCapability(serviceId).startsWith('cap-')) {
      return serviceId;
    }
    return normalizeText(service?.capabilityId || service?.action || serviceId);
  }

  function normalizeBool(value, fallback = false) {
    const raw = normalizeText(value).toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
  }

  function templateLifecycleState(template = {}) {
    const explicitStatus = normalizeText(template?.status || '').toLowerCase();
    if (explicitStatus === 'expired') return 'expired';
    const active = template?.active !== false;
    if (!active) return 'inactive';
    const validUntil = normalizeText(template?.validUntil || '');
    if (validUntil) {
      const expiry = Date.parse(validUntil);
      if (Number.isFinite(expiry) && Date.now() > expiry) {
        return 'expired';
      }
    }
    return explicitStatus || 'active';
  }

  function isTemplateUsable(template = {}) {
    return templateLifecycleState(template) === 'active';
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function isRetryableInternalFetchError(error = null) {
    const message = normalizeText(error?.message || error || '').toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('fetch failed') ||
      message.includes('socket hang up') ||
      message.includes('und_err_socket') ||
      message.includes('etimedout')
    );
  }

  async function invokeServiceWithRetry(serviceId = '', headers = {}, invokeBody = {}) {
    const normalizedServiceId = normalizeText(serviceId);
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${PORT}/api/services/${encodeURIComponent(normalizedServiceId)}/invoke`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(invokeBody)
          }
        );
        const payload = await response.json().catch(() => ({}));
        return {
          ok: response.ok && payload?.ok !== false,
          status: response.status,
          payload
        };
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableInternalFetchError(error)) {
          throw error;
        }
        await sleep(250 * attempt);
      }
    }

    throw lastError || new Error('template buy invoke failed');
  }

  function readTemplatesSafe() {
    return ensureTemplateCatalog()
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...item }));
  }

  function findTemplate(templateId = '') {
    const normalizedId = normalizeText(templateId);
    if (!normalizedId) return null;
    return readTemplatesSafe().find((item) => normalizeText(item?.templateId) === normalizedId) || null;
  }

  function resolveTemplateCandidate({ provider = '', capability = '' } = {}) {
    const normalizedProvider = normalizeText(provider).toLowerCase();
    const normalizedCapability = normalizeCapability(capability);
    const services = ensureServiceCatalog();
    const rows = readTemplatesSafe()
      .filter((item) => {
        if (normalizedProvider && normalizeText(item?.providerAgentId).toLowerCase() !== normalizedProvider) return false;
        if (normalizedCapability) {
          const linkedService =
            services.find((service) => normalizeText(service?.id) === normalizeText(item?.serviceId)) || null;
          const matchesCapability =
            capabilityMatchesValue(item?.capabilityId, normalizedCapability) ||
            capabilityMatchesValue(item?.serviceId, normalizedCapability) ||
            serviceMatchesCapability(linkedService, normalizedCapability);
          if (!matchesCapability) return false;
        }
        return isTemplateUsable(item);
      })
      .sort((left, right) => {
        const versionDelta = Number(right?.templateVersion || 0) - Number(left?.templateVersion || 0);
        if (versionDelta !== 0) return versionDelta;
        return Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0);
      });
    return rows[0] || null;
  }

  function findServiceByTemplate(template = {}) {
    const serviceId = normalizeText(template?.serviceId);
    const capabilityId = normalizeCapability(template?.capabilityId);
    const providerAgentId = normalizeText(template?.providerAgentId);
    const services = ensureServiceCatalog();
    if (serviceId) {
      return services.find((item) => normalizeText(item?.id) === serviceId) || null;
    }
    return (
      services.find(
        (item) =>
          normalizeText(item?.providerAgentId) === providerAgentId &&
          serviceMatchesCapability(item, capabilityId) &&
          item?.active !== false
      ) || null
    );
  }

  function templateMatchesCapability(template = {}, capability = '') {
    if (!capability) return true;
    return (
      capabilityMatchesValue(template?.capabilityId, capability) ||
      capabilityMatchesValue(template?.serviceId, capability) ||
      serviceMatchesCapability(findServiceByTemplate(template), capability)
    );
  }

  function findServiceForCapability({ provider = '', capability = '' } = {}) {
    const normalizedProvider = normalizeText(provider).toLowerCase();
    const normalizedCapability = normalizeCapability(capability);
    return (
      ensureServiceCatalog().find((item) => {
        if (item?.active === false) return false;
        if (normalizedProvider && normalizeText(item?.providerAgentId).toLowerCase() !== normalizedProvider) return false;
        if (normalizedCapability && !serviceMatchesCapability(item, normalizedCapability)) return false;
        return true;
      }) || null
    );
  }

  function ensureAutoTemplateForCapability({ provider = '', capability = '' } = {}) {
    const service = findServiceForCapability({ provider, capability });
    if (!service) return { template: null, service: null, autoPublished: false };

    const rows = readTemplatesSafe();
    const existingIdx = rows.findIndex((item) => normalizeText(item?.serviceId) === normalizeText(service?.id));
    const existing = existingIdx >= 0 ? rows[existingIdx] : null;
    if (existing && isTemplateUsable(existing)) {
      return { template: existing, service, autoPublished: false };
    }

    const record = sanitizeTemplateRecord(
      {
        templateId: normalizeText(existing?.templateId || `tpl_${normalizeText(service?.id)}`),
        serviceId: normalizeText(service?.id),
        providerAgentId: normalizeText(service?.providerAgentId),
        capabilityId: resolveServiceCapabilityId(service),
        publishedBy: normalizeText(existing?.publishedBy || 'auto-template'),
        active: true
      },
      existing
    );
    if (existingIdx >= 0) rows[existingIdx] = record;
    else rows.unshift(record);
    writeTemplates(rows);
    return { template: record, service, autoPublished: true };
  }

  function sanitizeTemplateRecord(input = {}, existing = null) {
    const serviceId = normalizeText(input?.serviceId || existing?.serviceId || '');
    if (!serviceId) {
      throw new Error('serviceId is required');
    }
    const service =
      ensureServiceCatalog().find((item) => normalizeText(item?.id) === serviceId && item?.active !== false) || null;
    if (!service) {
      throw new Error(`No active service found for serviceId=${serviceId}`);
    }

    const now = new Date().toISOString();
    const currentVersion = Number(existing?.templateVersion || 0);
    const requestedVersion = Number(input?.templateVersion || 0);
    const validUntil = normalizeText(input?.validUntil || existing?.validUntil || '');
    const active = normalizeBool(input?.active ?? existing?.active ?? true, true);
    const status = active ? 'active' : 'inactive';
    const validFrom = normalizeText(input?.validFrom || existing?.validFrom || now);
    if (validUntil && Number.isFinite(Date.parse(validUntil)) && Number.isFinite(Date.parse(validFrom))) {
      if (Date.parse(validUntil) <= Date.parse(validFrom)) {
        throw new Error('validUntil must be later than validFrom');
      }
    }

    return {
      templateId: normalizeText(input?.templateId || existing?.templateId || `tpl_${serviceId}`),
      templateVersion: requestedVersion > 0 ? requestedVersion : Math.max(1, currentVersion + (existing ? 1 : 0)),
      name: normalizeText(input?.name || existing?.name || service?.name || `Template ${serviceId}`),
      description: normalizeText(input?.description || existing?.description || service?.description || ''),
      providerAgentId: normalizeText(input?.providerAgentId || existing?.providerAgentId || service?.providerAgentId || ''),
      capabilityId: normalizeText(
        input?.capabilityId || existing?.capabilityId || resolveServiceCapabilityId(service)
      ),
      serviceId,
      pricingTerms: {
        amount: normalizeText(
          input?.pricingTerms?.amount || input?.amount || existing?.pricingTerms?.amount || service?.price || ''
        ),
        currency: normalizeText(
          input?.pricingTerms?.currency || existing?.pricingTerms?.currency || (service?.tokenAddress ? 'token' : '')
        ),
        tokenAddress: normalizeText(
          input?.pricingTerms?.tokenAddress ||
            input?.tokenAddress ||
            existing?.pricingTerms?.tokenAddress ||
            service?.tokenAddress ||
            ''
        )
      },
      settlementTerms: {
        paymentMode: normalizeText(
          input?.settlementTerms?.paymentMode || existing?.settlementTerms?.paymentMode || 'x402'
        ) || 'x402',
        recipient: normalizeText(
          input?.settlementTerms?.recipient ||
            input?.recipient ||
            existing?.settlementTerms?.recipient ||
            service?.recipient ||
            ''
        ),
        tokenAddress: normalizeText(
          input?.settlementTerms?.tokenAddress ||
            existing?.settlementTerms?.tokenAddress ||
            service?.tokenAddress ||
            ''
        ),
        proofMode: normalizeText(
          input?.settlementTerms?.proofMode || existing?.settlementTerms?.proofMode || 'on-chain'
        ) || 'on-chain'
      },
      fulfillmentMode: normalizeText(input?.fulfillmentMode || existing?.fulfillmentMode || 'direct') || 'direct',
      validFrom,
      validUntil,
      status,
      active,
      tags: Array.isArray(input?.tags)
        ? input.tags
        : Array.isArray(existing?.tags)
          ? existing.tags
          : Array.isArray(service?.tags)
            ? service.tags
            : [],
      exampleInput:
        input?.exampleInput && typeof input.exampleInput === 'object' && !Array.isArray(input.exampleInput)
          ? input.exampleInput
          : existing?.exampleInput && typeof existing.exampleInput === 'object' && !Array.isArray(existing.exampleInput)
            ? existing.exampleInput
            : service?.exampleInput && typeof service.exampleInput === 'object' && !Array.isArray(service.exampleInput)
              ? service.exampleInput
              : {},
      sourceServiceUpdatedAt: normalizeText(service?.updatedAt || existing?.sourceServiceUpdatedAt || ''),
      createdAt: normalizeText(existing?.createdAt || now),
      updatedAt: now,
      publishedBy: normalizeText(input?.publishedBy || existing?.publishedBy || 'admin')
    };
  }

  function buildTemplateView(template = {}) {
    const lifecycleState = templateLifecycleState(template);
    const service = findServiceByTemplate(template);
    return {
      templateId: normalizeText(template?.templateId),
      templateVersion: Number(template?.templateVersion || 0),
      name: normalizeText(template?.name),
      description: normalizeText(template?.description),
      providerAgentId: normalizeText(template?.providerAgentId),
      capabilityId: service ? resolveServiceCapabilityId(service) : normalizeText(template?.capabilityId),
      serviceId: normalizeText(template?.serviceId),
      pricingTerms: template?.pricingTerms && typeof template.pricingTerms === 'object' ? template.pricingTerms : {},
      settlementTerms:
        template?.settlementTerms && typeof template.settlementTerms === 'object' ? template.settlementTerms : {},
      fulfillmentMode: normalizeText(template?.fulfillmentMode),
      validFrom: normalizeText(template?.validFrom),
      validUntil: normalizeText(template?.validUntil),
      status: lifecycleState,
      active: lifecycleState === 'active',
      expired: lifecycleState === 'expired',
      tags: Array.isArray(template?.tags) ? template.tags : [],
      exampleInput:
        template?.exampleInput && typeof template.exampleInput === 'object' && !Array.isArray(template.exampleInput)
          ? template.exampleInput
          : {},
      createdAt: normalizeText(template?.createdAt),
      updatedAt: normalizeText(template?.updatedAt)
    };
  }

  function buildPurchaseView(purchase = {}) {
    return {
      purchaseId: normalizeText(purchase?.purchaseId),
      traceId: normalizeText(purchase?.traceId),
      intentId: normalizeText(purchase?.intentId),
      templateId: normalizeText(purchase?.templateId),
      serviceId: normalizeText(purchase?.serviceId),
      quoteId: normalizeText(purchase?.quoteId),
      paymentId: normalizeText(purchase?.paymentId),
      resultId: normalizeText(purchase?.resultId),
      state: normalizeText(purchase?.state),
      providerAgentId: normalizeText(purchase?.providerAgentId),
      capabilityId: normalizeText(purchase?.capabilityId),
      payer: normalizeText(purchase?.payer),
      authorityId: normalizeText(purchase?.authorityId),
      policySnapshotHash: normalizeText(purchase?.policySnapshotHash),
      authority:
        purchase?.authorityPublic && typeof purchase.authorityPublic === 'object' ? purchase.authorityPublic : null,
      paymentTxHash: normalizeText(purchase?.paymentTxHash),
      receiptRef: normalizeText(purchase?.receiptRef),
      evidenceRef: normalizeText(purchase?.evidenceRef),
      summary: normalizeText(purchase?.summary),
      error: normalizeText(purchase?.error),
      createdAt: normalizeText(purchase?.createdAt),
      updatedAt: normalizeText(purchase?.updatedAt)
    };
  }

  function buildAuthorityErrorResponse(result = {}) {
    return {
      ok: false,
      error: normalizeText(result?.code || 'authority_validation_failed'),
      reason: normalizeText(result?.reason || 'authority validation failed'),
      authority: result?.authorityPublic || null,
      policySnapshotHash: normalizeText(result?.policySnapshotHash || ''),
      detail: result?.detail && typeof result.detail === 'object' ? result.detail : undefined
    };
  }

  function buildIntentConflictPayload(result = {}) {
    const existing = result?.existing && typeof result.existing === 'object' ? result.existing : null;
    const existingPurchase = existing?.resultRef
      ? readPurchases().find((item) => normalizeText(item?.purchaseId) === normalizeText(existing.resultRef)) || null
      : null;
    return {
      ok: false,
      error: normalizeText(result?.code || 'intent_conflict'),
      reason: normalizeText(result?.reason || 'intent conflict'),
      intent: existing,
      purchase: existingPurchase ? buildPurchaseView(existingPurchase) : null
    };
  }

  app.get('/api/templates', requireRole('viewer'), (req, res) => {
    const provider = normalizeText(req.query.provider || '').toLowerCase();
    const capability = normalizeCapability(req.query.capability || '');
    const activeOnly = normalizeText(req.query.active || '').toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
    const rows = readTemplatesSafe()
      .filter((item) => {
        if (provider && normalizeText(item?.providerAgentId).toLowerCase() !== provider) return false;
        if (capability && !templateMatchesCapability(item, capability)) return false;
        const lifecycleState = templateLifecycleState(item);
        if (activeOnly === '1' || activeOnly === 'true') return lifecycleState === 'active';
        if (activeOnly === '0' || activeOnly === 'false') return lifecycleState !== 'active';
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
      .slice(0, limit)
      .map((item) => buildTemplateView(item));
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });

  app.get('/api/templates/resolve', requireRole('viewer'), (req, res) => {
    const provider = normalizeText(req.query.provider || '');
    const capability = normalizeCapability(req.query.capability || '');
    if (!provider && !capability) {
      return res.status(400).json({
        ok: false,
        error: 'template_resolution_inputs_required',
        reason: 'provider or capability is required'
      });
    }
    let template = resolveTemplateCandidate({ provider, capability });
    let service = template ? findServiceByTemplate(template) : null;
    let autoPublished = false;
    if (!template) {
      const ensured = ensureAutoTemplateForCapability({ provider, capability });
      template = ensured.template;
      service = ensured.service;
      autoPublished = ensured.autoPublished;
    }
    if (!template) {
      return res.status(404).json({
        ok: false,
        error: 'template_not_found',
        reason: `No active template matched provider=${provider || '-'} capability=${capability || '-'}`
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      template: buildTemplateView(template),
      service: service || null,
      autoPublished
    });
  });

  app.get('/api/templates/:templateId', requireRole('viewer'), (req, res) => {
    const template = findTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({ ok: false, error: 'template_not_found', templateId: normalizeText(req.params.templateId) });
    }
    const service = findServiceByTemplate(template);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      template: buildTemplateView(template),
      service: service || null
    });
  });

  app.post('/api/templates/publish', requireRole('admin'), (req, res) => {
    try {
      const body = req.body || {};
      const rows = readTemplatesSafe();
      const requestedId = normalizeText(body.templateId || body.id || '');
      const existingIdx = requestedId ? rows.findIndex((item) => normalizeText(item?.templateId) === requestedId) : -1;
      const existing = existingIdx >= 0 ? rows[existingIdx] : null;
      const record = sanitizeTemplateRecord(
        {
          ...body,
          publishedBy: req.authRole || 'admin'
        },
        existing
      );
      if (existingIdx >= 0) rows[existingIdx] = record;
      else rows.unshift(record);
      writeTemplates(rows);
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        template: buildTemplateView(record),
        mode: existing ? 'updated' : 'created'
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_template',
        reason: error?.message || 'invalid template payload'
      });
    }
  });

  app.post('/api/templates/:templateId/revoke', requireRole('admin'), (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const rows = readTemplatesSafe();
    const idx = rows.findIndex((item) => normalizeText(item?.templateId) === templateId);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'template_not_found', templateId });
    }
    rows[idx] = {
      ...rows[idx],
      active: false,
      status: 'inactive',
      updatedAt: new Date().toISOString()
    };
    writeTemplates(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      template: buildTemplateView(rows[idx])
    });
  });

  app.post('/api/templates/:templateId/activate', requireRole('admin'), (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const rows = readTemplatesSafe();
    const idx = rows.findIndex((item) => normalizeText(item?.templateId) === templateId);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'template_not_found', templateId });
    }
    rows[idx] = {
      ...rows[idx],
      active: true,
      status: 'active',
      updatedAt: new Date().toISOString()
    };
    writeTemplates(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      template: buildTemplateView(rows[idx])
    });
  });

  app.post('/api/templates/:templateId/expire', requireRole('admin'), (req, res) => {
    const templateId = normalizeText(req.params.templateId);
    const rows = readTemplatesSafe();
    const idx = rows.findIndex((item) => normalizeText(item?.templateId) === templateId);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'template_not_found', templateId });
    }
    rows[idx] = {
      ...rows[idx],
      active: false,
      status: 'expired',
      validUntil: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeTemplates(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      template: buildTemplateView(rows[idx])
    });
  });

  app.post('/api/templates/:templateId/buy', requireRole('agent'), async (req, res) => {
    const template = findTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({ ok: false, error: 'template_not_found', templateId: normalizeText(req.params.templateId) });
    }
    if (!isTemplateUsable(template)) {
      return res.status(409).json({ ok: false, error: 'template_inactive', reason: 'Template is not active.' });
    }

    const service = findServiceByTemplate(template);
    if (!service) {
      return res.status(404).json({
        ok: false,
        error: 'template_service_not_found',
        reason: `No active service matched template=${template.templateId}.`
      });
    }

    const runtime = readSessionRuntime();
    const body = req.body || {};
    const traceId = normalizeText(body.traceId || createTraceId('purchase'));
    const payer = normalizeAddress(body.payer || runtime?.aaWallet || runtime?.owner || '');
    const intentId = normalizeText(body.intentId || body.idempotencyKey || '');
    const input =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : template?.exampleInput && typeof template.exampleInput === 'object' && !Array.isArray(template.exampleInput)
          ? template.exampleInput
          : {};
    const authorityResult = validateConsumerAuthority?.({
      payer,
      provider: normalizeText(template.providerAgentId || service.providerAgentId),
      capability: resolveServiceCapabilityId(service),
      recipient: normalizeText(service.recipient || ''),
      amount: normalizeText(service.price || ''),
      intentId,
      actionKind: 'buy_direct',
      referenceId: normalizeText(template.templateId || service.id),
      traceId
    });
    if (authorityResult && authorityResult.ok === false) {
      return res.status(Number(authorityResult.statusCode || 403)).json(buildAuthorityErrorResponse(authorityResult));
    }
    const intentState = beginConsumerIntent?.({
      intentId,
      payer,
      provider: normalizeText(template.providerAgentId || service.providerAgentId),
      capability: resolveServiceCapabilityId(service),
      recipient: normalizeText(service.recipient || ''),
      amount: normalizeText(service.price || ''),
      actionKind: 'buy_direct',
      referenceId: normalizeText(template.templateId || service.id),
      traceId
    });
    if (intentState && intentState.ok === false) {
      return res.status(Number(intentState.code === 'intent_replayed' ? 409 : 409)).json(buildIntentConflictPayload(intentState));
    }
    const purchaseId = createTraceId('purchase');
    const now = new Date().toISOString();
    const authoritySnapshot =
      authorityResult?.authority && typeof authorityResult.authority === 'object'
        ? buildAuthoritySnapshot(authorityResult.authority)
        : null;
    const authorityPublic =
      authorityResult?.authorityPublic && typeof authorityResult.authorityPublic === 'object'
        ? buildAuthorityPublicSummary(authorityResult.authorityPublic)
        : authoritySnapshot
          ? buildAuthorityPublicSummary(authoritySnapshot)
          : null;
    const policySnapshotHash = normalizeText(
      authorityResult?.policySnapshotHash || (authoritySnapshot ? buildPolicySnapshotHash(authoritySnapshot) : '')
    );
    const purchase = {
      purchaseId,
      traceId,
      intentId,
      templateId: template.templateId,
      serviceId: service.id,
      quoteId: '',
      paymentId: '',
      resultId: '',
      state: 'payment_pending',
      providerAgentId: normalizeText(template.providerAgentId || service.providerAgentId),
      capabilityId: resolveServiceCapabilityId(service),
      payer,
      authorityId: normalizeText(authoritySnapshot?.authorityId || ''),
      authority: authoritySnapshot,
      authorityPublic,
      policySnapshotHash,
      paymentTxHash: '',
      receiptRef: '',
      evidenceRef: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : '',
      summary: 'Direct buy started.',
      error: '',
      createdAt: now,
      updatedAt: now
    };
    upsertPurchaseRecord(purchase);

    const internalApiKey = getInternalAgentApiKey();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (internalApiKey) {
      headers['x-api-key'] = internalApiKey;
    }

    try {
      const invokeResult = await invokeServiceWithRetry(normalizeText(service.id), headers, {
        ...input,
        traceId,
        ...(payer ? { payer } : {})
      });
      const payload = invokeResult.payload || {};
      const workflow = payload?.workflow || {};
      const requestId = normalizeText(payload?.requestId || workflow?.requestId);
      const nextTraceId = normalizeText(payload?.traceId || workflow?.traceId || traceId);
      const txHash = normalizeText(payload?.txHash || workflow?.txHash);
      const workflowState = normalizeText(payload?.state || workflow?.state).toLowerCase();
      const completed = invokeResult.ok && ['success', 'completed', 'unlocked', 'paid'].includes(workflowState);
      const next = {
        ...purchase,
        traceId: nextTraceId || purchase.traceId,
        state: completed ? 'completed' : invokeResult.ok ? 'paid' : 'failed',
        paymentId: requestId,
        resultId: normalizeText(payload?.invocationId || requestId || nextTraceId),
        paymentTxHash: txHash,
        receiptRef: requestId ? `/api/receipt/${encodeURIComponent(requestId)}` : '',
        evidenceRef: nextTraceId ? `/api/evidence/export?traceId=${encodeURIComponent(nextTraceId)}` : '',
        summary:
          normalizeText(workflow?.result?.summary || payload?.receipt?.result?.summary || payload?.reason || '') ||
          (completed ? 'Direct buy completed.' : 'Direct buy submitted.'),
        error: invokeResult.ok ? '' : normalizeText(payload?.reason || payload?.error || 'direct buy failed'),
        updatedAt: new Date().toISOString()
      };
      upsertPurchaseRecord(next);
      finalizeConsumerIntent?.(intentId, {
        status: invokeResult.ok ? 'completed' : 'failed',
        resultRef: normalizeText(next.purchaseId),
        requestId: normalizeText(next.paymentId),
        traceId: normalizeText(next.traceId)
      });
      if (invokeResult.ok) {
        appendReputationSignal?.({
          signalId: createTraceId('rep'),
          agentId: normalizeText(next.providerAgentId),
          sourceLane: 'buy',
          sourceKind: 'purchase',
          referenceId: normalizeText(next.purchaseId),
          traceId: normalizeText(next.traceId),
          paymentRequestId: normalizeText(next.paymentId),
          verdict: 'positive',
          score: 1,
          summary: normalizeText(next.summary || 'Direct buy completed.'),
          evaluator: 'ktrace-buy',
          createdAt: new Date().toISOString()
        });
      }

      return res.status(invokeResult.status).json({
        ok: invokeResult.ok && payload?.ok !== false,
        traceId: req.traceId || '',
        purchase: buildPurchaseView(next),
        workflow: workflow && typeof workflow === 'object' ? workflow : null,
        receipt: payload?.receipt || null
      });
    } catch (error) {
      upsertWorkflow?.({
        traceId: purchase.traceId,
        type: normalizeText(service?.action || purchase.capabilityId || 'direct-buy'),
        state: 'failed',
        sourceAgentId: '',
        targetAgentId: normalizeText(template.providerAgentId || service.providerAgentId || ''),
        payer,
        input,
        requestId: '',
        txHash: '',
        userOpHash: '',
        steps: [
          {
            name: 'failed',
            status: 'error',
            at: new Date().toISOString(),
            details: {
              reason: normalizeText(error?.message || 'direct buy failed')
            }
          }
        ],
        createdAt: purchase.createdAt,
        updatedAt: new Date().toISOString(),
        error: normalizeText(error?.message || 'direct buy failed')
      });
      const failed = {
        ...purchase,
        state: 'failed',
        error: normalizeText(error?.message || 'direct buy failed'),
        updatedAt: new Date().toISOString()
      };
      upsertPurchaseRecord(failed);
      finalizeConsumerIntent?.(intentId, {
        status: 'failed',
        resultRef: normalizeText(failed.purchaseId),
        traceId: normalizeText(failed.traceId),
        failureReason: normalizeText(failed.error)
      });
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'direct_buy_failed',
        reason: failed.error,
        purchase: buildPurchaseView(failed)
      });
    }
  });

  app.get('/api/purchases/:purchaseId', requireRole('viewer'), (req, res) => {
    const purchaseId = normalizeText(req.params.purchaseId);
    const purchase =
      readPurchases().find((item) => normalizeText(item?.purchaseId) === purchaseId) || null;
    if (!purchase) {
      return res.status(404).json({ ok: false, error: 'purchase_not_found', purchaseId });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      purchase: buildPurchaseView(purchase)
    });
  });

  app.get('/api/purchases', requireRole('viewer'), (req, res) => {
    const traceId = normalizeText(req.query.traceId || '');
    const purchaseId = normalizeText(req.query.purchaseId || '');
    const templateId = normalizeText(req.query.templateId || '');
    const provider = normalizeText(req.query.provider || '').toLowerCase();
    const capability = normalizeCapability(req.query.capability || '');
    const state = normalizeText(req.query.state || '').toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));

    const rows = readPurchases()
      .filter((item) => {
        if (traceId && normalizeText(item?.traceId) !== traceId) return false;
        if (purchaseId && normalizeText(item?.purchaseId) !== purchaseId) return false;
        if (templateId && normalizeText(item?.templateId) !== templateId) return false;
        if (provider && normalizeText(item?.providerAgentId).toLowerCase() !== provider) return false;
        if (capability && normalizeCapability(item?.capabilityId) !== capability) return false;
        if (state && normalizeText(item?.state).toLowerCase() !== state) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildPurchaseView(item));

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });
}
