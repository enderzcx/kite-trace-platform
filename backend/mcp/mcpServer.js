import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createMcpToolsAdapter } from './toolsAdapter.js';
import { createMcpInvokeAdapter } from './invokeAdapter.js';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function buildRoleRank(role = '') {
  const normalizedRole = normalizeLower(role);
  if (normalizedRole === 'admin') return 3;
  if (normalizedRole === 'agent') return 2;
  if (normalizedRole === 'viewer') return 1;
  // Finding 13 fix: dev-open only allowed in development, not production
  if (normalizedRole === 'dev-open' && process.env.NODE_ENV !== 'production') return 99;
  return 0;
}

function buildJsonRpcErrorBody(req, message, code, data = null) {
  return {
    jsonrpc: '2.0',
    error: {
      code,
      message,
      ...(data && typeof data === 'object' ? { data } : {})
    },
    id: req?.body?.id ?? null
  };
}

function sendJsonRpcError(res, req, status, message, code, data = null) {
  return res.status(status).json(buildJsonRpcErrorBody(req, message, code, data));
}

function resolveRequiredRole(body = null) {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (normalizeLower(message?.method || '') === 'tools/call') {
      return 'agent';
    }
  }
  return 'viewer';
}

function resolvePaymentMode(req, auth = {}, deps = {}) {
  const headerValue = normalizeLower(req.headers['x-ktrace-mcp-payment-mode'] || '');
  if (headerValue === 'agent') return 'agent';
  if (headerValue === 'hosted') return 'hosted';
  // Use hosted payment only if the server holds the owner's private key (backend-managed account).
  // Self-custodial connector grants (user_grant_self_custodial) do NOT give the server the key,
  // so hosted payment would fail with session_not_configured for those users.
  if (auth.authSource === 'connector-grant' && auth.ownerEoa) {
    const ownerKey =
      typeof deps.resolveSessionOwnerPrivateKey === 'function'
        ? String(deps.resolveSessionOwnerPrivateKey(auth.ownerEoa) || '').trim()
        : '';
    if (ownerKey) return 'hosted';
  }
  return 'agent';
}

function buildPublicBaseUrl(req) {
  const configured = normalizeText(process.env.BACKEND_PUBLIC_URL || '');
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedProto = normalizeText(req.headers['x-forwarded-proto'] || '');
  const forwardedHost = normalizeText(req.headers['x-forwarded-host'] || '');
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || `127.0.0.1:${normalizeText(process.env.PORT || '3001') || '3001'}`;
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function resolvePublicMcpEndpoint() {
  return normalizeText(process.env.MCP_STREAM_PUBLIC_PATH || '/mcp/stream') || '/mcp/stream';
}

function buildWellKnownPayload(req, deps) {
  return {
    name: 'Kite Trace MCP Server',
    version: normalizeText(deps.PACKAGE_VERSION || '0.0.0') || '0.0.0',
    endpoint: `${buildPublicBaseUrl(req)}${resolvePublicMcpEndpoint()}`,
    transport: 'streamable-http',
    auth: deps.authConfigured?.()
      ? {
          type: 'multi',
          primary: {
            type: 'connector-token',
            path: '/mcp/connect/:token',
            role: 'agent'
          },
          compatibility: {
            type: 'api-key-header',
            header: 'x-api-key',
            listRole: 'viewer',
            toolCallRole: 'agent'
          }
        }
      : { type: 'none' },
    toolNamePrefix: 'ktrace__'
  };
}

function applyConnectorGrantAuth(req, grant = {}) {
  const ownerEoa = normalizeText(grant.ownerEoa || '');
  const aaWallet = normalizeText(grant.aaWallet || '');
  const grantId = normalizeText(grant.grantId || '');
  const agentId = normalizeText(grant.agentId || '');
  const identityRegistry = normalizeText(grant.identityRegistry || '');
  const allowedBuiltinTools = Array.isArray(grant.allowedBuiltinTools) ? grant.allowedBuiltinTools : [];
  req.authRole = 'agent';
  req.authSource = 'connector-grant';
  req.authOwnerEoa = ownerEoa;
  req.auth = {
    token: '',
    clientId: grantId || 'connector-grant',
    scopes: ['agent'],
    ownerEoa,
    extra: {
      role: 'agent',
      authSource: 'connector-grant',
      ownerEoa,
      aaWallet,
      grantId,
      agentId,
      identityRegistry,
      allowedBuiltinTools
    }
  };
  req.accountCtx = ownerEoa
    ? {
        ownerEoa,
        aaWallet
      }
    : null;
}

async function buildRequestAuth(req, deps) {
  function resolveAccountRuntimeContext(current = {}) {
    const authSource = normalizeLower(current.authSource || '');
    const explicitOwner = normalizeText(current.ownerEoa || '');
    const explicitAaWallet = normalizeText(current.aaWallet || '');
    if (authSource === 'connector-grant') {
      return {
        ownerEoa: explicitOwner,
        aaWallet: explicitAaWallet
      };
    }
    if (authSource !== 'account-api-key') {
      return {
        ownerEoa: explicitOwner,
        aaWallet: explicitAaWallet
      };
    }
    if (explicitOwner && explicitAaWallet) {
      return {
        ownerEoa: explicitOwner,
        aaWallet: explicitAaWallet
      };
    }

    let runtime = null;
    if (explicitOwner && typeof deps.readSessionRuntimeByOwner === 'function') {
      runtime = deps.readSessionRuntimeByOwner(explicitOwner) || null;
    }
    if ((!runtime || !normalizeText(runtime?.aaWallet || '')) && typeof deps.readSessionRuntime === 'function') {
      runtime = deps.readSessionRuntime() || null;
    }

    const runtimeOwner = normalizeText(runtime?.owner || runtime?.ownerEoa || '');
    const runtimeAaWallet = normalizeText(runtime?.aaWallet || '');
    const ownerMatches =
      !explicitOwner ||
      !runtimeOwner ||
      normalizeLower(explicitOwner) === normalizeLower(runtimeOwner);

    return {
      ownerEoa: explicitOwner || (ownerMatches ? runtimeOwner : ''),
      aaWallet: explicitAaWallet || (ownerMatches ? runtimeAaWallet : '')
    };
  }

  // Self-custodial session-key auth: proxy signs timestamp with session key, no stored grant needed
  // Finding 12 fix: replay protection with nonce tracking
  const _sessionReplayCache = buildRoleRank._sessionReplayCache || (buildRoleRank._sessionReplayCache = new Map());
  const SESSION_AUTH_WINDOW_MS = 60 * 1000; // 60s window (reduced from 5 min)
  // Cleanup stale replay entries every 2 minutes
  if (!buildRoleRank._sessionReplayCleanup) {
    buildRoleRank._sessionReplayCleanup = setInterval(() => {
      const cutoff = Date.now() - SESSION_AUTH_WINDOW_MS * 3;
      for (const [k, v] of _sessionReplayCache) {
        if (v < cutoff) _sessionReplayCache.delete(k);
      }
    }, SESSION_AUTH_WINDOW_MS * 2);
    if (buildRoleRank._sessionReplayCleanup.unref) buildRoleRank._sessionReplayCleanup.unref();
  }

  const sessionSignature = normalizeText(req.headers?.['x-ktrace-session-signature'] || '');
  const sessionAddress = normalizeText(req.headers?.['x-ktrace-session-address'] || '');
  const sessionTimestamp = normalizeText(req.headers?.['x-ktrace-session-timestamp'] || '');
  if (sessionSignature && sessionAddress && sessionTimestamp) {
    try {
      const ts = Number(sessionTimestamp);
      const drift = Math.abs(Date.now() - ts);
      if (drift > SESSION_AUTH_WINDOW_MS) {
        return { ok: false, status: 401, message: 'Session signature timestamp too old or in the future.', code: -32001 };
      }
      // Replay detection: reject duplicate (address, timestamp) pairs
      const replayKey = `${sessionAddress.toLowerCase()}:${sessionTimestamp}`;
      if (_sessionReplayCache.has(replayKey)) {
        return { ok: false, status: 401, message: 'Session signature replay detected.', code: -32001 };
      }
      _sessionReplayCache.set(replayKey, Date.now());
      const { ethers: _ethers } = await import('ethers');
      const message = `ktrace-session:${sessionTimestamp}`;
      const recovered = _ethers.verifyMessage(message, sessionSignature);
      if (recovered.toLowerCase() !== sessionAddress.toLowerCase()) {
        return { ok: false, status: 401, message: 'Session signature does not match sessionAddress.', code: -32001 };
      }
      const ownerEoa = normalizeText(req.headers?.['x-ktrace-owner-eoa'] || '');
      const aaWallet = normalizeText(req.headers?.['x-ktrace-aa-wallet'] || '');
      const sessionId = normalizeText(req.headers?.['x-ktrace-session-id'] || '');
      applyConnectorGrantAuth(req, {
        ownerEoa,
        aaWallet,
        grantId: `session-key:${sessionAddress}`,
        agentId: normalizeText(req.headers?.['x-ktrace-agent-id'] || ''),
        identityRegistry: normalizeText(req.headers?.['x-ktrace-identity-registry'] || ''),
        allowedBuiltinTools: []
      });
      return {
        ok: true,
        role: 'agent',
        authSource: 'session-key',
        apiKey: '',
        ownerEoa,
        aaWallet,
        grantId: `session-key:${sessionAddress}`,
        agentId: normalizeText(req.headers?.['x-ktrace-agent-id'] || ''),
        identityRegistry: normalizeText(req.headers?.['x-ktrace-identity-registry'] || ''),
        allowedBuiltinTools: []
      };
    } catch (err) {
      return { ok: false, status: 401, message: 'Session signature verification failed.', code: -32001 };
    }
  }

  const connectorToken = normalizeText(req.params?.token || '');
  if (connectorToken) {
    const resolveConnectorToken = deps.resolveAgentConnectorToken || deps.resolveClaudeConnectorToken;
    const claimConnectorInstallCode =
      deps.claimAgentConnectorInstallCode || deps.claimClaudeConnectorInstallCode;
    const touchConnectorGrantUsage =
      deps.touchAgentConnectorGrantUsage || deps.touchClaudeConnectorGrantUsage;
    let grant = resolveConnectorToken?.(connectorToken) || null;
    if (grant?.type === 'legacy_grant' || grant?.type === 'legacy_install_code') {
      return {
        ok: false,
        status: Number(grant?.statusCode || 401) || 401,
        message: normalizeText(grant?.reason || 'Connector reconnect required.'),
        code: -32001
      };
    }
    if (grant?.type === 'install_code') {
      const claimed = claimConnectorInstallCode?.(connectorToken) || null;
      if (claimed?.ok && claimed.grant) {
        grant = {
          type: 'grant',
          grant: claimed.grant
        };
      } else if (claimed?.ok === false) {
        return {
          ok: false,
          status: Number(claimed?.statusCode || 401) || 401,
          message: normalizeText(claimed?.reason || 'Connector reconnect required.'),
          code: -32001
        };
      } else {
        grant = null;
      }
    }
    if (!grant?.grant) {
      return {
        ok: false,
        status: 401,
        message: 'Missing or invalid connector token.',
        code: -32001
      };
    }
    const touchedGrant = touchConnectorGrantUsage?.(grant.grant) || grant.grant;
    const effectiveGrant = touchedGrant || grant.grant;
    applyConnectorGrantAuth(req, effectiveGrant);
    return {
      ok: true,
      role: 'agent',
      authSource: 'connector-grant',
      apiKey: '',
      ownerEoa: normalizeText(effectiveGrant.ownerEoa || ''),
      aaWallet: normalizeText(effectiveGrant.aaWallet || ''),
      grantId: normalizeText(effectiveGrant.grantId || ''),
      agentId: normalizeText(effectiveGrant.agentId || ''),
      identityRegistry: normalizeText(effectiveGrant.identityRegistry || ''),
      allowedBuiltinTools: Array.isArray(effectiveGrant.allowedBuiltinTools) ? effectiveGrant.allowedBuiltinTools : []
    };
  }

  const requiredRole = resolveRequiredRole(req.body);
  let resolved = deps.resolveAuthRequest?.(req, {
    requiredRole,
    allowEnvApiKey: false,
    allowAccountApiKey: true,
    allowOnboardingCookie: false
  });
  if (!resolved?.ok && Number(resolved?.status || 0) !== 403) {
    resolved = deps.resolveAuthRequest?.(req, {
      requiredRole,
      allowEnvApiKey: true,
      allowAccountApiKey: false,
      allowOnboardingCookie: false
    });
  }
  if (!resolved?.ok) {
    return {
      ok: false,
      status: Number(resolved?.status || 401) || 401,
      message: normalizeText(resolved?.message || 'Missing or invalid API key.') || 'Missing or invalid API key.',
      code: Number(resolved?.status || 0) === 403 ? -32003 : -32001
    };
  }

  const accountRuntime = resolveAccountRuntimeContext({
    authSource: normalizeLower(req.authSource || resolved.authSource || '') || 'env-api-key',
    ownerEoa: normalizeText(req.authOwnerEoa || req.accountCtx?.ownerEoa || ''),
    aaWallet: normalizeText(req.accountCtx?.aaWallet || '')
  });

  return {
    ok: true,
    role: normalizeLower(req.authRole || resolved.role || '') || 'viewer',
    authSource: normalizeLower(req.authSource || resolved.authSource || '') || 'env-api-key',
    apiKey: normalizeText(req.auth?.token || deps.extractApiKey?.(req) || ''),
    ownerEoa: accountRuntime.ownerEoa,
    aaWallet: accountRuntime.aaWallet,
    agentId: normalizeText(req.auth?.extra?.agentId || ''),
    identityRegistry: normalizeText(req.auth?.extra?.identityRegistry || ''),
    allowedBuiltinTools: Array.isArray(req.auth?.extra?.allowedBuiltinTools) ? req.auth.extra.allowedBuiltinTools : []
  };
}

function createFetchLoopbackJson({ PORT, getInternalAgentApiKey }) {
  return async function fetchLoopbackJson({
    pathname = '',
    method = 'GET',
    body = null,
    apiKey = '',
    traceId = ''
  } = {}) {
    const headers = {
      Accept: 'application/json'
    };

    const effectiveApiKey = normalizeText(getInternalAgentApiKey?.() || apiKey || '');
    if (effectiveApiKey) headers['x-api-key'] = effectiveApiKey;
    if (traceId) headers['x-trace-id'] = traceId;

    const init = {
      method: normalizeText(method || 'GET').toUpperCase(),
      headers
    };

    if (body !== null && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const loopbackTimeoutMs = Math.max(30_000, Number(process.env.MCP_LOOPBACK_TIMEOUT_MS || 100_000));
    const loopbackController = new AbortController();
    const loopbackTimer = setTimeout(() => loopbackController.abort(), loopbackTimeoutMs);
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, { ...init, signal: loopbackController.signal });
    } finally {
      clearTimeout(loopbackTimer);
    }
    const rawText = await response.text();
    let payload = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = {
        ok: false,
        error: 'invalid_json_response',
        reason: rawText || `HTTP ${response.status}`
      };
    }

    return {
      status: response.status,
      headers: response.headers,
      payload,
      rawText
    };
  };
}

function registerTools(server, tools, invokeAdapter, requestContext) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        _meta: {
          capabilityId: tool.capabilityId,
          providerId: tool.providerId
        }
      },
      async (args, extra) =>
        invokeAdapter.callTool({
          tool,
          args,
          extra,
          apiKey: requestContext.apiKey,
          paymentMode: requestContext.paymentMode,
          ownerEoa: requestContext.ownerEoa,
          aaWallet: requestContext.aaWallet,
          authSource: requestContext.authSource,
          grantId: requestContext.grantId,
          agentId: requestContext.agentId,
          identityRegistry: requestContext.identityRegistry,
          allowedBuiltinTools: requestContext.allowedBuiltinTools
        })
    );
  }
}

// Finding 11 fix: concurrency limiter for MCP requests
const MCP_MAX_CONCURRENT = Number(process.env.MCP_MAX_CONCURRENT || 20);
let _mcpActiveCount = 0;

async function handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter) {
  // Reject if too many concurrent MCP requests
  if (_mcpActiveCount >= MCP_MAX_CONCURRENT) {
    return sendJsonRpcError(res, req, 429, 'Too many concurrent MCP requests. Try again shortly.', -32000, {
      traceId: normalizeText(req.traceId || ''),
      activeSessions: _mcpActiveCount
    });
  }
  _mcpActiveCount++;
  res.once('close', () => { _mcpActiveCount = Math.max(0, _mcpActiveCount - 1); });

  const auth = await buildRequestAuth(req, deps);
  if (!auth.ok) {
    return sendJsonRpcError(res, req, auth.status, auth.message, auth.code, {
      traceId: normalizeText(req.traceId || '')
    });
  }

  try {
    const tools = await toolsAdapter.listTools({
      traceId: normalizeText(req.traceId || ''),
      apiKey: auth.apiKey,
      authSource: auth.authSource,
      role: auth.role,
      allowedBuiltinTools: auth.allowedBuiltinTools
    });

    const server = new McpServer(
      {
        name: 'kite-trace-mcp-server',
        version: normalizeText(deps.PACKAGE_VERSION || '0.0.0') || '0.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    registerTools(server, tools, invokeAdapter, {
      apiKey: auth.apiKey,
      paymentMode: resolvePaymentMode(req, auth, deps),
      ownerEoa: auth.ownerEoa,
      aaWallet: auth.aaWallet,
      authSource: auth.authSource,
      grantId: auth.grantId,
      agentId: auth.agentId,
      identityRegistry: auth.identityRegistry,
      allowedBuiltinTools: auth.allowedBuiltinTools
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await server.connect(transport);
    res.once('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req, res, req.body);
    return undefined;
  } catch (error) {
    return sendJsonRpcError(
      res,
      req,
      500,
      normalizeText(error?.message || 'Internal server error') || 'Internal server error',
      -32603,
      {
        traceId: normalizeText(req.traceId || '')
      }
    );
  }
}

export function registerMcpRoutes(app, deps) {
  const fetchLoopbackJson = createFetchLoopbackJson({
    PORT: deps.PORT,
    getInternalAgentApiKey: deps.getInternalAgentApiKey
  });
  const toolsAdapter = createMcpToolsAdapter({ fetchLoopbackJson });
  const invokeAdapter = createMcpInvokeAdapter({ fetchLoopbackJson });

  app.get('/.well-known/mcp.json', (req, res) => {
    res.json(buildWellKnownPayload(req, deps));
  });

  app.get('/mcp', async (req, res) => handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter));
  app.post('/mcp', async (req, res) => handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter));
  app.get('/mcp/stream', async (req, res) => handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter));
  app.post('/mcp/stream', async (req, res) => handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter));
  app.get('/mcp/connect/:token', async (req, res) => handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter));
  app.post('/mcp/connect/:token', async (req, res) => handleMcpRequest(req, res, deps, toolsAdapter, invokeAdapter));
}
