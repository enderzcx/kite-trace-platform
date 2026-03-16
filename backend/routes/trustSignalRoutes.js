export function registerTrustSignalRoutes(app, deps) {
  const {
    appendReputationSignal,
    appendValidationRecord,
    createTraceId,
    readReputationSignals,
    readValidationRecords,
    requireRole
  } = deps;

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function normalizeScore(value = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(-1, Math.min(1, Number(parsed.toFixed(4))));
  }

  function normalizeVerdict(value = '') {
    const raw = normalizeText(value).toLowerCase();
    if (['positive', 'negative', 'neutral'].includes(raw)) return raw;
    return raw === 'completed' ? 'positive' : raw === 'rejected' ? 'negative' : 'neutral';
  }

  function normalizeValidationStatus(value = '') {
    const raw = normalizeText(value).toLowerCase();
    if (['completed', 'rejected', 'expired', 'submitted', 'pending'].includes(raw)) return raw;
    return raw || 'pending';
  }

  function buildReputationView(signal = {}) {
    return {
      signalId: normalizeText(signal?.signalId),
      agentId: normalizeText(signal?.agentId),
      sourceLane: normalizeText(signal?.sourceLane),
      sourceKind: normalizeText(signal?.sourceKind),
      referenceId: normalizeText(signal?.referenceId),
      traceId: normalizeText(signal?.traceId),
      paymentRequestId: normalizeText(signal?.paymentRequestId),
      verdict: normalizeVerdict(signal?.verdict),
      score: normalizeScore(signal?.score),
      summary: normalizeText(signal?.summary),
      evaluator: normalizeText(signal?.evaluator),
      createdAt: normalizeText(signal?.createdAt)
    };
  }

  function buildValidationView(record = {}) {
    return {
      validationId: normalizeText(record?.validationId),
      agentId: normalizeText(record?.agentId),
      referenceType: normalizeText(record?.referenceType),
      referenceId: normalizeText(record?.referenceId),
      traceId: normalizeText(record?.traceId),
      status: normalizeValidationStatus(record?.status),
      evaluator: normalizeText(record?.evaluator),
      evaluatorRef: normalizeText(record?.evaluatorRef),
      responseRef: normalizeText(record?.responseRef),
      responseHash: normalizeText(record?.responseHash),
      summary: normalizeText(record?.summary),
      createdAt: normalizeText(record?.createdAt)
    };
  }

  function buildReputationAggregate(items = []) {
    const rows = items.map((item) => buildReputationView(item));
    const count = rows.length;
    const scoreSum = rows.reduce((sum, item) => sum + normalizeScore(item?.score), 0);
    const positive = rows.filter((item) => item.verdict === 'positive').length;
    const negative = rows.filter((item) => item.verdict === 'negative').length;
    const neutral = rows.filter((item) => item.verdict === 'neutral').length;
    return {
      count,
      positive,
      negative,
      neutral,
      scoreSum: Number(scoreSum.toFixed(4)),
      averageScore: count > 0 ? Number((scoreSum / count).toFixed(4)) : 0
    };
  }

  app.get('/api/trust/reputation', requireRole('viewer'), (req, res) => {
    const agentId = normalizeText(req.query.agentId || '');
    const lane = normalizeText(req.query.lane || '').toLowerCase();
    const referenceId = normalizeText(req.query.referenceId || '');
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));

    const items = readReputationSignals()
      .filter((item) => {
        if (agentId && normalizeText(item?.agentId) !== agentId) return false;
        if (lane && normalizeText(item?.sourceLane).toLowerCase() !== lane) return false;
        if (referenceId && normalizeText(item?.referenceId) !== referenceId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildReputationView(item));

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      aggregate: buildReputationAggregate(items),
      total: items.length,
      items
    });
  });

  app.get('/api/trust/validations', requireRole('viewer'), (req, res) => {
    const agentId = normalizeText(req.query.agentId || '');
    const referenceId = normalizeText(req.query.referenceId || '');
    const status = normalizeText(req.query.status || '').toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 300));

    const items = readValidationRecords()
      .filter((item) => {
        if (agentId && normalizeText(item?.agentId) !== agentId) return false;
        if (referenceId && normalizeText(item?.referenceId) !== referenceId) return false;
        if (status && normalizeValidationStatus(item?.status) !== status) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))
      .slice(0, limit)
      .map((item) => buildValidationView(item));

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      total: items.length,
      items
    });
  });

  app.post('/api/trust/reputation', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const agentId = normalizeText(body.agentId || '');
    if (!agentId) {
      return res.status(400).json({ ok: false, error: 'agent_id_required', reason: 'agentId is required' });
    }
    const signal = appendReputationSignal({
      signalId: normalizeText(body.signalId || createTraceId('rep')),
      agentId,
      sourceLane: normalizeText(body.sourceLane || 'manual'),
      sourceKind: normalizeText(body.sourceKind || 'manual'),
      referenceId: normalizeText(body.referenceId || ''),
      traceId: normalizeText(body.traceId || ''),
      paymentRequestId: normalizeText(body.paymentRequestId || ''),
      verdict: normalizeVerdict(body.verdict),
      score: normalizeScore(body.score),
      summary: normalizeText(body.summary || ''),
      evaluator: normalizeText(body.evaluator || req.authRole || 'admin'),
      createdAt: normalizeText(body.createdAt || new Date().toISOString())
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      signal: buildReputationView(signal)
    });
  });

  app.post('/api/trust/validations', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const agentId = normalizeText(body.agentId || '');
    const referenceId = normalizeText(body.referenceId || '');
    if (!agentId) {
      return res.status(400).json({ ok: false, error: 'agent_id_required', reason: 'agentId is required' });
    }
    if (!referenceId) {
      return res.status(400).json({ ok: false, error: 'reference_id_required', reason: 'referenceId is required' });
    }
    const record = appendValidationRecord({
      validationId: normalizeText(body.validationId || createTraceId('val')),
      agentId,
      referenceType: normalizeText(body.referenceType || 'manual'),
      referenceId,
      traceId: normalizeText(body.traceId || ''),
      status: normalizeValidationStatus(body.status),
      evaluator: normalizeText(body.evaluator || req.authRole || 'admin'),
      evaluatorRef: normalizeText(body.evaluatorRef || ''),
      responseRef: normalizeText(body.responseRef || ''),
      responseHash: normalizeText(body.responseHash || ''),
      summary: normalizeText(body.summary || ''),
      createdAt: normalizeText(body.createdAt || new Date().toISOString())
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      validation: buildValidationView(record)
    });
  });
}
