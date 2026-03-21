export function createX402WorkflowHelpers({
  crypto,
  normalizeAddress,
  createTraceId,
  toAuditText,
  appendNetworkAuditEvent,
  readX402Requests,
  writeX402Requests,
  readAgent001Results,
  writeAgent001Results,
  readWorkflows,
  writeWorkflows,
  x402Price,
  x402TtlMs,
  settlementToken,
  merchantAddress,
  kiteNetworkAuditMaxEvents,
  erc8004IdentityRegistry,
  erc8004AgentId
}) {
  function computeX402StatusCounts(rows = [], now = Date.now()) {
    const items = Array.isArray(rows) ? rows : [];
    let pending = 0;
    let paid = 0;
    let expired = 0;
    let failed = 0;
    for (const item of items) {
      const status = String(item?.status || '').trim().toLowerCase();
      const expiresAt = Number(item?.expiresAt || 0);
      if (status === 'paid') {
        paid += 1;
      } else if (status === 'pending') {
        if (expiresAt > 0 && now > expiresAt) expired += 1;
        else pending += 1;
      } else if (status === 'expired') {
        expired += 1;
      } else if (status) {
        failed += 1;
      }
    }
    return {
      total: items.length,
      pending,
      paid,
      expired,
      failed
    };
  }

  function expireStaleX402PendingRequests({
    dryRun = false,
    stalePendingMs = 24 * 60 * 60 * 1000,
    limit = 0,
    reason = 'ttl_or_stale_pending'
  } = {}) {
    const now = Date.now();
    const maxStalePendingMs = Number.isFinite(Number(stalePendingMs)) && Number(stalePendingMs) > 0
      ? Number(stalePendingMs)
      : 24 * 60 * 60 * 1000;
    const maxUpdates = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.min(Number(limit), 10_000)
      : 0;
    const rows = readX402Requests();
    const before = computeX402StatusCounts(rows, now);
    let touched = 0;
    const touchedIds = [];
    const nextRows = rows.map((item) => {
      const status = String(item?.status || '').trim().toLowerCase();
      if (status !== 'pending') return item;
      if (maxUpdates > 0 && touched >= maxUpdates) return item;
      const expiresAt = Number(item?.expiresAt || 0);
      const createdAt = Number(item?.createdAt || 0);
      const expiredByTtl = expiresAt > 0 && now > expiresAt;
      const expiredByAge = (!expiresAt || expiresAt <= 0) && createdAt > 0 && now - createdAt > maxStalePendingMs;
      if (!expiredByTtl && !expiredByAge) return item;
      touched += 1;
      touchedIds.push(String(item?.requestId || '').trim());
      if (dryRun) return item;
      return {
        ...item,
        status: 'expired',
        expiredAt: now,
        cleanup: {
          reason,
          expiredBy: expiredByTtl ? 'ttl' : 'age',
          stalePendingMs: maxStalePendingMs,
          cleanedAt: now
        }
      };
    });
    if (!dryRun && touched > 0) {
      writeX402Requests(nextRows);
    }
    const after = computeX402StatusCounts(dryRun ? rows : nextRows, now);
    return {
      ok: true,
      dryRun,
      now,
      stalePendingMs: maxStalePendingMs,
      requestedLimit: maxUpdates,
      cleaned: touched,
      before,
      after,
      requestIds: touchedIds.slice(0, 100)
    };
  }

  function upsertAgent001ResultRecord(input = {}) {
    const requestId = String(input?.requestId || '').trim();
    if (!requestId) return null;
    const rows = readAgent001Results();
    const now = new Date().toISOString();
    const existingIndex = rows.findIndex((item) => String(item?.requestId || '').trim() === requestId);
    const prev = existingIndex >= 0 ? rows[existingIndex] : null;
    const merged = {
      requestId,
      capability: String(input?.capability || prev?.capability || '').trim().toLowerCase(),
      stage: String(input?.stage || prev?.stage || '').trim().toLowerCase(),
      status: String(input?.status || prev?.status || '').trim().toLowerCase(),
      traceId: String(input?.traceId || prev?.traceId || '').trim(),
      taskId: String(input?.taskId || prev?.taskId || '').trim(),
      toAgentId: String(input?.toAgentId || prev?.toAgentId || '').trim().toLowerCase(),
      payer: normalizeAddress(input?.payer || prev?.payer || ''),
      input:
        input?.input && typeof input.input === 'object' && !Array.isArray(input.input)
          ? input.input
          : prev?.input && typeof prev.input === 'object' && !Array.isArray(prev.input)
            ? prev.input
            : {},
      quote:
        input?.quote && typeof input.quote === 'object' && !Array.isArray(input.quote)
          ? input.quote
          : prev?.quote && typeof prev.quote === 'object' && !Array.isArray(prev.quote)
            ? prev.quote
            : null,
      payment:
        input?.payment && typeof input.payment === 'object' && !Array.isArray(input.payment)
          ? input.payment
          : prev?.payment && typeof prev.payment === 'object' && !Array.isArray(prev.payment)
            ? prev.payment
            : null,
      receiptRef:
        input?.receiptRef && typeof input.receiptRef === 'object' && !Array.isArray(input.receiptRef)
          ? input.receiptRef
          : prev?.receiptRef && typeof prev.receiptRef === 'object' && !Array.isArray(prev.receiptRef)
            ? prev.receiptRef
            : null,
      result:
        input?.result && typeof input.result === 'object' && !Array.isArray(input.result)
          ? input.result
          : prev?.result && typeof prev.result === 'object' && !Array.isArray(prev.result)
            ? prev.result
            : null,
      error: String(input?.error || prev?.error || '').trim(),
      reason: String(input?.reason || prev?.reason || '').trim(),
      warnings: Array.isArray(input?.warnings)
        ? input.warnings.map((item) => String(item || '').trim()).filter(Boolean)
        : Array.isArray(prev?.warnings)
          ? prev.warnings.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
      dm:
        input?.dm && typeof input.dm === 'object' && !Array.isArray(input.dm)
          ? input.dm
          : prev?.dm && typeof prev.dm === 'object' && !Array.isArray(prev.dm)
            ? prev.dm
            : null,
      source: String(input?.source || prev?.source || '').trim().toLowerCase(),
      createdAt: String(prev?.createdAt || now).trim() || now,
      updatedAt: now
    };
    if (existingIndex >= 0) rows[existingIndex] = merged;
    else rows.unshift(merged);
    writeAgent001Results(rows);
    return merged;
  }

  function upsertWorkflow(workflow) {
    const rows = readWorkflows();
    const idx = rows.findIndex((w) => String(w.traceId || '') === String(workflow.traceId || ''));
    const prev = idx >= 0 ? rows[idx] : null;
    if (idx >= 0) rows[idx] = workflow;
    else rows.unshift(workflow);
    writeWorkflows(rows);
    const nextState = String(workflow?.state || '').trim().toLowerCase();
    const prevState = String(prev?.state || '').trim().toLowerCase();
    if (!prev && workflow?.traceId) {
      appendNetworkAuditEvent({
        traceId: workflow.traceId,
        requestId: workflow?.requestId || '',
        type: 'workflow.step',
        actorId: 'Actor:Orchestrator',
        summary: {
          step: {
            name: 'workflow_started',
            status: nextState || 'running',
            details: {
              requestId: workflow?.requestId || ''
            }
          },
          capability: workflow?.type || ''
        },
        refs: {
          workflow: `/api/workflow/${encodeURIComponent(String(workflow.traceId || '').trim())}`
        }
      });
    }
    if (workflow?.traceId && nextState && nextState !== prevState && ['unlocked', 'failed'].includes(nextState)) {
      appendNetworkAuditEvent({
        traceId: workflow.traceId,
        requestId: workflow?.requestId || '',
        type: 'decision.final',
        actorId: 'Actor:Orchestrator',
        summary: {
          status: nextState,
          resultSummary:
            nextState === 'unlocked'
              ? toAuditText(workflow?.result?.summary || 'workflow unlocked', 240)
              : toAuditText(workflow?.error || 'workflow failed', 240)
        },
        refs: {
          workflow: `/api/workflow/${encodeURIComponent(String(workflow.traceId || '').trim())}`
        }
      });
    }
    return workflow;
  }

  function createX402Request(query, payer, action = 'kol-score', options = {}) {
    const now = Date.now();
    const requestId = `x402_${now}_${crypto.randomBytes(4).toString('hex')}`;
    return {
      requestId,
      action,
      query,
      payer,
      amount: String(options.amount || x402Price),
      tokenAddress: options.tokenAddress || settlementToken,
      recipient: options.recipient || merchantAddress,
      status: 'pending',
      createdAt: now,
      expiresAt: now + x402TtlMs,
      policy: options.policy || null,
      identity: options.identity || {
        registry: erc8004IdentityRegistry || '',
        agentId: erc8004AgentId !== null ? String(erc8004AgentId) : ''
      }
    };
  }

  function buildPaymentRequiredResponse(reqItem, reason = '') {
    return {
      error: 'payment_required',
      reason,
      x402: {
        version: '0.1-demo',
        requestId: reqItem.requestId,
        expiresAt: reqItem.expiresAt,
        accepts: [
          {
            scheme: 'kite-aa-erc20',
            network: 'kite_testnet',
            tokenAddress: reqItem.tokenAddress,
            amount: reqItem.amount,
            recipient: reqItem.recipient,
            decimals: 18
          }
        ]
      }
    };
  }

  let _cleanupInterval = null;
  function scheduleX402PendingCleanup(intervalMs = 5 * 60 * 1000) {
    if (_cleanupInterval) return;
    const safeInterval = Math.max(60_000, Number(intervalMs) || 5 * 60 * 1000);
    _cleanupInterval = setInterval(() => {
      try {
        expireStaleX402PendingRequests({ stalePendingMs: 30 * 60 * 1000 });
      } catch (_) { /* cleanup best-effort */ }
    }, safeInterval);
    if (_cleanupInterval.unref) _cleanupInterval.unref();
  }

  return {
    computeX402StatusCounts,
    expireStaleX402PendingRequests,
    scheduleX402PendingCleanup,
    upsertAgent001ResultRecord,
    upsertWorkflow,
    createX402Request,
    buildPaymentRequiredResponse
  };
}
