/**
 * PayTrace instrumentation for KTrace backend.
 *
 * This module provides a thin integration layer between the KTrace backend
 * and the PayTrace SDK concepts. Since paytrace-sdk is TypeScript and KTrace
 * backend is plain JS, we implement the OTel instrumentation directly using
 * the OTel JS API, following the same span naming and attribute conventions
 * defined in paytrace-sdk.
 *
 * Usage:
 *   import { initTracing, traceServiceInvoke } from '../lib/paytrace/instrument.js';
 *   initTracing();  // call once at server startup
 */

import { trace, context, SpanKind, SpanStatusCode, TraceFlags } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const TRACER_NAME = 'paytrace-sdk';
const SDK_VERSION = '0.1.0';

let _initialized = false;
let _tracer = null;
let _meter = null;
let _invocationCount = null;
let _invocationSuccess = null;
let _invocationFailure = null;
let _stageDuration = null;
let _paymentVolume = null;

/**
 * Initialize OTel tracing. Call once at server startup.
 * Best-effort: if it fails, tracing is silently disabled.
 */
export function initTracing(opts = {}) {
  if (_initialized) return;
  try {
    const {
      serviceName = 'ktrace-backend',
      serviceVersion = '1.0.0',
      traceEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    } = opts;

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'paytrace.sdk.version': SDK_VERSION,
    });

    const provider = new NodeTracerProvider({ resource });
    const exporter = new OTLPTraceExporter({ url: traceEndpoint });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();

    _tracer = trace.getTracer(TRACER_NAME, SDK_VERSION);

    // ── Metrics: Prometheus exporter on :9464/metrics ───────────
    const metricsPort = Number(opts.metricsPort) || 9464;
    try {
      const promExporter = new PrometheusExporter({ port: metricsPort });
      const meterProvider = new MeterProvider({ resource, readers: [promExporter] });
      _meter = meterProvider.getMeter(TRACER_NAME, SDK_VERSION);

      _invocationCount = _meter.createCounter('paytrace_invocation_count', {
        description: 'Total number of payment invocations',
      });
      _invocationSuccess = _meter.createCounter('paytrace_invocation_success', {
        description: 'Successful payment invocations',
      });
      _invocationFailure = _meter.createCounter('paytrace_invocation_failure', {
        description: 'Failed payment invocations',
      });
      _stageDuration = _meter.createHistogram('paytrace_stage_duration_ms', {
        description: 'Duration of each payment stage in milliseconds',
        unit: 'ms',
      });
      _paymentVolume = _meter.createCounter('paytrace_payment_volume', {
        description: 'Total payment volume in smallest token unit',
      });
      console.log(`[paytrace] Metrics exporter → http://0.0.0.0:${metricsPort}/metrics`);
    } catch (mErr) {
      console.warn('[paytrace] Metrics initialization failed (suppressed):', mErr?.message || mErr);
    }

    _initialized = true;
    console.log(`[paytrace] Tracing initialized → ${traceEndpoint}`);
  } catch (err) {
    console.warn('[paytrace] Tracing initialization failed (suppressed):', err?.message || err);
    _tracer = trace.getTracer('paytrace-noop');
  }
}

function getTracer() {
  return _tracer || trace.getTracer('paytrace-noop');
}

// ── Safe wrappers ───────────────────────────────────────────────
// NOTE: safe()/safeVoid() are synchronous only. Do NOT pass async callbacks.

function safe(fn, fallback) {
  try { return fn(); } catch (err) {
    console.warn('[paytrace] SDK error (suppressed):', err?.message || err);
    return fallback;
  }
}

function safeVoid(fn) {
  try { fn(); } catch (err) {
    console.warn('[paytrace] SDK error (suppressed):', err?.message || err);
  }
}

const _noopTracer = trace.getTracer('paytrace-noop');

function noopSpan() {
  return _noopTracer.startSpan('noop');
}

// ── Agent Payment Spans ─────────────────────────────────────────

/**
 * Start a root agent payment invocation span.
 * Returns { span, ctx } for creating child spans.
 */
export function startCapability(opts = {}) {
  return safe(() => {
    const tracer = getTracer();
    const attributes = {};
    if (opts.traceId) attributes['paytrace.trace_id'] = opts.traceId;
    if (opts.payer) attributes['paytrace.payer'] = opts.payer;
    if (opts.providerId) attributes['paytrace.provider.id'] = opts.providerId;
    if (opts.providerKind) attributes['paytrace.provider.kind'] = opts.providerKind;
    if (opts.capabilityId) attributes['paytrace.capability.id'] = opts.capabilityId;
    if (opts.sessionStrategy) attributes['paytrace.session.strategy'] = opts.sessionStrategy;

    // If opts.traceId is a valid 32-char hex string, use it directly as the OTel
    // traceId — no hashing, no fake parent. The route handler generates W3C-
    // compliant hex IDs so the same ID works for both Jaeger and evidence/receipts.
    // spanId must be non-zero (W3C spec rejects all-zero), use a minimal sentinel.
    let parentCtx = context.active();
    const tid = String(opts.traceId || '').toLowerCase();
    if (/^(?!0{32}$)[0-9a-f]{32}$/.test(tid)) {
      parentCtx = trace.setSpanContext(parentCtx, {
        traceId: tid,
        spanId: '0000000000000001',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: false,
      });
    }

    const span = tracer.startSpan('paytrace.capability', {
      kind: SpanKind.SERVER,
      attributes,
    }, parentCtx);
    const ctx = trace.setSpan(parentCtx, span);
    return { span, ctx };
  }, { span: noopSpan(), ctx: context.active() });
}

/** Discover span — provider/capability selection. */
export function startDiscover(parentSpan) {
  return safe(() => {
    const ctx = trace.setSpan(context.active(), parentSpan);
    return getTracer().startSpan('paytrace.discover', { kind: SpanKind.INTERNAL }, ctx);
  }, noopSpan());
}

export function endDiscover(span, result = {}) {
  safeVoid(() => {
    if (result.candidateCount != null) span.setAttribute('paytrace.discover.candidate_count', result.candidateCount);
    if (result.selectedProvider) span.setAttribute('paytrace.discover.selected_provider', result.selectedProvider);
    if (result.selectionMode) span.setAttribute('paytrace.discover.selection_mode', result.selectionMode);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  });
}

/** Negotiate span — x402 payment terms. */
export function startNegotiate(parentSpan) {
  return safe(() => {
    const ctx = trace.setSpan(context.active(), parentSpan);
    return getTracer().startSpan('paytrace.x402_negotiate', { kind: SpanKind.INTERNAL }, ctx);
  }, noopSpan());
}

export function endNegotiate(span, result = {}) {
  safeVoid(() => {
    if (result.requestId) span.setAttribute('paytrace.negotiate.request_id', result.requestId);
    if (result.amount) span.setAttribute('paytrace.negotiate.amount', result.amount);
    if (result.tokenAddress) span.setAttribute('paytrace.negotiate.token_address', result.tokenAddress);
    if (result.recipient) span.setAttribute('paytrace.negotiate.recipient', result.recipient);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  });
}

/** Payment span — on-chain payment execution. */
export function startPayment(parentSpan) {
  return safe(() => {
    const ctx = trace.setSpan(context.active(), parentSpan);
    return getTracer().startSpan('paytrace.x402_payment', { kind: SpanKind.INTERNAL }, ctx);
  }, noopSpan());
}

export function endPayment(span, result = {}) {
  safeVoid(() => {
    if (result.status) span.setAttribute('paytrace.payment.status', result.status);
    if (result.txHash) span.setAttribute('paytrace.payment.tx_hash', result.txHash);
    if (result.userOpHash) span.setAttribute('paytrace.payment.user_op_hash', result.userOpHash);
    if (result.protocol) span.setAttribute('paytrace.payment.protocol', result.protocol);
    if (result.asset) span.setAttribute('paytrace.payment.asset', result.asset);

    if (result.status === 'confirmed') {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `payment_${result.status || 'unknown'}` });
    }
    span.end();
  });
}

/** Fulfill span — provider result retrieval. */
export function startFulfill(parentSpan) {
  return safe(() => {
    const ctx = trace.setSpan(context.active(), parentSpan);
    return getTracer().startSpan('paytrace.fulfill', { kind: SpanKind.CLIENT }, ctx);
  }, noopSpan());
}

export function endFulfill(span, result = {}) {
  safeVoid(() => {
    if (result.httpStatus != null) span.setAttribute('paytrace.fulfill.http_status', result.httpStatus);
    if (result.providerLatencyMs != null) span.setAttribute('paytrace.fulfill.provider_latency_ms', result.providerLatencyMs);
    if (result.resultState) span.setAttribute('paytrace.fulfill.result_state', result.resultState);

    const ok = result.httpStatus != null
      ? (result.httpStatus >= 200 && result.httpStatus < 300)
      : (result.resultState === 'ok');
    span.setStatus(ok
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR, message: result.error || `http_${result.httpStatus || 'unknown'}` }
    );
    span.end();
  });
}

/** Receipt bind span — audit artifact binding. */
export function startReceiptBind(parentSpan) {
  return safe(() => {
    const ctx = trace.setSpan(context.active(), parentSpan);
    return getTracer().startSpan('paytrace.receipt_bind', { kind: SpanKind.INTERNAL }, ctx);
  }, noopSpan());
}

export function endReceiptBind(span, result = {}) {
  safeVoid(() => {
    if (result.receiptRef) span.setAttribute('paytrace.audit.receipt_ref', result.receiptRef);
    if (result.evidenceRef) span.setAttribute('paytrace.audit.evidence_ref', result.evidenceRef);
    if (result.anchorStatus) span.setAttribute('paytrace.audit.anchor_status', result.anchorStatus);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  });
}

/** Fail any span with classified error. */
export function failSpan(span, errorCode, message) {
  safeVoid(() => {
    const layer = classifyErrorLayer(errorCode);
    span.setAttribute('paytrace.error.code', errorCode);
    span.setAttribute('paytrace.error.layer', layer);
    span.setStatus({ code: SpanStatusCode.ERROR, message: message || errorCode });
    span.end();
  });
}

/** End root capability span. */
export function endCapability(span, ok = true) {
  safeVoid(() => {
    span.setStatus(ok
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR }
    );
    span.end();
  });
}

// ── Error Classification ────────────────────────────────────────

const LAYER_MAP = {};
const COMPLIANCE = ['kyc_rejected', 'sanctions_hit', 'travel_rule_failed', 'jurisdiction_blocked', 'identity_not_verified'];
const PAYMENT = ['payment_required', 'session_not_ready', 'bundler_timeout', 'tx_revert', 'insufficient_balance', 'gas_estimation_failed', 'nonce_conflict', 'proof_verification_failed', 'allowance_insufficient'];
const PROVIDER = ['provider_timeout', 'provider_4xx', 'provider_5xx', 'invalid_result', 'schema_validation_failed'];
const INFRA = ['rpc_transport_error', 'bridge_timeout', 'chain_congestion', 'network_reset', 'collector_unavailable', 'upstream_dns_error'];
const SETTLEMENT = ['settle_timeout', 'fiat_rejected', 'bank_error', 'reconciliation_mismatch'];

for (const c of COMPLIANCE) LAYER_MAP[c] = 'COMPLIANCE';
for (const c of PAYMENT) LAYER_MAP[c] = 'PAYMENT';
for (const c of PROVIDER) LAYER_MAP[c] = 'PROVIDER';
for (const c of INFRA) LAYER_MAP[c] = 'INFRA';
for (const c of SETTLEMENT) LAYER_MAP[c] = 'SETTLEMENT';

export function classifyErrorLayer(code) {
  return LAYER_MAP[String(code || '').trim()] || 'UNKNOWN';
}

// ── Metrics Recording ──────────────────────────────────────────

function buildMetricLabels(labels = {}) {
  const result = {};
  if (labels.providerId) result.provider_id = labels.providerId;
  if (labels.capabilityId) result.capability_id = labels.capabilityId;
  if (labels.chain) result.chain = labels.chain;
  return result;
}

export function recordInvocation(labels = {}) {
  safeVoid(() => { _invocationCount?.add(1, buildMetricLabels(labels)); });
}

export function recordSuccess(labels = {}) {
  safeVoid(() => { _invocationSuccess?.add(1, buildMetricLabels(labels)); });
}

export function recordFailure(labels = {}) {
  safeVoid(() => {
    _invocationFailure?.add(1, {
      ...buildMetricLabels(labels),
      ...(labels.errorType ? { error_type: labels.errorType } : {}),
    });
  });
}

export function recordStageDuration(durationMs, labels = {}) {
  safeVoid(() => {
    _stageDuration?.record(durationMs, {
      stage: labels.stage || 'unknown',
      ...(labels.providerId ? { provider_id: labels.providerId } : {}),
    });
  });
}

export function recordPaymentVolume(amount, labels = {}) {
  safeVoid(() => {
    _paymentVolume?.add(amount, {
      ...(labels.asset ? { asset: labels.asset } : {}),
      ...(labels.providerId ? { provider_id: labels.providerId } : {}),
      ...(labels.capabilityId ? { capability_id: labels.capabilityId } : {}),
    });
  });
}

// ── High-level convenience: trace a full service invocation ─────

/**
 * Wraps a full service invocation with PayTrace spans.
 *
 * Has an `_ended` flag to prevent double-ending and enable
 * `ensureEnded()` as a safety net for early returns.
 *
 * Usage:
 *   const traced = traceServiceInvoke({ traceId, payer, capabilityId });
 *   try {
 *     traced.discover({ candidateCount: 1, selectedProvider: 'okx' });
 *     traced.negotiate({ requestId, amount, tokenAddress, recipient });
 *     // ... async work ...
 *     traced.payment({ status: 'confirmed', txHash });
 *     traced.receiptBind({ receiptRef, evidenceRef });
 *     traced.end(true);
 *     return res.json({ ok: true });
 *   } catch (err) {
 *     traced.fail(errorCode, message); // also ends the span
 *     return res.status(500).json({ ok: false });
 *   } finally {
 *     traced.ensureEnded(); // safety net: ends span if not already ended
 *   }
 */
export function traceServiceInvoke(opts = {}) {
  const { span: rootSpan, ctx: rootCtx } = startCapability(opts);
  let _ended = false;
  let _lastStage = 'init';

  function markEnded() { _ended = true; }

  return {
    rootSpan,
    rootCtx,

    /** True if the root span has been ended (via end/fail/ensureEnded). */
    get ended() { return _ended; },

    discover(result) {
      _lastStage = 'discover';
      const s = startDiscover(rootSpan);
      endDiscover(s, result);
    },

    negotiate(result) {
      _lastStage = 'negotiate';
      const s = startNegotiate(rootSpan);
      endNegotiate(s, result);
    },

    payment(result) {
      _lastStage = 'payment';
      const s = startPayment(rootSpan);
      endPayment(s, result);
    },

    fulfillStart() {
      _lastStage = 'fulfill';
      return startFulfill(rootSpan);
    },

    fulfillEnd(span, result) {
      endFulfill(span, result);
    },

    receiptBind(result) {
      _lastStage = 'receipt_bind';
      const s = startReceiptBind(rootSpan);
      endReceiptBind(s, result);
    },

    /** Mark root span as failed and end it. Records which stage failed. */
    fail(errorCode, message) {
      if (_ended) return;
      safeVoid(() => rootSpan.setAttribute('paytrace.error.stage', _lastStage));
      failSpan(rootSpan, errorCode, message);
      markEnded();
    },

    /** End root span with success/failure status. */
    end(ok = true) {
      if (_ended) return;
      endCapability(rootSpan, ok);
      markEnded();
    },

    /**
     * Safety net: if the root span wasn't explicitly ended,
     * end it as ERROR. Call this in a `finally` block.
     */
    ensureEnded() {
      if (_ended) return;
      safeVoid(() => rootSpan.setAttribute('paytrace.error.stage', _lastStage));
      endCapability(rootSpan, false);
      markEnded();
    },
  };
}
