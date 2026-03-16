export function createNetworkAuditHelpers({
  normalizeAddress,
  readX402Requests,
  readNetworkAuditEvents,
  writeNetworkAuditEvents,
  kiteNetworkAuditMaxEvents
}) {
  function toAuditText(value = '', maxLen = 240) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...`;
  }

  function sanitizeAuditRefs(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const refs = {};
    const workflowRef = toAuditText(input.workflow, 200);
    const evidenceRef = toAuditText(input.evidence, 200);
    const requestRef = toAuditText(input.request, 200);
    if (workflowRef) refs.workflow = workflowRef;
    if (evidenceRef) refs.evidence = evidenceRef;
    if (requestRef) refs.request = requestRef;
    return Object.keys(refs).length > 0 ? refs : null;
  }

  function sanitizeAuditQuote(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const quote = {
      amount: toAuditText(input.amount, 80),
      tokenAddress: normalizeAddress(input.tokenAddress || ''),
      expiresAt: toAuditText(input.expiresAt, 80),
      capability: toAuditText(input.capability || input.service || '', 80),
      actorId: toAuditText(input.actorId, 80)
    };
    const hasValue = Object.values(quote).some((value) => Boolean(value));
    return hasValue ? quote : null;
  }

  function sanitizeAuditSla(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const timeoutMs = Number(input.timeoutMs);
    const retries = Number(input.retries);
    const maxCost = Number(input.maxCost);
    const maxLatencyMs = Number(input.maxLatencyMs);
    const sla = {};
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) sla.timeoutMs = Math.round(timeoutMs);
    if (Number.isFinite(retries) && retries >= 0) sla.retries = Math.round(retries);
    if (Number.isFinite(maxCost) && maxCost >= 0) sla.maxCost = maxCost;
    if (Number.isFinite(maxLatencyMs) && maxLatencyMs > 0) sla.maxLatencyMs = Math.round(maxLatencyMs);
    return Object.keys(sla).length > 0 ? sla : null;
  }

  function sanitizeAuditRationale(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const selectedActorId = toAuditText(input.selectedActorId, 80);
    const reasonCodes = Array.isArray(input.reasonCodes)
      ? input.reasonCodes.map((item) => toAuditText(item, 80)).filter(Boolean)
      : [];
    const explanation = toAuditText(input.explanation, 240);
    if (!selectedActorId && reasonCodes.length === 0 && !explanation) return null;
    return {
      selectedActorId,
      reasonCodes,
      explanation
    };
  }

  function sanitizeAuditStepDetails(details = {}) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
    const normalized = {
      requestId: toAuditText(details.requestId, 120),
      taskId: toAuditText(details.taskId, 120),
      txHash: toAuditText(details.txHash, 120),
      userOpHash: toAuditText(details.userOpHash, 120),
      recipient: normalizeAddress(details.recipient || ''),
      amount: toAuditText(details.amount, 80),
      verified: details.verified === true ? true : details.verified === false ? false : undefined,
      result: toAuditText(details.result, 240),
      reason: toAuditText(details.reason || details.error, 240)
    };
    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== '' && value !== undefined));
  }

  function sanitizeAuditSummary(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const summary = {};
    const quote = sanitizeAuditQuote(input.quote);
    const sla = sanitizeAuditSla(input.sla);
    const rationale = sanitizeAuditRationale(input.rationale);
    const stepName = toAuditText(input.stepName || input.step?.name, 80);
    const stepStatus = toAuditText(input.stepStatus || input.step?.status, 40);
    const channel = toAuditText(input.channel, 40);
    const mode = toAuditText(input.mode, 40);
    const capability = toAuditText(input.capability, 80);
    const fromAgentId = toAuditText(input.fromAgentId, 80);
    const toAgentId = toAuditText(input.toAgentId, 80);
    const dispatchStatus = toAuditText(input.dispatchStatus || input.status, 40);
    const reason = toAuditText(input.reason || input.error, 240);
    const resultSummary = toAuditText(input.resultSummary || input.summary, 240);
    if (quote) summary.quote = quote;
    if (sla) summary.sla = sla;
    if (rationale) summary.rationale = rationale;
    if (stepName || stepStatus) {
      summary.step = {
        ...(stepName ? { name: stepName } : {}),
        ...(stepStatus ? { status: stepStatus } : {}),
        details: sanitizeAuditStepDetails(input.step?.details || input.details || {})
      };
    }
    if (channel) summary.channel = channel;
    if (mode) summary.mode = mode;
    if (capability) summary.capability = capability;
    if (fromAgentId) summary.fromAgentId = fromAgentId;
    if (toAgentId) summary.toAgentId = toAgentId;
    if (dispatchStatus) summary.status = dispatchStatus;
    if (reason) summary.reason = reason;
    if (resultSummary) summary.resultSummary = resultSummary;
    return summary;
  }

  function resolveAuditQuoteFromPaymentIntent(paymentIntent = {}, capability = '', actorId = '') {
    const intent = paymentIntent && typeof paymentIntent === 'object' && !Array.isArray(paymentIntent) ? paymentIntent : {};
    const requestId = toAuditText(intent.requestId, 120);
    const reqItem = requestId
      ? readX402Requests().find((row) => String(row?.requestId || '').trim() === requestId) || null
      : null;
    const quote = sanitizeAuditQuote({
      amount: reqItem?.amount || intent.amount || '',
      tokenAddress: reqItem?.tokenAddress || intent.tokenAddress || '',
      expiresAt: reqItem?.expiresAt ? new Date(Number(reqItem.expiresAt)).toISOString() : intent.expiresAt || '',
      capability,
      actorId
    });
    return quote;
  }

  function appendNetworkAuditEvent(input = {}) {
    const traceId = toAuditText(input.traceId, 120);
    if (!traceId) return null;
    const rows = readNetworkAuditEvents();
    let nextSeq = 1;
    for (const row of rows) {
      if (String(row?.traceId || '') !== traceId) continue;
      const seq = Number(row?.seq);
      if (Number.isFinite(seq) && seq >= nextSeq) nextSeq = seq + 1;
    }
    const type = toAuditText(input.type, 80) || 'workflow.step';
    const ts = new Date().toISOString();
    const event = {
      traceId,
      seq: nextSeq,
      ts,
      type,
      actorId: toAuditText(input.actorId, 80) || 'Actor:Orchestrator',
      requestId: toAuditText(input.requestId, 120),
      taskId: toAuditText(input.taskId, 120),
      summary: sanitizeAuditSummary(input.summary || {}),
      refs: sanitizeAuditRefs(input.refs || {})
    };
    rows.push(event);
    if (rows.length > kiteNetworkAuditMaxEvents) {
      rows.splice(0, rows.length - kiteNetworkAuditMaxEvents);
    }
    writeNetworkAuditEvents(rows);
    return event;
  }

  function listNetworkAuditEventsByTraceId(traceId = '') {
    const normalized = toAuditText(traceId, 120);
    if (!normalized) return [];
    return readNetworkAuditEvents()
      .filter((row) => String(row?.traceId || '') === normalized)
      .sort((a, b) => {
        const seqA = Number(a?.seq);
        const seqB = Number(b?.seq);
        if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) return seqA - seqB;
        return Date.parse(a?.ts || 0) - Date.parse(b?.ts || 0);
      });
  }

  function appendWorkflowStep(workflow, name, status, details = {}) {
    if (!workflow.steps) workflow.steps = [];
    const step = {
      name,
      status,
      at: new Date().toISOString(),
      details
    };
    workflow.steps.push(step);
    appendNetworkAuditEvent({
      traceId: workflow?.traceId || '',
      requestId: workflow?.requestId || details?.requestId || '',
      taskId: details?.taskId || '',
      type: 'workflow.step',
      actorId: details?.actorId || 'Actor:Orchestrator',
      summary: {
        step: {
          name,
          status,
          details
        },
        reason: details?.reason || ''
      },
      refs: {
        workflow: workflow?.traceId ? `/api/workflow/${encodeURIComponent(String(workflow.traceId || '').trim())}` : ''
      }
    });
  }

  return {
    toAuditText,
    sanitizeAuditRefs,
    sanitizeAuditQuote,
    sanitizeAuditSla,
    sanitizeAuditRationale,
    sanitizeAuditStepDetails,
    sanitizeAuditSummary,
    resolveAuditQuoteFromPaymentIntent,
    appendNetworkAuditEvent,
    listNetworkAuditEventsByTraceId,
    appendWorkflowStep
  };
}
