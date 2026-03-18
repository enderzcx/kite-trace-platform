import { sendErrorResponse } from '../lib/errorResponse.js';
import { createRequestLogger } from '../lib/logger.js';

const logger = createRequestLogger('approval-route');

function detailFromError(error = null) {
  if (error?.data && typeof error.data === 'object' && !Array.isArray(error.data)) {
    return error.data;
  }
  return {};
}

function sendApprovalRouteError(req, res, error, fallbackCode = 'approval_request_failed', fallbackMessage = 'Approval request failed.') {
  const status = Number(error?.statusCode || 0) || 500;
  const log = status >= 500 ? logger.error : logger.warn;
  log(fallbackCode, {
    route: req?.path || '',
    method: req?.method || '',
    error: error?.message || String(error || fallbackCode),
    code: error?.code || fallbackCode
  }, req);
  return sendErrorResponse(req, res, {
    status,
    code: error?.code || fallbackCode,
    message: error?.message || fallbackMessage,
    detail: detailFromError(error)
  });
}

export function registerCoreIdentityApprovalRoutes(ctx = {}) {
  const { app, helpers = {} } = ctx;
  const {
    assertApprovalInboxAccess,
    buildApprovalListMeta,
    buildApprovalReadResponse,
    buildApprovalRequestUrl,
    buildSessionApprovalRequestPayload,
    buildUnifiedApprovalPayload,
    filterUnifiedApprovalRows,
    finalizeSessionApprovalRecord,
    getSessionApprovalRecordOrThrow,
    rejectSessionApprovalRecord
  } = helpers;

  app.get('/api/approvals', async (req, res) => {
    try {
      assertApprovalInboxAccess(req);
      const rows = filterUnifiedApprovalRows({
        state: req.query.state,
        approvalKind: req.query.approvalKind,
        owner: req.query.owner,
        limit: req.query.limit
      });
      const items = rows.map((record) => buildUnifiedApprovalPayload(record, { includeToken: false }));
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        total: items.length,
        meta: buildApprovalListMeta({
          state: req.query.state,
          approvalKind: req.query.approvalKind,
          owner: req.query.owner,
          limit: req.query.limit,
          rows
        }),
        items
      });
    } catch (error) {
      return sendApprovalRouteError(req, res, error, 'approval_list_failed', 'approval_list_failed');
    }
  });

  app.get('/api/approvals/:approvalId', async (req, res) => {
    try {
      const approvalId = String(req.params.approvalId || '').trim();
      const approvalToken = String(req.query.token || '').trim();
      const record = getSessionApprovalRecordOrThrow(approvalId, approvalToken, req);
      const responsePayload = buildApprovalReadResponse(record, { includeToken: true });
      const wantsHtml = !String(req.headers.accept || '').toLowerCase().includes('application/json');
      if (wantsHtml) {
        const frontendUrl = String(responsePayload.approval?.approvalUrl || '').trim();
        if (frontendUrl && !frontendUrl.includes('/api/approvals/')) {
          return res.redirect(302, frontendUrl);
        }
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ...responsePayload
      });
    } catch (error) {
      return sendApprovalRouteError(req, res, error, 'approval_request_read_failed', 'approval_request_read_failed');
    }
  });

  app.post('/api/approvals/:approvalId/approve', async (req, res) => {
    try {
      const approvalId = String(req.params.approvalId || '').trim();
      const approvalToken = String(req.query.token || req.body?.token || '').trim();
      const completed = await finalizeSessionApprovalRecord({
        approvalRequestId: approvalId,
        approvalToken,
        body: req.body || {},
        traceId: req.traceId || '',
        req
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ...completed.response
      });
    } catch (error) {
      return sendApprovalRouteError(req, res, error, 'approval_request_complete_failed', 'approval_request_complete_failed');
    }
  });

  app.post('/api/approvals/:approvalId/reject', async (req, res) => {
    try {
      const approvalId = String(req.params.approvalId || '').trim();
      const approvalToken = String(req.query.token || req.body?.token || '').trim();
      const responsePayload = rejectSessionApprovalRecord({
        approvalRequestId: approvalId,
        approvalToken,
        reason: req.body?.reason || req.body?.note || '',
        req
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ...responsePayload
      });
    } catch (error) {
      return sendApprovalRouteError(req, res, error, 'approval_request_reject_failed', 'approval_request_reject_failed');
    }
  });

  app.get('/api/session/approval/:approvalRequestId', async (req, res) => {
    try {
      const approvalRequestId = String(req.params.approvalRequestId || '').trim();
      const approvalToken = String(req.query.token || '').trim();
      const record = getSessionApprovalRecordOrThrow(approvalRequestId, approvalToken);
      const payload = buildSessionApprovalRequestPayload(record, { includeToken: true });
      const wantsHtml = !String(req.headers.accept || '').toLowerCase().includes('application/json');
      if (wantsHtml) {
        const frontendUrl = buildApprovalRequestUrl(
          payload.approvalRequestId,
          payload.approvalToken,
          payload?.payload?.audience || ''
        );
        if (frontendUrl && !frontendUrl.includes('/api/session/approval/')) {
          return res.redirect(302, frontendUrl);
        }
        const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>KTRACE Session Approval</title></head>
<body>
<h1>KTRACE Session Approval</h1>
<p>Status: ${payload.status || '-'}</p>
<p>Approval Request: ${payload.approvalRequestId || '-'}</p>
<p>User EOA: ${payload.userEoa || '-'}</p>
<p>Session Address: ${payload.sessionAddress || '-'}</p>
<p>This approval URL is ready. Use a wallet-aware client or the ktrace CLI to complete the session approval.</p>
<pre>${JSON.stringify(payload, null, 2)}</pre>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        approvalRequest: payload,
        authorization: payload.authorization || null,
        runtime: payload.runtime || null,
        session: payload.session || null
      });
    } catch (error) {
      return sendApprovalRouteError(req, res, error, 'approval_request_read_failed', 'approval_request_read_failed');
    }
  });

  app.post('/api/session/approval/:approvalRequestId/complete', async (req, res) => {
    try {
      const approvalRequestId = String(req.params.approvalRequestId || '').trim();
      const approvalToken = String(req.query.token || req.body?.token || '').trim();
      const completed = await finalizeSessionApprovalRecord({
        approvalRequestId,
        approvalToken,
        body: req.body || {},
        traceId: req.traceId || ''
      });

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        approvalRequest: buildSessionApprovalRequestPayload(completed.record, { includeToken: true }),
        authorization: completed.response.authorization,
        session: completed.response.session,
        runtime: completed.response.runtime
      });
    } catch (error) {
      return sendApprovalRouteError(req, res, error, 'approval_request_complete_failed', 'approval_request_complete_failed');
    }
  });
}
