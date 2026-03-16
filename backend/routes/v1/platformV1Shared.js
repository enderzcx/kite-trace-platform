export function createPlatformV1Shared(deps) {
  const {
    PORT,
    createTraceId,
    ensureNetworkAgents,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    issueIdentityChallenge,
    publishTrustPublicationOnChain,
    readIdentityProfile,
    readReputationSignals,
    readTrustPublications,
    readValidationRecords,
    appendTrustPublication,
    verifyIdentityChallengeResponse,
    getInternalAgentApiKey,
    requireRole,
    sanitizeNetworkAgentRecord,
    sanitizeServiceRecord,
    writeNetworkAgents,
    writePublishedServices
  } = deps;
  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function normalizeLower(value = '') {
    return normalizeText(value).toLowerCase();
  }

  function capabilityAliases(value = '') {
    const normalized = normalizeLower(value);
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
    const normalizedValue = normalizeLower(value);
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
    if (serviceId && normalizeLower(serviceId).startsWith('cap-')) {
      return serviceId;
    }
    return normalizeText(service?.capabilityId || service?.action || serviceId);
  }

  function templateMatchesCapability(template = {}, capability = '', service = null) {
    const linkedService =
      service && typeof service === 'object'
        ? service
        : normalizeText(template?.serviceId)
          ? ensureServiceCatalog().find((item) => normalizeText(item?.id) === normalizeText(template?.serviceId)) || null
          : null;
    if (!capability) return true;
    return (
      capabilityMatchesValue(template?.capabilityId, capability) ||
      capabilityMatchesValue(template?.serviceId, capability) ||
      serviceMatchesCapability(linkedService, capability)
    );
  }

  function normalizeBool(value, fallback = false) {
    const raw = normalizeLower(value);
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
  }

  function clampLimit(value, fallback = 50, min = 1, max = 500) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(Math.round(numeric), max));
  }

  function buildErrorShape(code = '', reason = '', details = null) {
    return {
      code: normalizeText(code) || 'unknown_error',
      reason: normalizeText(reason) || 'Request failed.',
      details: details && typeof details === 'object' ? details : undefined
    };
  }

  function sendV1Success(res, req, payload = {}, status = 200) {
    return res.status(status).json({
      ok: true,
      schemaVersion: 'v1',
      traceId: req.traceId || '',
      ...payload
    });
  }

  function sendV1Error(res, req, status = 400, code = '', reason = '', details = null) {
    const error = buildErrorShape(code, reason, details);
    return res.status(status).json({
      ok: false,
      schemaVersion: 'v1',
      traceId: req.traceId || '',
      error: error.code,
      reason: error.reason,
      errorDetail: error
    });
  }

  function isAllowedProviderRole(role = '') {
    return ['provider', 'executor', 'router'].includes(normalizeLower(role));
  }

  function isAllowedProviderMode(mode = '') {
    return ['a2a', 'a2api'].includes(normalizeLower(mode));
  }

  function providerHasIdentityLink(provider = {}) {
    return Boolean(normalizeText(provider?.identityRegistry) && normalizeText(provider?.identityAgentId));
  }

  function providerIsIdentityVerified(provider = {}) {
    return Boolean(normalizeText(provider?.identityVerifiedAt));
  }

  function normalizeApprovalStatus(value = '', fallback = 'approved') {
    const normalized = normalizeLower(value);
    if (['approved', 'pending', 'suspended'].includes(normalized)) return normalized;
    return normalizeLower(fallback) || 'approved';
  }

  function buildProviderTrustAggregate(providerId = '') {
    const normalizedProviderId = normalizeText(providerId);
    if (!normalizedProviderId) {
      return {
        reputationCount: 0,
        validationCount: 0,
        publicationCount: 0,
        scoreSum: 0,
        averageScore: 0
      };
    }
    const reputationItems = readReputationSignals()
      .filter((item) => normalizeText(item?.agentId) === normalizedProviderId);
    const validationItems = readValidationRecords()
      .filter((item) => normalizeText(item?.agentId) === normalizedProviderId);
    const publicationItems = readTrustPublications()
      .filter((item) => normalizeText(item?.agentId) === normalizedProviderId);
    const reputationAggregate = buildTrustReputationAggregate(reputationItems.map((item) => buildTrustReputationView(item)));
    return {
      reputationCount: reputationAggregate.count,
      validationCount: validationItems.length,
      publicationCount: publicationItems.length,
      scoreSum: reputationAggregate.scoreSum,
      averageScore: reputationAggregate.averageScore
    };
  }

  function buildProviderVerificationView(provider = {}) {
    return {
      identityLinked: providerHasIdentityLink(provider),
      verified: providerIsIdentityVerified(provider),
      verifyMode: normalizeText(provider?.identityVerifyMode),
      signerType: normalizeText(provider?.identitySignerType),
      verifiedAt: normalizeText(provider?.identityVerifiedAt),
      importedAt: normalizeText(provider?.importedFromIdentityAt)
    };
  }

  function buildProviderOnboardingView(provider = {}) {
    const approvalStatus = normalizeApprovalStatus(provider?.approvalStatus, provider?.active === false ? 'suspended' : 'approved');
    return {
      source: normalizeText(provider?.onboardingSource) || 'internal',
      approvalStatus,
      approvedAt: normalizeText(provider?.approvedAt),
      suspendedAt: normalizeText(provider?.suspendedAt),
      discoverable: provider?.active !== false && providerIsIdentityVerified(provider) && approvalStatus === 'approved'
    };
  }

  function providerIsDiscoverable(provider = {}) {
    return Boolean(buildProviderOnboardingView(provider).discoverable);
  }

  function buildProviderDiscoveryScore(provider = {}) {
    const verification = buildProviderVerificationView(provider);
    const trust = buildProviderTrustAggregate(provider?.id);
    const onboarding = buildProviderOnboardingView(provider);
    let score = 0;
    if (provider?.active !== false) score += 5;
    if (verification.identityLinked) score += 10;
    if (verification.verified) score += 20;
    if (onboarding.approvalStatus === 'approved') score += 10;
    if (onboarding.approvalStatus === 'pending') score -= 5;
    if (onboarding.approvalStatus === 'suspended') score -= 15;
    score += Math.min(10, trust.reputationCount);
    score += Math.min(5, trust.validationCount);
    score += Math.min(3, trust.publicationCount);
    score += Math.max(-5, Math.min(5, Math.round(trust.averageScore)));
    return score;
  }

  function matchesSearch(provider = {}, query = '') {
    const normalizedQuery = normalizeLower(query);
    if (!normalizedQuery) return true;
    const haystack = [
      provider?.id,
      provider?.name,
      provider?.description,
      provider?.role,
      provider?.mode,
      ...(Array.isArray(provider?.capabilities) ? provider.capabilities : [])
    ]
      .map((item) => normalizeLower(item))
      .filter(Boolean)
      .join(' ');
    return haystack.includes(normalizedQuery);
  }

  function ensureProviderOnboardingPolicy(input = {}, existing = null, providers = []) {
    const providerId = normalizeLower(input?.providerId || input?.id || existing?.id || '');
    const name = normalizeText(input?.name || existing?.name || '');
    const role = normalizeLower(input?.role || existing?.role || '');
    const mode = normalizeLower(input?.mode || existing?.mode || '');
    const identityRegistry = normalizeLower(input?.identityRegistry || input?.registry || existing?.identityRegistry || '');
    const identityAgentId = normalizeText(input?.identityAgentId || input?.agentId || existing?.identityAgentId || '');
    const capabilities = Array.isArray(input?.capabilities)
      ? input.capabilities.map((item) => normalizeLower(item)).filter(Boolean)
      : Array.isArray(existing?.capabilities)
        ? existing.capabilities.map((item) => normalizeLower(item)).filter(Boolean)
        : [];

    if (!providerId) {
      throw new Error('providerId is required');
    }
    if (!name) {
      throw new Error('provider name is required');
    }
    if (!isAllowedProviderRole(role)) {
      throw new Error('provider role must be one of provider, executor, router');
    }
    if (!isAllowedProviderMode(mode)) {
      throw new Error('provider mode must be one of a2a or a2api');
    }
    if (role === 'provider' && capabilities.length === 0) {
      throw new Error('provider capabilities are required for provider role');
    }
    if (existing?.identityAgentId && identityAgentId && normalizeText(existing.identityAgentId) !== identityAgentId) {
      throw new Error('provider identityAgentId cannot be reassigned once linked');
    }
    if (existing?.identityRegistry && identityRegistry && normalizeLower(existing.identityRegistry) !== identityRegistry) {
      throw new Error('provider identityRegistry cannot be reassigned once linked');
    }
    if (identityRegistry && !identityAgentId) {
      throw new Error('identityAgentId is required when identityRegistry is provided');
    }
    if (identityAgentId && !identityRegistry) {
      throw new Error('identityRegistry is required when identityAgentId is provided');
    }
    if (identityRegistry && identityAgentId) {
      const conflictingProvider = providers.find((item) => {
        const sameIdentity =
          normalizeLower(item?.identityRegistry) === identityRegistry &&
          normalizeText(item?.identityAgentId) === identityAgentId;
        return sameIdentity && normalizeLower(item?.id) !== providerId;
      });
      if (conflictingProvider) {
        throw new Error(
          `identity ${identityRegistry}:${identityAgentId} is already linked to provider ${normalizeText(conflictingProvider?.id)}`
        );
      }
    }
  }

  function ensureCapabilityPublishPolicy(input = {}, existing = null, providers = []) {
    const capabilityId = normalizeText(input?.capabilityId || input?.id || existing?.id || '');
    const providerId = normalizeLower(input?.providerId || input?.providerAgentId || existing?.providerAgentId || '');
    const action = normalizeLower(input?.action || existing?.action || '');

    if (!capabilityId) {
      throw new Error('capabilityId is required');
    }
    if (!providerId) {
      throw new Error('providerId is required');
    }
    if (!action) {
      throw new Error('capability action is required');
    }

    const provider = providers.find((item) => normalizeLower(item?.id) === providerId) || null;
    if (!provider) {
      throw new Error(`provider ${providerId} does not exist`);
    }
    if (provider?.active === false) {
      throw new Error(`provider ${providerId} is inactive`);
    }
    const providerRole = normalizeLower(provider?.role);
    if (!['provider', 'executor'].includes(providerRole)) {
      throw new Error(`provider ${providerId} cannot publish capabilities with role ${providerRole || '-'}`);
    }
    if (existing && normalizeLower(existing?.providerAgentId) && normalizeLower(existing?.providerAgentId) !== providerId) {
      throw new Error('capability providerId cannot be reassigned once created');
    }
  }

  function ensureTemplatePublishPolicy(input = {}, providers = [], capabilities = []) {
    const serviceId = normalizeText(input?.serviceId || '');
    if (!serviceId) {
      throw new Error('template serviceId is required');
    }
    const capability = capabilities.find((item) => normalizeText(item?.id) === serviceId) || null;
    if (!capability) {
      throw new Error(`service ${serviceId} does not exist`);
    }
    const providerId = normalizeLower(input?.providerAgentId || capability?.providerAgentId || '');
    const provider = providers.find((item) => normalizeLower(item?.id) === providerId) || null;
    if (!provider) {
      throw new Error(`provider ${providerId} does not exist`);
    }
    if (provider?.active === false) {
      throw new Error(`provider ${providerId} is inactive`);
    }
  }

  function buildProviderView(provider = {}) {
    const capabilities = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
    const verification = buildProviderVerificationView(provider);
    const trust = buildProviderTrustAggregate(provider?.id);
    const onboarding = buildProviderOnboardingView(provider);
    return {
      schemaVersion: 'v1',
      kind: 'provider',
      providerId: normalizeText(provider?.id),
      name: normalizeText(provider?.name),
      role: normalizeText(provider?.role),
      mode: normalizeText(provider?.mode),
      active: provider?.active !== false,
      description: normalizeText(provider?.description),
      identity: {
        registry: normalizeText(provider?.identityRegistry),
        agentId: normalizeText(provider?.identityAgentId)
        },
        verification,
        onboarding,
        runtime: {
        xmtpAddress: normalizeText(provider?.xmtpAddress),
        aaAddress: normalizeText(provider?.aaAddress),
        inboxId: normalizeText(provider?.inboxId),
        ownerWallet: normalizeText(provider?.ownerWallet)
      },
      trust,
      discovery: {
        score: buildProviderDiscoveryScore(provider)
      },
      capabilities,
      createdAt: normalizeText(provider?.createdAt),
      updatedAt: normalizeText(provider?.updatedAt)
    };
  }

  function buildCapabilityView(service = {}, provider = null) {
    const linkedProvider = provider && typeof provider === 'object' ? provider : null;
    const providerVerification = linkedProvider ? buildProviderVerificationView(linkedProvider) : null;
    const providerTrust = linkedProvider ? buildProviderTrustAggregate(linkedProvider?.id) : null;
    return {
      schemaVersion: 'v1',
      kind: 'capability',
      capabilityId: normalizeText(service?.id),
      providerId: normalizeText(service?.providerAgentId),
      action: normalizeText(service?.action),
      name: normalizeText(service?.name),
      description: normalizeText(service?.description),
      laneType: normalizeLower(service?.action) === 'hyperliquid-order-testnet' ? 'job-or-buy' : 'buy',
      pricing: {
        amount: normalizeText(service?.price),
        tokenAddress: normalizeText(service?.tokenAddress)
      },
      settlement: {
        recipient: normalizeText(service?.recipient),
        mode: 'x402'
      },
        discovery: {
          tags: Array.isArray(service?.tags) ? service.tags : [],
          pair: normalizeText(service?.pair),
          source: normalizeText(service?.sourceRequested || service?.source),
          providerVerified: Boolean(providerVerification?.verified),
          providerIdentityLinked: Boolean(providerVerification?.identityLinked),
          providerDiscoverable: Boolean(linkedProvider ? buildProviderOnboardingView(linkedProvider).discoverable : false)
        },
        provider:
          linkedProvider
            ? {
                providerId: normalizeText(linkedProvider?.id),
                name: normalizeText(linkedProvider?.name),
                mode: normalizeText(linkedProvider?.mode),
                verified: Boolean(providerVerification?.verified),
                identityLinked: Boolean(providerVerification?.identityLinked),
                discoverable: Boolean(buildProviderOnboardingView(linkedProvider).discoverable),
                trust: providerTrust
              }
          : null,
      constraints: {
        slaMs: Number(service?.slaMs || 0),
        rateLimitPerMinute: Number(service?.rateLimitPerMinute || 0),
        budgetPerDay: Number(service?.budgetPerDay || 0)
      },
      exampleInput:
        service?.exampleInput && typeof service.exampleInput === 'object' && !Array.isArray(service.exampleInput)
          ? service.exampleInput
          : {},
      active: service?.active !== false,
      createdAt: normalizeText(service?.createdAt),
      updatedAt: normalizeText(service?.updatedAt)
    };
  }

  function buildCapabilitySelectionScore(service = {}, provider = null, criteria = {}) {
    const linkedProvider = provider && typeof provider === 'object' ? provider : null;
    const providerScore = linkedProvider ? buildProviderDiscoveryScore(linkedProvider) : 0;
    const providerVerification = linkedProvider ? buildProviderVerificationView(linkedProvider) : null;
    const providerOnboarding = linkedProvider ? buildProviderOnboardingView(linkedProvider) : null;
    const lane = normalizeLower(criteria?.lane);
    const inferredLane = normalizeLower(service?.action) === 'hyperliquid-order-testnet' ? 'job-or-buy' : 'buy';
    let score = providerScore;
    if (service?.active !== false) score += 5;
    if (providerVerification?.verified) score += 5;
    if (providerOnboarding?.discoverable) score += 10;
    if (lane && inferredLane === lane) score += 5;
    if (normalizeLower(criteria?.provider) && normalizeLower(service?.providerAgentId) === normalizeLower(criteria?.provider)) score += 5;
    return score;
  }

  function inferServiceLaneType(service = {}) {
    return normalizeLower(service?.action) === 'hyperliquid-order-testnet' ? 'job-or-buy' : 'buy';
  }

  function findRecommendedTemplate(service = {}, templates = []) {
    const templateRows = Array.isArray(templates) ? templates : [];
    const now = Date.now();
    return templateRows
      .filter((template) => {
        if (template?.active === false) return false;
        if (normalizeLower(template?.status) !== 'active') return false;
        const validUntil = normalizeText(template?.validUntil);
        if (validUntil && Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) <= now) return false;
        const serviceId = normalizeText(service?.id);
        const templateServiceId = normalizeText(template?.serviceId);
        if (templateServiceId && serviceId && templateServiceId === serviceId) return true;
        return (
          normalizeLower(template?.providerAgentId) === normalizeLower(service?.providerAgentId) &&
          templateMatchesCapability(template, normalizeText(service?.id || service?.action))
        );
      })
      .sort((left, right) => {
        const versionDelta = Number(right?.templateVersion || 0) - Number(left?.templateVersion || 0);
        if (versionDelta !== 0) return versionDelta;
        return Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0);
      })[0] || null;
  }

  function buildSelectionRationale(service = {}, provider = null, criteria = {}, template = null) {
    const linkedProvider = provider && typeof provider === 'object' ? provider : null;
    const providerVerification = linkedProvider ? buildProviderVerificationView(linkedProvider) : null;
    const providerOnboarding = linkedProvider ? buildProviderOnboardingView(linkedProvider) : null;
    return {
      laneType: inferServiceLaneType(service),
      providerVerified: Boolean(providerVerification?.verified),
      providerDiscoverable: Boolean(providerOnboarding?.discoverable),
      directBuyReady: Boolean(template),
      matchedCapability: serviceMatchesCapability(service, criteria?.capability),
      matchedProvider: normalizeLower(criteria?.provider) === normalizeLower(service?.providerAgentId),
      matchedLane: normalizeLower(criteria?.lane) === inferServiceLaneType(service)
    };
  }

  function buildSelectionView(service = {}, provider = null, criteria = {}, templates = []) {
    const template = findRecommendedTemplate(service, templates);
    return {
      schemaVersion: 'v1',
      kind: 'selection',
      selectionScore: buildCapabilitySelectionScore(service, provider, criteria),
      directBuyReady: Boolean(template),
      rationale: buildSelectionRationale(service, provider, criteria, template),
      template: template ? buildTemplateView(template) : null,
      capability: buildCapabilityView(service, provider),
      provider: provider ? buildProviderView(provider) : null
    };
  }

  function buildTemplateView(template = {}) {
    const pricingTerms = template?.pricingTerms && typeof template.pricingTerms === 'object' ? template.pricingTerms : {};
    const settlementTerms =
      template?.settlementTerms && typeof template.settlementTerms === 'object' ? template.settlementTerms : {};
    const linkedService = normalizeText(template?.serviceId)
      ? ensureServiceCatalog().find((item) => normalizeText(item?.id) === normalizeText(template?.serviceId)) || null
      : null;
    return {
      schemaVersion: 'v1',
      kind: 'template',
      templateId: normalizeText(template?.templateId),
      templateVersion: Number(template?.templateVersion || 0),
      providerId: normalizeText(template?.providerAgentId),
      capabilityId: linkedService ? resolveServiceCapabilityId(linkedService) : normalizeText(template?.capabilityId),
      serviceId: normalizeText(template?.serviceId),
      name: normalizeText(template?.name),
      description: normalizeText(template?.description),
      fulfillmentMode: normalizeText(template?.fulfillmentMode),
      pricing: {
        amount: normalizeText(pricingTerms?.amount),
        currency: normalizeText(pricingTerms?.currency),
        tokenAddress: normalizeText(pricingTerms?.tokenAddress)
      },
      settlement: {
        paymentMode: normalizeText(settlementTerms?.paymentMode),
        recipient: normalizeText(settlementTerms?.recipient),
        tokenAddress: normalizeText(settlementTerms?.tokenAddress),
        proofMode: normalizeText(settlementTerms?.proofMode)
      },
      active: template?.active !== false,
      status: normalizeText(template?.status),
      validFrom: normalizeText(template?.validFrom),
      validUntil: normalizeText(template?.validUntil),
      updatedAt: normalizeText(template?.updatedAt)
    };
  }

  function normalizeVerdict(value = '') {
    const raw = normalizeLower(value);
    if (['positive', 'negative', 'neutral'].includes(raw)) return raw;
    if (raw === 'completed') return 'positive';
    if (raw === 'rejected') return 'negative';
    return raw || 'neutral';
  }

  function normalizeValidationStatus(value = '') {
    const raw = normalizeLower(value);
    if (['completed', 'rejected', 'expired', 'submitted', 'pending'].includes(raw)) return raw;
    return raw || 'pending';
  }

  function normalizeTrustPublicationStatus(value = '') {
    const raw = normalizeLower(value);
    if (['pending', 'published', 'failed', 'superseded'].includes(raw)) return raw;
    return raw || 'pending';
  }

  function buildTrustReputationView(signal = {}) {
    return {
      schemaVersion: 'v1',
      kind: 'trust-reputation-signal',
      signalId: normalizeText(signal?.signalId),
      agentId: normalizeText(signal?.agentId),
      sourceLane: normalizeText(signal?.sourceLane),
      sourceKind: normalizeText(signal?.sourceKind),
      referenceId: normalizeText(signal?.referenceId),
      traceId: normalizeText(signal?.traceId),
      paymentRequestId: normalizeText(signal?.paymentRequestId),
      verdict: normalizeVerdict(signal?.verdict),
      score: Number(signal?.score || 0),
      summary: normalizeText(signal?.summary),
      evaluator: normalizeText(signal?.evaluator),
      createdAt: normalizeText(signal?.createdAt)
    };
  }

  function buildTrustValidationView(record = {}) {
    return {
      schemaVersion: 'v1',
      kind: 'trust-validation-record',
      validationId: normalizeText(record?.validationId),
      agentId: normalizeText(record?.agentId),
      referenceType: normalizeText(record?.referenceType),
      referenceId: normalizeText(record?.referenceId),
      traceId: normalizeText(record?.traceId),
      status: normalizeValidationStatus(record?.status),
      evaluator: normalizeText(record?.evaluator),
      evaluatorRef: normalizeText(record?.evaluatorRef),
      responseRef: normalizeText(record?.responseRef),
      responseHash: normalizeText(record?.responseHash),
      summary: normalizeText(record?.summary),
      createdAt: normalizeText(record?.createdAt)
    };
  }

  function buildTrustPublicationView(record = {}) {
    return {
      schemaVersion: 'v1',
      kind: 'trust-publication',
      publicationId: normalizeText(record?.publicationId),
      publicationType: normalizeLower(record?.publicationType),
      sourceId: normalizeText(record?.sourceId),
      agentId: normalizeText(record?.agentId),
      targetRegistry: normalizeText(record?.targetRegistry),
      status: normalizeTrustPublicationStatus(record?.status),
      referenceId: normalizeText(record?.referenceId),
      traceId: normalizeText(record?.traceId),
      publicationRef: normalizeText(record?.publicationRef),
      anchorTxHash: normalizeText(record?.anchorTxHash),
      summary: normalizeText(record?.summary),
      createdAt: normalizeText(record?.createdAt),
      updatedAt: normalizeText(record?.updatedAt)
    };
  }

  function buildTrustReputationAggregate(items = []) {
    const scoreSum = items.reduce((sum, item) => sum + Number(item?.score || 0), 0);
    const count = items.length;
    const positive = items.filter((item) => item?.verdict === 'positive').length;
    const negative = items.filter((item) => item?.verdict === 'negative').length;
    const neutral = items.filter((item) => item?.verdict === 'neutral').length;
    return {
      count,
      positive,
      negative,
      neutral,
      scoreSum: Number(scoreSum.toFixed(4)),
      averageScore: count > 0 ? Number((scoreSum / count).toFixed(4)) : 0
    };
  }

  function ensureTrustPublicationPolicy(input = {}, { reputationSignals = [], validationRecords = [] } = {}) {
    const publicationType = normalizeLower(input?.publicationType);
    const sourceId = normalizeText(input?.sourceId);
    const agentId = normalizeText(input?.agentId);
    if (!['reputation', 'validation'].includes(publicationType)) {
      throw new Error('publicationType must be one of reputation or validation');
    }
    if (!sourceId) {
      throw new Error('sourceId is required');
    }
    if (!agentId) {
      throw new Error('agentId is required');
    }
    if (publicationType === 'reputation') {
      const source = reputationSignals.find((item) => normalizeText(item?.signalId) === sourceId) || null;
      if (!source) {
        throw new Error(`reputation signal ${sourceId} does not exist`);
      }
      if (normalizeText(source?.agentId) !== agentId) {
        throw new Error(`reputation signal ${sourceId} is not owned by agent ${agentId}`);
      }
      return {
        publicationType,
        source,
        targetRegistry: normalizeText(input?.targetRegistry || 'erc8004-reputation')
      };
    }
    const source = validationRecords.find((item) => normalizeText(item?.validationId) === sourceId) || null;
    if (!source) {
      throw new Error(`validation record ${sourceId} does not exist`);
    }
    if (normalizeText(source?.agentId) !== agentId) {
      throw new Error(`validation record ${sourceId} is not owned by agent ${agentId}`);
    }
    return {
      publicationType,
      source,
      targetRegistry: normalizeText(input?.targetRegistry || 'erc8004-validation')
    };
  }

  async function callInternalTemplatePublish(body = {}) {
    return callInternalTemplateRoute({
      method: 'POST',
      pathname: '/api/templates/publish',
      body
    });
  }

  async function callInternalTemplateRoute({ method = 'GET', pathname = '', body = null } = {}) {
    const headers = {
      Accept: 'application/json'
    };
    const internalApiKey = normalizeText(getInternalAgentApiKey?.());
    if (internalApiKey) {
      headers['x-api-key'] = internalApiKey;
    }
    const init = {
      method,
      headers
    };
    if (body && ['POST', 'PUT', 'PATCH'].includes(String(method || 'GET').toUpperCase())) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, init);
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload?.ok !== false,
      status: response.status,
      payload
    };
  }
  return {
    PORT,
    createTraceId,
    ensureNetworkAgents,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    issueIdentityChallenge,
    publishTrustPublicationOnChain,
    readIdentityProfile,
    readReputationSignals,
    readTrustPublications,
    readValidationRecords,
    appendTrustPublication,
    verifyIdentityChallengeResponse,
    getInternalAgentApiKey,
    requireRole,
    sanitizeNetworkAgentRecord,
    sanitizeServiceRecord,
    writeNetworkAgents,
    writePublishedServices,
    normalizeText,
    normalizeLower,
    capabilityAliases,
    capabilityMatchesValue,
    serviceMatchesCapability,
    resolveServiceCapabilityId,
    templateMatchesCapability,
    normalizeBool,
    clampLimit,
    buildErrorShape,
    sendV1Success,
    sendV1Error,
    isAllowedProviderRole,
    isAllowedProviderMode,
    providerHasIdentityLink,
    providerIsIdentityVerified,
    normalizeApprovalStatus,
    buildProviderTrustAggregate,
    buildProviderVerificationView,
    buildProviderOnboardingView,
    providerIsDiscoverable,
    buildProviderDiscoveryScore,
    matchesSearch,
    ensureProviderOnboardingPolicy,
    ensureCapabilityPublishPolicy,
    ensureTemplatePublishPolicy,
    buildProviderView,
    buildCapabilityView,
    buildCapabilitySelectionScore,
    inferServiceLaneType,
    findRecommendedTemplate,
    buildSelectionRationale,
    buildSelectionView,
    buildTemplateView,
    normalizeVerdict,
    normalizeValidationStatus,
    normalizeTrustPublicationStatus,
    buildTrustReputationView,
    buildTrustValidationView,
    buildTrustPublicationView,
    buildTrustReputationAggregate,
    ensureTrustPublicationPolicy,
    callInternalTemplatePublish,
    callInternalTemplateRoute
  };
}
