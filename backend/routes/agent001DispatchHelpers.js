export function createAgent001DispatchHelpers(deps = {}) {
  const {
    buildLocalTechnicalRecoveryDispatch,
    createTraceId,
    findNetworkAgentById,
    getReaderRuntime,
    getRiskRuntime,
    getRouterRuntime,
    isLegacyBtcOnlyTechnicalFailure,
    normalizeAddress,
    waitMs
  } = deps;

  function isRecoverableDispatchFailure(error = '', reason = '') {
    const text = `${String(error || '').trim()} ${String(reason || '').trim()}`.toLowerCase();
    if (!text) return false;
    return (
      text.includes('stream') ||
      text.includes('timeout') ||
      text.includes('not_running') ||
      text.includes('unhandled') ||
      text.includes('connection') ||
      text.includes('router_send_failed')
    );
  }

  function getRouterRuntimeSafe() {
    return typeof getRouterRuntime === 'function' ? getRouterRuntime() : null;
  }

  function getRiskRuntimeSafe() {
    return typeof getRiskRuntime === 'function' ? getRiskRuntime() : null;
  }

  function getReaderRuntimeSafe() {
    return typeof getReaderRuntime === 'function' ? getReaderRuntime() : null;
  }

  function resolveDispatchRuntimeByAgentId(agentId = '') {
    const id = String(agentId || '').trim().toLowerCase();
    if (id === 'risk-agent' || id === 'technical-agent') {
      return { runtime: getRiskRuntimeSafe(), label: 'risk' };
    }
    if (id === 'reader-agent' || id === 'message-agent') {
      return { runtime: getReaderRuntimeSafe(), label: 'reader' };
    }
    return { runtime: null, label: '' };
  }

  function resolveAgentAddressByIdForRouter(agentId = '') {
    const id = String(agentId || '').trim().toLowerCase();
    const mapped = findNetworkAgentById(id);
    return normalizeAddress(mapped?.aaAddress || '');
  }

  async function waitRouterTaskResultByTaskId(taskId = '', waitMsLimit = 25_000) {
    const safeTaskId = String(taskId || '').trim();
    if (!safeTaskId) return null;
    const deadline = Date.now() + Math.max(1_000, Math.min(Number(waitMsLimit || 25_000), 60_000));
    const routerRuntime = getRouterRuntimeSafe();
    if (!routerRuntime || typeof routerRuntime.listEvents !== 'function') return null;
    while (Date.now() <= deadline) {
      const hits = routerRuntime.listEvents({
        runtimeName: 'router-runtime',
        direction: 'inbound',
        kind: 'task-result',
        taskId: safeTaskId
      });
      if (Array.isArray(hits) && hits.length > 0) {
        return hits[0];
      }
      await waitMs(280);
    }
    return null;
  }

  async function healRuntime(runtime, label = '') {
    if (!runtime || typeof runtime.getStatus !== 'function') {
      return { label, attempted: false, recovered: false, reason: 'runtime_not_found' };
    }
    const before = runtime.getStatus();
    if (before && before.running) {
      return {
        label,
        attempted: false,
        recovered: true,
        before,
        after: before
      };
    }
    let stopError = '';
    try {
      await runtime.stop();
    } catch (error) {
      stopError = String(error?.message || 'stop_failed').trim();
    }
    let after = null;
    let startError = '';
    try {
      after = await runtime.start();
    } catch (error) {
      startError = String(error?.message || 'start_failed').trim();
    }
    const latest = runtime.getStatus();
    return {
      label,
      attempted: true,
      recovered: Boolean(latest?.running),
      before,
      after: after || latest,
      reason: startError || stopError || ''
    };
  }

  async function ensureDispatchRuntimesHealthy(toAgentId = '') {
    const actions = [];
    const routerRuntime = getRouterRuntimeSafe();
    actions.push(await healRuntime(routerRuntime, 'router'));
    const target = resolveDispatchRuntimeByAgentId(toAgentId);
    if (target?.runtime) {
      actions.push(await healRuntime(target.runtime, target.label || 'target'));
    }
    return {
      actions,
      router: routerRuntime?.getStatus ? routerRuntime.getStatus() : null,
      target: target?.runtime && typeof target.runtime.getStatus === 'function' ? target.runtime.getStatus() : null
    };
  }

  async function runAgent001DispatchTask({
    toAgentId = '',
    capability = '',
    input = {},
    paymentIntent = null,
    waitMsLimit = 25_000
  } = {}) {
    const resolvedToAgentId = String(toAgentId || '').trim().toLowerCase();
    const preflight = await ensureDispatchRuntimesHealthy(resolvedToAgentId);
    const recovery = Array.isArray(preflight?.actions) ? [...preflight.actions] : [];
    const routerRuntime = getRouterRuntimeSafe();
    const routerStatus = routerRuntime?.getStatus ? routerRuntime.getStatus() : null;
    if (!routerStatus?.running) {
      return {
        ok: false,
        error: 'router_not_running',
        reason: routerStatus?.lastError || 'router runtime is not running',
        recovery
      };
    }
    const targetRuntime = resolveDispatchRuntimeByAgentId(resolvedToAgentId);
    const targetStatus =
      targetRuntime?.runtime && typeof targetRuntime.runtime.getStatus === 'function'
        ? targetRuntime.runtime.getStatus()
        : null;
    if (targetStatus && !targetStatus.running) {
      return {
        ok: false,
        error: 'target_not_running',
        reason: targetStatus.lastError || `${targetRuntime.label || resolvedToAgentId} runtime is not running`,
        recovery
      };
    }
    const toAddress = resolveAgentAddressByIdForRouter(resolvedToAgentId);
    if (!toAddress) {
      return {
        ok: false,
        error: 'target_agent_address_missing',
        reason: `missing address for ${resolvedToAgentId || 'unknown'}`,
        recovery
      };
    }
    const maxAttempts = 2;
    let lastFailure = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const traceId = createTraceId('agent001_trace');
      const requestId = createTraceId('agent001_req');
      const taskId = createTraceId('agent001_task');
      const envelope = {
        kind: 'task-envelope',
        protocolVersion: 'kite-agent-task-v1',
        traceId,
        requestId,
        taskId,
        fromAgentId: 'router-agent',
        toAgentId: resolvedToAgentId,
        channel: 'dm',
        hopIndex: 1,
        mode: 'a2a',
        capability: String(capability || '').trim(),
        input: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
        paymentIntent:
          paymentIntent && typeof paymentIntent === 'object' && !Array.isArray(paymentIntent) ? paymentIntent : {},
        expectsReply: true,
        timestamp: new Date().toISOString()
      };
      const sent = await routerRuntime.sendDm({
        fromAgentId: 'router-agent',
        toAgentId: resolvedToAgentId,
        toAddress,
        channel: 'dm',
        hopIndex: 1,
        envelope,
        traceId,
        requestId,
        taskId
      });
      if (!sent?.ok) {
        lastFailure = {
          ok: false,
          error: sent?.error || 'router_send_failed',
          reason: sent?.reason || 'router send failed',
          sent,
          task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
          attempt
        };
      } else {
        const resultEvent = await waitRouterTaskResultByTaskId(taskId, waitMsLimit);
        const taskResult =
          resultEvent?.parsed && typeof resultEvent.parsed === 'object' && !Array.isArray(resultEvent.parsed)
            ? resultEvent.parsed
            : null;
        if (taskResult) {
          if (isLegacyBtcOnlyTechnicalFailure(taskResult, capability, input)) {
            try {
              return await buildLocalTechnicalRecoveryDispatch({
                capability,
                input,
                sent,
                task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
                attempt,
                recovery
              });
            } catch {
              // local recovery failed, keep original failure result
            }
          }
          return {
            ok: true,
            sent,
            task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
            resultEvent,
            taskResult,
            attempt,
            recovery
          };
        }
        lastFailure = {
          ok: false,
          error: 'task_result_timeout',
          reason: `no task-result within ${Math.max(1_000, Math.min(Number(waitMsLimit || 25_000), 60_000))}ms`,
          sent,
          task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
          attempt
        };
      }

      if (attempt < maxAttempts && isRecoverableDispatchFailure(lastFailure?.error, lastFailure?.reason)) {
        const extra = await ensureDispatchRuntimesHealthy(resolvedToAgentId);
        if (Array.isArray(extra?.actions)) recovery.push(...extra.actions);
        await waitMs(650);
        continue;
      }
      break;
    }

    return {
      ...(lastFailure || { ok: false, error: 'dispatch_failed', reason: 'unknown dispatch failure' }),
      recovery
    };
  }

  return {
    isRecoverableDispatchFailure,
    runAgent001DispatchTask
  };
}
