import {
  buildBtcTradingPlanDeliveryStandard,
  normalizeBtcTradingPlanEvidence,
  validateBtcTradingPlanV1,
  BTC_TRADING_PLAN_V1_SCHEMA_ID
} from './btcTradingPlanV1.js';
import {
  buildNewsBriefDeliveryStandard,
  normalizeNewsBriefEvidence,
  validateNewsBriefV1,
  NEWS_BRIEF_V1_SCHEMA_ID
} from './newsBriefV1.js';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  BTC_TRADING_PLAN_V1_SCHEMA_ID,
} from './btcTradingPlanV1.js';
export {
  NEWS_BRIEF_V1_SCHEMA_ID
} from './newsBriefV1.js';

export { validateNewsBriefJobDelivery } from './newsBriefV1.js';

function buildUnknownSchemaValidation(delivery = null) {
  return {
    ok: false,
    schema: normalizeText(delivery?.schema || ''),
    conformant: false,
    errors: [
      {
        path: 'schema',
        code: 'unknown_schema',
        message: `unsupported delivery schema ${normalizeText(delivery?.schema || '') || '(empty)'}`
      }
    ]
  };
}

export function validateDeliveryPayload(delivery = null) {
  if (!isPlainObject(delivery)) {
    return buildUnknownSchemaValidation(delivery);
  }
  const schemaId = normalizeText(delivery.schema);
  if (schemaId === BTC_TRADING_PLAN_V1_SCHEMA_ID) {
    return validateBtcTradingPlanV1(delivery);
  }
  if (schemaId === NEWS_BRIEF_V1_SCHEMA_ID) {
    return validateNewsBriefV1(delivery);
  }
  return buildUnknownSchemaValidation(delivery);
}

export function normalizeDeliveryEvidence(delivery = null, fallback = {}) {
  const schemaId = normalizeText(delivery?.schema || '');
  if (schemaId === NEWS_BRIEF_V1_SCHEMA_ID) {
    return normalizeNewsBriefEvidence(delivery, fallback);
  }
  return normalizeBtcTradingPlanEvidence(delivery, fallback);
}

export function buildDeliveryStandard({
  delivery = null,
  resultHash = '',
  outcomeAnchored = false,
  validatorApproved = false
} = {}) {
  const schemaId = normalizeText(delivery?.schema || '');
  if (schemaId === NEWS_BRIEF_V1_SCHEMA_ID) {
    return buildNewsBriefDeliveryStandard({
      delivery,
      resultHash,
      outcomeAnchored,
      validatorApproved
    });
  }
  return buildBtcTradingPlanDeliveryStandard({
    delivery,
    resultHash,
    outcomeAnchored,
    validatorApproved
  });
}

export function deriveDeliverySummary(delivery = null, fallback = '') {
  if (!isPlainObject(delivery)) return normalizeText(fallback);
  const schemaId = normalizeText(delivery.schema);
  if (schemaId === NEWS_BRIEF_V1_SCHEMA_ID) {
    return normalizeText(delivery.summary || fallback);
  }
  return normalizeText(delivery?.analysis?.summary || fallback);
}
