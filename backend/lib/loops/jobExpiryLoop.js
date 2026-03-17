function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeJobState(value = '') {
  return normalizeText(value).toLowerCase();
}

function hasEscrowBacking(job = {}) {
  return Boolean(normalizeText(job?.escrowAmount) && normalizeText(job?.executor) && normalizeText(job?.validator));
}

function isDeadlineReached(job = {}) {
  const expiresAt = normalizeText(job?.expiresAt);
  if (!expiresAt) return false;
  const expiryMs = Date.parse(expiresAt);
  return Number.isFinite(expiryMs) && expiryMs <= Date.now();
}

export function createAutoJobExpiryLoop({
  state = null,
  intervalMs,
  port,
  getInternalAgentApiKey,
  readJobs,
  fetchImpl
} = {}) {
  const autoJobExpiryState =
    state && typeof state === 'object'
      ? state
      : {
          enabled: false,
          intervalMs,
          startedAt: '',
          lastTickAt: '',
          lastStatus: '',
          lastError: '',
          lastExpiredJobId: '',
          lastExpiredTraceId: '',
          scannedCount: 0,
          expiredCount: 0,
          failedCount: 0
        };

  const runtimeFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  let autoJobExpiryTimer = null;
  let autoJobExpiryBusy = false;

  function getAutoJobExpiryStatus() {
    return {
      ...autoJobExpiryState,
      running: Boolean(autoJobExpiryTimer),
      busy: autoJobExpiryBusy
    };
  }

  function listOverdueEscrowJobs() {
    const rows = typeof readJobs === 'function' ? readJobs() : [];
    return (Array.isArray(rows) ? rows : []).filter((job) => {
      const state = normalizeJobState(job?.state);
      if (!['funded', 'accepted', 'submitted'].includes(state)) return false;
      if (!hasEscrowBacking(job)) return false;
      return isDeadlineReached(job);
    });
  }

  async function expireJob(job = {}) {
    const normalizedJobId = normalizeText(job?.jobId);
    if (!normalizedJobId) return { ok: false, error: 'job_id_required' };
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    const apiKey = normalizeText(getInternalAgentApiKey?.());
    if (apiKey) headers['x-api-key'] = apiKey;
    const response = await runtimeFetch(
      `http://127.0.0.1:${String(port || '').trim() || '3001'}/api/jobs/${encodeURIComponent(normalizedJobId)}/expire`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          summary: 'Job expired by auto job expiry watcher.'
        })
      }
    );
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload?.ok !== false,
      status: response.status,
      payload
    };
  }

  async function runAutoJobExpiryTick(reason = 'timer') {
    if (autoJobExpiryBusy) return;
    autoJobExpiryBusy = true;
    autoJobExpiryState.lastTickAt = new Date().toISOString();
    autoJobExpiryState.lastStatus = 'running';
    autoJobExpiryState.lastError = '';
    autoJobExpiryState.lastExpiredJobId = '';
    autoJobExpiryState.lastExpiredTraceId = '';

    try {
      const overdueJobs = listOverdueEscrowJobs();
      autoJobExpiryState.scannedCount += overdueJobs.length;

      let expiredThisRun = 0;
      for (const job of overdueJobs) {
        const result = await expireJob(job);
        if (result?.ok) {
          expiredThisRun += 1;
          autoJobExpiryState.expiredCount += 1;
          autoJobExpiryState.lastExpiredJobId = normalizeText(job?.jobId);
          autoJobExpiryState.lastExpiredTraceId = normalizeText(job?.traceId);
          continue;
        }
        const errorCode = normalizeText(result?.payload?.error);
        if (['job_not_expirable', 'job_deadline_not_reached'].includes(errorCode)) {
          continue;
        }
        autoJobExpiryState.failedCount += 1;
        autoJobExpiryState.lastError = normalizeText(errorCode || result?.payload?.reason || 'auto_job_expiry_failed');
      }

      autoJobExpiryState.lastStatus = expiredThisRun > 0 ? 'expired' : 'idle';
    } catch (error) {
      autoJobExpiryState.failedCount += 1;
      autoJobExpiryState.lastStatus = 'failed';
      autoJobExpiryState.lastError = normalizeText(error?.message || 'auto_job_expiry_failed');
    } finally {
      autoJobExpiryBusy = false;
      if (reason === 'startup' || reason === 'manual') {
        console.log(
          `[auto-job-expiry] tick ${autoJobExpiryState.lastStatus} expiredJob=${autoJobExpiryState.lastExpiredJobId || '-'}`
        );
      }
    }
  }

  function stopAutoJobExpiryLoop() {
    if (autoJobExpiryTimer) {
      clearInterval(autoJobExpiryTimer);
      autoJobExpiryTimer = null;
    }
    autoJobExpiryState.enabled = false;
  }

  function startAutoJobExpiryLoop(options = {}) {
    const nextIntervalMs = Math.max(5_000, Number(options.intervalMs || autoJobExpiryState.intervalMs || 30_000));
    autoJobExpiryState.intervalMs = nextIntervalMs;
    autoJobExpiryState.enabled = true;
    autoJobExpiryState.startedAt = new Date().toISOString();
    autoJobExpiryState.lastError = '';
    autoJobExpiryState.lastStatus = '';

    if (autoJobExpiryTimer) clearInterval(autoJobExpiryTimer);
    autoJobExpiryTimer = setInterval(() => {
      runAutoJobExpiryTick('timer').catch(() => {});
    }, nextIntervalMs);

    if (options.immediate !== false) {
      runAutoJobExpiryTick(options.reason || 'manual').catch(() => {});
    }
  }

  return {
    autoJobExpiryState,
    getAutoJobExpiryStatus,
    runAutoJobExpiryTick,
    startAutoJobExpiryLoop,
    stopAutoJobExpiryLoop
  };
}
