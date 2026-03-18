function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function buildPublicBaseUrl(req, deps = {}) {
  const configured = normalizeText(deps.BACKEND_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL || '');
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedProto = normalizeText(req.headers['x-forwarded-proto'] || '');
  const forwardedHost = normalizeText(req.headers['x-forwarded-host'] || '');
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || `127.0.0.1:${normalizeText(process.env.PORT || '3001') || '3001'}`;
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function buildAgentCard(req, deps = {}) {
  const baseUrl = buildPublicBaseUrl(req, deps);
  const authRequired = Boolean(deps.authConfigured?.());

  return {
    name: 'Kite Trace',
    description: 'Auditable multi-agent trading and commerce backend on Kite testnet.',
    version: normalizeText(deps.PACKAGE_VERSION || '0.0.0') || '0.0.0',
    url: baseUrl,
    auth: authRequired
      ? {
          type: 'api-key-header',
          header: 'x-api-key'
        }
      : {
          type: 'none'
        },
    capabilities: [
      {
        id: 'job.create',
        method: 'POST',
        path: '/api/jobs',
        url: `${baseUrl}/api/jobs`,
        auth: authRequired ? 'agent' : 'none'
      },
      {
        id: 'job.audit.public',
        method: 'GET',
        path: '/api/public/jobs/:jobId/audit',
        url: `${baseUrl}/api/public/jobs/{jobId}/audit`,
        auth: 'none'
      },
      {
        id: 'job.audit.publicByTrace',
        method: 'GET',
        path: '/api/public/jobs/by-trace/:traceId/audit',
        url: `${baseUrl}/api/public/jobs/by-trace/{traceId}/audit`,
        auth: 'none'
      },
      {
        id: 'approval.read',
        method: 'GET',
        path: '/api/approvals/:approvalId',
        url: `${baseUrl}/api/approvals/{approvalId}`,
        auth: authRequired ? 'agent-or-approval-token' : 'none'
      }
    ]
  };
}

export function registerAgentCardRoutes(app, deps = {}) {
  app.get('/.well-known/agent.json', (req, res) => {
    return res.json(buildAgentCard(req, deps));
  });
}
