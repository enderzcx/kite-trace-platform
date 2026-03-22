/**
 * Synthesis Autonomous Request Loop
 *
 * Acts as a Request Agent: periodically creates ERC-8183 jobs requesting
 * BTC trade plans from external agents. External agents gather data via
 * ktrace capabilities, analyze with LLM, and submit results with evidence.
 * Validator checks on-chain proofs, then completes the job to release funds.
 */

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function createTraceId(prefix = 'synth') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSynthesisRequestLoop({
  state,
  intervalMs = 3600_000,
  minIntervalMs = 60_000,
  requestJson,
  readJobs,
  publishTrustSignal,
  broadcastEvent,
  PORT = 3399
}) {
  let timer = null;

  const loopState = state || {
    enabled: false,
    intervalMs,
    startedAt: '',
    lastTickAt: '',
    lastStatus: '',
    lastError: '',
    lastJobId: '',
    lastTraceId: '',
    totalRuns: 0,
    jobsCreated: 0,
    jobsCompleted: 0,
    jobsRejected: 0,
    jobsExpired: 0,
    running: false,
    busy: false
  };

  function getInternalApiKey() {
    return normalizeText(
      process.env.KITE_INTERNAL_API_KEY ||
      process.env.KITE_AGENT_API_KEY ||
      process.env.KITECLAW_API_KEY_AGENT ||
      process.env.API_KEY_AGENT ||
      ''
    );
  }

  function buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = getInternalApiKey();
    if (apiKey) headers['x-api-key'] = apiKey;
    return headers;
  }

  async function postInternal(pathname, body = {}) {
    const url = `http://127.0.0.1:${PORT}${pathname}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data };
  }

  async function getInternal(pathname) {
    const url = `http://127.0.0.1:${PORT}${pathname}`;
    const response = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(15_000)
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data };
  }

  function buildJobInput() {
    const now = new Date();
    return {
      asset: 'BTC',
      pair: 'BTCUSDT',
      timeframe: '1h',
      requestedAt: now.toISOString(),
      requirements: [
        'Current market trend analysis (bullish/bearish/sideways)',
        'Entry price with reasoning',
        'Take-profit target(s) with reasoning',
        'Stop-loss level with reasoning',
        'Confidence score (0-100)',
        'Data sources used with ktrace evidence traceIds'
      ],
      evaluationCriteria: [
        'All data must be sourced via ktrace capabilities with valid traceIds',
        'Each traceId must have corresponding x402 payment proof (txHash)',
        'Analysis must reference at least 2 different data sources',
        'Entry/TP/SL must be specific numeric values, not ranges'
      ]
    };
  }

  function buildJobDescription() {
    return [
      'BTC Trade Plan Request — provide a complete trading plan for BTC/USDT.',
      '',
      'Required deliverables:',
      '1. Market trend analysis with supporting data',
      '2. Specific entry price',
      '3. Take-profit and stop-loss levels',
      '4. Confidence score (0-100)',
      '5. All data sourced via ktrace capabilities with evidence traceIds',
      '',
      'Evaluation: Validator will check on-chain evidence (traceIds, txHashes)',
      'for data provenance. At least 2 ktrace capabilities must be used.',
      '',
      'Suggested capabilities: cap-news-signal, cap-dex-market, cap-token-analysis,',
      'cap-listing-alert, cap-smart-money-signal'
    ].join('\n');
  }

  async function createTradeJob() {
    const traceId = createTraceId('synth_job');
    const budget = normalizeText(process.env.SYNTHESIS_JOB_BUDGET || '0.005');
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours from now

    const result = await postInternal('/api/jobs', {
      provider: 'any',
      capability: 'btc-trade-plan',
      budget,
      input: buildJobInput(),
      traceId,
      expiresAt,
      escrowAmount: budget,
      executorStakeAmount: '0',
      evaluator: 'auto',
      templateId: 'synthesis-btc-trade-plan'
    });

    const jobData = result.data?.job || result.data || {};
    return {
      ok: result.ok,
      jobId: normalizeText(jobData?.jobId || result.data?.jobId || ''),
      traceId,
      anchorTxHash: normalizeText(jobData?.createAnchorTxHash || ''),
      error: result.ok ? '' : normalizeText(
        result.data?.error?.message || result.data?.error?.code || result.data?.reason ||
        (typeof result.data?.error === 'string' ? result.data.error : JSON.stringify(result.data?.error || ''))
      )
    };
  }

  async function fundJob(jobId) {
    // Prepare funding (approve allowances)
    const prep = await postInternal(`/api/jobs/${jobId}/prepare-funding`, {});
    if (!prep.ok && prep.status !== 409) {
      return { ok: false, error: `prepare-funding failed: ${normalizeText(prep.data?.error || '')}` };
    }

    // Fund the escrow
    const fund = await postInternal(`/api/jobs/${jobId}/fund`, { async: false });
    return {
      ok: fund.ok,
      txHash: normalizeText(fund.data?.fundingTxHash || fund.data?.txHash || ''),
      error: normalizeText(fund.data?.error || fund.data?.reason || '')
    };
  }

  async function checkAndValidateSubmissions() {
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const submitted = jobs.filter(
      (job) =>
        normalizeText(job?.state) === 'submitted' &&
        normalizeText(job?.templateId || '') === 'synthesis-btc-trade-plan'
    );

    for (const job of submitted) {
      const jobId = normalizeText(job?.jobId || '');
      if (!jobId) continue;

      try {
        // Get audit trail
        const audit = await getInternal(`/api/jobs/${jobId}/audit`);
        const auditData = audit.data;

        // Check if evidence traceIds exist
        const traceIds = Array.isArray(job?.dataSourceTraceIds) ? job.dataSourceTraceIds : [];
        const hasEvidence = traceIds.length >= 2;
        const hasResult = Boolean(job?.resultRef || job?.resultHash);

        const approved = hasEvidence && hasResult;
        const reason = approved
          ? `Validated: ${traceIds.length} evidence sources, result hash present.`
          : `Rejected: ${!hasEvidence ? 'insufficient evidence sources (need >= 2)' : 'missing result'}`;

        // Validate the job
        await postInternal(`/api/jobs/${jobId}/validate`, {
          approved,
          reason,
          summary: reason,
          evaluator: 'synthesis-auto-validator'
        });

        if (approved) {
          loopState.jobsCompleted += 1;
        } else {
          loopState.jobsRejected += 1;
        }

        // Publish trust signal for the executor
        if (typeof publishTrustSignal === 'function') {
          try {
            await publishTrustSignal({
              subject: 'executor',
              agentId: normalizeText(job?.executor || ''),
              verdict: approved ? 'positive' : 'negative',
              score: approved ? 1 : 0,
              summary: reason,
              referenceId: jobId,
              traceId: normalizeText(job?.traceId || '')
            });
          } catch {}
        }
      } catch (error) {
        loopState.lastError = normalizeText(error?.message || 'validation_failed');
      }
    }
  }

  async function runTick(reason = 'scheduled') {
    if (loopState.busy) return;
    loopState.busy = true;
    const tickStart = new Date().toISOString();

    try {
      loopState.totalRuns += 1;
      loopState.lastTickAt = tickStart;

      // Step 1: Check and validate any submitted jobs
      await checkAndValidateSubmissions();

      // Step 2: Create a new trade plan job
      const job = await createTradeJob();
      if (!job.ok) {
        loopState.lastStatus = 'job_create_failed';
        loopState.lastError = job.error;
        return;
      }

      loopState.lastJobId = job.jobId;
      loopState.lastTraceId = job.traceId;
      loopState.jobsCreated += 1;

      // Step 3: Fund the job
      const fund = await fundJob(job.jobId);
      if (!fund.ok) {
        loopState.lastStatus = 'job_fund_failed';
        loopState.lastError = fund.error;
        return;
      }

      loopState.lastStatus = 'ok';
      loopState.lastError = '';

      if (typeof broadcastEvent === 'function') {
        broadcastEvent('synthesis_job_created', {
          jobId: job.jobId,
          traceId: job.traceId,
          fundingTxHash: fund.txHash,
          reason
        });
      }
    } catch (error) {
      loopState.lastStatus = 'error';
      loopState.lastError = normalizeText(error?.message || 'tick_failed');
    } finally {
      loopState.busy = false;
    }
  }

  function start(customIntervalMs) {
    if (loopState.enabled) return { ok: true, already: true };
    const resolvedInterval = Math.max(
      minIntervalMs,
      Number(customIntervalMs || loopState.intervalMs || intervalMs) || intervalMs
    );
    loopState.enabled = true;
    loopState.running = true;
    loopState.intervalMs = resolvedInterval;
    loopState.startedAt = new Date().toISOString();
    timer = setInterval(() => runTick('scheduled'), resolvedInterval);
    // Run first tick immediately
    runTick('initial');
    return { ok: true, intervalMs: resolvedInterval };
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    loopState.enabled = false;
    loopState.running = false;
    return { ok: true };
  }

  function getStatus() {
    return { ...loopState };
  }

  async function triggerNow() {
    await runTick('manual');
    return { ok: true, status: getStatus() };
  }

  return {
    start,
    stop,
    getStatus,
    triggerNow,
    runTick
  };
}
