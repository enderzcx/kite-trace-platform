import * as z from 'zod/v4';

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
    title: normalizeText(capability?.name || capabilityId),
    description: normalizeText(capability?.description || capabilityId),
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
    rawCapability: capability,
    inputSchema: buildToolInputSchema(capability)
  };
}

export function createMcpToolsAdapter({ fetchLoopbackJson }) {
  async function listTools({ traceId = '', apiKey = '' } = {}) {
    const { payload } = await fetchLoopbackJson({
      pathname: '/api/v1/capabilities?limit=500',
      apiKey,
      traceId
    });

    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items
      .filter((item) => item?.active !== false)
      .map((item) => buildToolDefinition(item))
      .filter(Boolean);
  }

  return {
    listTools,
    normalizeToolName
  };
}
