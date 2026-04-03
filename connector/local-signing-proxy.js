#!/usr/bin/env node
/**
 * KTrace Local Signing Proxy
 *
 * Sits between Claude Code and the KTrace backend MCP server.
 * Intercepts x402 payment-required responses, signs the ERC20 transfer
 * UserOp locally using the user's session private key (via GokiteAASDK),
 * submits it to the bundler, then retries the original tool call with
 * payment proof.
 *
 * Usage:
 *   node local-signing-proxy.js
 *
 * Config (~/.ktrace-connector/config.json):
 *   {
 *     "backendUrl":    "https://your-ktrace-backend.com",
 *     "aaWallet":      "0x...",
 *     "sessionId":     "0x<64 hex>",
 *     "ownerEoa":      "0x...",
 *     "sessionPrivateKey": "0x..."
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { GokiteAASDK } from './lib/gokite-aa-sdk.js';

// ── PayTrace: lightweight OTel tracing for payment sub-spans ────────────────
import { trace, context, SpanKind, SpanStatusCode, TraceFlags, diag, DiagLogLevel } from '@opentelemetry/api';
import crypto from 'crypto';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';

// Silence OTel diagnostics to prevent stdout pollution in MCP stdio channel
diag.setLogger({ error(){}, warn(){}, info(){}, debug(){}, verbose(){} }, DiagLogLevel.NONE);

const OTEL_ENDPOINT = process.env.PAYTRACE_TRACE_ENDPOINT || 'http://170.106.183.160:4318/v1/traces';
let _proxyTracer = null;
let _proxyProvider = null;
try {
  const resource = new Resource({ 'service.name': 'ktrace-proxy', 'paytrace.sdk.version': '0.1.0' });
  const provider = new NodeTracerProvider({ resource });
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: OTEL_ENDPOINT })));
  provider.register();
  _proxyProvider = provider;
  _proxyTracer = trace.getTracer('paytrace-sdk', '0.1.0');
  process.on('SIGTERM', () => provider.shutdown().catch(() => {}));
  console.error(`[ktrace-proxy] PayTrace tracing → ${OTEL_ENDPOINT}`);
} catch (e) {
  console.error('[ktrace-proxy] PayTrace tracing disabled:', e.message);
}

function _startSpan(name, parentCtx, attrs = {}) {
  if (!_proxyTracer) return null;
  try {
    return _proxyTracer.startSpan(name, { kind: SpanKind.CLIENT, attributes: attrs }, parentCtx || context.active());
  } catch { return null; }
}

function _endSpan(span, ok, attrs = {}) {
  if (!span) return;
  try {
    for (const [k, v] of Object.entries(attrs)) { if (v != null) span.setAttribute(k, v); }
    span.setStatus(ok ? { code: SpanStatusCode.OK } : { code: SpanStatusCode.ERROR, message: attrs['paytrace.payment.bundler_reason'] || 'failed' });
    span.end();
  } catch {}
}

function _traceIdToContext(traceId) {
  if (!_proxyTracer || !traceId || !/^[0-9a-f]{32}$/.test(traceId)) return context.active();
  try {
    return trace.setSpanContext(context.active(), {
      traceId,
      spanId: crypto.randomBytes(8).toString('hex'),
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
  } catch { return context.active(); }
}

// ── HTTP fetch with optional proxy support ───────────────────────────────────
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

async function pfetch(url, opts = {}) {
  const fetchOpts = proxyDispatcher ? { ...opts, dispatcher: proxyDispatcher } : opts;
  return undiciFetch(url, fetchOpts);
}

function parseSseJsonResponse(text = '') {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch {}
    }
  }
  try { return JSON.parse(text); } catch {}
  return {};
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const configDir = join(homedir(), '.ktrace-connector');
  const configPath = join(configDir, 'config.json');
  const envPath = join(configDir, '.env');

  let cfg = {};

  if (existsSync(configPath)) {
    try {
      cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      console.error('[ktrace-proxy] Failed to parse config.json:', e.message);
    }
  }

  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  const resolved = {
    backendUrl: process.env.KTRACE_BACKEND_URL || cfg.backendUrl || 'http://localhost:3001',
    aaWallet: process.env.KTRACE_AA_WALLET || cfg.aaWallet || '',
    sessionId: process.env.KTRACE_SESSION_ID || cfg.sessionId || '',
    ownerEoa: process.env.KTRACE_OWNER_EOA || cfg.ownerEoa || '',
    sessionPrivateKey: process.env.SESSION_PRIVATE_KEY || cfg.sessionPrivateKey || ''
  };

  return resolved;
}

const config = loadConfig();

if (!config.sessionPrivateKey) {
  console.error('[ktrace-proxy] SESSION_PRIVATE_KEY is required. Set it in env or ~/.ktrace-connector/config.json');
  process.exit(1);
}
const sessionWallet = new ethers.Wallet(config.sessionPrivateKey);
console.error(`[ktrace-proxy] Session signer: ${sessionWallet.address}`);
console.error(`[ktrace-proxy] AA wallet: ${config.aaWallet || '(not set)'}`);
console.error(`[ktrace-proxy] Backend: ${config.backendUrl}`);
if (PROXY_URL) console.error(`[ktrace-proxy] Proxy: ${PROXY_URL}`);

// ── Backend MCP proxy call ────────────────────────────────────────────────────

async function buildSessionAuthHeaders() {
  const ts = String(Date.now());
  const message = `ktrace-session:${ts}`;
  const signature = await sessionWallet.signMessage(message);
  return {
    'x-ktrace-session-address': sessionWallet.address,
    'x-ktrace-session-timestamp': ts,
    'x-ktrace-session-signature': signature,
    'x-ktrace-aa-wallet': config.aaWallet,
    'x-ktrace-session-id': config.sessionId,
    'x-ktrace-owner-eoa': config.ownerEoa
  };
}

async function callBackendTool(toolName, args) {
  const url = `${config.backendUrl}/mcp`;
  const authHeaders = await buildSessionAuthHeaders();
  const resp = await pfetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...authHeaders
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  const json = parseSseJsonResponse(await resp.text());
  return json.result || json;
}

// ── Payment handling (using GokiteAASDK) ─────────────────────────────────────

async function handlePaymentAndRetry(toolName, originalArgs, paymentData) {
  const { x402, signingContext, requestId, traceId } = paymentData;
  const accepts = Array.isArray(x402?.accepts) ? x402.accepts : [];
  const quote = accepts[0];

  if (!quote) throw new Error('No payment quote in 402 response');

  const { tokenAddress, amount, recipient, decimals = 18 } = quote;
  const ctx = quote.signingContext || signingContext || {};

  if (!ctx.bundlerUrl || !ctx.entryPointAddress) {
    throw new Error('signingContext missing bundlerUrl/entryPointAddress — cannot sign UserOp');
  }

  const sessionId = config.sessionId;
  const aaWallet = config.aaWallet;
  if (!sessionId) throw new Error('KTRACE_SESSION_ID not configured in proxy');
  if (!aaWallet) throw new Error('KTRACE_AA_WALLET not configured in proxy');

  // ── PayTrace: create parent context from backend's traceId ────────
  const _parentCtx = _traceIdToContext(traceId);

  console.error(`[ktrace-proxy] Signing x402 payment: ${amount} ${tokenAddress} → ${recipient}`);

  // Use the same SDK as the backend
  const _sdkInitSpan = _startSpan('paytrace.payment.sdk_init', _parentCtx, { 'paytrace.payment.rpc_url': ctx.rpcUrl || '' });
  const _sdkInitStart = Date.now();
  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: ctx.rpcUrl || 'https://rpc-testnet.gokite.ai/',
    bundlerUrl: ctx.bundlerUrl,
    entryPointAddress: ctx.entryPointAddress,
    accountFactoryAddress: ctx.accountFactoryAddress || '',
    accountImplementationAddress: ctx.accountImplementationAddress || '',
    proxyAddress: aaWallet,
    bundlerRpcTimeoutMs: 35000,
    bundlerRpcRetries: 3
  });
  if (config.ownerEoa) {
    sdk.config.ownerAddress = config.ownerEoa;
  }
  _endSpan(_sdkInitSpan, true, { 'paytrace.payment.rpc_latency_ms': Date.now() - _sdkInitStart });

  const amountRaw = typeof amount === 'string' && amount.includes('.')
    ? ethers.parseUnits(amount, decimals)
    : ethers.getBigInt(amount);

  const serviceProvider = ethers.keccak256(
    ethers.toUtf8Bytes(`x402_payment:requester:${tokenAddress}`)
  );

  const signFunction = async (userOpHash) =>
    sessionWallet.signMessage(ethers.getBytes(userOpHash));

  const MAX_PAYMENT_ATTEMPTS = 3;
  let txHash = '';

  for (let attempt = 1; attempt <= MAX_PAYMENT_ATTEMPTS; attempt++) {
    const nowSec = Math.floor(Date.now() / 1000);
    const authPayload = {
      from: aaWallet,
      to: recipient,
      token: tokenAddress,
      value: amountRaw,
      validAfter: BigInt(Math.max(0, nowSec - 30)),
      validBefore: BigInt(nowSec + 10 * 60),
      nonce: ethers.hexlify(ethers.randomBytes(32))
    };

    const authSignature = await sdk.buildTransferAuthorizationSignature(sessionWallet, authPayload);

    console.error(`[ktrace-proxy] Payment attempt ${attempt}/${MAX_PAYMENT_ATTEMPTS}...`);
    const ATTEMPT_TIMEOUT_MS = 30_000;

    // ── PayTrace: bundler_submit span per attempt ──────────────
    const _bundlerSpan = _startSpan('paytrace.payment.bundler_submit', _parentCtx, { 'paytrace.payment.bundler_attempt': attempt });
    const paymentPromise = sdk.sendSessionTransferWithAuthorizationAndProvider(
      {
        sessionId,
        auth: authPayload,
        authSignature,
        serviceProvider,
        metadata: '0x'
      },
      signFunction,
      {
        callGasLimit: 320000n,
        verificationGasLimit: 450000n,
        preVerificationGas: 120000n
      }
    );

    // ── PayTrace: confirm_wait span wraps Promise.race ─────────
    const _confirmSpan = _startSpan('paytrace.payment.confirm_wait', _parentCtx);
    const _confirmStart = Date.now();
    const timeoutPromise = new Promise(resolve =>
      setTimeout(() => resolve({ status: 'failed', reason: 'Timeout: payment not confirmed within 30s' }), ATTEMPT_TIMEOUT_MS)
    );
    let result;
    try {
      result = await Promise.race([paymentPromise, timeoutPromise]);
    } catch (raceErr) {
      _endSpan(_bundlerSpan, false, { 'paytrace.payment.bundler_status': 'exception', 'paytrace.payment.bundler_reason': raceErr?.message || 'unknown' });
      _endSpan(_confirmSpan, false, { 'paytrace.payment.confirm_wait_ms': Date.now() - _confirmStart, 'paytrace.payment.confirm_status': 'exception' });
      throw raceErr;
    }
    const _confirmMs = Date.now() - _confirmStart;

    if (result.status === 'success' && result.transactionHash) {
      txHash = result.transactionHash;
      _endSpan(_bundlerSpan, true, { 'paytrace.payment.user_op_hash': result.userOpHash || '', 'paytrace.payment.bundler_status': 'success' });
      _endSpan(_confirmSpan, true, { 'paytrace.payment.confirm_wait_ms': _confirmMs, 'paytrace.payment.tx_hash': txHash, 'paytrace.payment.confirm_status': 'confirmed' });
      break;
    }

    const reason = String(result.reason || '');
    _endSpan(_bundlerSpan, false, { 'paytrace.payment.bundler_status': 'failed', 'paytrace.payment.bundler_reason': reason, 'paytrace.payment.user_op_hash': result.userOpHash || '' });
    _endSpan(_confirmSpan, false, { 'paytrace.payment.confirm_wait_ms': _confirmMs, 'paytrace.payment.confirm_status': reason.includes('Timeout') ? 'timeout' : 'failed' });

    const isRetryable = reason.includes('Timeout') || reason.includes('fee too low') || reason.includes('replacement');
    if (!isRetryable || attempt >= MAX_PAYMENT_ATTEMPTS) {
      throw new Error(`SDK payment failed: ${reason || result.status || 'unknown'}`);
    }
    console.error(`[ktrace-proxy] Payment attempt ${attempt} failed (${reason}), retrying...`);
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  console.error(`[ktrace-proxy] Payment confirmed: ${txHash}`);

  // Retry tool call with payment proof
  const retryArgs = {
    ...originalArgs,
    x402Mode: 'agent',
    requestId: x402?.requestId || requestId || '',
    paymentProof: {
      txHash,
      requestId: x402?.requestId || requestId || '',
      tokenAddress,
      recipient,
      amount: String(amount)
    }
  };

  console.error(`[ktrace-proxy] Retrying ${toolName} with payment proof...`);
  return callBackendTool(toolName, retryArgs);
}

// ── MCP Server ────────────────────────────────────────────────────────────────

async function fetchBackendTools() {
  try {
    const authHeaders = await buildSessionAuthHeaders();
    const resp = await pfetch(`${config.backendUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...authHeaders
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    });
    const json = parseSseJsonResponse(await resp.text());
    return json.result?.tools || [];
  } catch (e) {
    console.error('[ktrace-proxy] Failed to fetch tools from backend:', e.message);
    return [];
  }
}

async function main() {
  const tools = await fetchBackendTools();
  console.error(`[ktrace-proxy] Proxying ${tools.length} tools from backend`);

  const server = new Server(
    { name: 'ktrace-signing-proxy', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args = {} } = request.params;

    const result = await callBackendTool(toolName, args);

    const sc = result?.structuredContent || result?.content?.[0];
    if (
      sc?.paymentStatus === 'payment_required_preview' ||
      sc?.error === 'payment_required_preview'
    ) {
      try {
        const retryResult = await handlePaymentAndRetry(toolName, args, sc);
        return retryResult;
      } catch (payErr) {
        console.error('[ktrace-proxy] Payment/retry failed:', payErr.message);
        return {
          ...result,
          content: [
            {
              type: 'text',
              text: `Payment signing failed: ${payErr.message}\n\n${result?.content?.[0]?.text || ''}`
            }
          ]
        };
      }
    }

    return result;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ktrace-proxy] Ready — listening on stdio');
}

main().catch((e) => {
  console.error('[ktrace-proxy] Fatal:', e.message);
  process.exit(1);
});
