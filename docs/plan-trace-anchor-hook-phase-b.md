# Plan: Trace Anchor Hook - Phase B (Onchain Guard)

Updated: 2026-03-18

Status:

- backend/code implementation completed
- contract compilation completed
- local Phase B verification completed
- current accepted scope closed at local verification only

## 1. Status Snapshot

Phase B upgrades trace-anchor enforcement from a backend ordering rule to an onchain guard rule.

This pass implemented the code needed for that upgrade:

- `JobLifecycleAnchorV2`
- `TraceAnchorGuard`
- `JobEscrowV2`
- backend V2 ABI / helper switch
- trace-anchor status API enrichment
- CLI output enrichment
- deploy / set-guard scripts
- Phase B verification script

Scope note for this document:

- this plan is now considered complete at the local-validation milestone
- any later testnet rollout or one-shot switch is an ops choice, not a blocker for closing this implementation pass

## 2. What Was Implemented

### 2.1 Contracts

Added:

- [JobLifecycleAnchorV2.sol](/E:/CODEX/kite-trace-platform/backend/contracts/JobLifecycleAnchorV2.sol)
- [ITraceAnchorGuard.sol](/E:/CODEX/kite-trace-platform/backend/contracts/ITraceAnchorGuard.sol)
- [TraceAnchorGuard.sol](/E:/CODEX/kite-trace-platform/backend/contracts/TraceAnchorGuard.sol)
- [JobEscrowV2.sol](/E:/CODEX/kite-trace-platform/backend/contracts/JobEscrowV2.sol)

Behavior now encoded in contracts:

- V2 anchor registry can answer `hasAnchor(jobId)` and `latestAnchorId(jobId)`
- escrow V2 can call a configurable trace-anchor guard before `submitResult(...)`
- guard can be disabled by setting `traceAnchorGuard = address(0)`

### 2.2 Backend switch readiness

Updated backend pieces:

- [onchainAnchors.js](/E:/CODEX/kite-trace-platform/backend/lib/onchainAnchors.js)
- [escrowHelpers.js](/E:/CODEX/kite-trace-platform/backend/lib/escrowHelpers.js)
- [appRuntime.impl.js](/E:/CODEX/kite-trace-platform/backend/appRuntime.impl.js)
- [config.js](/E:/CODEX/kite-trace-platform/backend/runtime/config.js)

New behavior:

- backend now uses the V2 anchor ABI for job-anchor writes and reads
- backend can query:
  - `checkAnchorExistsOnChain(jobId)`
  - `readLatestAnchorIdOnChain(jobId)`
- escrow helper now preserves contract-level `trace_anchor_required`

### 2.3 Status API and CLI

Updated trace-anchor status API:

- [jobReadRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLane/jobReadRoutes.js)

New response fields:

- `guardConfigured`
- `guardAddress`
- `verificationMode`
- `anchor.verifiedOnchain`
- `anchor.latestAnchorIdOnChain`

Legacy rule implemented:

- if local job state shows a submit anchor but V2 `hasAnchor(jobId)` is false:
  - `verifiedOnchain = null`
  - `verificationMode = legacy_v1_unknown`

Updated CLI:

- [jobCommands.js](/E:/CODEX/kite-trace-platform/backend/cli/commands/jobCommands.js)
- [output.js](/E:/CODEX/kite-trace-platform/backend/cli/output.js)

CLI now shows:

- `guardConfigured`
- `guardAddress`
- `verificationMode`
- `verifiedOnchain`
- `latestAnchorIdOnChain`

## 3. Scripts Added

Compile / deploy:

- [erc8183-compile-job-anchor-v2.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-compile-job-anchor-v2.js)
- [erc8183-deploy-job-anchor-v2.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-deploy-job-anchor-v2.js)
- [erc8183-compile-trace-anchor-guard.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-compile-trace-anchor-guard.js)
- [erc8183-deploy-trace-anchor-guard.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-deploy-trace-anchor-guard.js)
- [erc8183-compile-escrow-v2.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-compile-escrow-v2.js)
- [erc8183-deploy-escrow-v2.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-deploy-escrow-v2.js)
- [erc8183-set-trace-guard.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-set-trace-guard.js)

Verification:

- [verify-trace-anchor-guard.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-trace-anchor-guard.mjs)

Ops:

- [trace-anchor-phase-b-runbook.md](/E:/CODEX/kite-trace-platform/backend/docs/trace-anchor-phase-b-runbook.md)

## 4. Verification Status

Completed locally:

- `npm run erc8183:compile:job-anchor:v2`
- `npm run erc8183:compile:trace-anchor-guard`
- `npm run erc8183:compile:escrow:v2`
- `npm run verify:trace-anchor:submit-order`
- `npm run verify:trace-anchor:status`
- `npm run verify:trace-anchor:guard`
- public trace-anchor endpoint returns `verificationMode = v2_has_anchor` for an unanchored V2-era job
- public trace-anchor endpoint returns `verificationMode = legacy_v1_unknown` and `verifiedOnchain = null` for a historical V1-anchored job
- local backend trace-anchor verification bug was fixed by wiring `checkAnchorExistsOnChain` into the runtime route dependencies

Real backend startup also passed locally after this integration.

## 5. Remaining Work Outside This Pass

Not required for the current accepted scope:

- deploy V2 contracts to Kite testnet
- run `setTraceAnchorGuard(...)` on the live escrow V2 address
- update real backend env to V2 addresses
- restart live backend and complete one-shot switch on a real environment

If that rollout is needed later, use the runbook as a separate ops task.

## 6. One-Line Conclusion

Phase B is complete for the current scope: the repo now supports onchain trace-anchor enforcement and the local backend verification path is passing end to end.
