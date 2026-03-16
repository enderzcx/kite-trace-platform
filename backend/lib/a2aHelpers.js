export function createA2AHelpers({
  toAuditText,
  readWorkflows,
  readNetworkAuditEvents
} = {}) {
  function buildNetworkRunSummaries({ limit = 50, traceId = '', requestId = '' } = {}) {
    const maxRows = Math.max(1, Math.min(Number(limit) || 50, 300));
    const traceFilter = toAuditText(traceId, 120);
    const requestFilter = toAuditText(requestId, 120);
    const workflows = readWorkflows();
    const events = readNetworkAuditEvents();
    const byTrace = new Map();

    const ensureRow = (key) => {
      if (!byTrace.has(key)) {
        byTrace.set(key, {
          traceId: key,
          requestId: '',
          state: '',
          startedAt: '',
          latestAt: '',
          latestEventType: '',
          totalEvents: 0
        });
      }
      return byTrace.get(key);
    };

    for (const workflow of workflows) {
      const key = toAuditText(workflow?.traceId, 120);
      if (!key) continue;
      const row = ensureRow(key);
      row.requestId = row.requestId || toAuditText(workflow?.requestId, 120);
      row.state = toAuditText(workflow?.state, 40) || row.state;
      row.startedAt = row.startedAt || toAuditText(workflow?.createdAt, 80);
      row.latestAt = toAuditText(workflow?.updatedAt, 80) || row.latestAt || row.startedAt;
    }

    for (const event of events) {
      const key = toAuditText(event?.traceId, 120);
      if (!key) continue;
      const row = ensureRow(key);
      const eventTs = toAuditText(event?.ts, 80);
      row.requestId = row.requestId || toAuditText(event?.requestId, 120);
      row.totalEvents += 1;
      if (!row.startedAt || Date.parse(eventTs || 0) < Date.parse(row.startedAt || 0)) row.startedAt = eventTs;
      if (!row.latestAt || Date.parse(eventTs || 0) >= Date.parse(row.latestAt || 0)) {
        row.latestAt = eventTs;
        row.latestEventType = toAuditText(event?.type, 80);
      }
      const stepName = toAuditText(event?.summary?.step?.name, 80);
      if (stepName === 'failed') row.state = 'failed';
      if (stepName === 'unlocked' && row.state !== 'failed') row.state = 'unlocked';
    }

    return Array.from(byTrace.values())
      .filter((row) => (traceFilter ? row.traceId === traceFilter : true))
      .filter((row) => (requestFilter ? String(row.requestId || '') === requestFilter : true))
      .sort((a, b) => Date.parse(b?.latestAt || 0) - Date.parse(a?.latestAt || 0))
      .slice(0, maxRows);
  }

  return {
    buildNetworkRunSummaries
  };
}
