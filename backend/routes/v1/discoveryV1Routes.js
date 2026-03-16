import { createPlatformV1Shared } from './platformV1Shared.js';

export function registerDiscoveryV1Routes(app, deps) {
  const {
    ensureNetworkAgents,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    requireRole,
    normalizeText,
    normalizeLower,
    serviceMatchesCapability,
    normalizeBool,
    clampLimit,
    sendV1Success,
    sendV1Error,
    providerIsIdentityVerified,
    providerIsDiscoverable,
    inferServiceLaneType,
    findRecommendedTemplate,
    buildSelectionView
  } = createPlatformV1Shared(deps);

  app.get('/api/v1/discovery/select', requireRole('viewer'), (req, res) => {
    const capability = normalizeLower(req.query.capability || req.query.action);
    const providerId = normalizeLower(req.query.provider);
    const lane = normalizeLower(req.query.lane);
    const verifiedOnly = normalizeText(req.query.verified);
    const discoverableOnly = normalizeText(req.query.discoverable);
    const limit = clampLimit(req.query.limit, 25, 1, 100);
    const providers = ensureNetworkAgents().map((item) => ({ ...item }));
    const templates = ensureTemplateCatalog().map((item) => ({ ...item }));
    const selections = ensureServiceCatalog()
      .filter((service) => {
        if (capability && !serviceMatchesCapability(service, capability)) return false;
        if (providerId && normalizeLower(service?.providerAgentId) !== providerId) return false;
        if (lane) {
          const laneType = normalizeLower(service?.action) === 'hyperliquid-order-testnet' ? 'job-or-buy' : 'buy';
          if (laneType !== lane) return false;
        }
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        if (verifiedOnly) {
          const expected = normalizeBool(verifiedOnly, true);
          if (providerIsIdentityVerified(provider) !== expected) return false;
        }
        if (discoverableOnly) {
          const expected = normalizeBool(discoverableOnly, true);
          if (providerIsDiscoverable(provider) !== expected) return false;
        }
        if (!provider || provider?.active === false || service?.active === false) return false;
        return true;
      })
      .map((service) => {
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        return buildSelectionView(
          service,
          provider,
          {
            capability,
            provider: providerId,
            lane
          },
          templates
        );
      })
      .sort((left, right) => Number(right?.selectionScore || 0) - Number(left?.selectionScore || 0))
      .slice(0, limit);

    return sendV1Success(res, req, {
      total: selections.length,
      top: selections[0] || null,
      items: selections
    });
  });

  app.get('/api/v1/discovery/compare', requireRole('viewer'), (req, res) => {
    const capability = normalizeLower(req.query.capability || req.query.action);
    const providerId = normalizeLower(req.query.provider);
    const lane = normalizeLower(req.query.lane);
    const verifiedOnly = normalizeText(req.query.verified);
    const discoverableOnly = normalizeText(req.query.discoverable);
    const limit = clampLimit(req.query.limit, 5, 1, 25);
    const providers = ensureNetworkAgents().map((item) => ({ ...item }));
    const templates = ensureTemplateCatalog().map((item) => ({ ...item }));
    const items = ensureServiceCatalog()
      .filter((service) => {
        if (capability && !serviceMatchesCapability(service, capability)) return false;
        if (providerId && normalizeLower(service?.providerAgentId) !== providerId) return false;
        if (lane && inferServiceLaneType(service) !== lane) return false;
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        if (!provider || provider?.active === false || service?.active === false) return false;
        if (verifiedOnly) {
          const expected = normalizeBool(verifiedOnly, true);
          if (providerIsIdentityVerified(provider) !== expected) return false;
        }
        if (discoverableOnly) {
          const expected = normalizeBool(discoverableOnly, true);
          if (providerIsDiscoverable(provider) !== expected) return false;
        }
        return true;
      })
      .map((service) => {
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        return buildSelectionView(
          service,
          provider,
          {
            capability,
            provider: providerId,
            lane
          },
          templates
        );
      })
      .sort((left, right) => Number(right?.selectionScore || 0) - Number(left?.selectionScore || 0))
      .slice(0, limit);

    return sendV1Success(res, req, {
      criteria: {
        capability: capability || '',
        provider: providerId || '',
        lane: lane || '',
        verified: verifiedOnly || '',
        discoverable: discoverableOnly || ''
      },
      total: items.length,
      top: items[0] || null,
      items
    });
  });

  app.get('/api/v1/discovery/recommend-direct-buy', requireRole('viewer'), (req, res) => {
    const capability = normalizeLower(req.query.capability || req.query.action);
    const providerId = normalizeLower(req.query.provider);
    const verifiedOnly = normalizeText(req.query.verified);
    const discoverableOnly = normalizeText(req.query.discoverable);
    const providers = ensureNetworkAgents().map((item) => ({ ...item }));
    const templates = ensureTemplateCatalog().map((item) => ({ ...item }));
    const recommendations = ensureServiceCatalog()
      .filter((service) => {
        if (capability && !serviceMatchesCapability(service, capability)) return false;
        if (providerId && normalizeLower(service?.providerAgentId) !== providerId) return false;
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        if (!provider || provider?.active === false || service?.active === false) return false;
        if (verifiedOnly) {
          const expected = normalizeBool(verifiedOnly, true);
          if (providerIsIdentityVerified(provider) !== expected) return false;
        }
        if (discoverableOnly) {
          const expected = normalizeBool(discoverableOnly, true);
          if (providerIsDiscoverable(provider) !== expected) return false;
        }
        return Boolean(findRecommendedTemplate(service, templates));
      })
      .map((service) => {
        const provider = providers.find((item) => normalizeLower(item?.id) === normalizeLower(service?.providerAgentId)) || null;
        return buildSelectionView(
          service,
          provider,
          {
            capability,
            provider: providerId,
            lane: 'buy'
          },
          templates
        );
      })
      .sort((left, right) => Number(right?.selectionScore || 0) - Number(left?.selectionScore || 0));

    const top = recommendations[0] || null;
    if (!top || !top.template) {
      return sendV1Error(
        res,
        req,
        404,
        'direct_buy_recommendation_not_found',
        'No direct-buy recommendation with an active template was found for the requested criteria.',
        {
          capability: capability || '',
          provider: providerId || ''
        }
      );
    }

    return sendV1Success(res, req, {
      total: recommendations.length,
      selection: top,
      template: top.template,
      purchaseReady: true
    });
  });
}
