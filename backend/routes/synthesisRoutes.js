/**
 * Synthesis Hackathon Routes
 *
 * Controls the autonomous request loop and exposes agent_log.json export.
 */

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

export function registerSynthesisRoutes(app, deps = {}) {
  const {
    synthesisLoop,
    readJobs,
    readWorkflows,
    readServiceInvocations,
    readReputationSignals,
    PACKAGE_VERSION
  } = deps;

  if (!synthesisLoop) return;

  // --- Loop Control ---

  app.post('/api/synthesis/loop/start', (req, res) => {
    const intervalMs = Number(req.body?.intervalMs) || undefined;
    const result = synthesisLoop.start(intervalMs);
    return res.json({ ok: true, ...result, status: synthesisLoop.getStatus() });
  });

  app.post('/api/synthesis/loop/stop', (req, res) => {
    const result = synthesisLoop.stop();
    return res.json({ ok: true, ...result, status: synthesisLoop.getStatus() });
  });

  app.post('/api/synthesis/loop/trigger', async (req, res) => {
    try {
      const result = await synthesisLoop.triggerNow();
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'trigger_failed',
        reason: normalizeText(error?.message || '')
      });
    }
  });

  app.get('/api/synthesis/loop/status', (req, res) => {
    return res.json({ ok: true, status: synthesisLoop.getStatus() });
  });

  // --- Agent Log Export ---

  app.get('/api/synthesis/agent-log', (req, res) => {
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const synthesisJobs = jobs.filter(
      (job) => normalizeText(job?.templateId || '') === 'erc8183-hourly-news-brief'
    );

    const runs = synthesisJobs.map((job) => {
      const steps = [];
      if (job.createdAt) {
        steps.push({
          step: 'create',
          timestamp: job.createdAt,
          details: {
            jobId: job.jobId,
            capability: job.capability,
            budget: job.budget,
            window: job?.input?.window || ''
          }
        });
      }
      if (job.fundedAt) {
        steps.push({
          step: 'fund',
          timestamp: job.fundedAt,
          details: {
            escrowAmount: job.escrowAmount,
            txHash: job.fundingAnchorTxHash || job.createAnchorTxHash || ''
          }
        });
      }
      if (job.acceptedAt) {
        steps.push({
          step: 'accept',
          timestamp: job.acceptedAt,
          details: {
            executor: job.executor,
            executorRuntime: job.executorRuntimeAddress || ''
          }
        });
      }
      if (job.submittedAt) {
        steps.push({
          step: 'submit',
          timestamp: job.submittedAt,
          details: {
            resultRef: job.resultRef,
            resultHash: job.resultHash,
            summary: job.summary,
            newsTraceId: job?.delivery?.newsTraceId || '',
            paymentTxHash: job?.delivery?.paymentTxHash || job.paymentTxHash || '',
            trustTxHash: job?.delivery?.trustTxHash || '',
            evidenceRef: job.evidenceRef || ''
          }
        });
      }
      if (job.validatedAt) {
        steps.push({
          step: 'validate',
          timestamp: job.validatedAt,
          details: {
            approved: job.state === 'completed',
            reason: job.rejectionReason || job.summary || ''
          }
        });
      }
      if (job.completedAt) {
        steps.push({
          step: 'complete',
          timestamp: job.completedAt,
          details: {
            state: job.state,
            outcomeAnchorTxHash: job.outcomeAnchorTxHash || ''
          }
        });
      }

      const onChainTransactions = [];
      if (job.createAnchorTxHash) {
        onChainTransactions.push({ type: 'job_create_anchor', tx_hash: job.createAnchorTxHash });
      }
      if (job.fundingAnchorTxHash) {
        onChainTransactions.push({ type: 'escrow_fund', tx_hash: job.fundingAnchorTxHash });
      }
      if (job.submitAnchorTxHash) {
        onChainTransactions.push({ type: 'job_submit_anchor', tx_hash: job.submitAnchorTxHash });
      }
      if (job.outcomeAnchorTxHash) {
        onChainTransactions.push({ type: 'job_outcome_anchor', tx_hash: job.outcomeAnchorTxHash });
      }

      return {
        run_id: normalizeText(job.traceId || job.jobId),
        job_id: normalizeText(job.jobId),
        state: normalizeText(job.state),
        steps,
        on_chain_transactions: onChainTransactions,
        budget: {
          allocated: normalizeText(job.budget || job.escrowAmount || ''),
          token: normalizeText(job.escrowTokenAddress || '')
        },
        created_at: job.createdAt || '',
        completed_at: job.completedAt || ''
      };
    });

    const loopStatus = synthesisLoop.getStatus();

    return res.json({
      agent_id: 'synthesis-request-agent',
      version: normalizeText(PACKAGE_VERSION || '1.0.0'),
      operator_wallet: normalizeText(process.env.KITE_AA_WALLET || ''),
      identity_registry: '0x60BF18964FCB1B2E987732B0477E51594B3659B1',
      chain: {
        name: 'KiteAI Testnet',
        chain_id: 2368
      },
      loop: {
        enabled: loopStatus.enabled,
        interval_ms: loopStatus.intervalMs,
        total_runs: loopStatus.totalRuns,
        jobs_created: loopStatus.jobsCreated,
        jobs_completed: loopStatus.jobsCompleted,
        jobs_rejected: loopStatus.jobsRejected
      },
      runs,
      exported_at: new Date().toISOString()
    });
  });
}
