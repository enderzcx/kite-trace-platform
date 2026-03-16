export function createWorkflowHelpers({
  toAuditText,
  sanitizeAuditSummary,
  sanitizeAuditQuote,
  sanitizeAuditSla,
  sanitizeAuditRationale
} = {}) {
  function buildWorkflowFallbackAuditEvents(workflow = {}) {
    const traceId = toAuditText(workflow?.traceId, 120);
    if (!traceId) return [];
    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
    return steps.map((step, idx) => ({
      traceId,
      seq: idx + 1,
      ts: toAuditText(step?.at, 80) || new Date().toISOString(),
      type: 'workflow.step',
      actorId: 'Actor:Orchestrator',
      requestId: toAuditText(workflow?.requestId, 120),
      taskId: toAuditText(step?.details?.taskId || workflow?.taskId, 120),
      summary: sanitizeAuditSummary({
        step: {
          name: step?.name,
          status: step?.status,
          details: step?.details
        },
        reason: step?.details?.reason || ''
      }),
      refs: null
    }));
  }

  function deriveNegotiationTermsFromAuditEvents(events = []) {
    let quote = null;
    let sla = null;
    let rationale = null;
    for (const event of events) {
      const summary = event?.summary && typeof event.summary === 'object' ? event.summary : null;
      if (!summary) continue;
      const nextQuote = sanitizeAuditQuote(summary.quote);
      const nextSla = sanitizeAuditSla(summary.sla);
      const nextRationale = sanitizeAuditRationale(summary.rationale);
      if (nextQuote) quote = nextQuote;
      if (nextSla) sla = nextSla;
      if (nextRationale) rationale = nextRationale;
    }
    return { quote, sla, rationale };
  }

  return {
    buildWorkflowFallbackAuditEvents,
    deriveNegotiationTermsFromAuditEvents
  };
}
