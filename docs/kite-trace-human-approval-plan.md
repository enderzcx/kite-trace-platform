# Kite Trace Human Approval And Delivery Plan

Updated: 2026-03-18

## Purpose

This plan scopes the next `ktrace` upgrade around five gaps:

1. P0: Human approval / Locus-style over-limit pause
2. P0: Explicit delivery standard
3. P0: Escrow allowance + live end-to-end verification
4. P1: Frontend job lifecycle visualization
5. P1/P2: Contract primitive gaps beyond the current escrow demo

This document is now the landed execution plan for the current backend/frontend pass.

- Backend work in `backend/` is complete for this pass.
- Frontend work in `agent-network/` needed for this pass has also landed.

## Status Snapshot

### Completed

- `P0-C` escrow allowance and one full live E2E job flow are verified
- `P0-A` backend over-limit pause is live:
  - `POST /api/jobs/:jobId/fund` can return `202 pending_approval`
  - canonical approval routes are live:
    - `GET /api/approvals`
    - `GET /api/approvals/:approvalId`
    - `POST /api/approvals/:approvalId/approve`
    - `POST /api/approvals/:approvalId/reject`
  - approve auto-resume is verified
  - reject path is verified
  - expiry path is verified with an isolated script
- CLI operator surface is updated:
  - `ktrace job fund` now prints `approvalId`, `approvalUrl`, `approvalExpiresAt`, and next-step guidance
- `P0-B` explicit delivery standard is now locked in backend outputs:
  - receipt verification covers the full first-pass required field set
  - audit/receipt/evidence now surface:
    - `approvalPolicy`
    - `deadline`
    - `deliveryStandard`
- `P1` frontend lifecycle / approval reads are landed:
  - public job audit page reads the public audit route
  - approval page reads the canonical approval envelope
  - approval inbox persists the admin key in-session
- `P1/P2` contract primitive work is landed:
  - deadline enforcement is contract-backed for escrow jobs
  - requester / executor / validator role enforcement is live onchain
  - staking / slashing are represented in contract, audit, receipt, and evidence
  - overdue escrow-backed jobs can now be auto-expired by the backend watcher when enabled
  - job / audit / receipt / evidence reads hydrate from onchain escrow state
  - audit/receipt/evidence now surface `contractPrimitives` as actual capability state, not just planned gaps

### In Progress

- no required work remains for this implementation pass
- future work beyond this plan is optional hardening:
  - AA/session-bound role execution instead of role EOAs/private keys
  - autonomous keeper externalization instead of backend-local watcher
  - broader live end-to-end validation against more providers

### CC Ready

CC can begin these frontend items now without waiting for more backend approval work:

1. `P1-A` public job lifecycle audit view
- use current `job show` / receipt / evidence data
- render conditionally for fields that are still rolling out in `P0-B`
- backend audit helper routes are now available:
  - `GET /api/jobs/:jobId/audit`
  - `GET /api/public/jobs/:jobId/audit`
  - `GET /api/public/jobs/by-trace/:traceId/audit`
- CLI companion is now available:
  - `ktrace job audit <job-id>`
  - `ktrace job audit <job-id> --public`
  - `ktrace job audit <trace-id> --public --trace`

2. `P1-B` protected approval panel
- reuse `/approval/:approvalRequestId`
- branch by `approvalKind`
- support:
  - `approvalKind = session`
  - `approvalKind = job`

3. Approval inbox
- route:
  - `/approvals`
- backend source:
  - `GET /api/approvals`
- treat it as operator-only, not public
- CLI operator fallback is now available too:
  - `ktrace approval list`
  - `ktrace approval show`
  - `ktrace approval approve`
  - `ktrace approval reject`
- `ktrace approval show` now exposes pending job next-step guidance and the approval policy snapshot
- approval APIs now expose frontend-ready summary blocks for the protected approval UI:
  - list `meta.filters`
  - list `meta.approvalPolicyDefaults`
  - list `meta.counts`
  - detail `jobSummary`
  - detail `reviewSummary`
  - detail `links.jobAuditUrl`
  - detail `links.publicJobAuditUrl`
  - list access is now operator-gated by:
    - `X-Admin-Key`
    - `KTRACE_ADMIN_KEY`

### Not Yet Ready For CC

- onchain deadline enforcement
- onchain multi-role execution
- staking/slashing flows

## Execution Order

This plan is intentionally not ordered the same way as the conceptual sections above.

The required implementation order is:

1. `P0-C` first
- confirm escrow allowance and one real live end-to-end job flow before new feature work

2. `P0-A` and `P0-B` second
- add over-limit approval and freeze the delivery/receipt contract

Current state:
- `P0-A` complete
- `P0-B` complete

3. `P1` after the backend receipt and approval shapes stabilize
- public lifecycle audit view
- unified approval UI
- approval inbox

4. `P1/P2` later
- deadline enforcement
- onchain role enforcement
- staking/slashing

## Locked Integration Decisions

These decisions are now fixed before backend implementation starts:

1. Frontend approval route
- use a single frontend route:
  - `/approval/:approvalRequestId`
- do not introduce `/approvals/:approvalRequestId`

2. Canonical approval API shape
- frontend should converge on one canonical read shape:
  - `GET /api/approvals/:approvalId`
- existing session approval routes remain as backward-compatible adapters during migration:
  - `GET /api/session/approval/:approvalRequestId`
  - `POST /api/session/approval/:approvalRequestId/complete`
- the frontend approval shell should not need to probe multiple response formats forever

3. Approval kind routing
- one approval shell
- one canonical approval envelope
- branch rendering by `approvalKind`

4. Inbox visibility
- approval inbox is not public
- it is an operator surface protected by backend auth

5. Resume reliability
- approval completion must be restart-safe
- backend restart cannot invalidate an approved job by losing in-memory resume context

## Current State

The repo already has:

- a real `JobEscrowV1.sol` contract
- a real `JobLifecycleAnchorV1.sol` anchor contract
- backend helpers and job routes for `create -> fund -> accept -> submit -> validate`
- CLI commands for `job create/fund/accept/submit/validate/show`
- live AA session pay and x402 rails used elsewhere in the system
- a complete user-authorized agent session flow across backend, CLI, and frontend:
  - `ktrace session request`
  - `ktrace session wait`
  - `ktrace session approve`
  - `POST /api/v1/session/approval-requests`
  - `GET /api/session/approval/:approvalRequestId`
  - `POST /api/session/approval/:approvalRequestId/complete`
  - frontend approval page at `/approval/:approvalRequestId`

This changes the earlier planning assumption.

`Human approval` should not be designed as a brand-new parallel system anymore.

Instead, `ktrace` should treat the current session approval flow as the base human-control primitive and build job over-limit approval on top of the same model:

- same owner EOA as approver
- same `approvalUrl` pattern
- same frontend approval interaction language
- same audit fields when possible:
  - `authorizedBy`
  - `authorizationMode`
  - `authorizationPayload`
  - `authorizationPayloadHash`
  - `authorizationExpiresAt`
  - `allowedCapabilities`

The important limitation that still remains:

- [JobEscrowV1.sol](/E:/CODEX/kite-trace-platform/backend/contracts/JobEscrowV1.sol) uses `onlyOwner` for all state transitions
- `requester`, `executor`, and `validator` are recorded, but the backend signer performs the onchain actions
- this is good enough for a strong demo, but it is not yet full onchain role enforcement

## Decisions Already Confirmed

These decisions are locked for the first implementation pass:

- Human approval is triggered only by amount thresholds
- The approver is the owner EOA corresponding to the acting AA wallet
- Approval resumes the original job automatically
- Rejection is a distinct terminal state: `approval_rejected`
- First delivery definition:
  - `delivery complete = validator approve + resultHash submitted + outcome anchored onchain`
- Frontend splits into:
  - public read-only audit views
  - protected approval views
- The roadmap should include both:
  - deadline enforcement
  - onchain role enforcement

## Design Framing

The new human-control model should be two-layered:

1. Session-level authorization
- user authorizes an agent/session within:
  - time window
  - single limit
  - daily limit
  - allowed capabilities

2. Job-level over-limit approval
- only triggered when a concrete job crosses the configured amount threshold
- uses the same owner EOA and the same approval-link UX
- records extra job-specific policy and decision metadata

#### Threshold configuration for v1

The first release should not introduce a broad policy engine yet.

Use one explicit backend configuration source for the threshold:

- env-backed threshold, for example:
  - `KTRACE_JOB_APPROVAL_THRESHOLD`

Optional later expansion:

- per-agent policy
- per-session policy
- per-capability policy

For the first release, frontend only needs to display the effective resolved threshold, not edit it.

#### Approval expiry for v1

Use one explicit backend configuration source for approval expiry:

- env-backed expiry, for example:
  - `KTRACE_JOB_APPROVAL_TTL_MS`

Suggested default for v1:

- `24h`

Why:

- short enough to avoid stale approvals hanging forever
- long enough for demo usage and async operator review without accidental expiry during a presentation

In short:

- session approval = standing guardrails
- job approval = one-off async brake on a specific high-value action

## P0 Scope

### P0-A. Human Approval / Locus Pause Mode

Status: backend minimum viable loop complete; frontend integration pending

#### Goal

If a job funding attempt exceeds a configured threshold, the backend should pause the flow and return:

- `202 Accepted`
- `state = pending_approval`
- `approvalId`
- `approvalUrl`

After the human approves from a web page, the original job continues automatically. The agent does not need to resubmit the command.

#### Backend changes

1. Reuse and extend approval persistence
- avoid creating a second unrelated approval system
- either:
  - extend the existing session approval request store with a typed record model
  - or add a unified approval store that handles both `session` and `job` request types
- first-pass fields:
  - `approvalKind` = `session` or `job`
  - `approvalId`
  - `jobId`
  - `traceId`
  - `state`
  - `reasonCode`
  - `approvalUrl`
  - `requestedByAaWallet`
  - `requestedByOwnerEoa`
  - `createdAt`
  - `expiresAt`
  - `decidedAt`
  - `decidedBy`
  - `decisionNote`
  - `policySnapshot`
  - `jobSnapshot`
  - `resumeToken`
  - `sessionAuthorizationRef`
  - `approvalPayloadHash`
  - `authorizationScope`

Resume reliability requirement:

- `resumeToken` must be persisted, not held only in memory
- the persisted approval record must contain enough data for the backend to resume after restart
- if a job is approved and the process restarts before continuation, the backend should still be able to continue or deterministically fail into an auditable terminal state
- frontend may assume:
  - `approved` means resume has been accepted by the control plane
  - but it should still show an intermediate `resuming` state until the job transitions

2. Reuse owner-EOA approval semantics
- approver remains the owner EOA corresponding to the acting AA wallet
- job approval payload should reference the same identity envelope style already used by session authorization
- approval completion should stamp:
  - `authorizedBy`
  - `authorizationMode`
  - `authorizationPayloadHash`
  - `authorizationAudience`
  - job-specific approval fields

3. Add approval policy evaluation before fund execution
- target route: [jobLaneRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLaneRoutes.js)
- at `POST /api/jobs/:jobId/fund`
- rule for v1:
  - if `budget` or `escrowAmount` exceeds configured threshold, do not call `lockEscrowFunds`
  - create approval request instead
  - persist job state as `pending_approval`
  - include the already-authorized session context if one exists
  - if no valid session authorization exists, return a response that clearly tells the caller this is blocked on session authorization first, not just job approval

4. Approval endpoints
- prefer unifying around the existing approval surface rather than inventing a second disconnected URL scheme
- likely direction:
  - keep current session approval endpoints as compatibility aliases
  - add canonical typed approval routes, for example:
    - `GET /api/approvals`
    - `GET /api/approvals/:approvalId`
    - `POST /api/approvals/:approvalId/approve`
    - `POST /api/approvals/:approvalId/reject`
- the frontend should be able to render both session and job approvals from a shared approval envelope

Canonical decision:

- new frontend work should target:
  - `GET /api/approvals/:approvalId`
- current session-specific endpoints should adapt into the same approval envelope until they can be retired
- this avoids a permanent two-shape frontend integration

5. Add approval list support for inbox views
- `GET /api/approvals`
- minimum filters:
  - `state`
  - `approvalKind`
  - `owner`
  - `limit`
- minimum response usage:
  - approval inbox
  - operator review queue
  - recent decisions list

Inbox auth model for v1:

- `GET /api/approvals` is not public
- require `X-Admin-Key` matching `KTRACE_ADMIN_KEY`
- if `KTRACE_ADMIN_KEY` is unset, return `501 Not Implemented`
- wallet connection may still be used in the frontend to contextualize the active owner, but it is not the sole server-side access control
- first release behavior:
  - operator users with the configured admin key can query the inbox
  - list queries should support owner scoping to avoid showing unrelated approvals by default

6. Add automatic resume
- on approve:
  - validate approval state
  - continue the original `fund` path
  - preserve the same `jobId` and `traceId`
- on reject:
  - set `job.state = approval_rejected`
  - emit lifecycle evidence and anchor

On expired approval:

- set `job.state = approval_expired`
- do not auto-resume
- keep the approval record queryable
- frontend should show that the approval link is no longer actionable

7. Add new states
- `pending_approval`
- `approval_rejected`
- `approval_expired`

8. CLI behavior
- update `ktrace job fund`
- update high-level job flows if needed
- when backend returns `202 pending_approval`, CLI should:
  - not treat it as a crash
  - print `approvalId`
  - print `approvalUrl`
  - print `expiresAt`
  - explain that the job will continue after human approval
  - if the block is actually missing session authorization, point the user at:
    - `ktrace session request`
    - `ktrace session wait`
    - `ktrace session approve`

#### Acceptance criteria

- Small job fund request continues directly
- Large job fund request returns `202 pending_approval`
- Approving from the frontend resumes the same job automatically
- Rejecting from the frontend results in `approval_rejected`
- `artifact evidence` and `job show` both expose approval state
- the approval record links back to the session authorization context when present
- `GET /api/approvals` is sufficient to power an inbox without client-side stitching

### P0-B. Explicit Delivery Standard

Status: complete

#### Goal

Turn "delivery happened" into a clear, reviewable standard instead of an implicit collection of logs.

#### First standard

For the first release, define:

`delivery complete = validator approve + resultHash submitted + outcome anchored onchain`

This gives a clean answer to judges and users:

- execution happened
- a result was submitted
- a validator explicitly accepted it
- the final outcome is anchored onchain

#### Receipt schema

Freeze a minimal normalized receipt schema shared across backend, CLI, frontend, and public audit surfaces.

Suggested required fields:

- `traceId`
- `jobId`
- `state`
- `requester`
- `executor`
- `validator`
- `capability`
- `inputHash`
- `resultHash`
- `approved`
- `approvalState`
- `approvalRequestedAt`
- `approvalDecidedAt`
- `approvalDecidedBy`
- `approvalReasonCode`
- `authorizationId`
- `authorizedBy`
- `authorizationMode`
- `authorizationPayloadHash`
- `authorizationExpiresAt`
- `allowedCapabilities`
- `escrowAddress`
- `tokenAddress`
- `amount`
- `createAnchorTxHash`
- `fundingAnchorTxHash`
- `acceptAnchorTxHash`
- `submitAnchorTxHash`
- `outcomeAnchorTxHash`
- `escrowFundTxHash`
- `escrowAcceptTxHash`
- `escrowSubmitTxHash`
- `escrowValidateTxHash`
- `receiptRef`
- `evidenceRef`

#### Backend changes

1. Normalize receipt/evidence generation
- target files:
  - [receiptEvidenceRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/receiptEvidenceRoutes.js)
  - [jobLaneRoutes.js](/E:/CODEX/kite-trace-platform/backend/routes/jobLaneRoutes.js)
  - related receipt service helpers if needed

2. Distinguish:
- execution submitted
- validator accepted
- job completed

Semantic clarification:

- `approved`
  - reserved for the validator's final delivery judgment
  - example: validator approved payout vs validator rejected
- `approvalState`
  - reserved for human over-limit approval state
  - example: `pending`, `approved`, `rejected`, `expired`

This keeps the two approval layers separate:

- validator judgment on delivery
- human approval of a paused over-limit action

3. Expose both session-authorization fields and job-approval fields in the same receipt/evidence shape

4. Frontend must degrade gracefully while backend rollout is incomplete
- frontend should render fields conditionally
- do not assume all receipt fields exist on day one
- fields such as:
  - `authorizationPayloadHash`
  - `approvalDecidedBy`
  - `authorizationExpiresAt`
  - `allowedCapabilities`
  may be absent until P0-A and P0-B are fully landed
- the public audit UI should show partial data cleanly rather than blocking on a full receipt

5. Keep one story for humans and judges:
- who authorized the agent
- what the job attempted to do
- whether the job crossed the approval threshold
- who approved or rejected the over-limit action
- which onchain transactions prove the final outcome

#### Acceptance criteria

- Every job has a stable receipt object
- Frontend can render lifecycle and decision data without custom per-field guessing
- Public audit consumers can verify final delivery from the receipt alone

### P0-C. Escrow Allowance And Live E2E Verification

Status: complete

#### Goal

Before adding more product surface, confirm that the current escrow path is live and correctly approved.

#### Priority

This is the first implementation task, not the last one.

Reason:

- if escrow allowance or the live job lane is broken, approval and frontend work would be built on an unverified path
- this step is the precondition for the rest of the plan

#### Verification tasks

1. Run escrow approval
- script: [erc8183-approve-escrow.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-approve-escrow.js)
- command:
  - `npm run erc8183:approve:escrow`

2. Verify live allowance
- expected:
  - settlement token allowance from backend signer to escrow contract is sufficient

3. Run one live job flow
- create
- fund
- accept
- submit
- validate approve
- confirm:
  - escrow tx hashes exist
  - anchor tx hashes exist
  - receipt/evidence load correctly

4. Save results to a runbook note
- tx hashes
- contract addresses
- any degraded behavior

#### Acceptance criteria

- escrow contract has allowance
- one complete job reaches terminal success live
- corresponding receipt and evidence are exportable
- demo notes include exact commands and tx hashes

Result:

- verified live
- exact commands and tx hashes are captured in:
  - [erc8183-live-verification-runbook.md](/E:/CODEX/kite-trace-platform/backend/docs/erc8183-live-verification-runbook.md)

## P1 Scope

### P1-A. Frontend Job Lifecycle Visualization

Owner: CC

Status: CC ready

#### Goal

Make the escrow flow human-readable for demos, audits, and judges.

#### Public audit view

Public read-only page showing:

- compact job summary header first:
  - requester
  - executor
  - validator
  - current state
  - budget / escrow amount
- lifecycle timeline immediately after the header
- three roles:
  - requester
  - executor
  - validator
- job states:
  - created
  - funded
  - accepted
  - submitted
  - completed / rejected / approval_rejected / approval_expired
- tx hashes and anchor links per step
- evidence link
- final delivery summary
- session authorization summary:
  - owner EOA
  - AA wallet
  - allowed capabilities
  - single limit / daily limit / expiry
- if the job hit a threshold:
- approval requested
- approval decided by whom
- approval decision time
- if approval has expired:
  - clearly show expired state
  - do not show action controls

#### First-class visual points

The visual should make these three facts obvious:

1. Money was locked into escrow
2. A human approval or validator decision exists
3. Final payment, anchor, and evidence are all independently verifiable

#### Suggested frontend components

- Job summary header
- Job lifecycle timeline
- Role cards
- Evidence summary panel
- Anchor / explorer link list
- Delivery summary block
- Session authorization summary block

### P1-B. Protected Human Approval Panel

Owner: CC

Status: CC ready

#### Goal

Provide a human control surface separate from the public audit view.

This should evolve from the already-existing session approval page instead of replacing it.

#### Protected operator views

- approval inbox
- approval detail page
- approve / reject actions
- policy reason display
- job snapshot display
- owner EOA display
- support both approval kinds:
  - session authorization approval
  - job over-limit approval
- shared approval envelope, shared visual language, shared audit trail

#### approvalKind-specific behavior

The frontend should branch explicitly on `approvalKind`.

For `session` approvals:

- preserve the current chain-aware flow
- user-side actions may include:
  - `createAccount`
  - `addSupportedToken`
  - `createSession`
- wallet connection is required
- the page can remain operationally heavy because it is performing real user-side setup

For `job` approvals:

- no user-side chain action is required in v1
- the page should show:
  - job summary
  - threshold reason
  - policy snapshot
  - Approve / Reject buttons
- interaction should be intentionally lightweight
- approval decision is a control-plane action, not a wallet-execution flow

Expired approval UX:

- show a clear expired banner
- show original job summary and reason code
- disable Approve / Reject actions
- if the backend exposes a replacement or retry path later, render it explicitly
- otherwise say the original approval window has closed

#### Important separation

- Public audit page is read-only
- Approval page is protected and interactive

## P1/P2 Scope

### P1/P2-A. Contract Primitive Gaps

The current escrow lane covers only part of the intended primitive set:

- Escrow: present
- Conditional payment: present
- Deadline: onchain-enforced for escrow-backed jobs
- Staking: present via executor stake lock on accept
- Slashing: present on reject / timeout resolution
- Onchain role enforcement: present via requester / executor / validator signers

### P1/P2-B. Deadline Enforcement

#### Goal

Move expiration from backend-only state transitions toward contract-backed behavior.

#### Current state

- jobs still keep `expiresAt` in backend state for audit/receipt surfaces
- [JobEscrowV1.sol](/E:/CODEX/kite-trace-platform/backend/contracts/JobEscrowV1.sol) now persists `deadlineAt`
- escrow-backed jobs can now resolve timeout onchain through `expireJob(jobId)`
- the backend expiry route anchors the timeout outcome after the contract refund/slash path runs
- the backend can also auto-scan overdue escrow-backed jobs through:
  - `KTRACE_AUTO_JOB_EXPIRY_ENABLED`
  - `KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS`

#### Future direction

- optional AA/session-bound expiry execution instead of role EOA execution only
- optional external keeper instead of backend-local watcher

### P1/P2-C. Onchain Role Enforcement

#### Goal

Stop relying on the backend owner to execute every contract function.

#### Current state

[JobEscrowV1.sol](/E:/CODEX/kite-trace-platform/backend/contracts/JobEscrowV1.sol) is now role-enforced:

- requester funds
- executor accepts and submits
- validator approves or rejects

#### Future direction

- direct EOAs
- role-specific AA wallets
- delegated session wallets bound to those roles

Current implementation detail:

- backend orchestration now signs with role-specific private keys via:
  - `ERC8183_REQUESTER_PRIVATE_KEY`
  - `ERC8183_EXECUTOR_PRIVATE_KEY`
  - `ERC8183_VALIDATOR_PRIVATE_KEY`

### P2-D. Staking And Slashing

#### Goal

Support stronger accountability for executor non-performance.

#### Current state

- executor stake escrow
- slashing on missed deadlines or invalid delivery
- refund + slash outcome path

Current implementation detail:

- `lockFunds(...)` stores `executorStakeAmount`
- `acceptJob(...)` locks executor stake when configured
- `validate(..., false)` refunds requester and includes the slashed stake
- `expireJob(...)` refunds requester and slashes executor stake after deadline once accepted/submitted

## API Draft

These endpoints are expected in the first backend implementation pass.

The main change from the earlier draft is that approval APIs should be typed and unified, not split into one-off disconnected systems.

### Approval read

- `GET /api/approvals/:approvalId`

Response shape:

```json
{
  "ok": true,
  "approvalRequest": {
    "approvalKind": "job",
    "approvalId": "apr_123",
    "approvalRequestId": "apr_123",
    "jobId": "job_123",
    "traceId": "trace_123",
    "state": "pending",
    "reasonCode": "amount_threshold",
    "approvalUrl": "https://.../approval/apr_123",
    "createdAt": "2026-03-17T10:00:00.000Z",
    "expiresAt": "2026-03-17T12:00:00.000Z",
    "requestedByAaWallet": "0x...",
    "requestedByOwnerEoa": "0x...",
    "authorizationId": "auth_123",
    "authorizationPayloadHash": "0x..."
  }
}
```

Canonical read contract:

- frontend should call `GET /api/approvals/:approvalId`
- response envelope should be valid for both:
  - `approvalKind = session`
  - `approvalKind = job`

Compatibility note:

- legacy session endpoints may continue to exist, but new UI work should not depend on their old bespoke response shape long-term

### Approval list

- `GET /api/approvals`

Response shape:

```json
{
  "ok": true,
  "items": [
    {
      "approvalId": "apr_123",
      "approvalKind": "job",
      "state": "pending",
      "jobId": "job_123",
      "traceId": "trace_123",
      "requestedByOwnerEoa": "0x...",
      "createdAt": "2026-03-17T10:00:00.000Z",
      "expiresAt": "2026-03-18T10:00:00.000Z",
      "approvalUrl": "https://.../approval/apr_123"
    }
  ]
}
```

### Approval approve

- `POST /api/approvals/:approvalId/approve`

Expected effect:

- sets approval state to `approved`
- resumes original job fund path

### Approval reject

- `POST /api/approvals/:approvalId/reject`

Expected effect:

- sets approval state to `rejected`
- sets job state to `approval_rejected`

### Job fund over threshold

- `POST /api/jobs/:jobId/fund`

Over-threshold response:

```json
{
  "ok": true,
  "pendingApproval": true,
  "job": {
    "jobId": "job_123",
    "traceId": "trace_123",
    "state": "pending_approval"
  },
  "approval": {
    "approvalId": "apr_123",
    "approvalUrl": "https://.../approval/apr_123",
    "reasonCode": "amount_threshold",
    "approvalKind": "job"
  }
}
```

## Implementation Split

### Backend

Handled by Codex later:

- unify approval persistence around the existing session approval model
- threshold evaluation
- `pending_approval` state transitions
- approval endpoints
- automatic resume
- receipt/evidence schema normalization
- escrow allowance verification run
- live E2E validation run
- reuse current session-authorization state instead of duplicating owner/limit/capability metadata

### Frontend

Handled by CC:

- public lifecycle audit view
- extend the existing approval page into a general protected approval panel
- job evidence presentation
- anchor / tx link visualization
- operator-focused control language
- conditional rendering for partial receipt/evidence fields
- approval inbox backed by `GET /api/approvals`
- branch `/approval/:approvalRequestId` by canonical `approvalKind`

## Demo Story After This Plan Lands

The target story becomes:

1. Human grants bounded session authority
2. Agent creates a job
3. Small job auto-funds and proceeds inside the approved session scope
4. Large job pauses with `pending_approval`
5. Human reviews and approves from the same approval-control surface family already used for session authorization
6. Job resumes automatically
7. Result is submitted
8. Validator approves
9. Escrow settles
10. Anyone can inspect both the authorization trail and the lifecycle evidence publicly

## Demo Script Note

The demo should intentionally show both paths with two different jobs:

1. Small job path
- create a job below `KTRACE_JOB_APPROVAL_THRESHOLD`
- run fund
- show that it continues directly

2. Large job path
- create a second job above `KTRACE_JOB_APPROVAL_THRESHOLD`
- run fund
- show `202 pending_approval`
- open `approvalUrl`
- approve
- show automatic resume

This should be captured in the eventual demo runbook with exact CLI commands.

Current runbook:

- [erc8183-human-approval-demo-runbook.md](/E:/CODEX/kite-trace-platform/backend/docs/erc8183-human-approval-demo-runbook.md)

## Frontend Rendering Rules

To avoid blocking the UI on backend rollout sequencing:

- frontend must not require every receipt field to exist
- render optional sections only when supporting fields are present
- missing approval or authorization fields should show as "not available yet" rather than as hard errors
- the public audit page should always remain readable with:
  - core job summary
  - lifecycle timeline
  - whichever tx hashes and anchors are available

## Not In This First Implementation Pass

- a full contract rewrite for multi-role native execution
- staking/slashing in the current escrow contract
- generalized rule engine beyond amount thresholds
- automated semantic delivery judgment beyond validator approval

## Review Resolution From CC

The current agreed direction after review is:

1. Approval route model
- keep a single approval shell:
  - `/approval/:approvalRequestId`
- branch UI by `approvalKind`

2. Public audit page first screen
- start with a compact job summary header
- then show the lifecycle timeline
- place escrow proof and session authorization details below

3. Protected approval authentication
- first release uses backend-auth plus wallet connection
- owner-EOA signature proof remains the stronger later follow-up after the unified approval envelope settles

## Third-Pass Review — Open Items For Codex

These gaps were identified in the third review pass. All are concrete decision points that Codex needs before starting P0-A / P0-B.

### 1. API response envelope key

The API Draft defines `GET /api/approvals/:approvalId` as returning:

```json
{ "ok": true, "approval": { ... } }
```

The existing session approval endpoints return `approvalRequest` as the envelope key, which the current frontend `ApprovalResponse` type also uses.

**Decision required:**

Lock the canonical response key for the new unified endpoint:

- use `approvalRequest` to stay consistent with the existing frontend type and the current session flow
- the legacy session endpoint keeps returning `approvalRequest` with no migration overhead
- the API Draft examples under "Approval read" should be updated to reflect this key

### 2. `approvalUrl` in the fund over-threshold response example

The "Job fund over threshold" response example in the API Draft uses:

```
"approvalUrl": "https://.../approvals/apr_123"
```

This is `/approvals/` (plural), which contradicts Locked Integration Decision 1 where the frontend route is `/approval/` (singular).

**Fix required:**

Change the example in the API Draft to:

```
"approvalUrl": "https://.../approval/apr_123"
```

### 3. `approvalId` vs `approvalRequestId` naming

The API Draft uses `approvalId` for the new unified routes. The existing system and frontend use `approvalRequestId`.

**Decision required:**

For v1, adopt the following rule:

- new canonical API routes (`GET /api/approvals/:id`, `POST /api/approvals/:id/approve`, etc.) use `approvalId` as the path parameter and the field name in responses
- legacy session endpoints continue to use `approvalRequestId` in their own response shape until retired
- the frontend `ApprovalRequest` type keeps both fields as optional, resolving with `approvalId ?? approvalRequestId` when reading from the canonical endpoint

### 4. `resumeToken` content specification

P0-A requires `resumeToken` to be persisted and restart-safe, but does not define what the token must contain.

**Minimum required fields for Codex to implement:**

- `jobId`
- `traceId`
- `approvalId`
- original `fund` request parameters (budget, escrowAmount, tokenAddress, payerAaWallet)
- `sessionAuthorizationRef` if a session authorization was present at the time of pause
- timestamp of when the approval was created

The backend must be able to reconstruct the original `lockEscrowFunds` call from the persisted token alone, without holding any in-memory closure.

### 5. Inbox backend auth mechanism

P0-A specifies `GET /api/approvals` requires backend auth but does not define the mechanism.

**Decision for v1:**

- protect `GET /api/approvals` with a static `X-Admin-Key` header checked against a `KTRACE_ADMIN_KEY` environment variable
- if `KTRACE_ADMIN_KEY` is not set, the endpoint returns `501 Not Implemented` rather than being open
- the frontend approval inbox page reads this key from a session cookie set at login, or prompts the operator to enter it once per browser session
- this is intentionally minimal; a real auth system is out of scope for this release

### 6. Approval inbox frontend route

P1-B mentions an approval inbox but does not specify the frontend URL.

**Decision:**

- use `/approvals` (plural) for the inbox list page
- this is distinct from the single-item approval page at `/approval/:approvalRequestId` (singular)
- the inbox is a protected operator page; it does not need to be publicly accessible or linked from the main site nav

### 7. Legacy session endpoint migration endpoint

The plan says current session endpoints should be "backward-compatible adapters" but does not define when the probe fallback in the frontend can be removed.

**Decision:**

- once P0-A lands and `GET /api/approvals/:approvalId` is live, the backend should make `GET /api/session/approval/:approvalRequestId` return a response that also includes `approvalKind` and `approvalState` fields in the same envelope
- the frontend `fetchApproval` fallback probe can be removed after P0-A is confirmed working end-to-end
- the old session endpoints are not retired in this release but are no longer the source of truth for new work
