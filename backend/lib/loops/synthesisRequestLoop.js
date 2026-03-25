import { validateNewsBriefJobDelivery } from '../deliverySchemas/index.js';

/**
 * Synthesis Autonomous Request Loop
 *
 * Acts as the built-in ERC8183 requester/validator pair for the standard
 * hourly news brief example. It posts one open cap-news-signal job per hour,
 * waits for an external agent to claim + accept + submit, then validates the
 * submitted delivery against the recorded paid capability call.
 */

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function clampNumber(value, fallback, min = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, numeric);
}

function createTraceId(prefix = 'synth') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const HOURLY_NEWS_TEMPLATE_ID = 'erc8183-hourly-news-brief';
const HOURLY_NEWS_CAPABILITY = 'cap-news-signal';
const ACTIVE_NEWS_JOB_STATES = new Set(['created', 'funding_pending', 'pending_approval', 'funded', 'accepted', 'submitted']);

export function createSynthesisRequestLoop({
  state,
  intervalMs = 3600_000,
  minIntervalMs = 60_000,
  requestJson,
  readJobs,
  readServiceInvocations,
  readTrustPublications,
  readWorkflows,
  readX402Requests,
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

  function resolveJobExpiryMs() {
    const expiryHours = clampNumber(process.env.SYNTHESIS_JOB_EXPIRY_HOURS || 6, 6, 1);
    return expiryHours * 60 * 60 * 1000;
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

  function buildJobInput() {
    const now = new Date();
    return {
      task: 'Summarize the important BTC news from the last hour.',
      topic: 'important crypto news',
      sourceCapability: HOURLY_NEWS_CAPABILITY,
      window: 'last_1h',
      coin: 'BTC',
      signal: '',
      minScore: 50,
      limit: 5,
      requestedAt: now.toISOString(),
      requirements: [
        'Call cap_news_signal exactly once',
        'Produce a concise summary of the important news returned',
        'Include source URLs for the returned news items',
        'Include the payment tx hash for the cap_news_signal call',
        'Include the trust publication tx hash for the cap_news_signal call'
      ],
      evaluationCriteria: [
        'Delivery must match ktrace-news-brief-v1',
        'newsTraceId must resolve to a paid cap-news-signal invocation',
        'paymentTxHash must match the invocation payment tx',
        'trustTxHash must match the trust publication anchor tx',
        'Every submitted sourceUrl must exist in the cap-news-signal result'
      ]
    };
  }

  function buildJobDescription() {
    return [
      'Hourly News Brief Request: summarize the important BTC-related news from the last hour.',
      '',
      'Required deliverables:',
      '1. Call cap_news_signal exactly once',
      '2. Return ktrace-news-brief-v1 delivery JSON',
      '3. Include a short summary plus headline/sourceUrl items',
      '4. Include newsTraceId, paymentTxHash, trustTxHash',
      '',
      'Validation: the built-in validator will verify the paid cap-news-signal',
      'trace, payment tx hash, trust publication tx hash, and submitted source URLs.'
    ].join('\n');
  }

  function findActiveHourlyNewsJob() {
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    return (
      jobs.find(
        (job) =>
          normalizeText(job?.templateId || '') === HOURLY_NEWS_TEMPLATE_ID &&
          ACTIVE_NEWS_JOB_STATES.has(normalizeText(job?.state || '').toLowerCase())
      ) || null
    );
  }

  async function createNewsJob() {
    const traceId = createTraceId('synth_job');
    const budget = normalizeText(process.env.SYNTHESIS_JOB_BUDGET || '0.005');
    const expiresAt = new Date(Date.now() + resolveJobExpiryMs()).toISOString();
    const requesterAa = normalizeText(process.env.ERC8183_REQUESTER_AA_ADDRESS || '');

    const result = await postInternal('/api/jobs', {
      provider: 'any',
      capability: HOURLY_NEWS_CAPABILITY,
      budget,
      input: buildJobInput(),
      traceId,
      expiresAt,
      ...(requesterAa ? { payer: requesterAa, requester: requesterAa } : {}),
      executor: '0x0000000000000000000000000000000000000000',
      escrowAmount: budget,
      executorStakeAmount: '0',
      evaluator: 'auto',
      summary: buildJobDescription(),
      templateId: HOURLY_NEWS_TEMPLATE_ID
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
    const prep = await postInternal(`/api/jobs/${jobId}/prepare-funding`, {});
    if (!prep.ok && prep.status !== 409) {
      const prepErr = normalizeText(prep.data?.error?.message || prep.data?.error?.code || prep.data?.reason || String(prep.data?.error || ''));
      const isClientPayReq = /runtime_not_found|session_not_configured/.test(prepErr) ||
        /runtime_not_found|session_not_configured/.test(prep.data?.error?.code || '');
      return { ok: false, clientPaymentRequired: isClientPayReq, error: `prepare-funding failed: ${prepErr}` };
    }

    const fund = await postInternal(`/api/jobs/${jobId}/fund`, { async: false });
    const fundError = fund.data?.error;
    return {
      ok: fund.ok,
      txHash: normalizeText(fund.data?.fundingTxHash || fund.data?.txHash || ''),
      error: fund.ok ? '' : normalizeText(
        (typeof fundError === 'object' ? (fundError?.message || fundError?.code || JSON.stringify(fundError)) : fundError) ||
        fund.data?.reason || 'fund_failed'
      )
    };
  }

  async function checkAndValidateSubmissions() {
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const submitted = jobs.filter(
      (job) =>
        normalizeText(job?.state) === 'submitted' &&
        normalizeText(job?.templateId || '') === HOURLY_NEWS_TEMPLATE_ID
    );

    for (const job of submitted) {
      const jobId = normalizeText(job?.jobId || '');
      if (!jobId) continue;

      try {
        const deliveryValidation = validateNewsBriefJobDelivery({
          job,
          readServiceInvocations,
          readTrustPublications,
          readWorkflows,
          readX402Requests
        });
        const approved = Boolean(deliveryValidation?.ok);
        const reason = normalizeText(
          deliveryValidation?.summary ||
          (approved ? 'Validated hourly news brief delivery.' : 'Rejected hourly news brief delivery.')
        );

        await postInternal(`/api/jobs/${jobId}/validate`, {
          approved,
          reason,
          summary: reason,
          evaluator: 'erc8183-validator'
        });

        if (approved) {
          loopState.jobsCompleted += 1;
        } else {
          loopState.jobsRejected += 1;
        }

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

      await checkAndValidateSubmissions();

      const activeJob = findActiveHourlyNewsJob();
      if (activeJob) {
        loopState.lastJobId = normalizeText(activeJob?.jobId || '');
        loopState.lastTraceId = normalizeText(activeJob?.traceId || '');
        loopState.lastStatus = 'skipped_active_job';
        loopState.lastError = '';
        return;
      }

      const job = await createNewsJob();
      if (!job.ok) {
        loopState.lastStatus = 'job_create_failed';
        loopState.lastError = job.error;
        return;
      }

      loopState.lastJobId = job.jobId;
      loopState.lastTraceId = job.traceId;
      loopState.jobsCreated += 1;

      const fund = await fundJob(job.jobId);
      if (!fund.ok) {
        if (fund.clientPaymentRequired) {
          // Self-custodial job — server cannot sign UserOp. Client proxy will fund via submit-client-payment.
          loopState.lastStatus = 'awaiting_client_payment';
          loopState.lastError = '';
        } else {
          loopState.lastStatus = 'job_fund_failed';
          loopState.lastError = fund.error;
        }
        return;
      }

      loopState.lastStatus = 'ok';
      loopState.lastError = '';

      if (typeof broadcastEvent === 'function') {
        broadcastEvent('synthesis_job_created', {
          jobId: job.jobId,
          traceId: job.traceId,
          fundingTxHash: fund.txHash,
          reason,
          templateId: HOURLY_NEWS_TEMPLATE_ID,
          capability: HOURLY_NEWS_CAPABILITY
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
