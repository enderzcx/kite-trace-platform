export function createNetworkCommandExecutionHelpers(deps = {}) {
  const {
    PORT,
    appendNetworkCommandEvent,
    extractNetworkCommandRefs,
    fetchImpl,
    getInternalAgentApiKey,
    normalizeNetworkCommandPayload,
    normalizeNetworkCommandType,
    summarizeNetworkCommandExecution,
    upsertNetworkCommandRecord
  } = deps;

  async function invokeNetworkCommandTarget({ type = 'router-info-technical', payload = {} } = {}) {
    const commandType = normalizeNetworkCommandType(type);
    let endpoint = '/api/network/demo/router-info-technical/run';
    if (commandType !== 'router-info-technical') {
      endpoint = '/api/network/demo/router-info-technical/run';
    }
    const internalApiKey = getInternalAgentApiKey();
    const headers = { 'Content-Type': 'application/json' };
    if (internalApiKey) headers['x-api-key'] = internalApiKey;
    const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
    if (typeof doFetch !== 'function') {
      const error = new Error('fetch_unavailable');
      error.statusCode = 500;
      error.errorCode = 'fetch_unavailable';
      error.endpoint = endpoint;
      throw error;
    }
    const resp = await doFetch(`http://127.0.0.1:${PORT}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body?.ok) {
      const reason = String(body?.reason || body?.error || `HTTP ${resp.status}`).trim();
      const error = new Error(reason || 'network command invoke failed');
      error.statusCode = resp.status;
      error.errorCode = String(body?.error || 'network_command_invoke_failed').trim();
      error.responseBody = body;
      error.endpoint = endpoint;
      throw error;
    }
    return {
      endpoint,
      statusCode: resp.status,
      body
    };
  }

  async function executeNetworkCommand(command = {}, options = {}) {
    const existing = command && typeof command === 'object' ? command : null;
    if (!existing?.commandId) {
      return {
        ok: false,
        statusCode: 400,
        error: 'command_not_found',
        reason: 'command not found'
      };
    }
    if (String(existing.status || '').trim().toLowerCase() === 'running') {
      return {
        ok: false,
        statusCode: 409,
        error: 'command_running',
        reason: 'command is already running'
      };
    }

    const now = new Date().toISOString();
    const payloadOverride = normalizeNetworkCommandPayload(options.payload || null);
    const basePayload = normalizeNetworkCommandPayload(existing.payload);
    const payload = { ...basePayload, ...payloadOverride };
    const preRunEvents = appendNetworkCommandEvent(existing, 'running', 'dispatch', `run ${existing.type} command`, {
      source: String(options.source || 'api').trim(),
      payloadOverride: Object.keys(payloadOverride).length > 0
    });
    const running = upsertNetworkCommandRecord({
      ...existing,
      payload,
      status: 'running',
      error: '',
      result: null,
      attempts: Number(existing.attempts || 0) + 1,
      startedAt: now,
      finishedAt: '',
      lastRunAt: now,
      updatedAt: now,
      events: preRunEvents
    });

    try {
      const invokeResult = await invokeNetworkCommandTarget({
        type: running.type,
        payload
      });
      const executionSummary = summarizeNetworkCommandExecution(invokeResult.body);
      const refs = extractNetworkCommandRefs(invokeResult.body, running);
      const doneEvents = appendNetworkCommandEvent(
        running,
        'done',
        'complete',
        executionSummary.partialFailure
          ? `command partial done via ${invokeResult.endpoint}`
          : `command done via ${invokeResult.endpoint}`,
        {
          statusCode: invokeResult.statusCode,
          resultReceived: executionSummary.resultReceived,
          partialFailure: executionSummary.partialFailure,
          successCount: executionSummary.successCount,
          failureCount: executionSummary.failureCount
        }
      );
      const finishedAt = new Date().toISOString();
      const done = upsertNetworkCommandRecord({
        ...running,
        status: 'done',
        result: invokeResult.body,
        error: '',
        traceId: refs.traceId,
        requestId: refs.requestId,
        taskId: refs.taskId,
        finishedAt,
        updatedAt: finishedAt,
        events: doneEvents
      });
      return {
        ok: true,
        statusCode: 200,
        command: done,
        execution: {
          endpoint: invokeResult.endpoint,
          statusCode: invokeResult.statusCode,
          resultReceived: executionSummary.resultReceived,
          partialFailure: executionSummary.partialFailure,
          successCount: executionSummary.successCount,
          failureCount: executionSummary.failureCount
        }
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const reason = String(error?.message || 'network command failed').trim();
      const failEvents = appendNetworkCommandEvent(running, 'failed', 'complete', reason, {
        endpoint: String(error?.endpoint || '').trim(),
        statusCode: Number(error?.statusCode || 0) || null
      });
      const failResult =
        error?.responseBody && typeof error.responseBody === 'object' && !Array.isArray(error.responseBody)
          ? {
              endpoint: String(error?.endpoint || '').trim(),
              statusCode: Number(error?.statusCode || 0) || 0,
              response: error.responseBody
            }
          : null;
      const failed = upsertNetworkCommandRecord({
        ...running,
        status: 'failed',
        error: reason,
        result: failResult,
        finishedAt: failedAt,
        updatedAt: failedAt,
        events: failEvents
      });
      return {
        ok: false,
        statusCode: Number(error?.statusCode || 502),
        error: String(error?.errorCode || 'network_command_failed').trim(),
        reason,
        command: failed
      };
    }
  }

  return {
    executeNetworkCommand
  };
}
