# Trace Anchor Phase A Runbook

Last updated: 2026-03-18 (Asia/Shanghai)

## Goal

Phase A enforces trace anchoring in backend submit ordering before escrow result submission.

## Public API Surface

- `GET /api/jobs/:jobId/trace-anchor`
- `GET /api/public/jobs/:jobId/trace-anchor`

## Behavior

- if `ERC8183_JOB_ANCHOR_REGISTRY` is not configured:
  - submit keeps legacy behavior
- if `ERC8183_JOB_ANCHOR_REGISTRY` is configured:
  - `/api/jobs/:jobId/submit` must publish the `submitted` anchor before `submitEscrowResult`
  - anchor failure blocks submit
  - retry after anchor success must not publish a duplicate anchor

## Persisted Fields

- `submitAnchorId`
- `submitAnchorTxHash`
- `submitAnchorConfirmedAt`

## Verification

- `npm run verify:trace-anchor:submit-order`
- `npm run verify:trace-anchor:status`

## CLI Notes

- `ktrace job submit` now surfaces anchor failures distinctly
- `ktrace job submit` includes `submitAnchorConfirmedAt` in the returned job block
- `ktrace job show` / `ktrace job audit` inherit the new field from the backend response
