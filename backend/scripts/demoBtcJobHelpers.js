import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_BASE_URL = String(
  process.env.DEMO_BTC_JOB_BASE_URL ||
    (process.env.PORT ? `http://127.0.0.1:${String(process.env.PORT).trim()}` : '') ||
    process.env.KTRACE_BASE_URL ||
    'http://127.0.0.1:3399' ||
    process.env.BACKEND_PUBLIC_URL ||
    ''
)
  .trim()
  .replace(/\/+$/, '');
const DEFAULT_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.DEMO_BTC_JOB_TIMEOUT_MS || 45000));

export const DEMO_JOB_ARTIFACT_PATH = path.resolve(process.cwd(), 'data', 'demo_btc_job.json');

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMaybeJson(rawText = '') {
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

function parseSsePayload(rawText = '') {
  const dataLines = String(rawText || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return dataLines.length > 0 ? parseMaybeJson(dataLines.join('\n')) : null;
}

export function resolveBaseUrl() {
  return DEFAULT_BASE_URL;
}

export function resolveAgentApiKey() {
  return normalizeText(
    process.env.KTRACE_AGENT_API_KEY ||
      process.env.KITECLAW_API_KEY_AGENT ||
      process.env.API_KEY_AGENT ||
      process.env.KITECLAW_API_KEY_ADMIN ||
      process.env.KTRACE_ACCOUNT_API_KEY ||
      process.env.MCP_API_KEY ||
      ''
  );
}

export function buildHeaders({ json = true, apiKey = resolveAgentApiKey(), traceId = '' } = {}) {
  return {
    Accept: json ? 'application/json' : 'application/json, text/event-stream',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(traceId ? { 'x-trace-id': traceId } : {})
  };
}

export async function requestJson(pathname, { method = 'GET', body = null, apiKey = resolveAgentApiKey(), traceId = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`)), DEFAULT_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${resolveBaseUrl()}${pathname}`, {
      method,
      headers: buildHeaders({ apiKey, traceId }),
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`request timeout after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`);
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const rawText = await response.text();
  const payload = parseMaybeJson(rawText);
  if (!response.ok || payload?.ok === false) {
    const nestedError = isPlainObject(payload?.error)
      ? normalizeText(payload.error.message || payload.error.reason || payload.error.code || '')
      : '';
    const reason = normalizeText(payload?.reason || payload?.message || nestedError || payload?.error || rawText || `HTTP ${response.status}`);
    const error = new Error(reason);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function postJsonRpc(body, { apiKey = resolveAgentApiKey() } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`)), DEFAULT_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${resolveBaseUrl()}/mcp`, {
      method: 'POST',
      headers: {
        ...buildHeaders({ apiKey }),
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`request timeout after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`);
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const rawText = await response.text();
  const contentType = normalizeText(response.headers.get('content-type') || '');
  const payload = contentType.includes('text/event-stream') ? parseSsePayload(rawText) : parseMaybeJson(rawText);
  if (response.status >= 400 && !payload?.result) {
    const reason = normalizeText(payload?.error?.message || rawText || `HTTP ${response.status}`);
    const error = new Error(reason);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return {
    status: response.status,
    payload
  };
}

export async function loadCapabilities() {
  const payload = await requestJson('/api/v1/capabilities?limit=100');
  return Array.isArray(payload?.items) ? payload.items : [];
}

export async function loadSessionRuntime() {
  const payload = await requestJson('/api/session/runtime');
  return isPlainObject(payload?.runtime) ? payload.runtime : {};
}

export function pickMarketCapability(capabilities = []) {
  const items = Array.isArray(capabilities) ? capabilities : [];
  const preferred = items.find((item) => /btc-price-feed|market-quote/i.test(normalizeText(item?.action || item?.id || '')));
  if (preferred) return preferred;
  const fallback = items.find((item) => /btc|price|market/i.test(
    [item?.id, item?.name, item?.description, item?.action].map((entry) => normalizeText(entry).toLowerCase()).join(' ')
  ));
  return fallback || items[0] || null;
}

export function resolveExecutorAddress() {
  return normalizeText(
    process.env.DEMO_BTC_JOB_EXECUTOR ||
      process.env.ERC8183_EXECUTOR_AA_ADDRESS ||
      process.env.ERC8183_EXECUTOR_ADDRESS ||
      ''
  );
}

export function resolveValidatorAddress() {
  return normalizeText(
    process.env.DEMO_BTC_JOB_VALIDATOR ||
      process.env.ERC8183_VALIDATOR_AA_ADDRESS ||
      process.env.ERC8183_VALIDATOR_ADDRESS ||
      ''
  );
}

export async function pollJobUntilSettled(jobId, {
  intervalMs = 2000,
  maxWaitMs = 300000,
  apiKey = resolveAgentApiKey()
} = {}) {
  const settled = new Set(['funded', 'accepted', 'submitted', 'validated', 'completed', 'rejected', 'expired']);
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const payload = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, { apiKey });
    const state = String(payload?.job?.state || '').trim();
    if (state === 'funding_failed' || state === 'failed') {
      const error = new Error(String(payload?.job?.error || payload?.job?.summary || 'funding failed'));
      error.code = 'FUNDING_FAILED';
      error.payload = payload;
      throw error;
    }
    if (settled.has(state)) return payload;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const error = new Error(`Job ${jobId} did not settle within ${maxWaitMs}ms`);
  error.code = 'POLL_TIMEOUT';
  throw error;
}

export function readDemoArtifact() {
  if (!fs.existsSync(DEMO_JOB_ARTIFACT_PATH)) {
    throw new Error(`Demo job artifact not found at ${DEMO_JOB_ARTIFACT_PATH}`);
  }
  return parseMaybeJson(fs.readFileSync(DEMO_JOB_ARTIFACT_PATH, 'utf8'));
}

export function writeDemoArtifact(payload = {}) {
  fs.mkdirSync(path.dirname(DEMO_JOB_ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(DEMO_JOB_ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function normalizeMcpCallResult(result = {}) {
  const structured = isPlainObject(result?.structuredContent)
    ? result.structuredContent
    : isPlainObject(result)
      ? result
      : {};
  const receipt = isPlainObject(structured?.receipt) ? structured.receipt : {};
  return {
    traceId: normalizeText(structured?.traceId || ''),
    requestId: normalizeText(structured?.requestId || ''),
    txHash: normalizeText(structured?.txHash || ''),
    evidenceRef: normalizeText(structured?.evidenceRef || ''),
    receiptRef:
      normalizeText(receipt?.receiptRef || '') ||
      (normalizeText(structured?.requestId || '') ? `/api/receipt/${encodeURIComponent(normalizeText(structured.requestId))}` : ''),
    summary: normalizeText(structured?.summary || '')
  };
}
