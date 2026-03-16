import { createPlatformV1Shared } from './platformV1Shared.js';

export function registerTrustV1Routes(app, deps) {
  const {
    createTraceId,
    publishTrustPublicationOnChain,
    readReputationSignals,
    readTrustPublications,
    readValidationRecords,
    appendTrustPublication,
    requireRole,
    normalizeText,
    normalizeLower,
    clampLimit,
    sendV1Success,
    sendV1Error,
    normalizeValidationStatus,
    normalizeTrustPublicationStatus,
    buildTrustReputationView,
    buildTrustValidationView,
    buildTrustPublicationView,
    buildTrustReputationAggregate,
    ensureTrustPublicationPolicy
  } = createPlatformV1Shared(deps);

  app.get('/api/v1/trust/reputation', requireRole('viewer'), (req, res) => {
    const agentId = normalizeText(req.query.agentId);
    const lane = normalizeLower(req.query.lane);
    const referenceId = normalizeText(req.query.referenceId);
    const limit = clampLimit(req.query.limit, 50, 1, 300);
    const items = (Array.isArray(readReputationSignals?.()) ? readReputationSignals() : [])
      .filter((item) => {
        if (agentId && normalizeText(item?.agentId) !== agentId) return false;
        if (lane && normalizeLower(item?.sourceLane) !== lane) return false;
        if (referenceId && normalizeText(item?.referenceId) !== referenceId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildTrustReputationView(item));
    return sendV1Success(res, req, {
      aggregate: buildTrustReputationAggregate(items),
      total: items.length,
      items
    });
  });

  app.get('/api/v1/trust/validations', requireRole('viewer'), (req, res) => {
    const agentId = normalizeText(req.query.agentId);
    const referenceId = normalizeText(req.query.referenceId);
    const status = normalizeLower(req.query.status);
    const limit = clampLimit(req.query.limit, 50, 1, 300);
    const items = (Array.isArray(readValidationRecords?.()) ? readValidationRecords() : [])
      .filter((item) => {
        if (agentId && normalizeText(item?.agentId) !== agentId) return false;
        if (referenceId && normalizeText(item?.referenceId) !== referenceId) return false;
        if (status && normalizeValidationStatus(item?.status) !== status) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildTrustValidationView(item));
    return sendV1Success(res, req, {
      total: items.length,
      items
    });
  });

  app.get('/api/v1/trust/publications', requireRole('viewer'), (req, res) => {
    const agentId = normalizeText(req.query.agentId);
    const publicationType = normalizeLower(req.query.type);
    const status = normalizeTrustPublicationStatus(req.query.status);
    const limit = clampLimit(req.query.limit, 50, 1, 300);
    const items = (Array.isArray(readTrustPublications?.()) ? readTrustPublications() : [])
      .filter((item) => {
        if (agentId && normalizeText(item?.agentId) !== agentId) return false;
        if (publicationType && normalizeLower(item?.publicationType) !== publicationType) return false;
        if (normalizeText(req.query.status) && normalizeTrustPublicationStatus(item?.status) !== status) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildTrustPublicationView(item));
    return sendV1Success(res, req, {
      total: items.length,
      items
    });
  });

  app.post('/api/v1/trust/publications', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {};
      const publication = ensureTrustPublicationPolicy(body, {
        reputationSignals: Array.isArray(readReputationSignals?.()) ? readReputationSignals() : [],
        validationRecords: Array.isArray(readValidationRecords?.()) ? readValidationRecords() : []
      });
      const now = new Date().toISOString();
      const source = publication.source || {};
      const draftRecord = {
        publicationId: normalizeText(body.publicationId || createTraceId('pub')),
        publicationType: publication.publicationType,
        sourceId: normalizeText(body.sourceId),
        agentId: normalizeText(body.agentId),
        targetRegistry: publication.targetRegistry,
        status: normalizeTrustPublicationStatus(body.status || 'pending'),
        referenceId: normalizeText(body.referenceId || source?.referenceId || ''),
        traceId: normalizeText(body.traceId || source?.traceId || ''),
        publicationRef: normalizeText(body.publicationRef || ''),
        anchorTxHash: normalizeText(body.anchorTxHash || ''),
        summary:
          normalizeText(body.summary) ||
          `Prepared ${publication.publicationType} publication for ${normalizeText(body.agentId)}.`,
        createdAt: normalizeText(body.createdAt || now),
        updatedAt: now
      };
      const anchorResult =
        typeof publishTrustPublicationOnChain === 'function'
          ? await publishTrustPublicationOnChain(draftRecord)
          : { configured: false, published: false };
      const finalRecord = appendTrustPublication?.({
        ...draftRecord,
        targetRegistry: normalizeText(anchorResult?.registryAddress || draftRecord.targetRegistry),
        status: anchorResult?.published ? 'published' : draftRecord.status,
        publicationRef: normalizeText(anchorResult?.anchorId || draftRecord.publicationRef),
        anchorTxHash: normalizeText(anchorResult?.anchorTxHash || draftRecord.anchorTxHash),
        updatedAt: new Date().toISOString()
      });
      return sendV1Success(res, req, {
        publication: buildTrustPublicationView(finalRecord || {}),
        anchor: {
          configured: Boolean(anchorResult?.configured),
          published: Boolean(anchorResult?.published),
          anchorId: normalizeText(anchorResult?.anchorId),
          anchorTxHash: normalizeText(anchorResult?.anchorTxHash),
          payloadHash: normalizeText(anchorResult?.payloadHash)
        }
      });
    } catch (error) {
      return sendV1Error(
        res,
        req,
        400,
        'invalid_trust_publication',
        error?.message || 'invalid trust publication payload'
      );
    }
  });
}
