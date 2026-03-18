# Trace Anchor Phase B Runbook

Last updated: 2026-03-18 (Asia/Shanghai)

## Goal

Phase B upgrades trace-anchor enforcement from backend ordering to onchain guard enforcement.

## Contracts

- `JobLifecycleAnchorV2`
- `TraceAnchorGuard`
- `JobEscrowV2`

## Required Env

- `KITEAI_RPC_URL`
- `KITECLAW_BACKEND_SIGNER_PRIVATE_KEY` or `ERC8004_REGISTRAR_PRIVATE_KEY`
- `KITE_SETTLEMENT_TOKEN`
- `ERC8183_JOB_ANCHOR_REGISTRY`
- `ERC8183_ESCROW_ADDRESS`
- `ERC8183_TRACE_ANCHOR_GUARD`

## Compile Commands

- `npm run erc8183:compile:job-anchor:v2`
- `npm run erc8183:compile:trace-anchor-guard`
- `npm run erc8183:compile:escrow:v2`

## Deploy Commands

Recommended one-shot switch order:

1. `npm run erc8183:deploy:job-anchor:v2`
2. `npm run erc8183:deploy:trace-anchor-guard`
3. `npm run erc8183:deploy:escrow:v2`
4. `npm run erc8183:set:trace-guard -- 0x...guardAddress`
5. update backend env:
   - `ERC8183_JOB_ANCHOR_REGISTRY=<job-anchor-v2>`
   - `ERC8183_ESCROW_ADDRESS=<escrow-v2>`
   - `ERC8183_TRACE_ANCHOR_GUARD=<guard>`
6. restart backend
7. run verification:
   - `npm run verify:trace-anchor:submit-order`
   - `npm run verify:trace-anchor:status`
   - `npm run verify:trace-anchor:guard`

## Runtime Behavior

- backend Phase A ordering still publishes anchor before submit
- `JobEscrowV2.submitResult(...)` now also enforces `trace_anchor_required` onchain when guard is set
- `/api/jobs/:jobId/trace-anchor` and `/api/public/jobs/:jobId/trace-anchor` now return:
  - `guardConfigured`
  - `guardAddress`
  - `verificationMode`
  - `anchor.verifiedOnchain`
  - `anchor.latestAnchorIdOnChain`

## Legacy V1 Jobs

- historical V1 jobs are not backfilled into V2
- if a local job record has `submitAnchorTxHash` but V2 `hasAnchor(jobId)` is false:
  - `verifiedOnchain` returns `null`
  - `verificationMode` returns `legacy_v1_unknown`

## Rollback

Fast rollback path:

1. disable guard:
   - `npm run erc8183:set:trace-guard -- 0x0000000000000000000000000000000000000000`
2. restart backend if env was updated

This preserves `JobEscrowV2` but removes onchain guard enforcement.

## Validation Expectations

- guard disabled and unanchored submit:
  - submit still succeeds
- guard enabled and unanchored submit:
  - contract path reverts `trace_anchor_required`
- guard enabled and anchored submit:
  - submit succeeds
- retry after anchor success:
  - no duplicate anchor publish
