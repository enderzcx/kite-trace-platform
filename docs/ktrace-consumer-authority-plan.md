# Kite Trace Consumer Authority Control Plane Plan

Updated: 2026-03-18
Status: active
Scope: local-only planning document

AA-native source of truth:

- `docs/ktrace-full-stack-aa-plan.md`

## Purpose

This document turns the current consumer-agent discussion into an implementation plan for Kite Trace.

Primary product decision:

- consumer agents should not be forced to register an onchain agent identity before they can use Kite Trace
- consumer identity may exist later as an optional trust layer
- the first required control surface is delegated authority, not static identity

Ownership split:

- Backend: Codex / backend owner
- Frontend: CC

## Executive Summary

Kite Trace already has the right building blocks:

- provider identity via `ERC-8004`
- delegated payment authority via AA session
- buy and job execution lanes
- receipt, evidence, and public audit surfaces

The current weakness is that consumer authority is still implicit and scattered across runtime/session internals.

The next backend milestone should make consumer authority explicit, enforceable, revocable, and auditable.

One-line version:

**Turn Kite Trace from "session-backed payments" into an authority-first execution control plane for consumer agents.**

## Product Decision

### D1. Consumer Identity

Consumer agents do not need mandatory `ERC-8004` registration for first-mile onboarding.

Reason:

- the minimum consumer loop is discovery -> buy/job -> result -> evidence
- this loop depends on authorization scope and payment safety more than public identity
- forcing consumer identity too early raises onboarding cost without reducing the main execution risk

Decision:

- consumer identity remains optional
- provider identity remains required for provider discovery and provider trust
- future identity-linked consumers may be added as an upgrade tier

### D2. Authority-First Execution

Every buy or job action must be explainable by an explicit authority policy snapshot.

That policy should answer:

- who authorized the agent
- what the agent may buy
- which providers or recipients are allowed
- how much may be spent
- when the grant expires
- whether the grant has been revoked

### D3. Prompt And Intent Separation

Natural-language intent must never map directly to payment or execution.

Execution path:

1. intent capture
2. structured plan / validation
3. policy check
4. buy/job execution
5. receipt/evidence export

This keeps prompt-driven UX compatible with structured API guarantees.

### D4. Identity As An Upgrade Layer

If a consumer later needs stronger trust or network-level interoperability, it may optionally attach identity.

Candidate future tiers:

- unregistered consumer
- verified consumer
- identity-linked consumer agent

This tiering is not part of the first implementation slice.

### D5. `agent invoke` Positioning

`agent invoke` remains a convenience wrapper in this slice and does not replace the canonical buy/job surfaces.

Decision:

- canonical execution surfaces remain `buy direct`, `buy request`, and `job`
- `agent invoke` may consume the same authority validation path
- `agent invoke` is not the architecture center of this plan

## Why This Is The Right Next Step

This plan should be prioritized over consumer identity registration because it solves the higher-risk problem first.

It aligns with the current repo and architecture direction:

- consumer buy and job paths already require usable session state
- session-pay policy already treats delegated authority as the main safety boundary
- evidence already exists and can be expanded into an authority audit envelope

It also aligns with the broader agentic engineering direction:

- authority and revocation matter more than static identity at first onboarding
- API contracts must be safe for autonomous callers
- prompt-based UX must still terminate in structured, validated actions

## Current Repo Anchors

The plan should extend existing surfaces rather than invent a second execution system.

Primary backend anchors:

- `backend/cli/commands/buyCommands.js`
- `backend/cli/commands/jobCommands.js`
- `backend/cli/commands/authCommands.js`
- `backend/cli/lib/sessionRuntime.js`
- `backend/lib/sessionRuntimeHelpers.js`
- `backend/lib/sessionPay.js`
- `backend/routes/automationX402Routes.js`
- `backend/routes/coreIdentitySessionRoutes.js`
- `backend/routes/marketAgentServiceRoutes.js`
- `backend/routes/jobLaneRoutes.js`
- `backend/routes/paymentPolicyHelpers.js`
- `backend/routes/receiptEvidenceRoutes.js`
- `backend/docs/aa-session-policy.md`
- `docs/kite-trace-wallet-auth-model.md`

Current strengths already present:

- provider identity is separate from consumer payment authority
- `buy direct`, `buy request`, and `job fund` already preflight session readiness
- receipt/evidence/public audit are normal platform outputs, not an afterthought

Current gap:

- there is no first-class authority policy surface that a consumer operator can inspect, revoke, or audit cleanly
- existing policy logic is split across runtime/session routes and x402 policy helpers rather than exposed as one consumer authority contract

Existing policy-adjacent surfaces that must be converged rather than duplicated:

- `GET /api/session/runtime`
- `POST /api/session/runtime/sync`
- `POST /api/session/runtime/ensure`
- `GET /api/x402/policy`
- `POST /api/x402/policy`
- `POST /api/x402/policy/revoke`
- `GET /api/x402/policy-failures`

## Main Goal

Land a first implementation slice where consumer execution is governed by an explicit authority model.

Done means:

- policy scope is visible
- policy enforcement is centralized
- revocation is explicit
- buy/job retries are safer
- evidence explains the authority chain behind execution

## Non-Goals

This plan should not expand into all future platform concerns at once.

Out of scope for the first slice:

- mandatory consumer `ERC-8004` onboarding
- full decentralized consumer reputation
- large frontend redesign
- replacing the existing buy or job lanes
- deep refactor of unrelated XMTP or workflow files

## Backend Workstreams

### 1. Authority Policy Model

Create one normalized backend authority policy shape for consumer execution.

Minimum fields:

- `authorityId`
- `sessionId`
- `authorizedBy`
- `payer`
- `consumerAgentLabel`
- `allowedCapabilities`
- `allowedProviders`
- `allowedRecipients`
- `singleLimit`
- `dailyLimit`
- `totalLimit`
- `expiresAt`
- `status`
- `revokedAt`
- `revocationReason`
- `createdAt`
- `updatedAt`

Notes:

- `consumerAgentLabel` is optional and must not imply `ERC-8004`
- policy data should be derived from or attached to the current session model rather than introducing a separate wallet system
- `allowedCapabilities`, `singleLimit`, `dailyLimit`, `authorizedBy`, and recipient controls must reuse the current runtime and payment-policy primitives where possible

### 2. Authority API Surface

Add explicit backend surfaces for reading, validating, and revoking consumer authority.

Recommended routes:

- `GET /api/session/policy`
- `POST /api/session/policy`
- `POST /api/session/policy/revoke`
- `POST /api/session/validate`

Route ownership decision:

- implement these routes inside `backend/routes/coreIdentitySessionRoutes.js`
- reuse `coreIdentitySessionRoutes.js` auth boundaries instead of creating a separate authority route file in phase 1
- treat the existing `/api/x402/policy*` routes in `backend/routes/automationX402Routes.js` as legacy compatibility/admin surfaces until the new authority routes are live

Behavior goals:

- `GET` returns the effective policy snapshot for the current caller
- `POST /policy` creates or updates the current grant configuration
- `POST /policy/revoke` revokes the active grant without deleting history
- `POST /validate` evaluates whether a proposed buy/job action is allowed before execution

Initial role alignment:

- `GET /api/session/policy` -> `requireRole('viewer')`
- `POST /api/session/policy` -> `requireRole('agent')` for self-scoped updates; admin override remains on legacy/admin paths
- `POST /api/session/policy/revoke` -> `requireRole('agent')` for self-scoped revoke; admin override remains on legacy/admin paths
- `POST /api/session/validate` -> `requireRole('agent')`

Implementation rule:

- reuse the current session runtime and auth boundaries where possible
- do not create a second policy engine beside `paymentPolicyHelpers.js` and the current session-pay checks
- policy denials must continue to flow into existing policy-failure logging and `sessionPay` category metrics where applicable

### 3. Execution Enforcement

Move policy evaluation into a shared authority check path used by all consumer execution lanes.

First required callers:

- `buy direct`
- `buy request`
- `job fund`
- `job submit`
- any future `agent invoke` purchase path

Policy checks must cover:

- expiration
- revocation
- allowed capability
- allowed provider
- allowed recipient
- spend limit

Enforcement rule:

- execution must fail before payment if validation fails
- error responses must include machine-readable reason codes
- deny paths should reuse the current `writePolicyFailures(...)` and `failuresByCategory.policy` observability model instead of inventing a second metrics path

### 4. Idempotency And Retry Safety

Add stronger idempotency support for autonomous callers.

Required changes:

- allow and encourage `intentId` or `idempotencyKey` on buy/job actions
- persist the key through purchase/job/audit records
- retries with the same key must not create duplicate payment execution

Storage decision:

- add a dedicated bounded store for consumer intent replay control rather than overloading only the purchase/job rows
- recommended file: `backend/data/consumer_intents.json`
- recommended accessors: `readConsumerIntents()` / `writeConsumerIntents()` in `backend/lib/dataStoreAccessors.js`
- attach the chosen `intentId` to purchase/job records as secondary references for audit readability

Retention decision:

- replay-control records are not kept forever
- default retention is 7 days after terminal completion or terminal failure
- compaction runs on read/write paths in the accessor layer
- long-lived audit remains in purchase/job/receipt/evidence records, not in the replay index

Reason:

- agent callers amplify ambiguity and retry bugs faster than human operators

### 5. Evidence And Accountability Expansion

Extend receipt/evidence payloads with authority metadata.

Minimum evidence additions:

- `authorization.authorityId`
- `authorization.authorizedBy`
- `authorization.payer`
- `authorization.sessionId`
- `authorization.policySnapshot`
- `authorization.policySnapshotHash`
- `authorization.validationDecision`
- `authorization.intentId`

Design rule:

- evidence must answer not only "what happened" but also "under what authority was it allowed to happen"

Snapshot decision:

- internal receipt/evidence may embed a normalized policy snapshot
- the embedded snapshot must exclude secrets, private keys, raw authorization signatures, and other runtime-only material
- public evidence should not embed the full policy snapshot
- public evidence should expose a sanitized authority summary plus `authorityId` and `policySnapshotHash`

### 6. CLI Surface

Expose the authority model through `ktrace`.

Recommended CLI additions:

- `ktrace auth policy`
- `ktrace auth policy-set`
- `ktrace auth policy-revoke`
- `ktrace auth validate`

Execution updates:

- `ktrace buy direct` accepts `--intent-id`
- `ktrace buy request` accepts `--intent-id`
- `ktrace job fund` accepts `--intent-id`
- `ktrace job submit` accepts `--intent-id`

CLI output goal:

- show the policy decision in a compact form before or alongside execution metadata

## Frontend Workstreams (CC)

Frontend should remain narrow and backend-led.

CC-owned scope:

- authority policy inspection view
- grant and revoke controls
- pre-execution validation display
- evidence panel showing authority snapshot

Frontend rules:

- do not redesign the whole app around this slice
- reuse stable backend authority APIs
- keep the first UI operator-facing, not mass-market

Frontend should not own business rules.

The backend is the source of truth for:

- authority validation
- policy enforcement
- revocation state
- evidence formatting

## Migration Path

Migration must preserve current session-backed consumers without forcing re-onboarding.

Decision:

- existing session runtime records are auto-materialized into the new authority shape on first read, first validate, or first execution after rollout
- no mandatory re-run of `auth session` is required in phase 1
- when an older runtime lacks new authority metadata, the backend derives a compatibility policy from:
  - session runtime fields such as `authorizedBy`, `allowedCapabilities`, `maxPerTx`, `dailyLimit`, and `gatewayRecipient`
  - current `paymentPolicyHelpers.js` snapshot where needed
- newly created or updated session grants should persist the normalized authority object directly

Compatibility rule:

- if the backend cannot derive a minimally safe authority object from an old runtime, execution must fail closed with a machine-readable migration reason code

## Suggested Phases

### Phase A. Contract Freeze

Backend:

- finalize authority policy shape
- finalize route names and response contract
- define reason-code set for policy denials

Frontend:

- none beyond review

Phase A completion criteria:

- route ownership is frozen
- migration behavior is frozen
- public-vs-internal evidence authority shape is frozen
- denial reasons are frozen as string enums
- CC confirms the contract is frontend-consumable
- backend owner gives final contract sign-off

Initial denial reason-code set:

- `authority_not_found`
- `authority_expired`
- `authority_revoked`
- `authority_migration_required`
- `capability_not_allowed`
- `provider_not_allowed`
- `recipient_not_allowed`
- `amount_exceeds_single_limit`
- `amount_exceeds_daily_limit`
- `intent_replayed`
- `intent_conflict`

### Phase B. Backend Authority Surface

Backend:

- implement policy read/update/revoke routes
- add shared policy evaluation helper
- persist authority snapshots

Frontend:

- none beyond API review

### Phase C. Execution Integration

Backend:

- enforce policy in buy/job/agent invoke paths
- add `intentId` propagation
- normalize error envelopes for denials and replay-safe retries

Frontend:

- validation and policy-state read surfaces

### Phase D. Audit Expansion

Backend:

- attach authority snapshot to receipt/evidence/public audit where safe
- verify export consistency

Frontend:

- display authority chain in evidence views

## Acceptance Criteria

The first slice is successful when all of the following are true:

1. a consumer can inspect the active execution authority without reading hidden runtime state
2. a consumer can revoke authority cleanly
3. buy/job execution is denied when policy rules do not allow the action
4. repeated execution with the same `intentId` does not duplicate payment
5. receipt/evidence explain the authority context behind the action
6. consumer onboarding still does not require mandatory `ERC-8004`

## Validation Plan

Backend validation should stay narrow and risk-based.

Minimum validation targets:

- policy route read/update/revoke checks
- `POST /api/session/validate` allow-path and deny-path checks
- buy direct deny-path and allow-path checks
- buy request deny-path and allow-path checks
- job fund deny-path and allow-path checks
- duplicate `intentId` replay test
- revoke-then-execute deny-path test
- evidence export includes authorization snapshot

Suggested script additions:

- `backend/scripts/verify-consumer-authority-policy.mjs`
- `backend/scripts/verify-consumer-authority-idempotency.mjs`
- `backend/scripts/verify-consumer-authority-evidence.mjs`
- `backend/scripts/verify-consumer-authority-revoke.mjs`

## Immediate Next Actions

Backend owner:

1. freeze the policy object and denial reason codes
2. choose the authority route shape
3. wire the shared evaluator into buy/job paths
4. extend evidence payloads
5. add verification scripts

CC:

1. review the authority API contract
2. design the smallest useful operator-facing authority panel
3. wait for backend contract freeze before frontend implementation

## Open Questions

Open questions resolved for phase 1:

- `allowedProviders=[]` means wildcard allow rather than default deny
- revocation is global only in phase 1; scoped revoke moves to a later slice
- `agent invoke` remains a convenience wrapper and does not replace canonical buy/job surfaces
