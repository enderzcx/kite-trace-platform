export function registerXmtpNetworkRoutes(app, deps) {
  const {
    action,
    address,
    after,
    agent,
    AGENT001_BIND_TIMEOUT_MS,
    appendNetworkAuditEvent,
    appendNetworkCommandEvent,
    before,
    body,
    capability,
    channel,
    code,
    commandId,
    confidence,
    configured,
    createCommandId,
    created,
    createdAt,
    createTraceId,
    deadline,
    defaults,
    description,
    ensured,
    envelope,
    error,
    event,
    events,
    executeNetworkCommand,
    execution,
    existing,
    explanation,
    failed,
    failure,
    failureCount,
    fetchBtcPriceQuote,
    buildAgent001TradePlan,
    buildRiskScorePaymentIntentForTask,
    buildInfoPaymentIntentForTask,
    buildXReaderPaymentIntentForTask,
    coerceAgent001ForcedTradePlan,
    findNetworkAgentById,
    findNetworkCommandById,
    findXmtpGroupRecord,
    fromAgentId,
    getAllXmtpRuntimeStatuses,
    getAutoXmtpNetworkStatus,
    group,
    groupId,
    groupName,
    hits,
    horizonMin,
    info,
    infoQuote,
    input,
    intervalMs,
    items,
    kind,
    KITE_SESSION_PAY_RETRIES,
    label,
    lastUsedAt,
    limit,
    market,
    maxChars,
    maxLatencyMs,
    maxRows,
    memberAddresses,
    memberAgentIds,
    message,
    MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
    MESSAGE_PROVIDER_DISABLE_CLAWFEED,
    MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    mode,
    ms,
    network,
    normalizeAddress,
    normalizeAddresses,
    normalizeNetworkCommandPayload,
    normalizeNetworkCommandType,
    OPENNEWS_API_BASE,
    OPENNEWS_MAX_ROWS,
    OPENNEWS_RETRY,
    OPENNEWS_TIMEOUT_MS,
    OPENNEWS_TOKEN,
    OPENTWITTER_API_BASE,
    OPENTWITTER_MAX_ROWS,
    OPENTWITTER_RETRY,
    OPENTWITTER_TIMEOUT_MS,
    OPENTWITTER_TOKEN,
    parseAgentIdList,
    parseAgent001OrderDirectives,
    isAgent001ForceOrderRequested,
    parseNetworkCommandFilterList,
    payload,
    paymentIntent,
    preferred,
    price,
    providers,
    quote,
    rationale,
    reader,
    readNetworkCommands,
    readXmtpGroups,
    reason,
    reasonCodes,
    record,
    recovery,
    refs,
    requestId,
    requireRole,
    resolveAgentAddressesByIds,
    resolveAuditQuoteFromPaymentIntent,
    resolved,
    result,
    resultEvent,
    resultReceived,
    resultSummary,
    retries,
    risk,
    router,
    routerStatus,
    row,
    rows,
    running,
    runtime,
    runtimeName,
    sanitizeXmtpGroupRecord,
    selectedActorId,
    sent,
    sla,
    source,
    sourceAgentId,
    startAutoXmtpNetworkLoop,
    startXmtpRuntimes,
    status,
    statusRaw,
    stopAutoXmtpNetworkLoop,
    stopXmtpRuntimes,
    success,
    successCount,
    summary,
    symbol,
    targetAgentIds,
    task,
    taskId,
    taskResult,
    tasks,
    technical,
    technicalQuote,
    text,
    timeoutMs,
    toAddress,
    toAgentId,
    total,
    traceId,
    type,
    updated,
    updatedAt,
    upsertNetworkCommandRecord,
    upsertXmtpGroupRecord,
    url,
    waitMs,
    waitMsLimit,
    warnings,
    workflow,
    X_READER_MAX_CHARS_DEFAULT,
    XMTP_ENV,
    XMTP_READER_RESOLVED_ADDRESS,
    XMTP_RISK_RESOLVED_ADDRESS,
    XMTP_WORKERS_GROUP_AGENT_IDS,
    XMTP_WORKERS_GROUP_LABEL,
    XMTP_WORKERS_GROUP_NAME,
    xmtpAddress,
    xmtpReaderRuntime,
    xmtpRiskRuntime,
    xmtpRuntime,
  } = deps;

  app.get('/api/xmtp/status', requireRole('viewer'), (req, res) => {
    const statuses = getAllXmtpRuntimeStatuses();
    const router = statuses.router;
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      xmtp: {
        env: router.env || XMTP_ENV,
        ...statuses
      }
    });
  });
  
  app.post('/api/xmtp/start', requireRole('admin'), async (req, res) => {
    const status = await startXmtpRuntimes();
    const ok = Boolean(status?.router?.running);
    return res.status(ok ? 200 : 400).json({
      ok,
      traceId: req.traceId || '',
      xmtp: status,
      reason: ok ? '' : status?.router?.lastError || 'xmtp_runtime_not_running'
    });
  });
  
  app.post('/api/xmtp/stop', requireRole('admin'), async (req, res) => {
    const status = await stopXmtpRuntimes();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      xmtp: status
    });
  });
  
  app.get('/api/xmtp/automation/status', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      automation: {
        type: 'xmtp-network-self-talk',
        ...getAutoXmtpNetworkStatus()
      }
    });
  });
  
  app.post('/api/xmtp/automation/start', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    startAutoXmtpNetworkLoop({
      intervalMs: body.intervalMs,
      sourceAgentId: body.sourceAgentId,
      targetAgentIds: body.targetAgentIds,
      capability: body.capability,
      immediate: body.immediate !== false,
      reason: 'manual'
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      automation: {
        type: 'xmtp-network-self-talk',
        ...getAutoXmtpNetworkStatus()
      }
    });
  });
  
  app.post('/api/xmtp/automation/stop', requireRole('admin'), (req, res) => {
    stopAutoXmtpNetworkLoop();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      automation: {
        type: 'xmtp-network-self-talk',
        ...getAutoXmtpNetworkStatus()
      }
    });
  });
  
  app.get('/api/xmtp/groups', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 80), 300));
    const rows = readXmtpGroups()
      .map((item) => sanitizeXmtpGroupRecord(item))
      .filter((item) => item.groupId || item.label)
      .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
      .slice(0, limit);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items: rows
    });
  });
  
  app.post('/api/xmtp/groups/ensure', requireRole('admin'), async (req, res) => {
    const body = req.body || {};
    if (!xmtpRuntime.getStatus().running && body.autoStart !== false) {
      await startXmtpRuntimes();
    }
    if (!xmtpRuntime.getStatus().running) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'xmtp_router_not_running',
        reason: xmtpRuntime.getStatus().lastError || 'router runtime is not running'
      });
    }
  
    const label = String(body.label || XMTP_WORKERS_GROUP_LABEL || 'workers-group').trim();
    const existing = findXmtpGroupRecord({
      groupId: body.groupId,
      label
    });
    const memberAgentIds = parseAgentIdList(
      body.memberAgentIds || existing?.memberAgentIds || XMTP_WORKERS_GROUP_AGENT_IDS
    );
    const resolvedMembers = resolveAgentAddressesByIds(memberAgentIds);
    const memberAddresses = resolvedMembers.map((item) => item.address);
    const ensured = await xmtpRuntime.ensureGroup({
      groupId: String(body.groupId || existing?.groupId || '').trim(),
      groupName: String(body.groupName || existing?.groupName || XMTP_WORKERS_GROUP_NAME).trim(),
      groupDescription: String(body.description || existing?.description || 'Agent001 workers collaboration channel').trim(),
      memberAddresses
    });
    if (!ensured?.ok) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: ensured?.error || 'xmtp_group_ensure_failed',
        reason: ensured?.reason || 'xmtp_group_ensure_failed',
        details: ensured
      });
    }
  
    const record = upsertXmtpGroupRecord({
      groupId: ensured.groupId,
      label,
      groupName: ensured.groupName,
      description: String(body.description || existing?.description || '').trim(),
      runtimeName: 'router-runtime',
      memberAgentIds,
      memberAddresses: ensured.memberAddresses || memberAddresses,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      group: record,
      resolvedMembers,
      ensured
    });
  });
  
  app.post('/api/xmtp/groups/send', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    if (!xmtpRuntime.getStatus().running && body.autoStart === true) {
      await startXmtpRuntimes();
    }
    const label = String(body.label || '').trim();
    const known = findXmtpGroupRecord({
      groupId: body.groupId,
      label
    });
    const groupId = String(body.groupId || known?.groupId || '').trim();
    const result = await xmtpRuntime.sendGroup({
      groupId,
      createIfMissing: body.createIfMissing === true,
      groupName: body.groupName || known?.groupName || XMTP_WORKERS_GROUP_NAME,
      groupDescription: body.description || known?.description || 'Agent001 workers collaboration channel',
      memberAddresses: normalizeAddresses(body.memberAddresses || known?.memberAddresses || []),
      fromAgentId: body.fromAgentId || 'router-agent',
      channel: body.channel || 'group',
      hopIndex: body.hopIndex,
      text: body.text,
      envelope: body.envelope,
      traceId: body.traceId,
      requestId: body.requestId,
      taskId: body.taskId
    });
    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: result?.error || 'xmtp_group_send_failed',
        reason: result?.reason || 'xmtp_group_send_failed',
        details: result
      });
    }
    if (label || known) {
      upsertXmtpGroupRecord({
        ...(known || {}),
        groupId: result.groupId || groupId,
        label: label || known?.label || '',
        groupName: body.groupName || known?.groupName || '',
        runtimeName: 'router-runtime',
        memberAgentIds: parseAgentIdList(body.memberAgentIds || known?.memberAgentIds || []),
        memberAddresses: normalizeAddresses(body.memberAddresses || known?.memberAddresses || []),
        updatedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      groupId: result.groupId || groupId,
      message: result
    });
  });
  
  app.get('/api/xmtp/events', requireRole('viewer'), (req, res) => {
    const items = xmtpRuntime.listEvents({
      limit: req.query.limit,
      direction: req.query.direction,
      runtimeName: req.query.runtimeName,
      fromAgentId: req.query.fromAgentId,
      toAgentId: req.query.toAgentId,
      conversationId: req.query.conversationId,
      kind: req.query.kind,
      traceId: req.query.traceId,
      requestId: req.query.requestId,
      taskId: req.query.taskId
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: items.length,
      items
    });
  });
  
  app.get('/api/xmtp/can-message', requireRole('viewer'), async (req, res) => {
    const toAgentId = String(req.query.toAgentId || '').trim();
    const candidateAddress = String(req.query.toAddress || '').trim();
    const resolved = toAgentId ? findNetworkAgentById(toAgentId) : null;
    const toAddress = normalizeAddress(candidateAddress || resolved?.xmtpAddress || '');
    if (!toAddress) {
      return res.status(400).json({
        ok: false,
        error: 'toAddress_required',
        reason: 'Provide valid toAddress or toAgentId with configured xmtpAddress.',
        traceId: req.traceId || ''
      });
    }
    const result = await xmtpRuntime.canMessageAddress(toAddress);
    return res.json({
      ok: result.ok,
      traceId: req.traceId || '',
      toAddress,
      toAgentId,
      canMessage: result.canMessage,
      reason: result.reason,
      details: result.details || {}
    });
  });
  
  app.post('/api/xmtp/dm/send', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    if (!xmtpRuntime.getStatus().running && body.autoStart === true) {
      await startXmtpRuntimes();
    }
    const result = await xmtpRuntime.sendDm({
      fromAgentId: body.fromAgentId,
      toAgentId: body.toAgentId,
      toAddress: body.toAddress,
      channel: body.channel || 'dm',
      hopIndex: body.hopIndex,
      text: body.text,
      envelope: body.envelope,
      traceId: body.traceId,
      requestId: body.requestId,
      taskId: body.taskId
    });
    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: result?.error || 'xmtp_send_failed',
        reason: result?.reason || 'xmtp_send_failed',
        details: result
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      message: result
    });
  });
  
  app.post('/api/network/tasks/run', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const toAgentId = String(body.toAgentId || '').trim();
    if (!toAgentId) {
      return res.status(400).json({
        ok: false,
        error: 'toAgentId_required',
        reason: 'toAgentId is required for network task routing.',
        traceId: req.traceId || ''
      });
    }
  
    const traceId = String(body.traceId || createTraceId('xmtp_trace')).trim();
    const requestId = String(body.requestId || createTraceId('xmtp_req')).trim();
    const taskId = String(body.taskId || createTraceId('xmtp_task')).trim();
    const fromAgentId = String(body.fromAgentId || 'router-agent').trim().toLowerCase();
    const capability = String(body.capability || '').trim();
    const mode = String(body.mode || 'a2a').trim().toLowerCase();
    const channel = String(body.channel || 'dm').trim().toLowerCase() || 'dm';
    const hopIndex = Number.isFinite(Number(body.hopIndex)) ? Number(body.hopIndex) : 1;
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
    const paymentIntent =
      body.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
        ? body.paymentIntent
        : {};
  
    const envelope = {
      kind: 'task-envelope',
      protocolVersion: 'kite-agent-task-v1',
      traceId,
      requestId,
      taskId,
      fromAgentId,
      toAgentId,
      channel,
      hopIndex,
      mode,
      capability,
      input,
      paymentIntent,
      expectsReply: body.expectsReply !== false,
      timestamp: new Date().toISOString()
    };
    const quote = resolveAuditQuoteFromPaymentIntent(paymentIntent, capability, `Actor:${toAgentId || 'unknown'}`);
    appendNetworkAuditEvent({
      traceId,
      requestId,
      taskId,
      type: 'negotiation.quote.request',
      actorId: `Actor:${fromAgentId || 'router-agent'}`,
      summary: {
        quote,
        sla: {
          timeoutMs: AGENT001_BIND_TIMEOUT_MS,
          retries: KITE_SESSION_PAY_RETRIES,
          maxLatencyMs: AGENT001_BIND_TIMEOUT_MS
        },
        fromAgentId,
        toAgentId,
        capability,
        mode,
        channel
      },
      refs: {
        workflow: `/api/workflow/${encodeURIComponent(traceId)}`,
        evidence: `/api/evidence/export?traceId=${encodeURIComponent(traceId)}`
      }
    });
  
    if (!xmtpRuntime.getStatus().running && body.autoStart !== false) {
      await startXmtpRuntimes();
    }
    const result = await xmtpRuntime.sendDm({
      fromAgentId,
      toAgentId,
      toAddress: body.toAddress,
      channel,
      hopIndex,
      envelope,
      traceId,
      requestId,
      taskId
    });
    if (!result?.ok) {
      appendNetworkAuditEvent({
        traceId,
        requestId,
        taskId,
        type: 'transport.dispatch',
        actorId: `Actor:${fromAgentId || 'router-agent'}`,
        summary: {
          status: 'failed',
          reason: result?.reason || result?.error || 'network_task_send_failed',
          channel,
          mode,
          capability,
          fromAgentId,
          toAgentId
        },
        refs: {
          evidence: `/api/evidence/export?traceId=${encodeURIComponent(traceId)}`
        }
      });
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: result?.error || 'network_task_send_failed',
        reason: result?.reason || 'network_task_send_failed',
        details: result
      });
    }
    appendNetworkAuditEvent({
      traceId,
      requestId,
      taskId,
      type: 'transport.dispatch',
      actorId: `Actor:${fromAgentId || 'router-agent'}`,
      summary: {
        status: 'sent',
        channel,
        mode,
        capability,
        fromAgentId,
        toAgentId
      },
      refs: {
        evidence: `/api/evidence/export?traceId=${encodeURIComponent(traceId)}`
      }
    });
  
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      task: {
        fromAgentId,
        toAgentId,
        traceId,
        requestId,
        taskId,
        channel,
        hopIndex,
        mode,
        capability
      },
      xmtp: result
    });
  });
  
  app.post('/api/network/demo/router-info-technical/run', requireRole('agent'), async (req, res) => {
    const body = req.body || {};
    const autoStart = body.autoStart !== false;
    const retryOnTimeout = body.retryOnTimeout !== false;
    if (autoStart) {
      await startXmtpRuntimes();
    }
    const isRuntimeUnhealthy = (status = {}) => {
      if (!status || typeof status !== 'object') return true;
      if (!status.enabled) return true;
      if (!status.configured) return true;
      if (!status.running) return true;
      const reason = String(status.lastError || '').trim().toLowerCase();
      if (!reason) return false;
      return (
        reason.includes('conversation streaming') ||
        reason.includes('streaming') ||
        reason.includes('incoming_handler') ||
        reason.includes('unhandled')
      );
    };
    const healRuntime = async (runtime, runtimeLabel) => {
      const before = runtime.getStatus();
      if (!isRuntimeUnhealthy(before)) {
        return {
          label: runtimeLabel,
          attempted: false,
          recovered: true,
          attempts: 0,
          before,
          after: before
        };
      }
      let after = before;
      let attempts = 0;
      let recovered = false;
      const maxAttempts = 3;
      while (attempts < maxAttempts && !recovered) {
        attempts += 1;
        try {
          await runtime.stop();
        } catch {
          // noop
        }
        try {
          after = await runtime.start();
        } catch {
          after = runtime.getStatus();
        }
        recovered = Boolean(after?.running) && !isRuntimeUnhealthy(after);
        if (!recovered && typeof waitMs === 'function') {
          await waitMs(650 * attempts);
        }
      }
      return {
        label: runtimeLabel,
        attempted: true,
        attempts,
        recovered,
        before,
        after
      };
    };
    const recovery = [];
    recovery.push(await healRuntime(xmtpRuntime, 'router'));
    recovery.push(await healRuntime(xmtpReaderRuntime, 'reader'));
    recovery.push(await healRuntime(xmtpRiskRuntime, 'risk'));
  
    const routerStatus = xmtpRuntime.getStatus();
    const readerStatus = xmtpReaderRuntime.getStatus();
    const riskStatus = xmtpRiskRuntime.getStatus();
    if (!routerStatus.running) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'xmtp_router_not_running',
        reason: routerStatus.lastError || 'router runtime is not running',
        recovery
      });
    }
    if (!readerStatus.running) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'xmtp_reader_not_running',
        reason: readerStatus.lastError || 'reader runtime is not running',
        recovery
      });
    }
    if (!riskStatus.running) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'xmtp_risk_not_running',
        reason: riskStatus.lastError || 'risk runtime is not running',
        recovery
      });
    }
  
    const readerAgent = findNetworkAgentById('reader-agent');
    const technicalAgent = findNetworkAgentById('technical-agent') || findNetworkAgentById('risk-agent');
    const infoAddress = normalizeAddress(body.infoToAddress || readerAgent?.xmtpAddress || XMTP_READER_RESOLVED_ADDRESS);
    const technicalAddress = normalizeAddress(
      body.technicalToAddress || technicalAgent?.xmtpAddress || XMTP_RISK_RESOLVED_ADDRESS
    );
    if (!infoAddress || !technicalAddress) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'agent_address_missing',
        reason: 'Set reader/risk(technical) XMTP address mapping before running info-technical demo.'
      });
    }
  
    const traceId = String(body.traceId || createTraceId('router_it_trace')).trim();
    const requestId = String(body.requestId || createTraceId('router_it_req')).trim();
    const infoTaskId = String(body.infoTaskId || createTraceId('router_it_info')).trim();
    const technicalTaskId = String(body.technicalTaskId || createTraceId('router_it_tech')).trim();
  
    const parseFlag = (value, fallback = false) => {
      if (typeof value === 'boolean') return value;
      const text = String(value || '').trim().toLowerCase();
      if (!text) return fallback;
      if (['1', 'true', 'yes', 'on', 'y'].includes(text)) return true;
      if (['0', 'false', 'no', 'off', 'n'].includes(text)) return false;
      return fallback;
    };
    const bindPaymentMode = String(body?.bindPayment || body?.paymentMode || body?.payment?.mode || '').trim().toLowerCase();
    const strictRealPayment = parseFlag(body?.strictRealPayment, false);
    const bindRealX402 = parseFlag(body?.bindRealX402, false) || ['real', 'x402'].includes(bindPaymentMode) || strictRealPayment;
    const strictBinding = parseFlag(body?.strictBinding, false) || strictRealPayment;
    const prebindOnly = parseFlag(body?.prebindOnly, false);
    const resolveInfoTaskMode = () => {
      const allowedModes = new Set(['auto', 'market-data', 'opennews', 'opentwitter', 'multi-provider']);
      const candidates = [body?.infoMode, body?.analysisMode, body?.mode];
      for (const raw of candidates) {
        const value = String(raw || '').trim().toLowerCase();
        if (allowedModes.has(value)) return value;
      }
      return 'auto';
    };
    const infoTaskMode = resolveInfoTaskMode();
    const infoBody = {
      ...body,
      bindRealX402,
      strictBinding,
      prebindOnly,
      action: String(body?.infoAction || body?.action || 'info-analysis-feed').trim().toLowerCase(),
      input:
        body?.infoInput && typeof body.infoInput === 'object' && !Array.isArray(body.infoInput)
          ? body.infoInput
          : {
              url: body?.url || body?.resourceUrl || 'https://newshacker.me/',
              mode: infoTaskMode,
              maxChars: body?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
            }
    };
    const technicalBody = {
      ...body,
      bindRealX402,
      strictBinding,
      prebindOnly,
      action: String(body?.technicalAction || body?.action || 'technical-analysis-feed').trim().toLowerCase(),
      input:
        body?.technicalInput && typeof body.technicalInput === 'object' && !Array.isArray(body.technicalInput)
          ? body.technicalInput
          : {
              symbol: body?.symbol || body?.pair || 'BTCUSDT',
              source: body?.source || 'hyperliquid',
              horizonMin: body?.horizonMin ?? 60
            }
    };
  
    let infoPaymentPlan = null;
    let technicalPaymentPlan = null;
    const infoPaymentBuilder =
      typeof buildXReaderPaymentIntentForTask === 'function'
        ? buildXReaderPaymentIntentForTask
        : typeof buildInfoPaymentIntentForTask === 'function'
          ? buildInfoPaymentIntentForTask
          : null;
    if (!infoPaymentBuilder || typeof buildRiskScorePaymentIntentForTask !== 'function') {
      return res.status(500).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'runtime_dependency_missing',
        reason:
          'payment intent builders are not injected. expected buildXReader/buildInfo + buildRiskScore functions.'
      });
    }
    try {
      infoPaymentPlan = await infoPaymentBuilder({
        body: infoBody,
        traceId,
        fallbackRequestId: `${requestId}_info`,
        defaultTask: {
          url: 'https://newshacker.me/',
          mode: 'auto',
          maxChars: X_READER_MAX_CHARS_DEFAULT
        }
      });
      technicalPaymentPlan = await buildRiskScorePaymentIntentForTask({
        body: technicalBody,
        traceId,
        fallbackRequestId: `${requestId}_technical`,
        defaultTask: {
          symbol: 'BTCUSDT',
          source: 'hyperliquid',
          horizonMin: 60
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'bind_real_x402_failed',
        reason: error?.message || 'bind_real_x402_failed'
      });
    }
  
    const buildTaskEnvelope = ({ taskId, toAgentId, capability, input, paymentIntent }) => ({
      kind: 'task-envelope',
      protocolVersion: 'kite-agent-task-v1',
      traceId,
      requestId,
      taskId,
      fromAgentId: 'router-agent',
      toAgentId,
      channel: 'dm',
      hopIndex: 1,
      mode: 'a2a',
      capability,
      input,
      paymentIntent,
      expectsReply: true,
      timestamp: new Date().toISOString()
    });
  
    const infoEnvelope = buildTaskEnvelope({
      taskId: infoTaskId,
      toAgentId: 'reader-agent',
      capability: String(body.infoCapability || 'info-analysis-feed').trim(),
      input: infoPaymentPlan.normalizedTask,
      paymentIntent: infoPaymentPlan.paymentIntent
    });
    const technicalEnvelope = buildTaskEnvelope({
      taskId: technicalTaskId,
      toAgentId: String(body.technicalAgentId || technicalAgent?.id || 'technical-agent').trim().toLowerCase(),
      capability: String(body.technicalCapability || 'technical-analysis-feed').trim(),
      input: technicalPaymentPlan.normalizedTask,
      paymentIntent: technicalPaymentPlan.paymentIntent
    });
    const waitMsDefault = bindRealX402 ? 90_000 : 15_000;
    const waitMsLimit = Math.max(1000, Math.min(Number(body.waitMs || waitMsDefault), 180_000));
    const infoQuote = resolveAuditQuoteFromPaymentIntent(
      infoPaymentPlan.paymentIntent,
      infoEnvelope.capability,
      `Actor:${infoEnvelope.toAgentId}`
    );
    const technicalQuote = resolveAuditQuoteFromPaymentIntent(
      technicalPaymentPlan.paymentIntent,
      technicalEnvelope.capability,
      `Actor:${technicalEnvelope.toAgentId}`
    );
    appendNetworkAuditEvent({
      traceId,
      requestId,
      taskId: infoTaskId,
      type: 'negotiation.quote.response',
      actorId: `Actor:${infoEnvelope.toAgentId}`,
      summary: {
        quote: infoQuote,
        sla: {
          timeoutMs: waitMsLimit,
          retries: retryOnTimeout ? 2 : 1,
          maxLatencyMs: waitMsLimit
        },
        capability: infoEnvelope.capability,
        fromAgentId: infoEnvelope.fromAgentId,
        toAgentId: infoEnvelope.toAgentId,
        mode: infoEnvelope.mode,
        channel: infoEnvelope.channel
      }
    });
    appendNetworkAuditEvent({
      traceId,
      requestId,
      taskId: technicalTaskId,
      type: 'negotiation.quote.response',
      actorId: `Actor:${technicalEnvelope.toAgentId}`,
      summary: {
        quote: technicalQuote,
        sla: {
          timeoutMs: waitMsLimit,
          retries: retryOnTimeout ? 2 : 1,
          maxLatencyMs: waitMsLimit
        },
        capability: technicalEnvelope.capability,
        fromAgentId: technicalEnvelope.fromAgentId,
        toAgentId: technicalEnvelope.toAgentId,
        mode: technicalEnvelope.mode,
        channel: technicalEnvelope.channel
      }
    });
  
    const infoSent = await xmtpRuntime.sendDm({
      fromAgentId: 'router-agent',
      toAgentId: infoEnvelope.toAgentId,
      toAddress: infoAddress,
      channel: 'dm',
      hopIndex: 1,
      envelope: infoEnvelope,
      traceId,
      requestId,
      taskId: infoTaskId
    });
    if (!infoSent?.ok) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: infoSent?.error || 'info_task_send_failed',
        reason: infoSent?.reason || 'info_task_send_failed',
        details: infoSent
      });
    }
  
    const technicalSent = await xmtpRuntime.sendDm({
      fromAgentId: 'router-agent',
      toAgentId: technicalEnvelope.toAgentId,
      toAddress: technicalAddress,
      channel: 'dm',
      hopIndex: 1,
      envelope: technicalEnvelope,
      traceId,
      requestId,
      taskId: technicalTaskId
    });
    if (!technicalSent?.ok) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: technicalSent?.error || 'technical_task_send_failed',
        reason: technicalSent?.reason || 'technical_task_send_failed',
        details: technicalSent
      });
    }
  
    const waitTaskResultEvent = async (taskId, timeoutMs = 15000) => {
      const timeout = Math.max(1000, Math.min(Number(timeoutMs || 15000), 180000));
      const deadline = Date.now() + timeout;
      while (Date.now() <= deadline) {
        const hits = xmtpRuntime.listEvents({
          kind: 'task-result',
          taskId
        });
        const scoped = (Array.isArray(hits) ? hits : []).filter((row) => {
          const rowTraceId = String(row?.traceId || '').trim();
          const rowRequestId = String(row?.requestId || '').trim();
          if (rowTraceId && rowTraceId !== traceId) return false;
          if (rowRequestId && rowRequestId !== requestId) return false;
          return true;
        });
        if (scoped.length > 0) {
          const preferred =
            scoped.find(
              (row) =>
                String(row?.runtimeName || '').trim() === 'router-runtime' &&
                String(row?.direction || '').trim() === 'inbound'
            ) ||
            scoped.find((row) => {
              const runtimeName = String(row?.runtimeName || '').trim();
              const direction = String(row?.direction || '').trim();
              return direction === 'outbound' && ['reader-runtime', 'risk-runtime'].includes(runtimeName);
            }) ||
            scoped[0];
          return preferred || null;
        }
        await waitMs(350);
      }
      return null;
    };
  
    let [infoEvent, technicalEvent] = await Promise.all([
      waitTaskResultEvent(infoTaskId, waitMsLimit),
      waitTaskResultEvent(technicalTaskId, waitMsLimit)
    ]);
    let infoRetrySent = null;
    let technicalRetrySent = null;
    let infoRetryEvent = null;
    let technicalRetryEvent = null;
    let infoResolvedTaskId = infoTaskId;
    let technicalResolvedTaskId = technicalTaskId;
    const retryWarnings = [];
  
    const retryWaitMs = Math.max(3000, Math.min(Math.round(waitMsLimit * 0.6), 90000));
    if (retryOnTimeout && !infoEvent) {
      const infoRetryTaskId = `${infoTaskId}_r1`;
      const infoRetryEnvelope = {
        ...infoEnvelope,
        taskId: infoRetryTaskId,
        timestamp: new Date().toISOString()
      };
      infoRetrySent = await xmtpRuntime.sendDm({
        fromAgentId: 'router-agent',
        toAgentId: infoRetryEnvelope.toAgentId,
        toAddress: infoAddress,
        channel: 'dm',
        hopIndex: 1,
        envelope: infoRetryEnvelope,
        traceId,
        requestId,
        taskId: infoRetryTaskId
      });
      if (infoRetrySent?.ok) {
        infoRetryEvent = await waitTaskResultEvent(infoRetryTaskId, retryWaitMs);
        if (infoRetryEvent) {
          infoEvent = infoRetryEvent;
          infoResolvedTaskId = infoRetryTaskId;
        }
      } else {
        retryWarnings.push(`info_retry_send_failed:${String(infoRetrySent?.reason || infoRetrySent?.error || 'unknown').trim()}`);
      }
    }
  
    if (retryOnTimeout && !technicalEvent) {
      const technicalRetryTaskId = `${technicalTaskId}_r1`;
      const technicalRetryEnvelope = {
        ...technicalEnvelope,
        taskId: technicalRetryTaskId,
        timestamp: new Date().toISOString()
      };
      technicalRetrySent = await xmtpRuntime.sendDm({
        fromAgentId: 'router-agent',
        toAgentId: technicalRetryEnvelope.toAgentId,
        toAddress: technicalAddress,
        channel: 'dm',
        hopIndex: 1,
        envelope: technicalRetryEnvelope,
        traceId,
        requestId,
        taskId: technicalRetryTaskId
      });
      if (technicalRetrySent?.ok) {
        technicalRetryEvent = await waitTaskResultEvent(technicalRetryTaskId, retryWaitMs);
        if (technicalRetryEvent) {
          technicalEvent = technicalRetryEvent;
          technicalResolvedTaskId = technicalRetryTaskId;
        }
      } else {
        retryWarnings.push(
          `technical_retry_send_failed:${String(technicalRetrySent?.reason || technicalRetrySent?.error || 'unknown').trim()}`
        );
      }
    }
  
    const infoTaskResult =
      infoEvent?.parsed && typeof infoEvent.parsed === 'object' && !Array.isArray(infoEvent.parsed)
        ? infoEvent.parsed
        : null;
    const technicalTaskResult =
      technicalEvent?.parsed && typeof technicalEvent.parsed === 'object' && !Array.isArray(technicalEvent.parsed)
        ? technicalEvent.parsed
        : null;
    const infoAnalysis =
      infoTaskResult?.result?.info ||
      infoTaskResult?.result?.analysis ||
      null;
    const technicalAnalysis =
      technicalTaskResult?.result?.analysis ||
      technicalTaskResult?.result?.technical ||
      null;
    const infoConfidence = Number(infoAnalysis?.confidence);
    const technicalConfidence = Number(technicalAnalysis?.confidence);
    const confidenceCandidates = [infoConfidence, technicalConfidence].filter((item) => Number.isFinite(item));
    const confidenceBlend =
      confidenceCandidates.length > 0
        ? Number((confidenceCandidates.reduce((sum, item) => sum + item, 0) / confidenceCandidates.length).toFixed(4))
        : null;
    const failedStatuses = ['failed', 'error', 'rejected'];
    const buildTaskDispatchState = ({ label = 'task', event = null, taskResult = null, retrySent = null, retryEvent = null }) => {
      const resultReceived = Boolean(event);
      if (!resultReceived) {
        return {
          status: 'timeout',
          success: false,
          resultReceived: false,
          failure: {
            code: 'task_result_timeout',
            reason: `${label} no task-result within ${waitMsLimit}ms`,
            retryAttempted: Boolean(retrySent),
            retrySucceeded: Boolean(retryEvent)
          }
        };
      }
      if (!taskResult || typeof taskResult !== 'object' || Array.isArray(taskResult)) {
        return {
          status: 'failed',
          success: false,
          resultReceived: true,
          failure: {
            code: 'task_result_invalid',
            reason: `${label} returned invalid task-result payload`,
            retryAttempted: Boolean(retrySent),
            retrySucceeded: Boolean(retryEvent)
          }
        };
      }
      const statusRaw = String(taskResult?.status || '').trim().toLowerCase();
      if (failedStatuses.includes(statusRaw)) {
        const reason =
          String(taskResult?.error || taskResult?.result?.summary || '').trim() || `${label} returned failed task-result`;
        return {
          status: 'failed',
          success: false,
          resultReceived: true,
          failure: {
            code: 'task_result_failed',
            reason,
            retryAttempted: Boolean(retrySent),
            retrySucceeded: Boolean(retryEvent)
          }
        };
      }
      return {
        status: 'success',
        success: true,
        resultReceived: true,
        failure: null
      };
    };
  
    const infoState = buildTaskDispatchState({
      label: 'info',
      event: infoEvent,
      taskResult: infoTaskResult,
      retrySent: infoRetrySent,
      retryEvent: infoRetryEvent
    });
    const technicalState = buildTaskDispatchState({
      label: 'technical',
      event: technicalEvent,
      taskResult: technicalTaskResult,
      retrySent: technicalRetrySent,
      retryEvent: technicalRetryEvent
    });
    const successCount = Number(infoState.success) + Number(technicalState.success);
    const failureCount = 2 - successCount;
    const anyResultReceived = Boolean(infoState.resultReceived || technicalState.resultReceived);
    const partialFailure = successCount > 0 && failureCount > 0;
    const failReasons = [infoState.failure?.reason, technicalState.failure?.reason].filter(Boolean);
    let selectedActorId = '';
    let selectedQuote = null;
    let selectedExplanation = '';
    const reasonCodes = [];
    if (infoState.success && technicalState.success) {
      const pickTechnical =
        Number.isFinite(technicalConfidence) && Number.isFinite(infoConfidence)
          ? technicalConfidence >= infoConfidence
          : true;
      selectedActorId = pickTechnical ? technicalEnvelope.toAgentId : infoEnvelope.toAgentId;
      selectedQuote = pickTechnical ? technicalQuote : infoQuote;
      reasonCodes.push('both_success', 'confidence_priority');
      selectedExplanation = pickTechnical
        ? 'Both actors returned success; selected technical actor by confidence priority.'
        : 'Both actors returned success; selected info actor by confidence priority.';
    } else if (technicalState.success) {
      selectedActorId = technicalEnvelope.toAgentId;
      selectedQuote = technicalQuote;
      reasonCodes.push('technical_success', 'info_failed_or_timeout');
      selectedExplanation = 'Technical actor succeeded while info actor failed or timed out.';
    } else if (infoState.success) {
      selectedActorId = infoEnvelope.toAgentId;
      selectedQuote = infoQuote;
      reasonCodes.push('info_success', 'technical_failed_or_timeout');
      selectedExplanation = 'Info actor succeeded while technical actor failed or timed out.';
    } else {
      reasonCodes.push('no_success');
      selectedExplanation = failReasons.length > 0 ? failReasons.join(' | ') : 'No successful task result.';
    }
    appendNetworkAuditEvent({
      traceId,
      requestId,
      type: 'negotiation.quote.selected',
      actorId: 'Actor:Orchestrator',
      summary: {
        quote: selectedQuote,
        sla: {
          timeoutMs: waitMsLimit,
          retries: retryOnTimeout ? 2 : 1,
          maxLatencyMs: waitMsLimit
        },
        rationale: {
          selectedActorId,
          reasonCodes,
          explanation: selectedExplanation
        }
      },
      refs: {
        evidence: `/api/evidence/export?traceId=${encodeURIComponent(traceId)}`
      }
    });
    appendNetworkAuditEvent({
      traceId,
      requestId,
      type: 'decision.final',
      actorId: 'Actor:Orchestrator',
      summary: {
        status: successCount > 0 ? (partialFailure ? 'partial_success' : 'success') : 'failed',
        resultSummary: selectedExplanation,
        rationale: {
          selectedActorId,
          reasonCodes,
          explanation: selectedExplanation
        }
      }
    });

    const rawText = String(body.agent001Text || body.text || body.query || '').trim();
    const normalizedTechnicalTask =
      technicalPaymentPlan?.normalizedTask &&
      typeof technicalPaymentPlan.normalizedTask === 'object' &&
      !Array.isArray(technicalPaymentPlan.normalizedTask)
        ? technicalPaymentPlan.normalizedTask
        : {};
    const normalizedInfoTask =
      infoPaymentPlan?.normalizedTask &&
      typeof infoPaymentPlan.normalizedTask === 'object' &&
      !Array.isArray(infoPaymentPlan.normalizedTask)
        ? infoPaymentPlan.normalizedTask
        : {};
    const agent001Intent = {
      symbol: String(normalizedTechnicalTask.symbol || body.symbol || body.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
      horizonMin: Number.isFinite(Number(normalizedTechnicalTask.horizonMin))
        ? Number(normalizedTechnicalTask.horizonMin)
        : Number.isFinite(Number(body.horizonMin))
          ? Number(body.horizonMin)
          : 60,
      source: String(normalizedTechnicalTask.source || body.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid',
      topic: String(normalizedInfoTask.topic || normalizedInfoTask.url || body.topic || body.url || rawText).trim()
    };
    let agent001Decision = null;
    if (typeof buildAgent001TradePlan === 'function') {
      try {
        const draftTradePlan = buildAgent001TradePlan({
          rawText,
          intent: agent001Intent,
          technical: {
            ok: technicalState.success,
            taskResult: { result: technicalTaskResult?.result || {} },
            reason: technicalState.failure?.reason || ''
          },
          info: {
            ok: infoState.success,
            taskResult: { result: infoTaskResult?.result || {} },
            reason: infoState.failure?.reason || ''
          },
          returnObject: true
        });
        const directives =
          typeof parseAgent001OrderDirectives === 'function'
            ? parseAgent001OrderDirectives(rawText)
            : {};
        const forceOrderRequested =
          (typeof isAgent001ForceOrderRequested === 'function' && isAgent001ForceOrderRequested(rawText)) ||
          Boolean(directives?.forceExecute);
        const explicitOrderRequested = Boolean(directives?.explicitOrder);
        const shouldCoercePlan = forceOrderRequested || explicitOrderRequested;
        const effectiveTradePlan =
          shouldCoercePlan && typeof coerceAgent001ForcedTradePlan === 'function'
            ? coerceAgent001ForcedTradePlan({
                rawText,
                tradePlan: draftTradePlan,
                technical: { taskResult: { result: technicalTaskResult?.result || {} } },
                info: { taskResult: { result: infoTaskResult?.result || {} } },
                directives
              })
            : draftTradePlan;
        const planVersion = String(effectiveTradePlan?.planVersion || 'v1.1-en').trim() || 'v1.1-en';
        const generatedAt = String(effectiveTradePlan?.generatedAt || new Date().toISOString()).trim();
        agent001Decision = {
          shouldPlaceOrder: Boolean(effectiveTradePlan?.canPlaceOrder),
          decision: String(effectiveTradePlan?.decision || '').trim(),
          reason: String(
            effectiveTradePlan?.forceOrderReason || effectiveTradePlan?.decisionReason || selectedExplanation || ''
          ).trim(),
          text: String(effectiveTradePlan?.text || '').trim(),
          version: planVersion,
          generatedAt,
          plan: {
            symbol: String(effectiveTradePlan?.symbol || agent001Intent.symbol).trim().toUpperCase() || 'BTCUSDT',
            side: String(effectiveTradePlan?.side || '').trim().toLowerCase(),
            orderType: String(effectiveTradePlan?.orderType || 'limit').trim().toLowerCase() || 'limit',
            tif: String(effectiveTradePlan?.tif || '').trim(),
            size: Number.isFinite(Number(effectiveTradePlan?.size)) ? Number(effectiveTradePlan.size) : null,
            entryPrice: Number.isFinite(Number(effectiveTradePlan?.entryPrice))
              ? Number(effectiveTradePlan.entryPrice)
              : null,
            takeProfit: Number.isFinite(Number(effectiveTradePlan?.takePrice))
              ? Number(effectiveTradePlan.takePrice)
              : null,
            stopLoss: Number.isFinite(Number(effectiveTradePlan?.stopPrice))
              ? Number(effectiveTradePlan.stopPrice)
              : null
          },
          forceOrderRequested,
          explicitOrderRequested
        };
      } catch (error) {
        agent001Decision = {
          shouldPlaceOrder: false,
          decision: 'decision_build_failed',
          reason: String(error?.message || 'failed to build agent001 decision').trim(),
          version: 'v1.1-en',
          generatedAt: new Date().toISOString()
        };
      }
    }
  
    const responsePayload = {
      traceId: req.traceId || '',
      command: {
        type: 'router-info-technical',
        traceId,
        requestId
      },
      resultReceived: anyResultReceived,
      partialFailure,
      tasks: {
        info: {
          taskId: infoResolvedTaskId,
          originalTaskId: infoTaskId,
          toAgentId: infoEnvelope.toAgentId,
          capability: infoEnvelope.capability,
          sent: infoSent,
          status: infoState.status,
          success: infoState.success,
          failure: infoState.failure,
          resultReceived: infoState.resultReceived,
          retrySent: infoRetrySent,
          retryResultEvent: infoRetryEvent,
          resultEvent: infoEvent,
          taskResult: infoTaskResult
        },
        technical: {
          taskId: technicalResolvedTaskId,
          originalTaskId: technicalTaskId,
          toAgentId: technicalEnvelope.toAgentId,
          capability: technicalEnvelope.capability,
          sent: technicalSent,
          status: technicalState.status,
          success: technicalState.success,
          failure: technicalState.failure,
          resultReceived: technicalState.resultReceived,
          retrySent: technicalRetrySent,
          retryResultEvent: technicalRetryEvent,
          resultEvent: technicalEvent,
          taskResult: technicalTaskResult
        }
      },
      summary: {
        infoSummary: String(infoTaskResult?.result?.summary || '').trim(),
        technicalSummary: String(technicalTaskResult?.result?.summary || '').trim(),
        confidenceBlend,
        successCount,
        failureCount
      },
      analysis: {
        info: infoAnalysis,
        technical: technicalAnalysis
      },
      agent001Decision,
      paymentBinding: {
        info: infoPaymentPlan.workflowBinding || null,
        technical: technicalPaymentPlan.workflowBinding || null
      },
      warnings: [
        ...(Array.isArray(infoPaymentPlan.warnings) ? infoPaymentPlan.warnings : []),
        ...(Array.isArray(technicalPaymentPlan.warnings) ? technicalPaymentPlan.warnings : []),
        ...retryWarnings
      ],
      runtime: getAllXmtpRuntimeStatuses()
    };
  
    if (successCount <= 0) {
      return res.status(502).json({
        ok: false,
        ...responsePayload,
        error: 'all_tasks_failed',
        reason: failReasons.join(' | ') || `info/technical no task-result within ${waitMsLimit}ms`
      });
    }
  
    return res.json({
      ok: true,
      ...responsePayload
    });
  });

  app.get('/api/network/demo/router-info-technical/stream', requireRole('agent'), async (req, res) => {
    const parseIntSafe = (value, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(1000, Math.min(Math.floor(n), 240000));
    };
    const traceId = String(req.query?.traceId || '').trim();
    const requestId = String(req.query?.requestId || '').trim();
    const infoTaskId = String(req.query?.infoTaskId || '').trim();
    const technicalTaskId = String(req.query?.technicalTaskId || '').trim();
    const waitLimitMs = parseIntSafe(req.query?.waitMs, 180000);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;
    const safeWait = typeof waitMs === 'function'
      ? waitMs
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const emit = (eventName, payload) => {
      if (closed) return;
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
    };
    const closeStream = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        // noop
      }
    };

    const heartbeat = setInterval(() => {
      emit('ping', { ts: new Date().toISOString() });
    }, 10000);

    req.on('close', () => {
      closeStream();
    });

    if (!traceId || !requestId || !infoTaskId || !technicalTaskId) {
      emit('error', {
        ok: false,
        error: 'stream_missing_ids',
        reason: 'traceId/requestId/infoTaskId/technicalTaskId are required for stream watch.'
      });
      emit('done', { ok: false });
      closeStream();
      return;
    }

    const filterScopedEvents = (rows = []) =>
      (Array.isArray(rows) ? rows : []).filter((row) => {
        const rowTraceId = String(row?.traceId || '').trim();
        const rowRequestId = String(row?.requestId || '').trim();
        if (rowTraceId && rowTraceId !== traceId) return false;
        if (rowRequestId && rowRequestId !== requestId) return false;
        return true;
      });

    const seen = {
      ercStarted: false,
      ercCompleted: false,
      quoteStarted: false,
      quoteCompleted: false,
      settleStarted: false,
      settlePayProof: false,
      settleVerify: false,
      infoReturn: false,
      technicalReturn: false,
      serviceResult: false
    };
    const startedAt = Date.now();
    const x402MinVisibleMs = parseIntSafe(req.query?.x402MinVisibleMs, 3500);
    let x402StartedAt = 0;

    emit('meta', {
      ok: true,
      traceId,
      requestId,
      infoTaskId,
      technicalTaskId,
      waitMs: waitLimitMs
    });

    while (!closed && Date.now() - startedAt < waitLimitMs) {
      const elapsed = Date.now() - startedAt;

      if (!seen.ercStarted) {
        seen.ercStarted = true;
        emit('step', {
          stepId: 'erc8004_verify',
          status: 'started',
          message: 'ERC8004 verification started.'
        });
      }
      if (!seen.ercCompleted && elapsed >= 1000) {
        seen.ercCompleted = true;
        emit('step', {
          stepId: 'erc8004_verify',
          status: 'completed',
          message: 'ERC8004 verification completed.'
        });
      }
      if (!seen.quoteStarted && elapsed >= 1000) {
        seen.quoteStarted = true;
        emit('step', {
          stepId: 'xmtp_quote_request',
          status: 'started',
          message: 'XMTP quote negotiation started.'
        });
      }
      if (!seen.quoteCompleted && elapsed >= 3000) {
        seen.quoteCompleted = true;
        emit('step', {
          stepId: 'xmtp_quote_request',
          status: 'completed',
          message: 'XMTP quote negotiation dispatched.'
        });
        seen.settleStarted = true;
        x402StartedAt = Date.now();
        emit('step', {
          stepId: 'x402_settlement',
          status: 'started',
          phase: 'challenge',
          message: 'x402 settlement in progress.'
        });
      }

      let infoTaskResult = null;
      let technicalTaskResult = null;
      try {
        infoTaskResult = filterScopedEvents(
          xmtpRuntime.listEvents({
            kind: 'task-result',
            taskId: infoTaskId
          })
        )[0] || null;
        technicalTaskResult = filterScopedEvents(
          xmtpRuntime.listEvents({
            kind: 'task-result',
            taskId: technicalTaskId
          })
        )[0] || null;
      } catch {
        // noop
      }

      if (seen.settleStarted) {
        const x402Elapsed = x402StartedAt > 0 ? Date.now() - x402StartedAt : 0;
        if (!seen.settlePayProof && x402Elapsed >= 800) {
          seen.settlePayProof = true;
          emit('step', {
            stepId: 'x402_settlement',
            status: 'progress',
            phase: 'pay+proof'
          });
        }
        if (!seen.settleVerify && x402Elapsed >= 1700) {
          seen.settleVerify = true;
          emit('step', {
            stepId: 'x402_settlement',
            status: 'progress',
            phase: 'verify'
          });
        }
        if (!seen.infoReturn && infoTaskResult) {
          seen.infoReturn = true;
          emit('step', {
            stepId: 'xmtp_quote_return',
            status: 'partial',
            branch: 'info',
            message: 'Info-side quote/result returned.'
          });
        }
        if (!seen.technicalReturn && technicalTaskResult) {
          seen.technicalReturn = true;
          emit('step', {
            stepId: 'xmtp_quote_return',
            status: 'partial',
            branch: 'technical',
            message: 'Technical-side quote/result returned.'
          });
        }
      }

      if (seen.infoReturn && seen.technicalReturn && !seen.serviceResult) {
        const x402Elapsed = x402StartedAt > 0 ? Date.now() - x402StartedAt : 0;
        if (x402Elapsed < x402MinVisibleMs) {
          await safeWait(200);
          continue;
        }
        seen.serviceResult = true;
        emit('step', {
          stepId: 'xmtp_quote_return',
          status: 'completed',
          message: 'XMTP quote return completed.'
        });
        emit('step', {
          stepId: 'x402_settlement',
          status: 'completed',
          phase: 'unlock',
          message: 'x402 settlement completed.'
        });
        emit('step', {
          stepId: 'xmtp_service_result',
          status: 'completed',
          message: 'Service results are ready for Agent001 summary.'
        });
        emit('done', { ok: true, traceId, requestId });
        closeStream();
        return;
      }

      await safeWait(300);
    }

    if (!closed) {
      emit('timeout', {
        ok: false,
        error: 'stream_watch_timeout',
        reason: `No complete task-result observed within ${waitLimitMs}ms.`,
        traceId,
        requestId
      });
      emit('done', { ok: false, traceId, requestId });
      closeStream();
    }
  });
  
  app.get('/api/network/commands', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const statusFilters = parseNetworkCommandFilterList(req.query.status);
    const typeFilters = parseNetworkCommandFilterList(req.query.type);
    let rows = readNetworkCommands();
    if (statusFilters.length > 0) {
      rows = rows.filter((item) => statusFilters.includes(String(item?.status || '').trim().toLowerCase()));
    }
    if (typeFilters.length > 0) {
      rows = rows.filter((item) => typeFilters.includes(String(item?.type || '').trim().toLowerCase()));
    }
    rows.sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0));
    const items = rows.slice(0, limit);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: rows.length,
      items
    });
  });
  
  app.get('/api/network/commands/:commandId', requireRole('viewer'), (req, res) => {
    const commandId = String(req.params.commandId || '').trim();
    if (!commandId) {
      return res.status(400).json({
        ok: false,
        error: 'commandId_required',
        reason: 'commandId is required.',
        traceId: req.traceId || ''
      });
    }
    const command = findNetworkCommandById(commandId);
    if (!command) {
      return res.status(404).json({
        ok: false,
        error: 'command_not_found',
        reason: 'command not found',
        commandId,
        traceId: req.traceId || ''
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      command
    });
  });
  
  app.post('/api/network/commands', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const type = normalizeNetworkCommandType(body.type || 'router-info-technical');
      const label = String(body.label || '').trim() || type;
      const payload = normalizeNetworkCommandPayload(body.payload);
      const createdAt = new Date().toISOString();
      const commandId = String(body.commandId || createCommandId()).trim();
      const existing = findNetworkCommandById(commandId);
      const mode = existing ? 'updated' : 'created';
      const queuedEvents = appendNetworkCommandEvent(
        existing || {},
        'queued',
        existing ? 'updated' : 'created',
        existing ? `command updated: ${type}` : `command created: ${type}`,
        {
          source: 'api',
          runNow: body.runNow === true
        }
      );
      let command = upsertNetworkCommandRecord({
        ...existing,
        commandId,
        type,
        label,
        payload,
        status: existing?.status === 'running' ? 'running' : 'queued',
        error: existing?.status === 'running' ? existing.error || '' : '',
        result: existing?.status === 'running' ? existing.result || null : null,
        traceId: String(body.traceId || existing?.traceId || '').trim(),
        requestId: String(body.requestId || existing?.requestId || '').trim(),
        taskId: String(body.taskId || existing?.taskId || '').trim(),
        createdAt: existing?.createdAt || createdAt,
        updatedAt: createdAt,
        events: queuedEvents
      });
  
      if (body.runNow !== true) {
        return res.json({
          ok: true,
          traceId: req.traceId || '',
          mode,
          command
        });
      }
  
      const runResult = await executeNetworkCommand(command, {
        source: 'api-create',
        payload: normalizeNetworkCommandPayload(body.runPayload)
      });
      if (!runResult.ok) {
        return res.status(runResult.statusCode || 502).json({
          ok: false,
          traceId: req.traceId || '',
          error: runResult.error || 'network_command_run_failed',
          reason: runResult.reason || 'network_command_run_failed',
          mode,
          command: runResult.command || command
        });
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode,
        command: runResult.command,
        execution: runResult.execution
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'invalid_network_command',
        reason: error?.message || 'invalid network command payload'
      });
    }
  });
  
  app.post('/api/network/commands/:commandId/run', requireRole('agent'), async (req, res) => {
    const commandId = String(req.params.commandId || '').trim();
    if (!commandId) {
      return res.status(400).json({
        ok: false,
        error: 'commandId_required',
        reason: 'commandId is required.',
        traceId: req.traceId || ''
      });
    }
    const command = findNetworkCommandById(commandId);
    if (!command) {
      return res.status(404).json({
        ok: false,
        error: 'command_not_found',
        reason: 'command not found',
        commandId,
        traceId: req.traceId || ''
      });
    }
  
    const runResult = await executeNetworkCommand(command, {
      source: 'api-run',
      payload: normalizeNetworkCommandPayload(req.body?.payload)
    });
    if (!runResult.ok) {
      return res.status(runResult.statusCode || 502).json({
        ok: false,
        traceId: req.traceId || '',
        error: runResult.error || 'network_command_run_failed',
        reason: runResult.reason || 'network_command_run_failed',
        command: runResult.command || command
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      command: runResult.command,
      execution: runResult.execution
    });
  });
  
  app.get('/api/market/btc/price', requireRole('viewer'), async (req, res) => {
    try {
      const quote = await fetchBtcPriceQuote({
        pair: req.query.pair,
        source: req.query.source
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        quote
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'price_source_unavailable',
        reason: error?.message || 'price_source_unavailable'
      });
    }
  });
  
  app.get('/api/message-providers/status', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      providers: {
        opennews: {
          enabled: true,
          baseUrl: OPENNEWS_API_BASE,
          tokenConfigured: Boolean(OPENNEWS_TOKEN),
          timeoutMs: OPENNEWS_TIMEOUT_MS,
          retries: OPENNEWS_RETRY,
          maxRows: OPENNEWS_MAX_ROWS
        },
        opentwitter: {
          enabled: true,
          baseUrl: OPENTWITTER_API_BASE,
          tokenConfigured: Boolean(OPENTWITTER_TOKEN),
          timeoutMs: OPENTWITTER_TIMEOUT_MS,
          retries: OPENTWITTER_RETRY,
          maxRows: OPENTWITTER_MAX_ROWS
        },
        clawfeed: {
          enabled: !MESSAGE_PROVIDER_DISABLE_CLAWFEED,
          reason: MESSAGE_PROVIDER_DISABLE_CLAWFEED ? 'disabled_by_policy' : 'not_integrated_for_realtime'
        }
      },
      defaults: {
        keywords: MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
        marketDataFallback: MESSAGE_PROVIDER_MARKET_DATA_FALLBACK
      }
    });
  });
  
}
