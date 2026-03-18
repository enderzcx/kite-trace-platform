# Plan: Trace Anchor Hook - Phase A (Backend Ordering)

Updated: 2026-03-18

Status:

- Phase A backend implementation completed
- CLI/output updates completed
- verification completed
- Phase B contract work still not started from this document

## 1. Status Snapshot

Phase A is now implemented as a backend ordering and observability pass.

The backend now enforces this submit progression:

1. prepare result metadata while the job is still effectively recoverable
2. publish and persist the submit anchor if required and missing
3. submit the escrow result
4. mark the job `submitted` only after escrow submit succeeds

This is the intended Phase A outcome.

## 2. What Was Implemented

### 2.1 Submit ordering fix

The real submit path in:

- [jobMutationRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLane/jobMutationRoutes.js)

now behaves as follows:

- if trace-anchor registry is not configured, legacy submit can still proceed
- if trace-anchor registry is configured and submit anchor is missing:
  - publish anchor first
  - persist anchor fields immediately
  - only then call `submitEscrowResult(...)`
- if anchor publish fails:
  - escrow submit is not called
  - job remains in recoverable pre-submit state
- if anchor already exists and escrow submit failed previously:
  - retry skips anchor publish
  - retry resumes from escrow submit

### 2.2 Persisted anchor confirmation timestamp

Added to the job model:

- `submitAnchorConfirmedAt`

This field is now included in job views and used by the status APIs.

### 2.3 Trace-anchor status APIs

Implemented:

- `GET /api/jobs/:jobId/trace-anchor`
- `GET /api/public/jobs/:jobId/trace-anchor`

The response now exposes:

- `jobId`
- `traceId`
- `anchorRequired`
- `anchor.published`
- `anchor.anchorId`
- `anchor.txHash`
- `anchor.registryAddress`
- `anchor.anchoredAt`

Phase A intentionally reports backend-known anchor state only.

### 2.4 CLI output updates

Updated:

- [jobCommands.js](/E:/CODEX/kite-trace-platform/backend/cli/commands/jobCommands.js)

Current behavior:

- `ktrace job submit`
  - surfaces trace-anchor failure as a clear backend-owned error
  - includes `submitAnchorConfirmedAt` on success output
- `ktrace job show`
  - now reflects `submitAnchorConfirmedAt` through the backend job view
- `ktrace job audit`
  - now includes anchor-related persisted fields via the backend audit payload

## 3. Files Added Or Updated

Primary implementation files:

- [jobMutationRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLane/jobMutationRoutes.js)
- [jobReadRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLane/jobReadRoutes.js)
- [sharedJobState.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLane/sharedJobState.js)
- [jobCommands.js](/E:/CODEX/kite-trace-platform/backend/cli/commands/jobCommands.js)

Verification and ops files:

- [traceAnchorHarness.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/traceAnchorHarness.mjs)
- [verify-trace-anchor-submit-order.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-trace-anchor-submit-order.mjs)
- [verify-trace-anchor-status-api.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-trace-anchor-status-api.mjs)
- [trace-anchor-phase-a-runbook.md](/E:/CODEX/kite-trace-platform/backend/docs/trace-anchor-phase-a-runbook.md)

## 4. Verification Status

### 4.1 Automated verification completed

Ran successfully:

- `npm run verify:trace-anchor:submit-order`
- `npm run verify:trace-anchor:status`

Observed results:

- legacy submit path: `200`
- anchor failure blocks submit: `500`
- anchor success then submit: `200`
- retry reuses existing anchor: `200`
- trace-anchor status API returns published anchor metadata as expected

### 4.2 Runtime behavior confirmed

The implementation now guarantees the Phase A safety rule that mattered most:

- escrow submit is not allowed to run before the required submit anchor has been published and persisted

It also preserves retryable partial state instead of pretending a failed submit is fully complete.

## 5. Boundaries Still In Effect

Still out of scope for this document:

- onchain guard enforcement
- contract upgrades
- `JobLifecycleAnchorV2`
- `JobEscrowV2`
- frontend submit blocking

Those remain Phase B work.

## 6. Notes On Actual Implementation Shape

The submit route still prepares the result payload before anchor publish, because the anchor step needs stable result context and the backend must avoid replaying external work on retry.

So the implemented Phase A sequence is:

- prepare result once
- persist submit anchor
- submit escrow result
- finalize submitted state

That is the intended backend-owned recovery model for this phase.

## 7. One-Line Conclusion

Phase A is now complete: submit is anchor-first from the escrow perspective, partial state is explicit and retryable, trace-anchor status is queryable, and the CLI reflects the backend-owned recovery path.
