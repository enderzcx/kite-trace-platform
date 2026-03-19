import { sendErrorResponse } from './errorResponse.js';

export function createAuthHelpers({
  AUTH_DISABLED = false,
  API_KEY_ADMIN = '',
  API_KEY_AGENT = '',
  API_KEY_VIEWER = '',
  ROLE_RANK = {},
  ONBOARDING_COOKIE_NAME = 'ktrace_onboard',
  hasDynamicAuthSource = null,
  resolveAccountApiKey = null,
  resolveOnboardingCookie = null,
  touchAccountApiKeyUsage = null
} = {}) {
  function normalizeText(value = '') {
    return String(value ?? '').trim();
  }

  function normalizeLower(value = '') {
    return normalizeText(value).toLowerCase();
  }

  function parseCookieHeader(req) {
    const header = normalizeText(req?.headers?.cookie || '');
    if (!header) return {};
    return Object.fromEntries(
      header
        .split(';')
        .map((part) => {
          const [rawKey, ...rawValue] = String(part || '').split('=');
          const key = normalizeText(rawKey);
          const value = rawValue.join('=').trim();
          if (!key) return null;
          try {
            return [key, decodeURIComponent(value)];
          } catch {
            return [key, value];
          }
        })
        .filter(Boolean)
    );
  }

  function authConfigured() {
    if (AUTH_DISABLED) return false;
    return Boolean(
      API_KEY_ADMIN ||
        API_KEY_AGENT ||
        API_KEY_VIEWER ||
        hasDynamicAuthSource?.()
    );
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

  function extractOnboardingCookie(req) {
    return normalizeText(parseCookieHeader(req)?.[ONBOARDING_COOKIE_NAME] || '');
  }

  function resolveEnvApiKey(key) {
    if (!key) return '';
    if (API_KEY_ADMIN && key === API_KEY_ADMIN) return 'admin';
    if (API_KEY_AGENT && key === API_KEY_AGENT) return 'agent';
    if (API_KEY_VIEWER && key === API_KEY_VIEWER) return 'viewer';
    return '';
  }

  function resolveApiKeyContext(
    key,
    { allowEnvApiKey = true, allowAccountApiKey = true } = {}
  ) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) return null;
    if (allowEnvApiKey) {
      const role = resolveEnvApiKey(normalizedKey);
      if (role) {
        return {
          role,
          authSource: 'env-api-key',
          token: normalizedKey
        };
      }
    }
    if (allowAccountApiKey && typeof resolveAccountApiKey === 'function') {
      const resolved = resolveAccountApiKey(normalizedKey);
      if (resolved?.role) {
        return {
          ...resolved,
          authSource: normalizeLower(resolved.authSource || 'account-api-key') || 'account-api-key',
          token: normalizedKey
        };
      }
    }
    return null;
  }

  function resolveRoleByApiKey(key) {
    return resolveApiKeyContext(key)?.role || '';
  }

  function applyAuthContext(req, context = {}) {
    const role = normalizeLower(context.role || '');
    const authSource = normalizeLower(context.authSource || '');
    const ownerEoa = normalizeText(context.ownerEoa || '');
    req.authRole = role;
    req.authSource = authSource;
    req.authOwnerEoa = ownerEoa;
    req.auth = {
      token: normalizeText(context.token || ''),
      clientId: normalizeText(context.keyId || role || authSource || ''),
      scopes: role ? [role] : [],
      ownerEoa,
      extra: {
        role,
        authSource,
        ownerEoa,
        ...(context.keyId ? { keyId: context.keyId } : {}),
        ...(context.chainId ? { chainId: context.chainId } : {})
      }
    };
    req.accountCtx = ownerEoa
      ? {
          ownerEoa,
          aaWallet: normalizeText(context.aaWallet || '')
        }
      : null;
    if (authSource === 'account-api-key' && typeof touchAccountApiKeyUsage === 'function') {
      touchAccountApiKeyUsage(context);
    }
  }

  function resolveAuthRequest(
    req,
    {
      requiredRole = 'viewer',
      allowEnvApiKey = true,
      allowAccountApiKey = true,
      allowOnboardingCookie = false
    } = {}
  ) {
    if (AUTH_DISABLED || !authConfigured()) {
      applyAuthContext(req, {
        role: 'dev-open',
        authSource: 'dev-open'
      });
      return {
        ok: true,
        role: 'dev-open',
        authSource: 'dev-open'
      };
    }

    const providedKey = extractApiKey(req);
    if (providedKey) {
      const resolved = resolveApiKeyContext(providedKey, {
        allowEnvApiKey,
        allowAccountApiKey
      });
      if (!resolved) {
        return {
          ok: false,
          status: 401,
          code: 'unauthorized',
          message: 'Missing or invalid API key.'
        };
      }
      const roleRank = ROLE_RANK[resolved.role] || 0;
      const requiredRank = ROLE_RANK[requiredRole] || ROLE_RANK.viewer;
      if (roleRank < requiredRank) {
        return {
          ok: false,
          status: 403,
          code: 'forbidden',
          message: `Role "${resolved.role}" cannot access "${requiredRole}" endpoint.`,
          detail: {
            role: resolved.role,
            requiredRole
          }
        };
      }
      applyAuthContext(req, resolved);
      return {
        ok: true,
        role: resolved.role,
        authSource: resolved.authSource
      };
    }

    if (allowOnboardingCookie && typeof resolveOnboardingCookie === 'function') {
      const token = extractOnboardingCookie(req);
      const resolved = token ? resolveOnboardingCookie(token) : null;
      if (resolved?.role) {
        const roleRank = ROLE_RANK[resolved.role] || 0;
        const requiredRank = ROLE_RANK[requiredRole] || ROLE_RANK.viewer;
        if (roleRank < requiredRank) {
          return {
            ok: false,
            status: 403,
            code: 'forbidden',
            message: `Role "${resolved.role}" cannot access "${requiredRole}" endpoint.`,
            detail: {
              role: resolved.role,
              requiredRole
            }
          };
        }
        applyAuthContext(req, resolved);
        return {
          ok: true,
          role: resolved.role,
          authSource: resolved.authSource
        };
      }
    }

    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Missing or invalid API key.'
    };
  }

  function requireRole(requiredRole = 'viewer', options = {}) {
    return (req, res, next) => {
      const resolved = resolveAuthRequest(req, {
        requiredRole,
        ...options
      });
      if (!resolved.ok) {
        return sendErrorResponse(req, res, {
          status: resolved.status || 401,
          code: resolved.code || 'unauthorized',
          message: resolved.message || 'Missing or invalid API key.',
          ...(resolved.detail ? { detail: resolved.detail } : {})
        });
      }
      return next();
    };
  }

  return {
    authConfigured,
    extractApiKey,
    extractOnboardingCookie,
    resolveRoleByApiKey,
    resolveAuthRequest,
    requireRole
  };
}
