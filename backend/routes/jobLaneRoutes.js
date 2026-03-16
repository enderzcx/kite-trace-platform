export function registerJobLaneRoutes(app, deps) {
  const {
    appendReputationSignal,
    appendValidationRecord,
    createTraceId,
    digestStableObject,
    ensureServiceCatalog,
    getInternalAgentApiKey,
    normalizeAddress,
    PORT,
    publishJobLifecycleAnchorOnChain,
    readJobs,
    readSessionRuntime,
    requireRole,
    resolveWorkflowTraceId,
    upsertJobRecord
  } = deps;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function normalizeCapability(capability = '') {
    return normalizeText(capability).toLowerCase();
  }

  function capabilityAliases(capability = '') {
    const normalized = normalizeCapability(capability);
    if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
      return ['technical-analysis-feed', 'risk-score-feed'];
    }
    if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
      return ['info-analysis-feed', 'x-reader-feed'];
    }
    if (['btc-price-feed', 'market-quote'].includes(normalized)) {
      return ['btc-price-feed', 'market-quote'];
    }
    if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
      return ['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'];
    }
    return [normalized].filter(Boolean);
  }

  function providerMatches(service = {}, provider = '') {
    const wanted = normalizeText(provider).toLowerCase();
    if (!wanted) return true;
    const candidates = [
      normalizeText(service?.providerAgentId).toLowerCase(),
      normalizeText(service?.id).toLowerCase(),
      normalizeText(service?.name).toLowerCase()
    ].filter(Boolean);
    return candidates.includes(wanted);
  }

  function selectService(provider = '', capability = '') {
    const aliases = capabilityAliases(capability);
    const services = ensureServiceCatalog();
    return (
      services.find((service) => {
        const action = normalizeText(service?.action).toLowerCase();
        return service?.active !== false && providerMatches(service, provider) && aliases.includes(action);
      }) || null
    );
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function isRetryableInvokeError(error = null) {
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
    let lastError = null;
    const maxAttempts = 3;

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
        if (attempt >= maxAttempts || !isRetryableInvokeError(error)) {
          throw error;
        }
        await sleep(250 * attempt);
      }
    }

    throw lastError || new Error('service invoke failed');
  }

  function findJob(jobId = '') {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return null;
    return readJobs().find((item) => normalizeText(item?.jobId) === normalizedJobId) || null;
  }

  function normalizeJobState(value = '') {
    const raw = normalizeText(value).toLowerCase();
    if (
      [
        'created',
        'funding_pending',
        'funded',
        'submitted',
        'completed',
        'rejected',
        'expired',
        'failed'
      ].includes(raw)
    ) {
      return raw;
    }
    return 'created';
  }

  function isTerminalJobState(state = '') {
    return ['completed', 'rejected', 'expired', 'failed'].includes(normalizeJobState(state));
  }

  function materializeJob(job = {}) {
    const safeJob = job && typeof job === 'object' ? job : {};
    const normalizedState = normalizeJobState(safeJob?.state);
    const expiresAt = normalizeText(safeJob?.expiresAt);
    if (!isTerminalJobState(normalizedState) && expiresAt) {
      const expiry = Date.parse(expiresAt);
      if (Number.isFinite(expiry) && Date.now() > expiry) {
        return {
          ...safeJob,
          state: 'expired',
          expiredAt: normalizeText(safeJob?.expiredAt || new Date(expiry).toISOString())
        };
      }
    }
    return {
      ...safeJob,
      state: normalizedState
    };
  }

  function appendJobTrustSignals(job = {}, { outcome = '', evaluator = '', evaluatorRef = '' } = {}) {
    const normalizedOutcome = normalizeJobState(outcome || job?.state);
    const providerAgentId = normalizeText(job?.provider);
    if (!providerAgentId || !['completed', 'rejected'].includes(normalizedOutcome)) {
      return {
        validationId: '',
        signalId: ''
      };
    }
    const verdict = normalizedOutcome === 'completed' ? 'positive' : 'negative';
    const score = normalizedOutcome === 'completed' ? 1 : -1;
    const createdAt = new Date().toISOString();
    const validation = appendValidationRecord?.({
      validationId: createTraceId('val'),
      agentId: providerAgentId,
      referenceType: 'job',
      referenceId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId),
      status: normalizedOutcome,
      evaluator: normalizeText(evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(evaluatorRef),
      responseRef: normalizeText(job?.resultRef || job?.submissionRef || ''),
      responseHash: normalizeText(job?.resultHash || job?.submissionHash || ''),
      summary: normalizeText(job?.summary || ''),
      createdAt
    });
    const signal = appendReputationSignal?.({
      signalId: createTraceId('rep'),
      agentId: providerAgentId,
      sourceLane: 'job',
      sourceKind: 'job',
      referenceId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId),
      paymentRequestId: normalizeText(job?.paymentRequestId),
      verdict,
      score,
      summary: normalizeText(job?.summary || ''),
      evaluator: normalizeText(evaluator || 'ktrace-job'),
      createdAt
    });
    return {
      validationId: normalizeText(validation?.validationId),
      signalId: normalizeText(signal?.signalId)
    };
  }

  function buildJobView(job = {}) {
    const materialized = materializeJob(job);
    return {
      jobId: normalizeText(materialized?.jobId),
      traceId: normalizeText(materialized?.traceId),
      state: normalizeJobState(materialized?.state),
      provider: normalizeText(materialized?.provider),
      capability: normalizeText(materialized?.capability),
      budget: normalizeText(materialized?.budget),
      payer: normalizeText(materialized?.payer),
      templateId: normalizeText(materialized?.templateId),
      serviceId: normalizeText(materialized?.serviceId),
      fundingRef: normalizeText(materialized?.fundingRef),
      paymentRequestId: normalizeText(materialized?.paymentRequestId),
      paymentTxHash: normalizeText(materialized?.paymentTxHash),
      signerMode: normalizeText(materialized?.signerMode),
      submissionRef: normalizeText(materialized?.submissionRef),
      submissionHash: normalizeText(materialized?.submissionHash),
      resultRef: normalizeText(materialized?.resultRef),
      resultHash: normalizeText(materialized?.resultHash),
      receiptRef: normalizeText(materialized?.receiptRef),
      evidenceRef: normalizeText(materialized?.evidenceRef),
      summary: normalizeText(materialized?.summary),
      error: normalizeText(materialized?.error),
      evaluator: normalizeText(materialized?.evaluator),
      evaluatorRef: normalizeText(materialized?.evaluatorRef),
      rejectionReason: normalizeText(materialized?.rejectionReason),
      validationId: normalizeText(materialized?.validationId),
      anchorRegistry: normalizeText(materialized?.anchorRegistry),
      createAnchorId: normalizeText(materialized?.createAnchorId),
      createAnchorTxHash: normalizeText(materialized?.createAnchorTxHash),
      fundingAnchorId: normalizeText(materialized?.fundingAnchorId),
      fundingAnchorTxHash: normalizeText(materialized?.fundingAnchorTxHash),
      outcomeAnchorId: normalizeText(materialized?.outcomeAnchorId),
      outcomeAnchorTxHash: normalizeText(materialized?.outcomeAnchorTxHash),
      createdAt: normalizeText(materialized?.createdAt),
      updatedAt: normalizeText(materialized?.updatedAt),
      fundedAt: normalizeText(materialized?.fundedAt),
      submittedAt: normalizeText(materialized?.submittedAt),
      completedAt: normalizeText(materialized?.completedAt),
      rejectedAt: normalizeText(materialized?.rejectedAt),
      expiredAt: normalizeText(materialized?.expiredAt),
      expiresAt: normalizeText(materialized?.expiresAt),
      input:
        materialized?.input && typeof materialized.input === 'object' && !Array.isArray(materialized.input)
          ? materialized.input
          : {}
    };
  }

  async function anchorJobLifecycle(job = {}, anchorType = '', overrides = {}) {
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

  app.post('/api/jobs', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const provider = normalizeText(body.provider);
    const capability = normalizeCapability(body.capability);
    const budget = normalizeText(body.budget);
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(body.payer || runtime?.aaWallet || runtime?.owner || '');
    const input = body?.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
    const expiresAt = normalizeText(body.expiresAt || '');
    const evaluator = normalizeText(body.evaluator || '');
    const evaluatorRef = normalizeText(body.evaluatorRef || '');
    const templateId = normalizeText(body.templateId || '');

    if (!provider) {
      return res.status(400).json({ ok: false, error: 'provider_required', reason: 'provider is required' });
    }
    if (!capability) {
      return res.status(400).json({ ok: false, error: 'capability_required', reason: 'capability is required' });
    }
    if (!budget) {
      return res.status(400).json({ ok: false, error: 'budget_required', reason: 'budget is required' });
    }

    const now = new Date().toISOString();
    const traceId = resolveWorkflowTraceId(body.traceId || createTraceId('job'));
    const job = {
      jobId: createTraceId('job'),
      traceId,
      state: 'created',
      provider,
      capability,
      budget,
      payer,
      templateId,
      serviceId: '',
      fundingRef: '',
      paymentRequestId: '',
      paymentTxHash: '',
      signerMode: '',
      submissionRef: '',
      submissionHash: '',
      receiptRef: '',
      evidenceRef: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : '',
      summary: 'Job created.',
      error: '',
      evaluator,
      evaluatorRef,
      rejectionReason: '',
      validationId: '',
      anchorRegistry: '',
      createAnchorId: '',
      createAnchorTxHash: '',
      fundingAnchorId: '',
      fundingAnchorTxHash: '',
      outcomeAnchorId: '',
      outcomeAnchorTxHash: '',
      resultRef: '',
      resultHash: '',
      createdAt: now,
      updatedAt: now,
      fundedAt: '',
      submittedAt: '',
      completedAt: '',
      rejectedAt: '',
      expiredAt: '',
      expiresAt,
      input
    };
    let next = job;
    try {
      const anchor = await anchorJobLifecycle(job, 'created', {
        referenceId: normalizeText(job?.jobId)
      });
      next = {
        ...job,
        anchorRegistry: normalizeText(anchor?.registryAddress || job.anchorRegistry),
        createAnchorId: normalizeText(anchor?.anchorId || job.createAnchorId),
        createAnchorTxHash: normalizeText(anchor?.anchorTxHash || job.createAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_create_anchor_failed',
          reason: normalizeText(error?.message || 'job create anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/fund', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (!['created', 'funding_pending'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_fundable',
        reason: `job state ${normalizeJobState(job.state)} cannot be funded`
      });
    }

    const runtime = readSessionRuntime();
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'funded',
      fundingRef: createTraceId('job_fund'),
      paymentRequestId: createTraceId('job_payment'),
      paymentTxHash: '',
      signerMode: runtime?.sessionAddress ? 'aa-session' : 'aa-wallet',
      summary: 'Job funding marked ready.',
      error: '',
      fundedAt: now,
      updatedAt: now
    };
    try {
      const anchor = await anchorJobLifecycle(next, 'funded', {
        referenceId: normalizeText(next?.fundingRef || next?.paymentRequestId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        fundingAnchorId: normalizeText(anchor?.anchorId || next.fundingAnchorId),
        fundingAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.fundingAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_fund_anchor_failed',
          reason: normalizeText(error?.message || 'job fund anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/submit', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (!['funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_submittable',
        reason: `job state ${normalizeJobState(job.state)} cannot be submitted`
      });
    }

    const input =
      req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input)
        ? req.body.input
        : job.input || {};
    const service = selectService(job.provider, job.capability);
    if (!service) {
      return res.status(404).json({
        ok: false,
        error: 'service_not_found',
        reason: `No active service matched provider=${job.provider} capability=${job.capability}.`
      });
    }

    const internalApiKey = getInternalAgentApiKey();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (internalApiKey) {
      headers['x-api-key'] = internalApiKey;
    }

    const invokeBody = {
      ...input,
      traceId: job.traceId,
      payer: job.payer
    };

    try {
      const invokeResult = await invokeServiceWithRetry(normalizeText(service.id), headers, invokeBody);
      const response = {
        ok: invokeResult.ok,
        status: invokeResult.status
      };
      const payload = invokeResult.payload || {};
      const workflow = payload?.workflow || {};
      const requestId = normalizeText(payload?.requestId || workflow?.requestId);
      const traceId = normalizeText(payload?.traceId || workflow?.traceId || job.traceId);
      const txHash = normalizeText(payload?.txHash || workflow?.txHash);
      const submissionHash =
        digestStableObject?.({
          scope: 'ktrace-job-submission-v1',
          jobId: job.jobId,
          traceId,
          input,
          requestId,
          txHash
        })?.value || '';
      const workflowState = normalizeText(payload?.state || workflow?.state).toLowerCase();
      const completed = response.ok && ['success', 'completed', 'unlocked', 'paid'].includes(workflowState);
      const now = new Date().toISOString();
      const nextBase = {
        ...job,
        traceId: traceId || job.traceId,
        provider: normalizeText(service.providerAgentId || job.provider),
        capability: normalizeText(service.action || job.capability),
        serviceId: normalizeText(service.id),
        submissionRef: `/api/jobs/${encodeURIComponent(job.jobId)}`,
        submissionHash,
        paymentRequestId: requestId || job.paymentRequestId,
        paymentTxHash: txHash || job.paymentTxHash,
        receiptRef: requestId ? `/api/receipt/${encodeURIComponent(requestId)}` : '',
        evidenceRef: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : '',
        summary:
          normalizeText(workflow?.result?.summary || payload?.receipt?.result?.summary || payload?.reason || '') ||
          (completed ? 'Job completed.' : 'Job submitted.'),
        error: response.ok ? '' : normalizeText(payload?.reason || payload?.error || 'job submit failed'),
        submittedAt: now,
        completedAt: completed ? now : job.completedAt,
        updatedAt: now,
        resultRef: normalizeText(payload?.resultRef || ''),
        resultHash:
          normalizeText(payload?.resultHash || '') ||
          (completed
            ? digestStableObject?.({
                scope: 'ktrace-job-result-v2',
                jobId: job.jobId,
                traceId,
                requestId,
                txHash,
                summary: normalizeText(workflow?.result?.summary || payload?.receipt?.result?.summary || '')
              })?.value || ''
            : ''),
        input
      };
      let next = {
        ...nextBase,
        state: completed ? 'completed' : response.ok ? 'submitted' : 'failed'
      };
      if (completed) {
        const trust = appendJobTrustSignals(next, {
          outcome: 'completed',
          evaluator: next.evaluator || 'ktrace-job',
          evaluatorRef: next.evaluatorRef
        });
        next = {
          ...next,
          validationId: trust.validationId || next.validationId
        };
      }
      if (completed) {
        try {
          const anchor = await anchorJobLifecycle(next, 'completed', {
            referenceId: normalizeText(next?.resultRef || next?.submissionRef || next?.jobId),
            validationId: normalizeText(next?.validationId)
          });
          next = {
            ...next,
            anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
            outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
            outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
          };
        } catch (error) {
          if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
            throw error;
          }
        }
      }
      upsertJobRecord(next);

      return res.status(response.status).json({
        ok: response.ok && payload?.ok !== false,
        traceId: req.traceId || '',
        job: buildJobView(next),
        workflow: workflow && typeof workflow === 'object' ? workflow : null,
        receipt: payload?.receipt || null
      });
    } catch (error) {
      const next = {
        ...job,
        state: 'failed',
        error: normalizeText(error?.message || 'job submit failed'),
        updatedAt: new Date().toISOString()
      };
      upsertJobRecord(next);
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'job_submit_failed',
        reason: next.error,
        job: buildJobView(next)
      });
    }
  });

  app.get('/api/jobs/:jobId', requireRole('viewer'), (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(job)
    });
  });

  app.get('/api/jobs', requireRole('viewer'), (req, res) => {
    const traceId = normalizeText(req.query.traceId || '');
    const jobId = normalizeText(req.query.jobId || '');
    const provider = normalizeText(req.query.provider || '').toLowerCase();
    const capability = normalizeCapability(req.query.capability || '');
    const state = normalizeText(req.query.state || '').toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));

    const rows = readJobs()
      .map((item) => materializeJob(item))
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

  app.post('/api/jobs/:jobId/complete', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (!['funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_completable',
        reason: `job state ${normalizeJobState(job.state)} cannot be completed`
      });
    }
    const body = req.body || {};
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'completed',
      summary: normalizeText(body.summary || job.summary || 'Job completed.'),
      resultRef: normalizeText(body.resultRef || job.resultRef || `/api/jobs/${encodeURIComponent(job.jobId)}`),
      resultHash:
        normalizeText(body.resultHash || job.resultHash) ||
        digestStableObject?.({
          scope: 'ktrace-job-manual-complete-v1',
          jobId: job.jobId,
          traceId: job.traceId,
          summary: normalizeText(body.summary || job.summary || 'Job completed.')
        })?.value ||
        '',
      evaluator: normalizeText(body.evaluator || job.evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(body.evaluatorRef || job.evaluatorRef || ''),
      error: '',
      completedAt: now,
      updatedAt: now
    };
    const trust = appendJobTrustSignals(next, {
      outcome: 'completed',
      evaluator: next.evaluator,
      evaluatorRef: next.evaluatorRef
    });
    next = {
      ...next,
      validationId: trust.validationId || next.validationId
    };
    try {
      const anchor = await anchorJobLifecycle(next, 'completed', {
        referenceId: normalizeText(next?.resultRef || next?.jobId),
        validationId: normalizeText(next?.validationId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_complete_anchor_failed',
          reason: normalizeText(error?.message || 'job complete anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/reject', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (!['created', 'funded', 'submitted'].includes(normalizeJobState(job.state))) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_rejectable',
        reason: `job state ${normalizeJobState(job.state)} cannot be rejected`
      });
    }
    const body = req.body || {};
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'rejected',
      rejectionReason: normalizeText(body.reason || body.summary || 'Job rejected.'),
      summary: normalizeText(body.summary || body.reason || 'Job rejected.'),
      evaluator: normalizeText(body.evaluator || job.evaluator || 'ktrace-job'),
      evaluatorRef: normalizeText(body.evaluatorRef || job.evaluatorRef || ''),
      error: '',
      rejectedAt: now,
      updatedAt: now
    };
    const trust = appendJobTrustSignals(next, {
      outcome: 'rejected',
      evaluator: next.evaluator,
      evaluatorRef: next.evaluatorRef
    });
    next = {
      ...next,
      validationId: trust.validationId || next.validationId
    };
    try {
      const anchor = await anchorJobLifecycle(next, 'rejected', {
        referenceId: normalizeText(next?.jobId),
        validationId: normalizeText(next?.validationId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_reject_anchor_failed',
          reason: normalizeText(error?.message || 'job reject anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });

  app.post('/api/jobs/:jobId/expire', requireRole('agent'), async (req, res) => {
    const job = materializeJob(findJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'job_not_found', jobId: normalizeText(req.params.jobId) });
    }
    if (isTerminalJobState(job.state)) {
      return res.status(409).json({
        ok: false,
        error: 'job_not_expirable',
        reason: `job state ${normalizeJobState(job.state)} cannot be expired`
      });
    }
    const now = new Date().toISOString();
    let next = {
      ...job,
      state: 'expired',
      summary: normalizeText(req.body?.summary || job.summary || 'Job expired.'),
      expiredAt: now,
      updatedAt: now
    };
    try {
      const anchor = await anchorJobLifecycle(next, 'expired', {
        referenceId: normalizeText(next?.jobId)
      });
      next = {
        ...next,
        anchorRegistry: normalizeText(anchor?.registryAddress || next.anchorRegistry),
        outcomeAnchorId: normalizeText(anchor?.anchorId || next.outcomeAnchorId),
        outcomeAnchorTxHash: normalizeText(anchor?.anchorTxHash || next.outcomeAnchorTxHash)
      };
    } catch (error) {
      if (process.env.ERC8183_JOB_ANCHOR_REGISTRY) {
        return res.status(500).json({
          ok: false,
          error: 'job_expire_anchor_failed',
          reason: normalizeText(error?.message || 'job expire anchor failed'),
          traceId: req.traceId || ''
        });
      }
    }
    upsertJobRecord(next);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      job: buildJobView(next)
    });
  });
}
