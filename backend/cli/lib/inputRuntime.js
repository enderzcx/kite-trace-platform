import { readFile, writeFile } from 'node:fs/promises';
import { createCliError } from './errors.js';

function splitTopLevelSegments(text = '', delimiter = ',') {
  const segments = [];
  let current = '';
  let quote = '';
  let escapeNext = false;
  let depth = 0;

  for (const char of String(text || '')) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (quote) {
      current += char;
      if (char === '\\') {
        escapeNext = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === delimiter && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current || text.endsWith(delimiter)) {
    segments.push(current);
  }

  return segments;
}

function splitTopLevelPair(segment = '') {
  let quote = '';
  let escapeNext = false;
  let depth = 0;
  let index = -1;
  const text = String(segment || '');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (quote) {
      if (char === '\\') {
        escapeNext = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ':' && depth === 0) {
      index = i;
      break;
    }
  }

  if (index < 0) return null;
  return [text.slice(0, index), text.slice(index + 1)];
}

function parseLooseValue(rawValue = '') {
  const text = String(rawValue || '').trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    const normalized =
      text.startsWith("'") && text.endsWith("'")
        ? `"${text.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : text;
    return JSON.parse(normalized);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function tryParseLooseJsonObject(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;

  const inner = text.slice(1, -1).trim();
  if (!inner) return {};

  const parsed = {};
  for (const segment of splitTopLevelSegments(inner, ',')) {
    const pair = splitTopLevelPair(segment);
    if (!pair) return null;
    const [rawKey, rawValue] = pair;
    const keyText = String(rawKey || '').trim();
    if (!keyText) return null;
    const key =
      (keyText.startsWith('"') && keyText.endsWith('"')) || (keyText.startsWith("'") && keyText.endsWith("'"))
        ? keyText.slice(1, -1)
        : keyText;
    if (!key) return null;
    parsed[key] = parseLooseValue(rawValue);
  }

  return parsed;
}

export async function readStructuredInput(rawInput = '') {
  const source = String(rawInput || '').trim();
  if (!source) {
    throw createCliError('An input payload is required. Pass --input <json-or-file>.', {
      code: 'input_required'
    });
  }

  const looksLikeJson = source.startsWith('{') || source.startsWith('[');
  const text = looksLikeJson ? source : await readFile(source, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') {
      throw createCliError(`Input file not found: ${source}`, {
        code: 'input_file_not_found'
      });
    }
    throw error;
  });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    parsed = tryParseLooseJsonObject(text);
    if (!parsed) {
      throw createCliError(`Input must be valid JSON: ${error?.message || 'invalid_json'}`, {
        code: 'invalid_input_json'
      });
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createCliError('Input JSON must be an object.', {
      code: 'invalid_input_shape'
    });
  }
  return parsed;
}

export function normalizeCapability(capability = '') {
  return String(capability || '').trim().toLowerCase();
}

export function capabilityAliases(capability = '') {
  const normalized = normalizeCapability(capability);
  const aliases = new Set();
  if (normalized) {
    aliases.add(normalized);
    if (normalized.startsWith('cap-') && normalized.length > 4) {
      aliases.add(normalized.slice(4));
    } else {
      aliases.add(`cap-${normalized}`);
    }
  }
  if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
    aliases.add('technical-analysis-feed');
    aliases.add('risk-score-feed');
    aliases.add('volatility-snapshot');
  }
  if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
    aliases.add('info-analysis-feed');
    aliases.add('x-reader-feed');
    aliases.add('url-digest');
  }
  if (['btc-price-feed', 'market-quote'].includes(normalized)) {
    aliases.add('btc-price-feed');
    aliases.add('market-quote');
  }
  if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
    aliases.add('hyperliquid-order-testnet');
    aliases.add('trade-order-feed');
    aliases.add('execute-plan');
  }
  return Array.from(aliases).filter(Boolean);
}

export function capabilityMatchesValue(value = '', capability = '') {
  const normalizedValue = normalizeCapability(value);
  if (!capability) return true;
  if (!normalizedValue) return false;
  return capabilityAliases(capability).includes(normalizedValue);
}

export function serviceMatchesCapability(service = {}, capability = '') {
  if (!capability) return true;
  return [service?.id, service?.capabilityId, service?.action].some((value) =>
    capabilityMatchesValue(value, capability)
  );
}

export function providerMatches(service = {}, provider = '') {
  const wanted = String(provider || '').trim().toLowerCase();
  if (!wanted) return true;
  const candidates = [
    String(service?.providerAgentId || '').trim().toLowerCase(),
    String(service?.id || '').trim().toLowerCase(),
    String(service?.name || '').trim().toLowerCase()
  ].filter(Boolean);
  return candidates.includes(wanted);
}

export function selectBuyService(services = [], { provider = '', capability = '' } = {}) {
  const matches = (Array.isArray(services) ? services : []).filter((service) => {
    return providerMatches(service, provider) && serviceMatchesCapability(service, capability);
  });
  return matches[0] || null;
}

export function normalizeBuyState(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['unlocked', 'success', 'paid', 'completed'].includes(raw)) return 'completed';
  if (['payment_required', 'payment_pending', 'pending'].includes(raw)) return 'payment_pending';
  if (['running', 'processing'].includes(raw)) return 'fulfilling';
  if (['failed', 'error', 'expired', 'rejected'].includes(raw)) return 'failed';
  return raw || 'running';
}

export function normalizeFlowState(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['success', 'completed', 'unlocked', 'paid'].includes(raw)) return 'completed';
  if (['running', 'processing'].includes(raw)) return 'running';
  if (['pending', 'payment_pending', 'payment_required'].includes(raw)) return 'payment_pending';
  if (['failed', 'error', 'expired', 'rejected'].includes(raw)) return 'failed';
  return raw || 'unknown';
}

export function normalizeLifecycleState(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['created', 'quoted'].includes(raw)) return raw;
  if (['payment_pending', 'pending', 'payment_required', 'funding_pending'].includes(raw)) return 'payment_pending';
  if (['paid', 'funded'].includes(raw)) return 'paid';
  if (['submitted', 'running', 'processing', 'fulfilling', 'fulfillment_pending'].includes(raw)) return 'fulfillment_pending';
  if (['success', 'completed', 'unlocked'].includes(raw)) return 'completed';
  if (['rejected'].includes(raw)) return 'rejected';
  if (['expired'].includes(raw)) return 'expired';
  if (['failed', 'error'].includes(raw)) return 'failed';
  return raw || 'unknown';
}

export function ensureReference(commandArgs = [], label = 'trace-or-request-id') {
  const reference = String((Array.isArray(commandArgs) ? commandArgs[0] : '') || '').trim();
  if (!reference) {
    throw createCliError(`A ${label} is required.`, {
      code: 'reference_required'
    });
  }
  return reference;
}

export async function writeArtifactDownload(kind = 'artifact', reference = '', payload = {}) {
  const safeReference =
    String(reference || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_') || 'latest';
  const fileName = `ktrace_${kind}_${safeReference}.json`;
  await writeFile(fileName, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return fileName;
}
