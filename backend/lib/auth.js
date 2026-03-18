import { sendErrorResponse } from './errorResponse.js';

export function createAuthHelpers({
  AUTH_DISABLED = false,
  API_KEY_ADMIN = '',
  API_KEY_AGENT = '',
  API_KEY_VIEWER = '',
  ROLE_RANK = {}
} = {}) {
  function authConfigured() {
    if (AUTH_DISABLED) return false;
    return Boolean(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER);
  }

  function extractApiKey(req) {
    const xApiKey = String(req.headers['x-api-key'] || '').trim();
    if (xApiKey) return xApiKey;
    const auth = String(req.headers.authorization || '').trim();
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    const streamQueryKey = String(req.query?.apiKey || req.query?.token || '').trim();
    if (streamQueryKey && req.method === 'GET' && String(req.path || '').includes('/stream')) {
      return streamQueryKey;
    }
    return '';
  }

  function resolveRoleByApiKey(key) {
    if (!key) return '';
    if (API_KEY_ADMIN && key === API_KEY_ADMIN) return 'admin';
    if (API_KEY_AGENT && key === API_KEY_AGENT) return 'agent';
    if (API_KEY_VIEWER && key === API_KEY_VIEWER) return 'viewer';
    return '';
  }

  function requireRole(requiredRole = 'viewer') {
    return (req, res, next) => {
      if (!authConfigured()) {
        req.authRole = 'dev-open';
        return next();
      }
      const providedKey = extractApiKey(req);
      const role = resolveRoleByApiKey(providedKey);
      if (!role) {
        return sendErrorResponse(req, res, {
          status: 401,
          code: 'unauthorized',
          message: 'Missing or invalid API key.'
        });
      }
      const roleRank = ROLE_RANK[role] || 0;
      const requiredRank = ROLE_RANK[requiredRole] || ROLE_RANK.viewer;
      if (roleRank < requiredRank) {
        return sendErrorResponse(req, res, {
          status: 403,
          code: 'forbidden',
          message: `Role "${role}" cannot access "${requiredRole}" endpoint.`,
          detail: {
            role,
            requiredRole
          }
        });
      }
      req.authRole = role;
      return next();
    };
  }

  return {
    authConfigured,
    extractApiKey,
    resolveRoleByApiKey,
    requireRole
  };
}
