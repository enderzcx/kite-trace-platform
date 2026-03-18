import crypto from 'node:crypto';
import express from 'express';

import { createAuthHelpers } from '../lib/auth.js';
import { registerMcpRoutes } from '../mcp/mcpServer.js';

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function buildHarnessCapabilities() {
  const now = new Date().toISOString();
  return [
    {
      id: 'cap-example-query',
      name: 'Example Query Capability',
      description: 'Stub query capability for deterministic MCP smoke verification.',
      action: 'example-query',
      providerAgentId: 'stub-query-node',
      exampleInput: {
        symbol: 'BTCUSDT',
        source: 'stub'
      },
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'cap-paid-demo',
      name: 'Paid Demo Capability',
      description: 'Stub paid capability that simulates hosted MCP auto-payment.',
      action: 'market-price-feed',
      providerAgentId: 'stub-paid-node',
      exampleInput: {
        vsCurrency: 'usd',
        ids: 'bitcoin,ethereum',
        limit: 2
      },
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'cap-hidden-inactive',
      name: 'Inactive Capability',
      description: 'Should not be exposed through MCP tools/list.',
      action: 'hidden-capability',
      providerAgentId: 'stub-hidden-node',
      exampleInput: {
        hidden: 'true'
      },
      active: false,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function makeHeaders(req, apiKey = '') {
  const headers = {
    Accept: 'application/json'
  };
  const normalizedApiKey = normalizeText(apiKey || '');
  if (normalizedApiKey) headers['x-api-key'] = normalizedApiKey;
  if (req?.traceId) headers['x-trace-id'] = req.traceId;
  return headers;
}

function jsonRpcAcceptHeaders(apiKey = '') {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json'
  };
  const normalizedApiKey = normalizeText(apiKey || '');
  if (normalizedApiKey) headers['x-api-key'] = normalizedApiKey;
  return headers;
}

function parseSsePayload(rawText = '') {
  const dataLines = String(rawText || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines.join('\n'));
}

export async function postJsonRpc(baseUrl, body, apiKey = '') {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: jsonRpcAcceptHeaders(apiKey),
    body: JSON.stringify(body)
  });

  const rawText = await response.text();
  const contentType = normalizeText(response.headers.get('content-type') || '');
  let payload = null;
  if (contentType.includes('text/event-stream')) {
    payload = parseSsePayload(rawText);
  } else {
    payload = rawText ? JSON.parse(rawText) : null;
  }

  return {
    status: response.status,
    contentType,
    payload,
    rawText
  };
}

export async function startMcpTestHarness({
  port = 34960,
  authEnabled = false,
  packageVersion = '1.0.0'
} = {}) {
  const app = express();
  const state = {
    capabilities: buildHarnessCapabilities(),
    invocations: []
  };

  const keys = {
    admin: authEnabled ? 'mcp-admin-key' : '',
    agent: authEnabled ? 'mcp-agent-key' : '',
    viewer: authEnabled ? 'mcp-viewer-key' : ''
  };

  const { authConfigured, extractApiKey, resolveRoleByApiKey, requireRole } = createAuthHelpers({
    AUTH_DISABLED: !authEnabled,
    API_KEY_ADMIN: keys.admin,
    API_KEY_AGENT: keys.agent,
    API_KEY_VIEWER: keys.viewer,
    ROLE_RANK: {
      viewer: 1,
      agent: 2,
      admin: 3
    }
  });

  app.use(express.json());
  app.use((req, _res, next) => {
    req.traceId = normalizeText(req.headers['x-trace-id'] || '') || createTraceId('req');
    next();
  });

  app.get('/api/v1/capabilities', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId,
      items: state.capabilities
    });
  });

  app.post('/api/services/:serviceId/invoke', requireRole('agent'), (req, res) => {
    const serviceId = normalizeText(req.params.serviceId || '');
    const service = state.capabilities.find((item) => normalizeText(item?.id || '') === serviceId && item?.active !== false);
    if (!service) {
      return res.status(404).json({
        ok: false,
        error: 'service_not_found',
        reason: 'Requested service is not active.',
        traceId: req.traceId,
        serviceId
      });
    }

    const body = req.body || {};
    const traceId = normalizeText(body.traceId || req.traceId || '') || createTraceId('invoke');
    const invocationId = createTraceId('svc_call');
    const requestId = createTraceId('x402');
    const sourceAgentId = normalizeText(body.sourceAgentId || '') || 'mcp-client';
    const targetAgentId = normalizeText(body.targetAgentId || service.providerAgentId || '') || service.providerAgentId || 'stub-node';
    const payer = normalizeText(body.payer || '') || '0x1111111111111111111111111111111111111111';
    const paid = serviceId === 'cap-paid-demo';
    const summary = paid
      ? 'Paid demo capability completed via hosted MCP auto-payment.'
      : 'Example query capability completed successfully.';
    const invocation = {
      invocationId,
      serviceId,
      traceId,
      requestId,
      state: 'success',
      sourceAgentId,
      targetAgentId,
      payer,
      amount: paid ? '0.00005' : '0',
      tokenAddress: paid ? '0x000000000000000000000000000000000000c0de' : '',
      recipient: paid ? '0x000000000000000000000000000000000000beef' : '',
      summary,
      error: '',
      txHash: paid ? '0xtxhashdemo' : '',
      userOpHash: paid ? '0xuserophashdemo' : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.invocations.unshift(invocation);

    return res.json({
      ok: true,
      traceId,
      requestId,
      invocationId,
      serviceId,
      state: 'success',
      txHash: invocation.txHash,
      userOpHash: invocation.userOpHash,
      result: {
        summary,
        echoedInput: body.input || {}
      },
      receipt: {
        result: {
          summary
        },
        invocationId,
        requestId,
        txHash: invocation.txHash,
        userOpHash: invocation.userOpHash
      }
    });
  });

  app.get('/api/service-invocations', requireRole('viewer'), (req, res) => {
    const traceId = normalizeText(req.query.traceId || '');
    const items = state.invocations.filter((item) => !traceId || normalizeText(item.traceId) === traceId);
    return res.json({
      ok: true,
      traceId: req.traceId,
      total: items.length,
      items
    });
  });

  registerMcpRoutes(app, {
    PACKAGE_VERSION: packageVersion,
    PORT: String(port),
    authConfigured,
    extractApiKey,
    resolveRoleByApiKey,
    getInternalAgentApiKey: () => normalizeText(keys.agent || keys.admin || '')
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(port, () => resolve(instance));
  });

  return {
    app,
    state,
    keys,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () =>
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      })
  };
}

export function getToolHeaders(apiKey = '') {
  return makeHeaders(null, apiKey);
}
