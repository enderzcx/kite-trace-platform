function normalizeText(value = '') {
  return String(value ?? '').trim();
}

export function sendErrorResponse(
  req,
  res,
  {
    status = 500,
    code = 'internal_error',
    message = 'Request failed.',
    detail = {},
    extra = {}
  } = {}
) {
  const safeDetail =
    detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const safeExtra =
    extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};

  return res.status(Number(status || 500)).json({
    ok: false,
    error: {
      code: normalizeText(code) || 'internal_error',
      message: normalizeText(message) || 'Request failed.',
      detail: safeDetail
    },
    requestId: normalizeText(req?.requestId || req?.traceId),
    traceId: normalizeText(req?.traceId),
    ...safeExtra
  });
}
