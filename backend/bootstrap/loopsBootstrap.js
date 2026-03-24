import { createAutoTradePlanLoop } from '../lib/loops/tradePlanLoop.js';
import { createAutoJobExpiryLoop } from '../lib/loops/jobExpiryLoop.js';
import { createJobExpiryExecutor } from '../routes/jobLaneRoutes.js';
import { createSynthesisRequestLoop } from '../lib/loops/synthesisRequestLoop.js';
import { registerHealthRoutes } from '../runtime/server.js';

export function loopsBootstrap(ctx) {
  const {
    AUTO_TRADE_PLAN_INTERVAL_MS,
    AUTO_TRADE_PLAN_SYMBOL,
    AUTO_TRADE_PLAN_HORIZON_MIN,
    AUTO_TRADE_PLAN_PROMPT,
    KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    ERC8183_JOB_ANCHOR_REGISTRY,
    KITE_NETWORK_NAME,
    PACKAGE_VERSION,
    STARTED_AT_MS,
    PORT,
    app,
    autoTradePlanState,
    autoJobExpiryState,
    readJobs,
    upsertJobRecord,
    expireEscrowJob,
    publishJobLifecycleAnchorOnChain,
    readServiceInvocations,
    readTrustPublications,
    readWorkflows,
    readX402Requests,
    broadcastEvent
  } = ctx;

  // ── Auto trade-plan loop ──────────────────────────────────────────────────

  const {
    getAutoTradePlanStatus,
    runAutoTradePlanTick,
    startAutoTradePlanLoop,
    stopAutoTradePlanLoop
  } = createAutoTradePlanLoop({
    state: autoTradePlanState,
    intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
    symbol: AUTO_TRADE_PLAN_SYMBOL,
    horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
    prompt: AUTO_TRADE_PLAN_PROMPT
  });

  // ── Auto job-expiry loop ──────────────────────────────────────────────────

  const executeJobExpiry = createJobExpiryExecutor({
    readJobs,
    upsertJobRecord,
    expireEscrowJob,
    publishJobLifecycleAnchorOnChain,
    anchorRegistryRequired: Boolean(process.env.ERC8183_JOB_ANCHOR_REGISTRY)
  });

  const {
    getAutoJobExpiryStatus,
    runAutoJobExpiryTick,
    startAutoJobExpiryLoop,
    stopAutoJobExpiryLoop
  } = createAutoJobExpiryLoop({
    state: autoJobExpiryState,
    intervalMs: KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    readJobs,
    expireJob: executeJobExpiry
  });

  // ── Synthesis request loop (optional) ────────────────────────────────────

  const synthesisLoopEnabled = /^(1|true|yes|on)$/i.test(
    String(process.env.SYNTHESIS_LOOP_ENABLED || '').trim()
  );
  const synthesisLoop = synthesisLoopEnabled
    ? createSynthesisRequestLoop({
        state: null,
        intervalMs: Math.max(
          60_000,
          Number(process.env.SYNTHESIS_LOOP_INTERVAL_MS || 3600_000)
        ),
        requestJson: null,
        readJobs,
        readServiceInvocations,
        readTrustPublications,
        readWorkflows,
        readX402Requests,
        publishTrustSignal: null,
        broadcastEvent,
        PORT
      })
    : null;

  // ── Health routes ─────────────────────────────────────────────────────────

  registerHealthRoutes(app, {
    getAutoJobExpiryStatus,
    kiteNetworkName: KITE_NETWORK_NAME,
    packageVersion: PACKAGE_VERSION,
    startedAtMs: STARTED_AT_MS
  });

  // ── Populate ctx ──────────────────────────────────────────────────────────

  Object.assign(ctx, {
    getAutoTradePlanStatus,
    runAutoTradePlanTick,
    startAutoTradePlanLoop,
    stopAutoTradePlanLoop,
    getAutoJobExpiryStatus,
    runAutoJobExpiryTick,
    startAutoJobExpiryLoop,
    stopAutoJobExpiryLoop,
    synthesisLoop
  });
}
