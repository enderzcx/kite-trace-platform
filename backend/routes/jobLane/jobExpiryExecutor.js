function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeEscrowState(value = '') {
  const raw = normalizeText(value).toLowerCase();
  if (['not_configured', 'funded', 'accepted', 'submitted', 'completed', 'rejected', 'expired'].includes(raw)) {
    return raw;
  }
  return '';
}

function normalizeJobState(value = '') {
  const raw = normalizeText(value).toLowerCase();
  if (
    [
      'created',
      'funding_pending',
      'pending_approval',
      'funded',
      'accepted',
      'submitted',
      'completed',
      'rejected',
      'approval_rejected',
      'approval_expired',
      'expired',
      'failed'
    ].includes(raw)
  ) {
    return raw;
  }
  return 'created';
}

function hasEscrowBacking(job = {}) {
  return Boolean(normalizeText(job?.escrowAmount) && normalizeText(job?.executor) && normalizeText(job?.validator));
}

function isTerminalJobState(state = '') {
  return ['completed', 'rejected', 'approval_rejected', 'approval_expired', 'expired', 'failed'].includes(
    normalizeJobState(state)
  );
}

function applyEscrowOutcome(job = {}, result = {}, fallbackState = '') {
  if (!result?.configured) {
    return {
      ...job,
      escrowState: normalizeEscrowState(fallbackState || job?.escrowState || 'not_configured')
    };
  }
  return {
    ...job,
    escrowState: normalizeEscrowState(result?.escrowState || fallbackState || job?.escrowState),
    escrowAddress: normalizeText(result?.contractAddress || job?.escrowAddress),
    escrowTokenAddress: normalizeText(result?.tokenAddress || job?.escrowTokenAddress)
  };
}

async function anchorJobLifecycle(job = {}, anchorType = '', overrides = {}, deps = {}) {
  const { publishJobLifecycleAnchorOnChain } = deps;
  if (typeof publishJobLifecycleAnchorOnChain !== 'function') {
    return {
      configured: false,
      published: false
    };
  }
  return publishJobLifecycleAnchorOnChain({
    anchorType,
    jobId: normalizeText(job?.jobId),
    traceId: normalizeText(overrides?.traceId || job?.traceId),
    providerId: normalizeText(overrides?.providerId || job?.provider),
    capability: normalizeText(overrides?.capability || job?.capability),
    status: normalizeText(overrides?.status || job?.state),
    paymentRequestId: normalizeText(overrides?.paymentRequestId || job?.paymentRequestId),
    paymentTxHash: normalizeText(overrides?.paymentTxHash || job?.paymentTxHash),
    validationId: normalizeText(overrides?.validationId || job?.validationId),
    referenceId: normalizeText(overrides?.referenceId || ''),
    detailsURI: normalizeText(overrides?.detailsURI || `/api/jobs/${encodeURIComponent(normalizeText(job?.jobId))}`)
  });
}

export function createJobExpiryExecutor(deps = {}) {
  const { readJobs, upsertJobRecord, expireEscrowJob, publishJobLifecycleAnchorOnChain, anchorRegistryRequired } = deps;

  return async function executeJobExpiry(jobOrJobId = {}, options = {}) {
    const jobId = typeof jobOrJobId === 'string' ? normalizeText(jobOrJobId) : normalizeText(jobOrJobId?.jobId);
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const sourceJob =
      (typeof jobOrJobId === 'object' && jobOrJobId
        ? jobOrJobId
        : Array.isArray(jobs)
          ? jobs.find((item) => normalizeText(item?.jobId) === jobId)
          : null) || null;

    if (!sourceJob) {
      return {
        ok: false,
        statusCode: 404,
        error: 'job_not_found',
        reason: 'job not found'
      };
    }
    if (isTerminalJobState(sourceJob.state)) {
      return {
        ok: false,
        statusCode: 409,
        error: 'job_not_expirable',
        reason: `job state ${normalizeJobState(sourceJob.state)} cannot be expired`
      };
    }
    const expiryMs = Date.parse(normalizeText(sourceJob.expiresAt));
    if (!Number.isFinite(expiryMs) || expiryMs > Date.now()) {
      return {
        ok: false,
        statusCode: 409,
        error: 'job_deadline_not_reached',
        reason: 'job deadline has not been reached yet'
      };
    }

    const now = new Date().toISOString();
    let next = {
      ...sourceJob,
      state: 'expired',
      summary: normalizeText(options?.summary || sourceJob.summary || 'Job expired.'),
      expiredAt: now,
      updatedAt: now
    };

    try {
      if (hasEscrowBacking(sourceJob) && ['funded', 'accepted', 'submitted'].includes(normalizeJobState(sourceJob.state))) {
        const escrow = await expireEscrowJob?.({
          jobId: normalizeText(next.jobId)
        });
        next = applyEscrowOutcome(
          {
            ...next,
            escrowValidateTxHash: normalizeText(escrow?.txHash)
          },
          escrow,
          'expired'
        );
      }
      const anchor = await anchorJobLifecycle(
        next,
        'expired',
        {
          referenceId: normalizeText(next?.jobId)
        },
        { publishJobLifecycleAnchorOnChain }
      );
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (anchorRegistryRequired) {
        return {
          ok: false,
          statusCode: 500,
          error: 'job_expire_anchor_failed',
          reason: normalizeText(error?.message || 'job expire anchor failed')
        };
      }
      return {
        ok: false,
        statusCode: 500,
        error: 'job_expire_failed',
        reason: normalizeText(error?.message || 'job expire failed')
      };
    }

    upsertJobRecord?.(next);
    return {
      ok: true,
      statusCode: 200,
      job: next
    };
  };
}
