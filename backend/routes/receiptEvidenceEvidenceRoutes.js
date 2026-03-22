export function registerReceiptEvidenceEvidenceRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const { requireRole } = deps;
  const { buildEvidenceExportPayloadForTrace, buildPublicEvidenceView } = helpers;

  app.get('/api/evidence/export', requireRole('viewer'), async (req, res) => {
    const result = await buildEvidenceExportPayloadForTrace(req.query.traceId);
    if (!result?.ok) {
      return res.status(Number(result?.statusCode || 400)).json({
        ok: false,
        error: String(result?.error || 'evidence_export_failed').trim(),
        traceId: String(result?.traceId || '').trim()
      });
    }
    const { traceId, exportPayload } = result;
    const shouldDownload = /^(1|true|yes|download)$/i.test(String(req.query.download || '').trim());
    if (shouldDownload) {
      const fileName = `kiteclaw_evidence_${traceId}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
    }

    return res.json({ ok: true, traceId, evidence: exportPayload });
  });

  app.get('/api/public/evidence/:traceId', async (req, res) => {
    const result = await buildEvidenceExportPayloadForTrace(req.params.traceId);
    if (!result?.ok) {
      return res.status(Number(result?.statusCode || 400)).json({
        ok: false,
        error: String(result?.error || 'public_evidence_failed').trim(),
        traceId: String(result?.traceId || req.params.traceId || '').trim()
      });
    }
    const publicEvidence = buildPublicEvidenceView(result);

    // Fetch on-chain event logs if txHash is available and ?logs=true
    const includeLogs = /^(1|true|yes)$/i.test(String(req.query.logs || '').trim());
    if (includeLogs && helpers.fetchOnchainEventLogs) {
      try {
        const txHashes = [
          publicEvidence.paymentTxHash,
          publicEvidence.jobAnchorTxHash
        ].filter(Boolean);
        const logs = await helpers.fetchOnchainEventLogs(txHashes);
        publicEvidence.onchainEventLogs = logs;
      } catch {
        publicEvidence.onchainEventLogs = null;
      }
    }

    return res.json({
      ok: true,
      traceId: String(result.traceId || '').trim(),
      evidence: publicEvidence
    });
  });
}
