import * as z from 'zod/v4';

export const BTC_TRADING_PLAN_V1_SCHEMA_ID = 'ktrace-btc-trading-plan-v1';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringArray(values = []) {
  return Array.isArray(values) ? values.map((item) => normalizeText(item)).filter(Boolean) : [];
}

const deliverySchema = z.object({
  schema: z.literal(BTC_TRADING_PLAN_V1_SCHEMA_ID),
  asset: z.literal('BTC/USDT'),
  generatedAt: z.string().min(1),
  marketSnapshot: z.object({
    price: z.number().finite(),
    priceSource: z.string().min(1),
    volume24h: z.number().finite(),
    dominance: z.number().finite()
  }),
  tradingPlan: z.object({
    bias: z.enum(['long', 'short', 'neutral']),
    timeframe: z.string().min(1),
    entry: z.object({
      price: z.number().finite(),
      zone: z.tuple([z.number().finite(), z.number().finite()])
    }),
    takeProfit: z.array(
      z.object({
        target: z.number().int().positive(),
        price: z.number().finite(),
        rationale: z.string().min(1)
      })
    ).min(2),
    stopLoss: z.object({
      price: z.number().finite(),
      rationale: z.string().min(1)
    }),
    riskRewardRatio: z.number().finite()
  }),
  analysis: z.object({
    summary: z.string().min(1),
    keyLevels: z.array(z.union([z.string(), z.number()])).min(1),
    sentiment: z.enum(['bullish', 'bearish', 'neutral'])
  }),
  evidence: z.object({
    primaryTraceId: z.string().min(1),
    primaryEvidenceRef: z.string().min(1),
    paymentRequestId: z.string().min(1),
    paymentTxHash: z.string().optional().default(''),
    dataSourceTraceIds: z.array(z.string().min(1)).min(1),
    receiptRefs: z.array(z.string().min(1)).min(1),
    deliveredAt: z.string().min(1)
  })
});

function formatZodIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((issue) => ({
    path: Array.isArray(issue?.path) ? issue.path.join('.') : '',
    code: normalizeText(issue?.code || 'invalid'),
    message: normalizeText(issue?.message || 'invalid field')
  }));
}

export function validateBtcTradingPlanV1(delivery = null) {
  if (!isPlainObject(delivery)) {
    return {
      ok: false,
      schema: '',
      conformant: false,
      errors: [
        {
          path: '',
          code: 'invalid_type',
          message: 'delivery must be an object'
        }
      ]
    };
  }

  const schemaId = normalizeText(delivery.schema);
  if (schemaId && schemaId !== BTC_TRADING_PLAN_V1_SCHEMA_ID) {
    return {
      ok: false,
      schema: schemaId,
      conformant: false,
      errors: [
        {
          path: 'schema',
          code: 'schema_mismatch',
          message: `expected ${BTC_TRADING_PLAN_V1_SCHEMA_ID}`
        }
      ]
    };
  }

  const parsed = deliverySchema.safeParse(delivery);
  return {
    ok: parsed.success,
    schema: parsed.success ? BTC_TRADING_PLAN_V1_SCHEMA_ID : (schemaId || BTC_TRADING_PLAN_V1_SCHEMA_ID),
    conformant: parsed.success,
    value: parsed.success ? parsed.data : null,
    errors: parsed.success ? [] : formatZodIssues(parsed.error?.issues)
  };
}

export function buildBtcTradingPlanDeliveryStandard({
  delivery = null,
  resultHash = '',
  outcomeAnchored = false,
  validatorApproved = false
} = {}) {
  const validation = validateBtcTradingPlanV1(delivery);
  const hasDelivery = isPlainObject(delivery);
  return {
    version: 'ktrace-delivery-v1',
    definition: 'validator_approve + result_hash_submitted + outcome_anchor_onchain + schema_check',
    schema: validation.schema || normalizeText(delivery?.schema || ''),
    conformant: hasDelivery ? Boolean(validation.conformant) : null,
    errors: hasDelivery ? validation.errors : [],
    validatorApproved: Boolean(validatorApproved),
    resultHashSubmitted: Boolean(normalizeText(resultHash)),
    outcomeAnchored: Boolean(outcomeAnchored),
    satisfied:
      Boolean(validatorApproved) &&
      Boolean(normalizeText(resultHash)) &&
      Boolean(outcomeAnchored) &&
      (!hasDelivery || Boolean(validation.conformant))
  };
}

export function normalizeBtcTradingPlanEvidence(delivery = null, fallback = {}) {
  const source = isPlainObject(delivery?.evidence) ? delivery.evidence : {};
  const fallbackEvidence = isPlainObject(fallback) ? fallback : {};
  return {
    primaryTraceId: normalizeText(source.primaryTraceId || fallbackEvidence.primaryTraceId || ''),
    primaryEvidenceRef: normalizeText(source.primaryEvidenceRef || fallbackEvidence.primaryEvidenceRef || ''),
    paymentRequestId: normalizeText(source.paymentRequestId || fallbackEvidence.paymentRequestId || ''),
    paymentTxHash: normalizeText(source.paymentTxHash || fallbackEvidence.paymentTxHash || ''),
    dataSourceTraceIds: normalizeStringArray(source.dataSourceTraceIds || fallbackEvidence.dataSourceTraceIds),
    receiptRefs: normalizeStringArray(source.receiptRefs || fallbackEvidence.receiptRefs),
    deliveredAt: normalizeText(source.deliveredAt || fallbackEvidence.deliveredAt || '')
  };
}
