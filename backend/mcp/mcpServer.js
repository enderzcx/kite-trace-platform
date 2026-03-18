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
  if (normalizedRole === 'dev-open') return 99;
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

function resolvePaymentMode(req) {
  const headerValue = normalizeLower(req.headers['x-ktrace-mcp-payment-mode'] || '');
  return headerValue === 'agent' ? 'agent' : '';
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

function buildWellKnownPayload(req, deps) {
  return {
    name: 'Kite Trace MCP Server',
    version: normalizeText(deps.PACKAGE_VERSION || '0.0.0') || '0.0.0',
    endpoint: `${buildPublicBaseUrl(req)}/mcp`,
    transport: 'streamable-http',
    auth: deps.authConfigured?.()
      ? {
          type: 'api-key-header',
          header: 'x-api-key',
          listRole: 'viewer',
          toolCallRole: 'agent'
        }
      : { type: 'none' },
    toolNamePrefix: 'ktrace__'
  };
}

function buildRequestAuth(req, deps) {
  if (!deps.authConfigured?.()) {
    req.authRole = 'dev-open';
    req.auth = {
      token: '',
      clientId: 'dev-open',
      scopes: ['viewer', 'agent', 'admin'],
      extra: { role: 'dev-open' }
    };
    return {
      ok: true,
      role: 'dev-open',
      apiKey: ''
    };
  }

  const providedKey = normalizeText(deps.extractApiKey?.(req) || '');
  const role = normalizeLower(deps.resolveRoleByApiKey?.(providedKey) || '');
  if (!role) {
    return {
      ok: false,
      status: 401,
      message: 'Missing or invalid API key.',
      code: -32001
    };
  }

  const requiredRole = resolveRequiredRole(req.body);
  if (buildRoleRank(role) < buildRoleRank(requiredRole)) {
    return {
      ok: false,
      status: 403,
      message: `Role "${role}" cannot access "${requiredRole}" MCP method.`,
      code: -32003
    };
  }

  req.authRole = role;
  req.auth = {
    token: providedKey,
    clientId: role,
    scopes: [role],
    extra: { role }
  };

  return {
    ok: true,
    role,
    apiKey: providedKey
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

    const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, init);
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
          paymentMode: requestContext.paymentMode
        })
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

  app.get('/mcp', (req, res) => {
    res.set('Allow', 'POST');
    return res.status(405).json(buildJsonRpcErrorBody(req, 'Method not allowed.', -32000));
  });

  app.delete('/mcp', (req, res) => {
    res.set('Allow', 'POST');
    return res.status(405).json(buildJsonRpcErrorBody(req, 'Method not allowed.', -32000));
  });

  app.post('/mcp', async (req, res) => {
    const auth = buildRequestAuth(req, deps);
    if (!auth.ok) {
      return sendJsonRpcError(res, req, auth.status, auth.message, auth.code, {
        traceId: normalizeText(req.traceId || '')
      });
    }

    try {
      const tools = await toolsAdapter.listTools({
        traceId: normalizeText(req.traceId || ''),
        apiKey: auth.apiKey
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
        paymentMode: resolvePaymentMode(req)
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
  });
}
