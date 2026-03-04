export function createNetworkCommandHelpers(deps = {}) {
  const {
    createTraceId,
    normalizeAddresses,
    parseAgentIdList,
    readNetworkCommands,
    readXmtpGroups,
    writeNetworkCommands,
    writeXmtpGroups
  } = deps;

  function sanitizeXmtpGroupRecord(input = {}, existing = null) {
    const source = input && typeof input === 'object' ? input : {};
    const prev = existing && typeof existing === 'object' ? existing : {};
    const now = new Date().toISOString();
    const groupId = String(source.groupId || prev.groupId || '').trim();
    const label = String(source.label || prev.label || '').trim();
    const groupName = String(source.groupName || prev.groupName || '').trim();
    const description = String(source.description || prev.description || '').trim();
    const runtimeName = String(source.runtimeName || prev.runtimeName || 'router-runtime').trim();
    const memberAgentIds = parseAgentIdList(source.memberAgentIds || prev.memberAgentIds || []);
    const memberAddresses = normalizeAddresses(source.memberAddresses || prev.memberAddresses || []);
    const createdAt = String(prev.createdAt || source.createdAt || now).trim() || now;
    const updatedAt = String(source.updatedAt || now).trim() || now;
    const lastUsedAt = String(source.lastUsedAt || prev.lastUsedAt || updatedAt).trim() || updatedAt;
    return {
      groupId,
      label,
      groupName,
      description,
      runtimeName,
      memberAgentIds,
      memberAddresses,
      createdAt,
      updatedAt,
      lastUsedAt
    };
  }

  function upsertXmtpGroupRecord(input = {}) {
    const rows = readXmtpGroups();
    const groupId = String(input?.groupId || '').trim();
    const label = String(input?.label || '').trim().toLowerCase();
    const idx = rows.findIndex((item) => {
      if (groupId && String(item?.groupId || '').trim() === groupId) return true;
      if (label && String(item?.label || '').trim().toLowerCase() === label) return true;
      return false;
    });
    const current = idx >= 0 ? rows[idx] : null;
    const record = sanitizeXmtpGroupRecord(input, current);
    if (idx >= 0) rows[idx] = record;
    else rows.unshift(record);
    writeXmtpGroups(rows);
    return record;
  }

  function findXmtpGroupRecord({ groupId = '', label = '' } = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedLabel = String(label || '').trim().toLowerCase();
    return (
      readXmtpGroups().find((item) => {
        if (normalizedGroupId && String(item?.groupId || '').trim() === normalizedGroupId) return true;
        if (normalizedLabel && String(item?.label || '').trim().toLowerCase() === normalizedLabel) return true;
        return false;
      }) || null
    );
  }

  function normalizeNetworkCommandType(value = '') {
    const type = String(value || '').trim().toLowerCase();
    if (!type) return 'router-info-technical';
    if (type === 'router-risk-group' || type === 'router-risk') return 'router-info-technical';
    if (type === 'router-info-technical') return type;
    throw new Error('Unsupported command type. Supported: router-info-technical.');
  }

  function createCommandId() {
    return createTraceId('cmd');
  }

  function appendNetworkCommandEvent(command = {}, status = '', step = '', message = '', meta = null) {
    const events = Array.isArray(command?.events) ? [...command.events] : [];
    events.push({
      at: new Date().toISOString(),
      status: String(status || '').trim().toLowerCase(),
      step: String(step || '').trim().toLowerCase(),
      message: String(message || '').trim(),
      meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null
    });
    if (events.length > 120) {
      events.splice(0, events.length - 120);
    }
    return events;
  }

  function sanitizeNetworkCommandRecord(input = {}, existing = null) {
    const source = input && typeof input === 'object' ? input : {};
    const prev = existing && typeof existing === 'object' ? existing : {};
    const now = new Date().toISOString();
    const commandId = String(source.commandId || prev.commandId || createCommandId()).trim();
    const type = normalizeNetworkCommandType(source.type || prev.type || 'router-info-technical');
    const label = String(source.label || prev.label || type).trim();
    const statusRaw = String(source.status || prev.status || 'queued').trim().toLowerCase();
    const status = ['queued', 'running', 'done', 'failed'].includes(statusRaw) ? statusRaw : 'queued';
    const payload =
      source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
        ? source.payload
        : prev.payload && typeof prev.payload === 'object' && !Array.isArray(prev.payload)
          ? prev.payload
          : {};
    const result =
      source.result && typeof source.result === 'object' && !Array.isArray(source.result)
        ? source.result
        : prev.result && typeof prev.result === 'object' && !Array.isArray(prev.result)
          ? prev.result
          : null;
    const error = String(source.error || prev.error || '').trim();
    const attemptsRaw = Number(source.attempts ?? prev.attempts ?? 0);
    const attempts = Number.isFinite(attemptsRaw) && attemptsRaw > 0 ? Math.round(attemptsRaw) : 0;
    const createdAt = String(prev.createdAt || source.createdAt || now).trim() || now;
    const updatedAt = String(source.updatedAt || now).trim() || now;
    const startedAt = String(source.startedAt || prev.startedAt || '').trim();
    const finishedAt = String(source.finishedAt || prev.finishedAt || '').trim();
    const lastRunAt = String(source.lastRunAt || prev.lastRunAt || '').trim();
    const traceId = String(source.traceId || prev.traceId || '').trim();
    const requestId = String(source.requestId || prev.requestId || '').trim();
    const taskId = String(source.taskId || prev.taskId || '').trim();
    const eventsSource = Array.isArray(source.events) ? source.events : Array.isArray(prev.events) ? prev.events : [];
    const events = eventsSource
      .map((item) => ({
        at: String(item?.at || '').trim(),
        status: String(item?.status || '').trim().toLowerCase(),
        step: String(item?.step || '').trim().toLowerCase(),
        message: String(item?.message || '').trim(),
        meta: item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : null
      }))
      .filter((item) => item.at || item.status || item.step || item.message)
      .slice(-120);

    return {
      commandId,
      type,
      label,
      status,
      payload,
      result,
      error,
      attempts,
      traceId,
      requestId,
      taskId,
      createdAt,
      updatedAt,
      startedAt,
      finishedAt,
      lastRunAt,
      events
    };
  }

  function findNetworkCommandById(commandId = '') {
    const id = String(commandId || '').trim();
    if (!id) return null;
    return readNetworkCommands().find((item) => String(item?.commandId || '').trim() === id) || null;
  }

  function upsertNetworkCommandRecord(input = {}) {
    const rows = readNetworkCommands();
    const commandId = String(input?.commandId || '').trim();
    const idx = rows.findIndex((item) => String(item?.commandId || '').trim() === commandId);
    const existing = idx >= 0 ? rows[idx] : null;
    const record = sanitizeNetworkCommandRecord(input, existing);
    if (idx >= 0) rows[idx] = record;
    else rows.unshift(record);
    rows.sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0));
    writeNetworkCommands(rows);
    return record;
  }

  function parseNetworkCommandFilterList(input = '') {
    return String(input || '')
      .split(',')
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }

  function normalizeNetworkCommandPayload(input = {}) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  }

  function extractNetworkCommandRefs(result = {}, fallback = {}) {
    const task = result?.task && typeof result.task === 'object' ? result.task : {};
    const group = result?.group && typeof result.group === 'object' ? result.group : {};
    return {
      traceId: String(task.traceId || result.traceId || fallback.traceId || '').trim(),
      requestId: String(task.requestId || result.requestId || fallback.requestId || '').trim(),
      taskId: String(task.taskId || result.taskId || fallback.taskId || '').trim(),
      groupId: String(group.groupId || fallback.groupId || '').trim()
    };
  }

  function summarizeNetworkCommandExecution(result = {}) {
    const tasks = result?.tasks && typeof result.tasks === 'object' && !Array.isArray(result.tasks) ? result.tasks : null;
    if (!tasks) {
      const resultReceived = Boolean(result?.resultReceived);
      return {
        resultReceived,
        partialFailure: Boolean(result?.partialFailure),
        successCount: resultReceived ? 1 : 0,
        failureCount: resultReceived ? 0 : 1
      };
    }

    const failStatuses = ['failed', 'error', 'rejected', 'timeout'];
    const taskItems = Object.values(tasks).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (taskItems.length === 0) {
      const resultReceived = Boolean(result?.resultReceived);
      return {
        resultReceived,
        partialFailure: Boolean(result?.partialFailure),
        successCount: resultReceived ? 1 : 0,
        failureCount: resultReceived ? 0 : 1
      };
    }

    let successCount = 0;
    let failureCount = 0;
    let resultReceived = false;
    for (const task of taskItems) {
      const hasResult = Boolean(task?.resultReceived || task?.resultEvent || task?.taskResult);
      resultReceived = resultReceived || hasResult;
      const status = String(task?.status || task?.taskResult?.status || '').trim().toLowerCase();
      const explicitSuccess = typeof task?.success === 'boolean' ? task.success : null;
      const isFailure = explicitSuccess === false || Boolean(task?.failure) || failStatuses.includes(status) || !hasResult;
      if (isFailure) {
        failureCount += 1;
        continue;
      }
      successCount += 1;
    }

    return {
      resultReceived,
      partialFailure: successCount > 0 && failureCount > 0,
      successCount,
      failureCount
    };
  }

  return {
    appendNetworkCommandEvent,
    createCommandId,
    extractNetworkCommandRefs,
    findNetworkCommandById,
    findXmtpGroupRecord,
    normalizeNetworkCommandPayload,
    normalizeNetworkCommandType,
    parseNetworkCommandFilterList,
    sanitizeNetworkCommandRecord,
    sanitizeXmtpGroupRecord,
    summarizeNetworkCommandExecution,
    upsertNetworkCommandRecord,
    upsertXmtpGroupRecord
  };
}
