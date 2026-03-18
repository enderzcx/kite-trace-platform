import { sendErrorResponse } from '../../lib/errorResponse.js';
import { createRequestLogger } from '../../lib/logger.js';

const logger = createRequestLogger('job-read-route');

function sendJobReadError(req, res, status, code, message, detail = {}) {
  const log = Number(status || 0) >= 500 ? logger.error : logger.warn;
  log(code, {
    route: req?.path || '',
    method: req?.method || '',
    error: message,
    detail
  }, req);
  return sendErrorResponse(req, res, {
    status,
    code,
    message,
    detail: detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {}
  });
}

export function registerJobReadRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const { checkAnchorExistsOnChain, readJobs, readLatestAnchorIdOnChain, requireRole, ERC8183_TRACE_ANCHOR_GUARD } = deps;
  const {
    buildJobAuditView,
    buildJobView,
    buildPublicJobAuditView,
    findJob,
    findJobByTraceId,
    hydrateJobForRead,
    normalizeCapability,
    normalizeJobState,
    normalizeText
  } = helpers;

  async function buildTraceAnchorPayload(job = {}) {
    const view = buildJobView(job);
    const activeRegistryAddress = normalizeText(process.env.ERC8183_JOB_ANCHOR_REGISTRY || '');
    const localRegistryAddress = normalizeText(view?.anchorRegistry || '');
    const registryAddress = normalizeText(localRegistryAddress || activeRegistryAddress);
    const guardAddress = normalizeText(ERC8183_TRACE_ANCHOR_GUARD || process.env.ERC8183_TRACE_ANCHOR_GUARD || '');
    const localAnchorPublished = Boolean(normalizeText(view?.submitAnchorTxHash));
    let verifiedOnchain = null;
    let latestAnchorIdOnChain = '';
    let verificationMode = activeRegistryAddress ? 'v2_has_anchor' : 'registry_not_configured';

    if (activeRegistryAddress) {
      try {
        const onchainStatus = await checkAnchorExistsOnChain?.(normalizeText(view?.jobId));
        const latestStatus = await readLatestAnchorIdOnChain?.(normalizeText(view?.jobId));
        if (!onchainStatus?.configured) {
          const error = new Error('trace anchor onchain verification unavailable');
          error.code = 'trace_anchor_verification_failed';
          throw error;
        }
        latestAnchorIdOnChain = normalizeText(
          latestStatus?.latestAnchorId || onchainStatus?.latestAnchorId || ''
        );
        if (localAnchorPublished && !Boolean(onchainStatus?.hasAnchor)) {
          verifiedOnchain = null;
          verificationMode = 'legacy_v1_unknown';
        } else {
          verifiedOnchain = Boolean(onchainStatus?.hasAnchor);
          verificationMode = 'v2_has_anchor';
        }
      } catch (error) {
        const failure = new Error(normalizeText(error?.message || 'trace anchor verification failed'));
        failure.code = normalizeText(error?.code || 'trace_anchor_verification_failed');
        throw failure;
      }
    }

    return {
      ok: true,
      jobId: normalizeText(view?.jobId),
      traceId: normalizeText(view?.traceId),
      anchorRequired: Boolean(activeRegistryAddress),
      guardConfigured: Boolean(guardAddress),
      guardAddress,
      verificationMode,
      anchor: {
        published: localAnchorPublished,
        anchorId: normalizeText(view?.submitAnchorId),
        latestAnchorIdOnChain,
        txHash: normalizeText(view?.submitAnchorTxHash),
        registryAddress,
        anchoredAt:
          normalizeText(view?.submitAnchorConfirmedAt) ||
          normalizeText(view?.submittedAt) ||
          normalizeText(view?.updatedAt),
        verifiedOnchain
      }
    };
  }

  app.get('/api/jobs/:jobId', requireRole('viewer'), async (req, res) => {
    const job = await hydrateJobForRead(findJob(req.params.jobId));
    if (!job) {
      return sendJobReadError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(job)
    });
  });

  app.get('/api/jobs/:jobId/audit', requireRole('viewer'), async (req, res) => {
    const job = await hydrateJobForRead(findJob(req.params.jobId));
    if (!job) {
      return sendJobReadError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      audit: buildJobAuditView(job)
    });
  });

  app.get('/api/jobs/:jobId/trace-anchor', requireRole('viewer'), async (req, res) => {
    try {
      const job = await hydrateJobForRead(findJob(req.params.jobId));
      if (!job) {
        return sendJobReadError(req, res, 404, 'job_not_found', 'Job was not found.', {
          jobId: normalizeText(req.params.jobId)
        });
      }
      return res.json(await buildTraceAnchorPayload(job));
    } catch (error) {
      return sendJobReadError(
        req,
        res,
        500,
        normalizeText(error?.code || 'trace_anchor_verification_failed'),
        normalizeText(error?.message || 'trace anchor verification failed')
      );
    }
  });

  app.get('/api/public/jobs/:jobId/audit', async (req, res) => {
    const job = await hydrateJobForRead(findJob(req.params.jobId));
    if (!job) {
      return sendJobReadError(req, res, 404, 'job_not_found', 'Job was not found.', {
        jobId: normalizeText(req.params.jobId)
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      audit: buildPublicJobAuditView(job)
    });
  });

  app.get('/api/public/jobs/:jobId/trace-anchor', async (req, res) => {
    try {
      const job = await hydrateJobForRead(findJob(req.params.jobId));
      if (!job) {
        return sendJobReadError(req, res, 404, 'job_not_found', 'Job was not found.', {
          jobId: normalizeText(req.params.jobId)
        });
      }
      return res.json(await buildTraceAnchorPayload(job));
    } catch (error) {
      return sendJobReadError(
        req,
        res,
        500,
        normalizeText(error?.code || 'trace_anchor_verification_failed'),
        normalizeText(error?.message || 'trace anchor verification failed')
      );
    }
  });

  app.get('/api/public/jobs/by-trace/:traceId/audit', async (req, res) => {
    const job = await hydrateJobForRead(findJobByTraceId(req.params.traceId));
    if (!job) {
      return sendJobReadError(req, res, 404, 'job_not_found', 'Job was not found.', {
        traceId: normalizeText(req.params.traceId)
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      audit: buildPublicJobAuditView(job)
    });
  });

  app.get('/api/jobs', requireRole('viewer'), async (req, res) => {
    const traceId = normalizeText(req.query.traceId || '');
    const jobId = normalizeText(req.query.jobId || '');
    const provider = normalizeText(req.query.provider || '').toLowerCase();
    const capability = normalizeCapability(req.query.capability || '');
    const state = normalizeText(req.query.state || '').toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));

    const rows = (await Promise.all(readJobs().map((item) => hydrateJobForRead(item))))
      .filter((item) => {
        if (traceId && normalizeText(item?.traceId) !== traceId) return false;
        if (jobId && normalizeText(item?.jobId) !== jobId) return false;
        if (provider && normalizeText(item?.provider).toLowerCase() !== provider) return false;
        if (capability && normalizeCapability(item?.capability) !== capability) return false;
        if (state && normalizeJobState(item?.state) !== state) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildJobView(item));

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });
}
