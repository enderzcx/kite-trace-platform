export function isAgent001TaskSuccessful(dispatchResult = null) {
  if (!dispatchResult || !dispatchResult.ok) return false;
  const status = String(dispatchResult?.taskResult?.status || 'done').trim().toLowerCase();
  return !['failed', 'error', 'rejected'].includes(status);
}

export function createCatalogHelpers({
  ensureServiceCatalog,
  readTemplates,
  writeTemplates,
  createTemplateId
}) {
  function buildTemplateRecordFromService(service = {}) {
    const now = new Date().toISOString();
    const serviceId = String(service?.id || '').trim();
    const capabilityId = String(service?.action || '').trim();
    return {
      templateId: serviceId ? `tpl_${serviceId}` : createTemplateId(),
      templateVersion: 1,
      name: String(service?.name || capabilityId || 'Template').trim(),
      description: String(service?.description || '').trim(),
      providerAgentId: String(service?.providerAgentId || '').trim(),
      capabilityId,
      serviceId,
      pricingTerms: {
        amount: String(service?.price || '').trim(),
        currency: String(service?.tokenAddress || '').trim() ? 'token' : '',
        tokenAddress: String(service?.tokenAddress || '').trim()
      },
      settlementTerms: {
        paymentMode: 'x402',
        recipient: String(service?.recipient || '').trim(),
        tokenAddress: String(service?.tokenAddress || '').trim(),
        proofMode: 'on-chain'
      },
      fulfillmentMode: 'direct',
      validFrom: now,
      validUntil: '',
      status: service?.active === false ? 'inactive' : 'active',
      active: service?.active !== false,
      tags: Array.isArray(service?.tags) ? service.tags : [],
      exampleInput:
        service?.exampleInput && typeof service.exampleInput === 'object' && !Array.isArray(service.exampleInput)
          ? service.exampleInput
          : {},
      sourceServiceUpdatedAt: String(service?.updatedAt || '').trim(),
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system'
    };
  }

  function ensureTemplateCatalog() {
    const services = ensureServiceCatalog();
    const validServiceIds = new Set(
      services
        .map((service) => String(service?.id || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const rows = readTemplates();
    if (Array.isArray(rows) && rows.length > 0) {
      const filtered = rows.filter((item) => {
        const serviceId = String(item?.serviceId || '').trim().toLowerCase();
        return validServiceIds.has(serviceId);
      });
      if (filtered.length !== rows.length) {
        writeTemplates(filtered);
      }
      return filtered;
    }
    const seeded = services.map((service) => buildTemplateRecordFromService(service));
    writeTemplates(seeded);
    return seeded;
  }

  return {
    buildTemplateRecordFromService,
    ensureTemplateCatalog
  };
}

export function createRecordMutationHelpers({
  readJobs,
  readPurchases,
  readReputationSignals,
  readServiceInvocations,
  readTrustPublications,
  readValidationRecords,
  writeJobs,
  writePurchases,
  writeReputationSignals,
  writeServiceInvocations,
  writeTrustPublications,
  writeValidationRecords
}) {
  function upsertServiceInvocation(invocation = {}) {
    const rows = readServiceInvocations();
    const invocationId = String(invocation.invocationId || '').trim();
    if (!invocationId) return;
    const idx = rows.findIndex((item) => String(item?.invocationId || '').trim() === invocationId);
    if (idx >= 0) rows[idx] = invocation;
    else rows.unshift(invocation);
    writeServiceInvocations(rows);
  }

  function upsertJobRecord(job = {}) {
    const rows = readJobs();
    const jobId = String(job.jobId || '').trim();
    if (!jobId) return;
    const idx = rows.findIndex((item) => String(item?.jobId || '').trim() === jobId);
    if (idx >= 0) rows[idx] = job;
    else rows.unshift(job);
    writeJobs(rows);
  }

  function upsertPurchaseRecord(purchase = {}) {
    const rows = readPurchases();
    const purchaseId = String(purchase.purchaseId || '').trim();
    if (!purchaseId) return;
    const idx = rows.findIndex((item) => String(item?.purchaseId || '').trim() === purchaseId);
    if (idx >= 0) rows[idx] = purchase;
    else rows.unshift(purchase);
    writePurchases(rows);
  }

  function appendReputationSignal(signal = {}) {
    const rows = readReputationSignals();
    rows.unshift(signal);
    writeReputationSignals(rows);
    return signal;
  }

  function appendValidationRecord(record = {}) {
    const rows = readValidationRecords();
    rows.unshift(record);
    writeValidationRecords(rows);
    return record;
  }

  function appendTrustPublication(record = {}) {
    const rows = readTrustPublications();
    rows.unshift(record);
    writeTrustPublications(rows);
    return record;
  }

  return {
    upsertServiceInvocation,
    upsertJobRecord,
    upsertPurchaseRecord,
    appendReputationSignal,
    appendValidationRecord,
    appendTrustPublication
  };
}
