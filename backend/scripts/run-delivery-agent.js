import { BTC_TRADING_PLAN_V1_SCHEMA_ID } from '../lib/deliverySchemas/btcTradingPlanV1.js';
import {
  loadCapabilities,
  loadSessionRuntime,
  normalizeMcpCallResult,
  postJsonRpc,
  readDemoArtifact,
  requestJson
} from './demoBtcJobHelpers.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeToolName(capabilityId = '') {
  return `ktrace__${normalizeText(capabilityId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function findNumberByKeys(input, patterns = []) {
  if (!input || typeof input !== 'object') return 0;
  const entries = Object.entries(input);
  for (const [key, value] of entries) {
    const lowerKey = normalizeText(key).toLowerCase();
    if (patterns.some((pattern) => lowerKey.includes(pattern)) && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  for (const value of Object.values(input)) {
    if (value && typeof value === 'object') {
      const nested = findNumberByKeys(value, patterns);
      if (nested) return nested;
    }
  }
  return 0;
}

function buildTradingPlanFromResult(mcpResult = {}, capability = {}) {
  const resultPayload = mcpResult?.result && typeof mcpResult.result === 'object' ? mcpResult.result : {};
  const summary = normalizeText(mcpResult.summary || resultPayload?.summary || 'BTC intraday plan assembled from ktrace market data.');
  const price =
    findNumberByKeys(resultPayload, ['price', 'mark', 'mid', 'last']) ||
    Number(process.env.DEMO_BTC_PRICE_FALLBACK || 68000);
  const volume24h =
    findNumberByKeys(resultPayload, ['volume24h', '24hvolume', 'volume']) ||
    Number(process.env.DEMO_BTC_VOLUME_FALLBACK || 1250000000);
  const dominance =
    findNumberByKeys(resultPayload, ['dominance']) ||
    Number(process.env.DEMO_BTC_DOMINANCE_FALLBACK || 52.5);
  const lowerEntry = Number((price * 0.995).toFixed(2));
  const upperEntry = Number((price * 1.005).toFixed(2));
  const tp1 = Number((price * 1.015).toFixed(2));
  const tp2 = Number((price * 1.03).toFixed(2));
  const stopLoss = Number((price * 0.99).toFixed(2));
  const riskRewardRatio = Number((((((tp1 + tp2) / 2) - price) / (price - stopLoss || 1))).toFixed(2));
  const bias = /bearish|short/i.test(summary) ? 'short' : /neutral/i.test(summary) ? 'neutral' : 'long';
  const sentiment = bias === 'short' ? 'bearish' : bias === 'neutral' ? 'neutral' : 'bullish';

  return {
    schema: BTC_TRADING_PLAN_V1_SCHEMA_ID,
    asset: 'BTC/USDT',
    generatedAt: new Date().toISOString(),
    marketSnapshot: {
      price,
      priceSource: normalizeText(capability?.id || capability?.capabilityId || capability?.name || 'ktrace-mcp-tool'),
      volume24h,
      dominance
    },
    tradingPlan: {
      bias,
      timeframe: '1D',
      entry: {
        price,
        zone: [lowerEntry, upperEntry]
      },
      takeProfit: [
        {
          target: 1,
          price: tp1,
          rationale: 'First scale-out near the initial breakout extension.'
        },
        {
          target: 2,
          price: tp2,
          rationale: 'Second target captures a stronger continuation move if momentum persists.'
        }
      ],
      stopLoss: {
        price: stopLoss,
        rationale: 'Invalidates the intraday bullish setup if price loses the entry structure.'
      },
      riskRewardRatio
    },
    analysis: {
      summary,
      keyLevels: [lowerEntry, price, tp1, tp2, stopLoss],
      sentiment
    },
    evidence: {
      primaryTraceId: normalizeText(mcpResult.traceId),
      primaryEvidenceRef: normalizeText(mcpResult.evidenceRef),
      paymentRequestId: normalizeText(mcpResult.requestId),
      paymentTxHash: normalizeText(mcpResult.txHash),
      dataSourceTraceIds: [normalizeText(mcpResult.traceId)].filter(Boolean),
      receiptRefs: [normalizeText(mcpResult.receiptRef)].filter(Boolean),
      deliveredAt: new Date().toISOString()
    }
  };
}

const artifact = readDemoArtifact();
assert(artifact?.jobId, 'Demo artifact missing jobId.');

let accepted;
try {
  accepted = await requestJson(`/api/jobs/${encodeURIComponent(artifact.jobId)}/accept`, {
    method: 'POST',
    body: {}
  });
} catch (error) {
  const currentState = normalizeText(error?.payload?.error?.detail?.state || error?.payload?.job?.state || '');
  if (error?.status === 409 && currentState === 'accepted') {
    accepted = {
      job: {
        jobId: artifact.jobId,
        state: 'accepted'
      }
    };
  } else {
    throw error;
  }
}
assert(String(accepted?.job?.state || '').trim() === 'accepted', `Expected accepted state, received ${String(accepted?.job?.state || '').trim() || 'unknown'}.`);

const capabilities = await loadCapabilities();
const capabilityRecord =
  capabilities.find(
    (item) =>
      normalizeText(item?.providerId || item?.providerAgentId) === normalizeText(artifact.provider) &&
      (normalizeText(item?.action) === normalizeText(artifact.capability) ||
        normalizeText(item?.capabilityId || item?.id) === normalizeText(artifact.capability))
  ) || capabilities[0] || null;
assert(capabilityRecord, 'No capability record was available for MCP delivery.');

const desiredToolName = normalizeToolName(capabilityRecord.capabilityId || capabilityRecord.id || capabilityRecord.serviceId || '');
const runtime = await loadSessionRuntime();
const mcpPayer = normalizeText(runtime?.aaWallet || artifact.payer);
assert(mcpPayer, 'No synced session runtime matched payer for MCP execution.');
const toolsList = await postJsonRpc({
  jsonrpc: '2.0',
  id: 'btc-demo-tools-list',
  method: 'tools/list',
  params: {}
});
const tools = Array.isArray(toolsList.payload?.result?.tools) ? toolsList.payload.result.tools : [];
const tool = tools.find((item) => normalizeText(item?.name) === desiredToolName) || null;
assert(tool, `Required BTC MCP tool was not available: ${desiredToolName}`);

const call = await postJsonRpc({
  jsonrpc: '2.0',
  id: 'btc-demo-tools-call',
  method: 'tools/call',
  params: {
    name: normalizeText(tool.name),
    arguments: {
      pair: 'BTCUSDT',
      symbol: 'BTCUSDT',
      asset: 'BTC',
      timeframe: '1D',
      payer: mcpPayer,
      _meta: {
        traceId: `btc_demo_${normalizeText(artifact.jobId)}`
      }
    }
  }
});

assert(call.status === 200, `MCP tool call failed with status ${call.status}.`);
assert(call.payload?.result?.isError !== true, normalizeText(call.payload?.result?.structuredContent?.reason || call.payload?.result?.content?.[0]?.text || 'MCP tool call returned an error.'));

const mcpResult = normalizeMcpCallResult({
  ...(call.payload?.result?.structuredContent || {}),
  result: call.payload?.result?.structuredContent?.result || null,
  summary: call.payload?.result?.structuredContent?.summary || '',
  receipt: call.payload?.result?.structuredContent?.receipt || null
});

assert(mcpResult.traceId, 'MCP tool call did not return traceId.');
assert(mcpResult.requestId, 'MCP tool call did not return requestId.');
assert(mcpResult.evidenceRef, 'MCP tool call did not return evidenceRef.');

const delivery = buildTradingPlanFromResult(
  {
    ...mcpResult,
    result: call.payload?.result?.structuredContent?.result || null,
    summary: call.payload?.result?.structuredContent?.summary || ''
  },
  capabilityRecord
);

const submitted = await requestJson(`/api/jobs/${encodeURIComponent(artifact.jobId)}/submit`, {
  method: 'POST',
  body: {
    delivery,
    primaryTraceId: delivery.evidence.primaryTraceId,
    paymentRequestId: delivery.evidence.paymentRequestId,
    paymentTxHash: delivery.evidence.paymentTxHash,
    evidenceRef: delivery.evidence.primaryEvidenceRef,
    receiptRefs: delivery.evidence.receiptRefs,
    dataSourceTraceIds: delivery.evidence.dataSourceTraceIds,
    summary: delivery.analysis.summary
  }
});

assert(String(submitted?.job?.state || '').trim() === 'submitted', `Expected submitted state, received ${String(submitted?.job?.state || '').trim() || 'unknown'}.`);

console.log(
  JSON.stringify(
    {
      ok: true,
      jobId: normalizeText(submitted?.job?.jobId),
      traceId: normalizeText(submitted?.job?.traceId),
      requestId: delivery.evidence.paymentRequestId,
      evidenceRef: delivery.evidence.primaryEvidenceRef,
      receiptRef: delivery.evidence.receiptRefs[0] || '',
      toolName: normalizeText(tool.name)
    },
    null,
    2
  )
);
