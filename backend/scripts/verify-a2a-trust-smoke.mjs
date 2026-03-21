import express from 'express';

import { registerA2aTaskNetworkRoutes } from '../routes/a2aTaskNetworkRoutes.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function createJsonResponse(response) {
  return response.json().catch(() => ({}));
}

async function runScenario(mode = 'pending') {
  const app = express();
  app.use(express.json());

  const state = {
    x402Requests: [],
    reputationSignals: [],
    trustPublications: [],
    networkAgents: [
      {
        id: 'price-agent',
        identityAgentId: '42',
        identityRegistry: '0x7777777777777777777777777777777777777777'
      }
    ]
  };

  function createX402Request(query = '', payer = '', action = '', options = {}) {
    const now = Date.now();
    return {
      requestId: createTraceId('x402'),
      query,
      payer,
      action,
      amount: String(options.amount || '1'),
      recipient: normalizeText(options.recipient || '0x3333333333333333333333333333333333333333').toLowerCase(),
      tokenAddress: '0x4444444444444444444444444444444444444444',
      status: 'pending',
      createdAt: now,
      expiresAt: now + 60_000,
      identity: options.identity || null
    };
  }

  function buildPaymentRequiredResponse(reqItem, reason = '') {
    return {
      error: 'payment_required',
      reason,
      x402: {
        requestId: reqItem.requestId,
        expiresAt: reqItem.expiresAt,
        accepts: [
          {
            tokenAddress: reqItem.tokenAddress,
            amount: reqItem.amount,
            recipient: reqItem.recipient
          }
        ]
      }
    };
  }

  function appendReputationSignal(record = {}) {
    const row = { ...record };
    state.reputationSignals.unshift(row);
    return row;
  }

  function appendTrustPublication(record = {}) {
    const row = { ...record };
    state.trustPublications.unshift(row);
    return row;
  }

  registerA2aTaskNetworkRoutes(app, {
    API_KEY_ADMIN: '',
    API_KEY_AGENT: '',
    API_KEY_VIEWER: '',
    appendReputationSignal,
    appendTrustPublication,
    AUTH_DISABLED: true,
    authConfigured: () => false,
    buildA2ACapabilities: () => [],
    buildA2AReceipt: (reqItem = {}) => ({ requestId: reqItem.requestId }),
    buildNetworkRunSummaries: () => [],
    buildPaymentRequiredResponse,
    buildPolicySnapshot: () => ({ ok: true }),
    computeReactiveStopOrderAmount: () => '1',
    createTraceId,
    createX402Request,
    ensureNetworkAgents: () => state.networkAgents,
    ensureWorkflowIdentityVerified: async ({ identityInput } = {}) => ({
      identity: {
        agentId: normalizeText(identityInput?.agentId || 'consumer-1'),
        registry: normalizeText(
          identityInput?.registry ||
          identityInput?.identityRegistry ||
          '0x7777777777777777777777777777777777777777'
        ).toLowerCase()
      }
    }),
    evaluateTransferPolicy: () => ({ ok: true, evidence: { mode: 'allow' } }),
    fetchBtcPriceQuote: async () => ({ pair: 'BTCUSDT', priceUsd: '100000', provider: 'demo' }),
    fetchXReaderDigest: async () => ({ title: 'digest', url: 'https://example.com' }),
    getActionConfig: () => ({
      action: 'btc-price-feed',
      amount: '1',
      recipient: '0x3333333333333333333333333333333333333333'
    }),
    KITE_AGENT1_ID: 'consumer-agent',
    KITE_AGENT2_ID: 'price-agent',
    logPolicyFailure: () => null,
    normalizeAddress: (value = '') => normalizeText(value).toLowerCase(),
    normalizeBtcPriceParams: (input = {}) => ({
      pair: normalizeText(input.pair || 'BTCUSDT') || 'BTCUSDT',
      source: normalizeText(input.source || 'demo') || 'demo'
    }),
    normalizeReactiveParams: (input = {}) => input,
    normalizeRiskScoreParams: (input = {}) => input,
    normalizeXReaderParams: (input = {}) => input,
    publishTrustPublicationOnChain: async () => {
      if (mode === 'fail') {
        throw new Error('simulated_trust_publication_failure');
      }
      if (mode === 'published') {
        return {
          configured: true,
          published: true,
          registryAddress: '0x9999999999999999999999999999999999999999',
          anchorId: createTraceId('anchor'),
          anchorTxHash: `0x${'c'.repeat(64)}`
        };
      }
      return {
        configured: false,
        published: false,
        registryAddress: '',
        anchorId: '',
        anchorTxHash: ''
      };
    },
    readX402Requests: () => state.x402Requests,
    requireRole: () => (_req, _res, next) => next(),
    runRiskScoreAnalysis: async () => ({ summary: 'risk ok' }),
    validatePaymentProof: () => '',
    verifyProofOnChain: async () => ({ ok: true, details: { blockNumber: 1 } }),
    writeX402Requests: (rows = []) => {
      state.x402Requests = Array.isArray(rows) ? rows : [];
    },
    X402_BTC_PRICE: '1'
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  async function post(pathname = '', body = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await createJsonResponse(response);
    return { response, payload };
  }

  try {
    const first = await post('/api/a2a/tasks/btc-price', {
      payer: '0x1111111111111111111111111111111111111111',
      sourceAgentId: 'consumer-agent',
      targetAgentId: 'price-agent',
      traceId: createTraceId('a2a'),
      task: { pair: 'BTCUSDT', source: 'demo' },
      identity: {
        agentId: 'consumer-1',
        identityRegistry: '0x7777777777777777777777777777777777777777'
      }
    });
    assert(first.response.status === 402, `expected payment_required 402 for ${mode}`);
    const requestId = normalizeText(first.payload?.x402?.requestId || '');
    assert(requestId, `missing requestId for ${mode}`);

    const second = await post('/api/a2a/tasks/btc-price', {
      payer: '0x1111111111111111111111111111111111111111',
      sourceAgentId: 'consumer-agent',
      targetAgentId: 'price-agent',
      traceId: createTraceId('a2a'),
      requestId,
      paymentProof: {
        requestId,
        txHash: `0x${'a'.repeat(64)}`,
        tokenAddress: '0x4444444444444444444444444444444444444444',
        recipient: '0x3333333333333333333333333333333333333333',
        amount: '1'
      }
    });

    assert(second.response.status === 200, `expected success 200 for ${mode}`);
    assert(Array.isArray(second.payload?.trust?.items), `missing trust items for ${mode}`);
    assert(second.payload.trust.items.length === 2, `expected 2 trust items for ${mode}`);
    assert(state.reputationSignals.length === 2, `expected 2 reputation signals for ${mode}`);
    assert(state.trustPublications.length === 2, `expected 2 trust publications for ${mode}`);

    const expectedStatus =
      mode === 'published'
        ? 'published'
        : mode === 'fail'
          ? 'failed'
          : 'pending';
    assert(
      state.trustPublications.every((item) => normalizeText(item.status || '') === expectedStatus),
      `unexpected publication status for ${mode}`
    );

    if (mode === 'published') {
      assert(
        state.trustPublications.every((item) => normalizeText(item.anchorTxHash || '').startsWith('0x')),
        'expected anchorTxHash for published mode'
      );
    }

    return {
      requestId,
      trustItems: second.payload.trust.items.length,
      publicationStatus: expectedStatus
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

try {
  const pending = await runScenario('pending');
  const published = await runScenario('published');
  const failed = await runScenario('fail');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          pending: pending.publicationStatus,
          published: published.publicationStatus,
          failed: failed.publicationStatus
        }
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
