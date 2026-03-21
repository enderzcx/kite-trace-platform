import * as z from 'zod/v4';
import { KTRACE_BUILTIN_TOOLS } from './ktraceBuiltinTools.js';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolName(capabilityId = '') {
  return `ktrace__${normalizeText(capabilityId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function normalizeAudience(value = '', fallback = 'public_product') {
  const normalized = normalizeText(value).toLowerCase();
  if (['public_product', 'trusted_integration', 'internal_ops'].includes(normalized)) return normalized;
  if (normalized === 'public') return 'public_product';
  if (normalized === 'trusted') return 'trusted_integration';
  if (normalized === 'internal') return 'internal_ops';
  return fallback;
}

function normalizeScopeMode(value = '', fallback = 'scoped') {
  const normalized = normalizeText(value).toLowerCase();
  if (['scoped', 'global'].includes(normalized)) return normalized;
  if (normalized === 'owner-scoped') return 'scoped';
  return fallback;
}

function normalizeRiskLevel(value = '', fallback = 'standard') {
  const normalized = normalizeText(value).toLowerCase();
  if (['low', 'standard', 'high', 'critical'].includes(normalized)) return normalized;
  return fallback;
}

function inferTitleOverride(capability = {}) {
  const capabilityId = normalizeText(capability?.capabilityId || capability?.id || capability?.serviceId || '').toLowerCase();
  if (capabilityId === 'svc_btcusd_minute') {
    return 'BTC Price Quote (Primary)';
  }
  if (capabilityId === 'cap-market-price-feed') {
    return 'Market Snapshot (Secondary)';
  }
  return normalizeText(capability?.name || capabilityId);
}

function inferDescriptionOverride(capability = {}) {
  const capabilityId = normalizeText(capability?.capabilityId || capability?.id || capability?.serviceId || '').toLowerCase();
  const baseDescription = normalizeText(capability?.description || capabilityId);
  if (capabilityId === 'svc_btcusd_minute') {
    return `${baseDescription} Prefer this tool for current BTC/BTCUSDT price requests.`;
  }
  if (capabilityId === 'cap-market-price-feed') {
    return `${baseDescription} Use this for multi-asset snapshots, not for the primary single-BTC quote path.`;
  }
  return baseDescription;
}

function inferToolPriority(capability = {}) {
  const capabilityId = normalizeText(capability?.capabilityId || capability?.id || capability?.serviceId || '').toLowerCase();
  if (capabilityId === 'svc_btcusd_minute') return 100;
  if (capabilityId === 'cap-market-price-feed') return 10;
  return 50;
}

function inferReadOnlyHint(action = '') {
  return normalizeText(action).toLowerCase() !== 'hyperliquid-order-testnet';
}

function inferPrimitiveSchema(descriptor, exampleValue) {
  const descriptorText = normalizeText(descriptor).toLowerCase();

  if (typeof exampleValue === 'boolean' || descriptorText.includes('boolean')) {
    return z.boolean();
  }

  if (typeof exampleValue === 'number' || descriptorText.includes('number') || descriptorText.includes('int')) {
    return z.number();
  }

  if (Array.isArray(exampleValue)) {
    const firstValue = exampleValue[0];
    if (typeof firstValue === 'number') return z.array(z.number());
    if (typeof firstValue === 'boolean') return z.array(z.boolean());
    if (isPlainObject(firstValue)) return z.array(z.any());
    return z.array(z.string());
  }

  if (Array.isArray(descriptor)) {
    return z.array(z.any());
  }

  if (isPlainObject(exampleValue) || isPlainObject(descriptor)) {
    return z.any();
  }

  return z.string();
}

function buildFieldSchema(key, descriptor, exampleInput = {}) {
  const exampleValue = exampleInput[key];
  const baseSchema = inferPrimitiveSchema(descriptor, exampleValue);
  const descriptorText = typeof descriptor === 'string' ? descriptor : '';
  const describedSchema = descriptorText ? baseSchema.describe(descriptorText) : baseSchema;
  return describedSchema.optional();
}

function buildInputShape(schemaInput = {}, exampleInput = {}) {
  const schemaObject = isPlainObject(schemaInput) ? schemaInput : {};
  const exampleObject = isPlainObject(exampleInput) ? exampleInput : {};
  const keys = new Set([
    ...Object.keys(schemaObject),
    ...Object.keys(exampleObject)
  ]);

  const shape = {};
  for (const key of keys) {
    if (!normalizeText(key)) continue;
    shape[key] = buildFieldSchema(key, schemaObject[key], exampleObject);
  }
  return shape;
}

function buildToolInputSchema(capability = {}) {
  const shape = buildInputShape(capability?.inputSchema, capability?.exampleInput);
  return z.object(shape).passthrough();
}

function buildToolDefinition(capability = {}) {
  const capabilityId = normalizeText(capability?.capabilityId || capability?.id || capability?.serviceId || '');
  if (!capabilityId) return null;

  return {
    name: normalizeToolName(capabilityId),
    title: inferTitleOverride(capability),
    description: inferDescriptionOverride(capability),
    annotations: {
      readOnlyHint: inferReadOnlyHint(capability?.action),
      destructiveHint: normalizeText(capability?.action || '').toLowerCase() === 'hyperliquid-order-testnet',
      idempotentHint: inferReadOnlyHint(capability?.action),
      openWorldHint: true
    },
    capabilityId,
    serviceId: capabilityId,
    action: normalizeText(capability?.action || ''),
    providerId: normalizeText(capability?.providerId || ''),
    audience: normalizeAudience(capability?.audience, 'public_product'),
    scopeMode: normalizeScopeMode(capability?.scopeMode, 'scoped'),
    riskLevel: normalizeRiskLevel(capability?.riskLevel, 'standard'),
    paymentMode: normalizeText(capability?.paymentMode || ''),
    rawCapability: capability,
    inputSchema: buildToolInputSchema(capability)
  };
}

function shouldExposeCapabilityTool(tool = {}, { authSource = '' } = {}) {
  if (normalizeText(authSource) !== 'connector-grant') return true;
  return normalizeAudience(tool?.audience, 'public_product') === 'public_product';
}

function shouldExposeBuiltinTool(tool = {}, { authSource = '', allowedBuiltinTools = [] } = {}) {
  if (normalizeText(authSource) !== 'connector-grant') return true;
  const audience = normalizeAudience(tool?.audience, 'public_product');
  const allowed = new Set((Array.isArray(allowedBuiltinTools) ? allowedBuiltinTools : []).map((item) => normalizeText(item).toLowerCase()));
  if (!allowed.has(normalizeText(tool?.builtinId || '').toLowerCase())) return false;
  return audience === 'public_product' || audience === 'trusted_integration';
}

export function createMcpToolsAdapter({ fetchLoopbackJson }) {
  async function listTools({ traceId = '', apiKey = '', authSource = '', allowedBuiltinTools = [] } = {}) {
    const { payload } = await fetchLoopbackJson({
      pathname: '/api/v1/capabilities?limit=500',
      apiKey,
      traceId
    });

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const capabilityTools = items
      .filter((item) => item?.active !== false)
      .map((item) => buildToolDefinition(item))
      .filter((tool) => shouldExposeCapabilityTool(tool, { authSource }))
      .filter(Boolean)
      .sort((left, right) => {
        const priorityDiff = inferToolPriority(right?.rawCapability) - inferToolPriority(left?.rawCapability);
        if (priorityDiff !== 0) return priorityDiff;
        return normalizeText(left?.title).localeCompare(normalizeText(right?.title));
      });

    const builtinTools = KTRACE_BUILTIN_TOOLS
      .map((tool) => ({ ...tool }))
      .filter((tool) => shouldExposeBuiltinTool(tool, { authSource, allowedBuiltinTools }));
    return [...builtinTools, ...capabilityTools];
  }

  return {
    listTools,
    normalizeToolName
  };
}
