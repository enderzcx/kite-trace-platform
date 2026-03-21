import { ethers } from 'ethers';
import { trustPublicationAnchorAbi } from '../../lib/contracts/trustPublicationAnchorAbi.js';
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
    ensureTrustPublicationPolicy,
    readIdentityProfile
  } = createPlatformV1Shared(deps);

  async function readOnchainTrustAnchors(agentId = '') {
    const registryAddress = normalizeText(process.env.ERC8004_TRUST_ANCHOR_REGISTRY || '');
    const rpcUrl = normalizeText(process.env.BACKEND_RPC_URL || '');
    if (!registryAddress || !ethers.isAddress(registryAddress) || !rpcUrl) {
      return {
        configured: false,
        registryAddress,
        anchorCount: 0,
        latestAnchorId: '',
        latestAnchorTxHash: '',
        anchors: []
      };
    }
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(registryAddress, trustPublicationAnchorAbi, provider);
      const events = await contract.queryFilter(contract.filters.TrustPublicationAnchored(), 0, 'latest');
      const anchors = events
        .map((event) => ({
          anchorId: normalizeText(event?.args?.anchorId || ''),
          agentId: normalizeText(event?.args?.agentId || ''),
          traceId: normalizeText(event?.args?.traceId || ''),
          referenceId: normalizeText(event?.args?.referenceId || ''),
          publicationType: normalizeText(event?.args?.publicationType || ''),
          txHash: normalizeText(event?.transactionHash || '')
        }))
        .filter((item) => item.agentId === normalizeText(agentId))
        .reverse();
      const latest = anchors[0] || null;
      return {
        configured: true,
        registryAddress,
        anchorCount: anchors.length,
        latestAnchorId: normalizeText(latest?.anchorId || ''),
        latestAnchorTxHash: normalizeText(latest?.txHash || ''),
        anchors: anchors.slice(0, 10)
      };
    } catch {
      return {
        configured: true,
        registryAddress,
        anchorCount: 0,
        latestAnchorId: '',
        latestAnchorTxHash: '',
        anchors: []
      };
    }
  }

  app.get('/api/v1/trust/chain-profile', async (req, res) => {
    const agentId = normalizeText(req.query.agentId);
    const identityRegistry = normalizeText(req.query.identityRegistry || req.query.registry || process.env.ERC8004_IDENTITY_REGISTRY || '');
    if (!agentId) {
      return sendV1Error(res, req, 400, 'agent_id_required', 'agentId is required.');
    }

    const reputationRows = (Array.isArray(readReputationSignals?.()) ? readReputationSignals() : [])
      .filter((item) => normalizeText(item?.agentId) === agentId)
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0));
    const publicationRows = (Array.isArray(readTrustPublications?.()) ? readTrustPublications() : [])
      .filter((item) => normalizeText(item?.agentId) === agentId)
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0));
    const validationRows = (Array.isArray(readValidationRecords?.()) ? readValidationRecords() : [])
      .filter((item) => normalizeText(item?.agentId) === agentId)
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0));

    const reputation = reputationRows.map((item) => buildTrustReputationView(item));
    const publications = publicationRows.map((item) => buildTrustPublicationView(item));
    const onchain = await readOnchainTrustAnchors(agentId);
    let identityProfile = null;
    if (typeof readIdentityProfile === 'function') {
      try {
        identityProfile = await readIdentityProfile({
          registry: identityRegistry,
          agentId
        });
      } catch {
        identityProfile = null;
      }
    }
    const aggregate = buildTrustReputationAggregate(reputation);

    return sendV1Success(res, req, {
      subject: {
        agentId,
        identityRegistry
      },
      identity: {
        tokenId: normalizeText(identityProfile?.configured?.agentId || agentId),
        ownerOf: normalizeText(identityProfile?.ownerAddress || ''),
        registry: normalizeText(identityProfile?.configured?.registry || identityRegistry),
        registryUrl:
          normalizeText(identityProfile?.configured?.registry || identityRegistry)
            ? `https://testnet.kitescan.ai/address/${encodeURIComponent(normalizeText(identityProfile?.configured?.registry || identityRegistry))}`
            : '',
        resolved: Boolean(identityProfile?.available)
      },
      reputation: {
        totalSignals: aggregate.count,
        positiveCount: aggregate.positive,
        negativeCount: aggregate.negative,
        successRate: aggregate.count > 0 ? Number((aggregate.positive / aggregate.count).toFixed(4)) : 0,
        averageScore: aggregate.averageScore,
        latestAt: normalizeText(reputation[0]?.createdAt || '')
      },
      publications: {
        total: publications.length,
        published: publications.filter((item) => normalizeTrustPublicationStatus(item?.status) === 'published').length,
        failed: publications.filter((item) => normalizeTrustPublicationStatus(item?.status) === 'failed').length,
        pending: publications.filter((item) => normalizeTrustPublicationStatus(item?.status) === 'pending').length,
        latestAnchorTxHash: normalizeText(publications[0]?.anchorTxHash || onchain.latestAnchorTxHash || ''),
        latestPublication: publications[0] || null
      },
      onchain: {
        configured: Boolean(onchain.configured),
        anchorCount: Number(onchain.anchorCount || 0),
        latestAnchorId: normalizeText(onchain.latestAnchorId || ''),
        latestAnchorTxHash: normalizeText(onchain.latestAnchorTxHash || ''),
        registryAddress: normalizeText(onchain.registryAddress || '')
      },
      recentReputation: reputation.slice(0, 10),
      recentPublications: publications.slice(0, 10),
      validations: validationRows.slice(0, 10).map((item) => buildTrustValidationView(item))
    });
  });

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
        detailsURI: normalizeText(body.detailsURI || ''),
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
