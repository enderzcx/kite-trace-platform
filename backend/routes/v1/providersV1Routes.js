import { createPlatformV1Shared } from './platformV1Shared.js';

export function registerProvidersV1Routes(app, deps) {
  const {
    createTraceId,
    ensureNetworkAgents,
    ensureServiceCatalog,
    issueIdentityChallenge,
    readIdentityProfile,
    verifyIdentityChallengeResponse,
    requireRole,
    sanitizeServiceRecord,
    sanitizeNetworkAgentRecord,
    writePublishedServices,
    writeNetworkAgents,
    normalizeText,
    normalizeLower,
    normalizeBool,
    clampLimit,
    sendV1Success,
    sendV1Error,
    providerHasIdentityLink,
    providerIsIdentityVerified,
    normalizeApprovalStatus,
    buildCapabilityView,
    buildProviderView,
    providerIsDiscoverable,
    buildProviderDiscoveryScore,
    matchesSearch,
    ensureCapabilityPublishPolicy,
    ensureProviderOnboardingPolicy
  } = createPlatformV1Shared(deps);

  function buildProviderManifest(provider = null) {
    const providerId = normalizeLower(provider?.id);
    const services = ensureServiceCatalog()
      .filter((item) => normalizeLower(item?.providerAgentId) === providerId)
      .sort((left, right) => Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0))
      .map((service) => buildCapabilityView(service, provider));
    const storedManifest =
      provider?.serviceManifest && typeof provider.serviceManifest === 'object' && !Array.isArray(provider.serviceManifest)
        ? provider.serviceManifest
        : {};
    return {
      providerId,
      version: normalizeText(storedManifest?.version || '1'),
      name: normalizeText(storedManifest?.name || provider?.name || ''),
      description: normalizeText(storedManifest?.description || provider?.description || ''),
      services,
      importedAt: normalizeText(storedManifest?.importedAt || provider?.updatedAt || ''),
      source: storedManifest?.source || null
    };
  }

  function normalizeManifestServiceInput(providerId = '', service = {}) {
    const manifestService = service && typeof service === 'object' && !Array.isArray(service) ? service : {};
    const pricing = manifestService?.pricing && typeof manifestService.pricing === 'object' ? manifestService.pricing : {};
    const settlement = manifestService?.settlement && typeof manifestService.settlement === 'object' ? manifestService.settlement : {};
    return {
      ...manifestService,
      id: normalizeText(manifestService.capabilityId || manifestService.id || manifestService.serviceId || ''),
      capabilityId: normalizeText(manifestService.capabilityId || manifestService.id || manifestService.serviceId || ''),
      action: normalizeLower(manifestService.action || manifestService.capability || manifestService.type || ''),
      providerId,
      providerAgentId: providerId,
      price: normalizeText(pricing.amount || manifestService.price || ''),
      tokenAddress: normalizeText(pricing.tokenAddress || manifestService.tokenAddress || ''),
      recipient: normalizeText(settlement.recipient || manifestService.recipient || ''),
      tags: Array.isArray(manifestService.tags) ? manifestService.tags : [],
      exampleInput:
        manifestService.exampleInput && typeof manifestService.exampleInput === 'object' && !Array.isArray(manifestService.exampleInput)
          ? manifestService.exampleInput
          : {},
      inputSchema:
        manifestService.inputSchema && typeof manifestService.inputSchema === 'object' && !Array.isArray(manifestService.inputSchema)
          ? manifestService.inputSchema
          : {},
      outputSchema:
        manifestService.outputSchema && typeof manifestService.outputSchema === 'object' && !Array.isArray(manifestService.outputSchema)
          ? manifestService.outputSchema
          : {},
      pricing: {
        ...pricing,
        amount: normalizeText(pricing.amount || manifestService.price || ''),
        tokenAddress: normalizeText(pricing.tokenAddress || manifestService.tokenAddress || ''),
        currency: normalizeText(pricing.currency || '')
      }
    };
  }

  app.get('/api/v1/providers', requireRole('viewer'), (req, res) => {
    const role = normalizeLower(req.query.role);
    const mode = normalizeLower(req.query.mode);
    const capability = normalizeLower(req.query.capability);
    const activeFilter = normalizeText(req.query.active);
    const verifiedFilter = normalizeText(req.query.verified);
    const identityLinkedFilter = normalizeText(req.query.identityLinked);
    const approvalStatusFilter = normalizeText(req.query.approvalStatus);
    const discoverableFilter = normalizeText(req.query.discoverable);
    const query = normalizeText(req.query.q);
    const limit = clampLimit(req.query.limit, 100);
    const items = ensureNetworkAgents()
      .filter((provider) => {
        if (role && normalizeLower(provider?.role) !== role) return false;
        if (mode && normalizeLower(provider?.mode) !== mode) return false;
        if (capability) {
          const capabilities = Array.isArray(provider?.capabilities) ? provider.capabilities.map((item) => normalizeLower(item)) : [];
          if (!capabilities.includes(capability)) return false;
        }
        if (activeFilter) {
          const expected = normalizeBool(activeFilter, true);
          if ((provider?.active !== false) !== expected) return false;
        }
        if (verifiedFilter) {
          const expected = normalizeBool(verifiedFilter, true);
          if (providerIsIdentityVerified(provider) !== expected) return false;
        }
        if (identityLinkedFilter) {
          const expected = normalizeBool(identityLinkedFilter, true);
          if (providerHasIdentityLink(provider) !== expected) return false;
        }
        if (approvalStatusFilter && normalizeApprovalStatus(provider?.approvalStatus) !== normalizeApprovalStatus(approvalStatusFilter)) {
          return false;
        }
        if (discoverableFilter) {
          const expected = normalizeBool(discoverableFilter, true);
          if (providerIsDiscoverable(provider) !== expected) return false;
        }
        if (query && !matchesSearch(provider, query)) return false;
        return true;
      })
      .sort((left, right) => {
        const discoveryDelta = buildProviderDiscoveryScore(right) - buildProviderDiscoveryScore(left);
        if (discoveryDelta !== 0) return discoveryDelta;
        return Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0);
      })
      .slice(0, limit)
      .map((provider) => buildProviderView(provider));
    return sendV1Success(res, req, {
      total: items.length,
      items
    });
  });

  app.post('/api/v1/providers', requireRole('admin'), (req, res) => {
    try {
      const body = req.body || {};
      const rows = ensureNetworkAgents().map((item) => ({ ...item }));
      const providerId = normalizeLower(body.providerId || body.id || '');
      const existingIndex = providerId ? rows.findIndex((item) => normalizeLower(item?.id) === providerId) : -1;
      const existing = existingIndex >= 0 ? rows[existingIndex] : null;
      ensureProviderOnboardingPolicy(body, existing, rows);
      const record = sanitizeNetworkAgentRecord(
        {
          ...body,
          id: providerId || body.id || body.providerId || '',
          onboardingSource: normalizeText(body.onboardingSource || existing?.onboardingSource || 'admin'),
          approvalStatus: normalizeApprovalStatus(body.approvalStatus || existing?.approvalStatus || 'approved'),
          approvedAt: normalizeText(body.approvedAt || existing?.approvedAt || new Date().toISOString()),
          suspendedAt: ''
        },
        existing
      );
      if (existingIndex >= 0) rows[existingIndex] = record;
      else rows.unshift(record);
      writeNetworkAgents(rows);
      return sendV1Success(res, req, {
        mode: existing ? 'updated' : 'created',
        provider: buildProviderView(record)
      });
    } catch (error) {
      return sendV1Error(res, req, 400, 'invalid_provider', error?.message || 'invalid provider payload');
    }
  });

  app.post('/api/v1/providers/identity-challenge', async (req, res) => {
    try {
      if (typeof issueIdentityChallenge !== 'function') {
        return sendV1Error(
          res,
          req,
          503,
          'identity_challenge_unavailable',
          'Provider identity challenge support is not configured on this backend.'
        );
      }
      const body = req.body || {};
      const providerDraft = {
        providerId: normalizeLower(body.providerId || body.id || ''),
        name: normalizeText(body.name || ''),
        role: normalizeLower(body.role || ''),
        mode: normalizeLower(body.mode || ''),
        capabilities: Array.isArray(body.capabilities) ? body.capabilities : []
      };
      ensureProviderOnboardingPolicy(providerDraft, null, ensureNetworkAgents().map((item) => ({ ...item })));
      const challenge = await issueIdentityChallenge?.({
        traceId: req.traceId || createTraceId('provider-idv'),
        identityInput: {
          identityRegistry: body.identityRegistry || body.registry,
          identityAgentId: body.identityAgentId || body.agentId
        }
      });
      return sendV1Success(res, req, {
        challenge,
        providerDraft
      });
    } catch (error) {
      return sendV1Error(
        res,
        req,
        400,
        'invalid_provider_identity_challenge',
        error?.message || 'invalid provider identity challenge payload'
      );
    }
  });

  app.post('/api/v1/providers/register-identity', async (req, res) => {
    try {
      if (typeof verifyIdentityChallengeResponse !== 'function') {
        return sendV1Error(
          res,
          req,
          503,
          'identity_registration_unavailable',
          'Provider identity verification support is not configured on this backend.'
        );
      }
      const body = req.body || {};
      const providerId = normalizeLower(body.providerId || body.id || '');
      const rows = ensureNetworkAgents().map((item) => ({ ...item }));
      const existingIndex = providerId ? rows.findIndex((item) => normalizeLower(item?.id) === providerId) : -1;
      const existing = existingIndex >= 0 ? rows[existingIndex] : null;
      ensureProviderOnboardingPolicy(body, existing, rows);
      const verification = await verifyIdentityChallengeResponse?.({
        challengeId: body.challengeId,
        signature: body.signature,
        traceId: req.traceId || createTraceId('provider-reg')
      });
      const record = sanitizeNetworkAgentRecord(
        {
          ...body,
          id: providerId || body.id || body.providerId || '',
          identityRegistry: normalizeText(verification?.identity?.registry || body.identityRegistry || body.registry || ''),
          identityAgentId: normalizeText(verification?.identity?.agentId || body.identityAgentId || body.agentId || ''),
          ownerWallet: normalizeText(verification?.identity?.ownerAddress || body.ownerWallet || ''),
          aaAddress: normalizeText(verification?.identity?.agentWallet || body.aaAddress || ''),
          importedFromIdentityAt: new Date().toISOString(),
          identityVerifyMode: normalizeText(verification?.verifyMode || ''),
          identitySignerType: normalizeText(verification?.signerType || ''),
          identityVerifiedAt: normalizeText(verification?.verifiedAt || ''),
          onboardingSource: normalizeText(body.onboardingSource || existing?.onboardingSource || 'identity-self-registered'),
          approvalStatus: normalizeApprovalStatus(body.approvalStatus || existing?.approvalStatus || 'pending'),
          approvedAt:
            normalizeApprovalStatus(body.approvalStatus || existing?.approvalStatus || 'pending') === 'approved'
              ? normalizeText(body.approvedAt || existing?.approvedAt || new Date().toISOString())
              : '',
          suspendedAt: ''
        },
        existing
      );
      if (existingIndex >= 0) rows[existingIndex] = record;
      else rows.unshift(record);
      writeNetworkAgents(rows);
      return sendV1Success(res, req, {
        mode: existing ? 'updated' : 'created',
        provider: buildProviderView(record),
        identity: verification?.identity || null,
        verification: {
          verifyMode: normalizeText(verification?.verifyMode || ''),
          signerType: normalizeText(verification?.signerType || ''),
          verifiedAt: normalizeText(verification?.verifiedAt || '')
        }
      });
    } catch (error) {
      return sendV1Error(
        res,
        req,
        400,
        'invalid_provider_identity_registration',
        error?.message || 'invalid provider identity registration payload'
      );
    }
  });

  app.post('/api/v1/providers/import-identity', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {};
      const identityProfile = await readIdentityProfile?.({
        registry: body.identityRegistry || body.registry,
        agentId: body.identityAgentId || body.agentId
      });
      if (!identityProfile?.available) {
        return sendV1Error(
          res,
          req,
          400,
          'identity_unavailable',
          identityProfile?.reason || 'identity unavailable'
        );
      }

      const rows = ensureNetworkAgents().map((item) => ({ ...item }));
      const providerId = normalizeLower(body.providerId || body.id || '');
      const existingIndex = providerId ? rows.findIndex((item) => normalizeLower(item?.id) === providerId) : -1;
      const existing = existingIndex >= 0 ? rows[existingIndex] : null;
      ensureProviderOnboardingPolicy(body, existing, rows);

      const record = sanitizeNetworkAgentRecord(
        {
          ...body,
          id: providerId || body.id || body.providerId || '',
          identityRegistry: normalizeText(identityProfile?.configured?.registry || body.identityRegistry || ''),
          identityAgentId: normalizeText(identityProfile?.configured?.agentId || body.identityAgentId || body.agentId || ''),
          ownerWallet: normalizeText(body.ownerWallet || identityProfile?.ownerAddress || ''),
          aaAddress: normalizeText(body.aaAddress || identityProfile?.agentWallet || ''),
          importedFromIdentityAt: new Date().toISOString(),
          onboardingSource: normalizeText(body.onboardingSource || existing?.onboardingSource || 'identity-import'),
          approvalStatus: normalizeApprovalStatus(body.approvalStatus || existing?.approvalStatus || 'approved'),
          approvedAt: normalizeText(body.approvedAt || existing?.approvedAt || new Date().toISOString()),
          suspendedAt: ''
        },
        existing
      );
      if (existingIndex >= 0) rows[existingIndex] = record;
      else rows.unshift(record);
      writeNetworkAgents(rows);

      return sendV1Success(res, req, {
        mode: existing ? 'updated' : 'created',
        provider: buildProviderView(record),
        identity: {
          registry: normalizeText(identityProfile?.configured?.registry),
          agentId: normalizeText(identityProfile?.configured?.agentId),
          ownerAddress: normalizeText(identityProfile?.ownerAddress),
          agentWallet: normalizeText(identityProfile?.agentWallet),
          tokenURI: normalizeText(identityProfile?.tokenURI)
        }
      });
    } catch (error) {
      return sendV1Error(res, req, 400, 'invalid_provider_identity_import', error?.message || 'invalid identity import payload');
    }
  });

  app.get('/api/v1/providers/:providerId', requireRole('viewer'), (req, res) => {
    const providerId = normalizeLower(req.params.providerId);
    const provider = ensureNetworkAgents().find((item) => normalizeLower(item?.id) === providerId) || null;
    if (!provider) {
      return sendV1Error(res, req, 404, 'provider_not_found', `Provider ${providerId} was not found.`, {
        providerId
      });
    }
    return sendV1Success(res, req, {
      provider: buildProviderView(provider)
    });
  });

  app.get('/api/v1/providers/:providerId/manifest', requireRole('viewer'), (req, res) => {
    const providerId = normalizeLower(req.params.providerId);
    const provider = ensureNetworkAgents().find((item) => normalizeLower(item?.id) === providerId) || null;
    if (!provider) {
      return sendV1Error(res, req, 404, 'provider_not_found', `Provider ${providerId} was not found.`, {
        providerId
      });
    }
    return sendV1Success(res, req, {
      manifest: buildProviderManifest(provider)
    });
  });

  app.post('/api/v1/providers/:providerId/manifest', requireRole('admin'), (req, res) => {
    const providerId = normalizeLower(req.params.providerId);
    const providers = ensureNetworkAgents().map((item) => ({ ...item }));
    const providerIndex = providers.findIndex((item) => normalizeLower(item?.id) === providerId);
    if (providerIndex < 0) {
      return sendV1Error(res, req, 404, 'provider_not_found', `Provider ${providerId} was not found.`, {
        providerId
      });
    }
    const provider = providers[providerIndex];
    if (!providerIsIdentityVerified(provider)) {
      return sendV1Error(
        res,
        req,
        409,
        'provider_identity_not_verified',
        `Provider ${providerId} must complete identity challenge verification before importing a manifest.`,
        { providerId }
      );
    }

    const manifest =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};
    const manifestServices = Array.isArray(manifest.services) ? manifest.services : [];
    if (manifestServices.length === 0) {
      return sendV1Error(res, req, 400, 'manifest_services_required', 'Service manifest must include a non-empty services array.');
    }

    const rows = ensureServiceCatalog().map((item) => ({ ...item }));
    const imported = [];
    let successCount = 0;
    let failureCount = 0;

    for (let index = 0; index < manifestServices.length; index += 1) {
      const manifestService = manifestServices[index];
      try {
        const normalized = normalizeManifestServiceInput(providerId, manifestService);
        const capabilityId = normalizeText(normalized.capabilityId || normalized.id || '');
        const existingIndex = capabilityId ? rows.findIndex((item) => normalizeText(item?.id) === capabilityId) : -1;
        const existing = existingIndex >= 0 ? rows[existingIndex] : null;
        ensureCapabilityPublishPolicy(normalized, existing, providers);
        const record = sanitizeServiceRecord(
          {
            ...normalized,
            id: capabilityId || normalized.id || '',
            providerAgentId: providerId,
            publishedBy: req.authRole || 'admin'
          },
          existing
        );
        if (existingIndex >= 0) rows[existingIndex] = record;
        else rows.unshift(record);
        imported.push({
          index,
          capabilityId: normalizeText(record?.id),
          action: normalizeText(record?.action),
          ok: true,
          mode: existing ? 'updated' : 'created'
        });
        successCount += 1;
      } catch (error) {
        imported.push({
          index,
          capabilityId: normalizeText(manifestService?.capabilityId || manifestService?.id || manifestService?.serviceId || ''),
          action: normalizeText(manifestService?.action || manifestService?.capability || manifestService?.type || ''),
          ok: false,
          error: normalizeText(error?.message || 'manifest_import_failed') || 'manifest_import_failed'
        });
        failureCount += 1;
      }
    }

    writePublishedServices(rows);
    const providerCapabilities = rows
      .filter((item) => normalizeLower(item?.providerAgentId) === providerId)
      .map((item) => normalizeLower(item?.action))
      .filter(Boolean);
    providers[providerIndex] = {
      ...provider,
      capabilities: [...new Set(providerCapabilities)],
      serviceManifest: {
        ...manifest,
        providerId,
        importedAt: new Date().toISOString(),
        source: manifest?.source || null
      },
      updatedAt: new Date().toISOString()
    };
    writeNetworkAgents(providers);

    return sendV1Success(res, req, {
      providerId,
      successCount,
      failureCount,
      results: imported,
      manifest: buildProviderManifest(providers[providerIndex])
    });
  });

  app.post('/api/v1/providers/:providerId/approve', requireRole('admin'), (req, res) => {
    const providerId = normalizeLower(req.params.providerId);
    const rows = ensureNetworkAgents().map((item) => ({ ...item }));
    const existingIndex = rows.findIndex((item) => normalizeLower(item?.id) === providerId);
    if (existingIndex < 0) {
      return sendV1Error(res, req, 404, 'provider_not_found', `Provider ${providerId} was not found.`, {
        providerId
      });
    }
    const existing = rows[existingIndex];
    const record = sanitizeNetworkAgentRecord(
      {
        ...existing,
        approvalStatus: 'approved',
        approvedAt: new Date().toISOString(),
        suspendedAt: ''
      },
      existing
    );
    rows[existingIndex] = record;
    writeNetworkAgents(rows);
    return sendV1Success(res, req, {
      mode: 'approved',
      provider: buildProviderView(record)
    });
  });

  app.post('/api/v1/providers/:providerId/suspend', requireRole('admin'), (req, res) => {
    const providerId = normalizeLower(req.params.providerId);
    const rows = ensureNetworkAgents().map((item) => ({ ...item }));
    const existingIndex = rows.findIndex((item) => normalizeLower(item?.id) === providerId);
    if (existingIndex < 0) {
      return sendV1Error(res, req, 404, 'provider_not_found', `Provider ${providerId} was not found.`, {
        providerId
      });
    }
    const existing = rows[existingIndex];
    const record = sanitizeNetworkAgentRecord(
      {
        ...existing,
        approvalStatus: 'suspended',
        suspendedAt: new Date().toISOString()
      },
      existing
    );
    rows[existingIndex] = record;
    writeNetworkAgents(rows);
    return sendV1Success(res, req, {
      mode: 'suspended',
      provider: buildProviderView(record)
    });
  });
}
