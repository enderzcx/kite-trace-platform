import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { applyNodeEnvProxyPreference } from '../lib/envProxy.js';
import { resolveRuntimeConfig } from '../cli/runtimeConfig.js';

loadEnv({ path: path.resolve(process.cwd(), '.env') });
applyNodeEnvProxyPreference();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeToolName(capability = {}) {
  const capabilityId = normalizeText(capability?.capabilityId || capability?.id || capability?.serviceId || '');
  return capabilityId
    ? `ktrace__${capabilityId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
    : '';
}

const PREFERRED_PAID_CAPABILITY_IDS = [
  'svc_btcusd_minute',
  'svc-live-btc-feed',
  'svc-compare-btc',
  'cap-weather-context',
  'cap-tech-buzz-signal',
  'cap-market-price-feed'
];

function sortPaidCapabilities(capabilities = []) {
  const priority = new Map(PREFERRED_PAID_CAPABILITY_IDS.map((capabilityId, index) => [capabilityId, index]));
  return [...capabilities].sort((left, right) => {
    const leftId = normalizeText(left?.capabilityId || left?.id || left?.serviceId || '');
    const rightId = normalizeText(right?.capabilityId || right?.id || right?.serviceId || '');
    const leftRank = priority.has(leftId) ? priority.get(leftId) : Number.MAX_SAFE_INTEGER;
    const rightRank = priority.has(rightId) ? priority.get(rightId) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return leftId.localeCompare(rightId);
  });
}

function buildRequestOptions(timeoutMs = 60_000) {
  return {
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs
  };
}

async function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildHeaders(apiKey = '') {
  const headers = {};
  const normalizedApiKey = normalizeText(apiKey);
  if (normalizedApiKey) headers['x-api-key'] = normalizedApiKey;
  return headers;
}

async function fetchJsonWithTimeout(url, headers = {}, timeoutMs = 60_000, label = 'json_fetch') {
  const response = await withTimeout(fetch(url, { headers }), timeoutMs, label);
  const payload = await response.json();
  return {
    status: response.status,
    payload
  };
}

async function resolveSessionRuntimeSource(profile = '') {
  const explicitPath = normalizeText(
    process.env.MCP_BRIDGE_SESSION_RUNTIME ||
      process.env.KTRACE_MCP_SESSION_RUNTIME ||
      ''
  );
  if (explicitPath) {
    await access(explicitPath);
    return {
      kind: 'file',
      path: explicitPath,
      cleanup: async () => {}
    };
  }

  const runtimeBundle = await resolveRuntimeConfig({ profile });
  const localSessionRuntime = runtimeBundle?.config?.localSessionRuntime;
  if (localSessionRuntime && typeof localSessionRuntime === 'object' && !Array.isArray(localSessionRuntime)) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ktrace-session-runtime-'));
    const tempPath = path.join(tempDir, 'ktrace-session-runtime.json');
    await writeFile(
      tempPath,
      `${JSON.stringify(
        {
          schema: 'ktrace-local-session-runtime-v1',
          createdAt: Date.now(),
          runtime: localSessionRuntime
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    return {
      kind: 'temp-file',
      path: tempPath,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    };
  }

  return {
    kind: 'missing',
    path: '',
    cleanup: async () => {}
  };
}

let client = null;
let transport = null;
let sessionRuntimeSource = null;

try {
  const profile = normalizeText(process.env.MCP_BRIDGE_PROFILE || process.env.KTRACE_PROFILE || '');
  const runtimeBundle = await resolveRuntimeConfig({ profile });
  const runtime = runtimeBundle.config;
  const baseUrl = normalizeText(process.env.MCP_BRIDGE_BASE_URL || runtime.baseUrl || 'http://127.0.0.1:3399');
  const apiKey = normalizeText(
    process.env.MCP_BRIDGE_API_KEY ||
      process.env.KTRACE_API_KEY ||
      runtime.apiKey ||
      ''
  );
  const timeoutMs = Math.max(30_000, Number(process.env.MCP_BRIDGE_LIVE_TIMEOUT_MS || 180_000) || 180_000);
  const requestedToolName = normalizeText(process.env.MCP_BRIDGE_PAID_TOOL_NAME || '');

  sessionRuntimeSource = await resolveSessionRuntimeSource(profile);
  if (!apiKey) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'api_key_missing',
          details: {
            profile: runtime.profile,
            baseUrl
          }
        },
        null,
        2
      )
    );
    process.exit(0);
  }
  if (!sessionRuntimeSource?.path) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'local_session_runtime_missing',
          details: {
            profile: runtime.profile,
            expectedEnv: 'MCP_BRIDGE_SESSION_RUNTIME'
          }
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const { status: capabilitiesStatus, payload: capabilitiesPayload } = await fetchJsonWithTimeout(
    `${baseUrl}/api/v1/capabilities?limit=500`,
    buildHeaders(apiKey),
    timeoutMs,
    'capabilities_fetch'
  );
  assert(capabilitiesStatus >= 200 && capabilitiesStatus < 300, 'capabilities endpoint failed');
  const capabilities = Array.isArray(capabilitiesPayload?.items) ? capabilitiesPayload.items : [];
  const paidCapabilities = sortPaidCapabilities(
    capabilities
      .filter((item) => item?.active !== false)
      .filter((item) => Number(item?.pricing?.amount || item?.price || 0) > 0)
  );
  const selectedCapabilities = requestedToolName
    ? paidCapabilities.filter((item) => normalizeToolName(item) === requestedToolName)
    : paidCapabilities;
  assert(selectedCapabilities.length > 0, `No paid capability found for ${requestedToolName || 'auto-select'}.`);

  transport = new StdioClientTransport({
    command: 'node',
    args: [
      './bin/ktrace.js',
      '--base-url',
      baseUrl,
      '--api-key',
      apiKey,
      ...(profile ? ['--profile', profile] : []),
      'mcp',
      'bridge',
      '--session-runtime',
      sessionRuntimeSource.path
    ],
    cwd: process.cwd(),
    stderr: 'pipe'
  });
  client = new Client({ name: 'mcp-bridge-paid-live-verifier', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport, buildRequestOptions(timeoutMs));

  const failures = [];
  let passedSummary = null;

  for (const selectedCapability of selectedCapabilities) {
    const toolName = normalizeToolName(selectedCapability);
    if (!toolName) {
      failures.push({
        capabilityId: normalizeText(selectedCapability?.capabilityId || selectedCapability?.id || ''),
        toolName: '',
        reason: 'tool_name_derivation_failed'
      });
      continue;
    }

    const traceId = `bridge_paid_live_${Date.now()}`;
    try {
      const paidCall = await withTimeout(
        client.callTool(
          {
            name: toolName,
            arguments: {
              ...(selectedCapability?.exampleInput && typeof selectedCapability.exampleInput === 'object'
                ? selectedCapability.exampleInput
                : {}),
              _meta: {
                traceId
              }
            }
          },
          CallToolResultSchema,
          buildRequestOptions(timeoutMs)
        ),
        timeoutMs,
        `bridge_paid_call_${toolName}`
      );

      assert(paidCall?.isError !== true, `Bridge paid call failed: ${normalizeText(paidCall?.content?.[0]?.text || '')}`);
      const structured = paidCall?.structuredContent || {};
      assert(normalizeText(structured.paymentStatus) === 'payment_settled_result', 'Bridge paid call did not settle payment.');
      assert(normalizeText(structured.requestId), 'Bridge paid call did not return requestId.');
      assert(normalizeText(structured.traceId) === traceId, 'Bridge paid call traceId mismatch.');

      const receiptTool = await withTimeout(
        client.callTool(
          {
            name: 'ktrace__artifact_receipt',
            arguments: {
              requestId: normalizeText(structured.requestId)
            }
          },
          CallToolResultSchema,
          buildRequestOptions(timeoutMs)
        ),
        timeoutMs,
        'artifact_receipt'
      );
      const evidenceTool = await withTimeout(
        client.callTool(
          {
            name: 'ktrace__artifact_evidence',
            arguments: {
              traceId
            }
          },
          CallToolResultSchema,
          buildRequestOptions(timeoutMs)
        ),
        timeoutMs,
        'artifact_evidence'
      );
      const flowShowTool = await withTimeout(
        client.callTool(
          {
            name: 'ktrace__flow_show',
            arguments: {
              traceId
            }
          },
          CallToolResultSchema,
          buildRequestOptions(timeoutMs)
        ),
        timeoutMs,
        'flow_show'
      );

      assert(receiptTool?.isError !== true, 'artifact_receipt failed through bridge');
      assert(evidenceTool?.isError !== true, 'artifact_evidence failed through bridge');
      assert(flowShowTool?.isError !== true, 'flow_show failed through bridge');

      passedSummary = {
        baseUrl,
        profile: runtime.profile,
        toolName,
        traceId,
        requestId: normalizeText(structured.requestId),
        paymentStatus: normalizeText(structured.paymentStatus),
        evidenceRef: normalizeText(structured.evidenceRef || ''),
        receiptLoaded: Boolean(receiptTool?.structuredContent?.receipt),
        evidenceLoaded: Boolean(evidenceTool?.structuredContent?.evidence),
        flowLoaded: Boolean(
          flowShowTool?.structuredContent?.workflow ||
            flowShowTool?.structuredContent?.invocation ||
            flowShowTool?.structuredContent?.purchase ||
            flowShowTool?.structuredContent?.job
        ),
        sessionRuntimeSource: sessionRuntimeSource.kind,
        attemptedTools: failures.map((item) => item.toolName)
      };
      break;
    } catch (error) {
      failures.push({
        capabilityId: normalizeText(selectedCapability?.capabilityId || selectedCapability?.id || ''),
        toolName,
        reason: normalizeText(error?.message || error)
      });
    }
  }

  assert(
    passedSummary,
    `No live paid bridge candidate succeeded.\n${JSON.stringify({ failures }, null, 2)}`
  );

  console.log(JSON.stringify({ ok: true, summary: passedSummary }, null, 2));
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  if (client) {
    await client.close().catch(() => {});
  }
  if (transport) {
    await transport.close().catch(() => {});
  }
  if (sessionRuntimeSource?.cleanup) {
    await sessionRuntimeSource.cleanup().catch(() => {});
  }
}
