import { parseAgentIdList } from '../env.js';

export function createAutoXmtpNetworkLoop({
  state = null,
  intervalMs,
  sourceAgentId,
  targetAgentIds,
  capability,
  findNetworkAgentById,
  xmtpRuntime,
  createTraceId
} = {}) {
  const autoXmtpNetworkState =
    state && typeof state === 'object'
      ? state
      : {
          enabled: false,
          intervalMs,
          sourceAgentId,
          targetAgentIds: parseAgentIdList(targetAgentIds),
          capability: capability || 'network-heartbeat',
          startedAt: '',
          lastTickAt: '',
          lastTraceId: '',
          lastRequestId: '',
          lastTaskId: '',
          lastTargetAgentId: '',
          lastStatus: '',
          lastError: '',
          sentCount: 0,
          failedCount: 0,
          cursor: 0
        };

  let autoXmtpNetworkTimer = null;
  let autoXmtpNetworkBusy = false;

  function getAutoXmtpNetworkStatus() {
    return {
      ...autoXmtpNetworkState,
      running: Boolean(autoXmtpNetworkTimer),
      busy: autoXmtpNetworkBusy
    };
  }

  function resolveAutoXmtpTargetAgentId() {
    const ids = Array.isArray(autoXmtpNetworkState.targetAgentIds) ? autoXmtpNetworkState.targetAgentIds : [];
    if (!ids.length) return '';
    const total = ids.length;
    const current = Math.max(0, Number(autoXmtpNetworkState.cursor || 0));
    for (let i = 0; i < total; i += 1) {
      const idx = (current + i) % total;
      const candidate = String(ids[idx] || '').trim().toLowerCase();
      if (!candidate) continue;
      const row = findNetworkAgentById(candidate);
      if (row?.active === false) continue;
      autoXmtpNetworkState.cursor = (idx + 1) % total;
      return candidate;
    }
    return '';
  }

  async function runAutoXmtpNetworkTick(reason = 'timer') {
    if (autoXmtpNetworkBusy) return;
    autoXmtpNetworkBusy = true;
    autoXmtpNetworkState.lastTickAt = new Date().toISOString();
    autoXmtpNetworkState.lastStatus = 'running';
    autoXmtpNetworkState.lastError = '';

    try {
      if (!xmtpRuntime.getStatus().running) {
        await xmtpRuntime.start();
      }
      if (!xmtpRuntime.getStatus().running) {
        throw new Error(xmtpRuntime.getStatus().lastError || 'xmtp_runtime_not_running');
      }

      const toAgentId = resolveAutoXmtpTargetAgentId();
      if (!toAgentId) throw new Error('no_active_target_agent');

      const traceId = createTraceId('xmtp_auto_trace');
      const requestId = createTraceId('xmtp_auto_req');
      const taskId = createTraceId('xmtp_auto_task');
      const envelope = {
        kind: 'task-envelope',
        protocolVersion: 'kite-agent-task-v1',
        traceId,
        requestId,
        taskId,
        fromAgentId: String(autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase(),
        toAgentId,
        channel: 'dm',
        hopIndex: 1,
        mode: 'a2a',
        capability: String(autoXmtpNetworkState.capability || 'network-heartbeat').trim(),
        input: {
          source: 'xmtp-auto-loop',
          reason,
          fromAgentId: String(autoXmtpNetworkState.sourceAgentId || '').trim(),
          toAgentId,
          tickAt: new Date().toISOString()
        },
        paymentIntent: {},
        expectsReply: true,
        timestamp: new Date().toISOString()
      };

      const sent = await xmtpRuntime.sendDm({
        toAgentId,
        envelope,
        traceId,
        requestId,
        taskId,
        fromAgentId: String(autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase(),
        channel: 'dm',
        hopIndex: 1
      });
      if (!sent?.ok) {
        throw new Error(String(sent?.reason || sent?.error || 'xmtp_auto_send_failed').trim());
      }

      autoXmtpNetworkState.lastTraceId = traceId;
      autoXmtpNetworkState.lastRequestId = requestId;
      autoXmtpNetworkState.lastTaskId = taskId;
      autoXmtpNetworkState.lastTargetAgentId = toAgentId;
      autoXmtpNetworkState.lastStatus = 'success';
      autoXmtpNetworkState.sentCount += 1;
    } catch (error) {
      autoXmtpNetworkState.lastStatus = 'failed';
      autoXmtpNetworkState.lastError = String(error?.message || 'auto_xmtp_tick_failed').trim();
      autoXmtpNetworkState.failedCount += 1;
    } finally {
      autoXmtpNetworkBusy = false;
      if (reason === 'startup' || reason === 'manual') {
        console.log(
          `[auto-xmtp] tick ${autoXmtpNetworkState.lastStatus} target=${autoXmtpNetworkState.lastTargetAgentId || '-'} task=${autoXmtpNetworkState.lastTaskId || '-'}`
        );
      }
    }
  }

  function stopAutoXmtpNetworkLoop() {
    if (autoXmtpNetworkTimer) {
      clearInterval(autoXmtpNetworkTimer);
      autoXmtpNetworkTimer = null;
    }
    autoXmtpNetworkState.enabled = false;
  }

  function startAutoXmtpNetworkLoop(options = {}) {
    const nextIntervalMs = Math.max(15_000, Number(options.intervalMs || autoXmtpNetworkState.intervalMs || 60_000));
    const nextTargetAgentIds = parseAgentIdList(options.targetAgentIds || autoXmtpNetworkState.targetAgentIds.join(','));
    autoXmtpNetworkState.intervalMs = nextIntervalMs;
    autoXmtpNetworkState.sourceAgentId = String(options.sourceAgentId || autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase();
    autoXmtpNetworkState.targetAgentIds = nextTargetAgentIds;
    autoXmtpNetworkState.capability = String(options.capability || autoXmtpNetworkState.capability || 'network-heartbeat').trim();
    autoXmtpNetworkState.enabled = true;
    autoXmtpNetworkState.startedAt = new Date().toISOString();
    autoXmtpNetworkState.lastError = '';
    autoXmtpNetworkState.lastStatus = '';

    if (autoXmtpNetworkTimer) clearInterval(autoXmtpNetworkTimer);
    autoXmtpNetworkTimer = setInterval(() => {
      runAutoXmtpNetworkTick('timer').catch(() => {});
    }, nextIntervalMs);

    if (options.immediate !== false) {
      runAutoXmtpNetworkTick(options.reason || 'manual').catch(() => {});
    }
  }

  return {
    autoXmtpNetworkState,
    getAutoXmtpNetworkStatus,
    runAutoXmtpNetworkTick,
    startAutoXmtpNetworkLoop,
    stopAutoXmtpNetworkLoop
  };
}
