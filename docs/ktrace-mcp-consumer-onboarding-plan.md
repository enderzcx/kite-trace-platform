# Kite Trace MCP Consumer Onboarding Plan

Updated: 2026-03-18
Status: backend contract complete, connector UX follow-up tracked separately
Scope: local-only planning document

AA-native source of truth:

- `docs/ktrace-full-stack-aa-plan.md`
- Claude-friendly connector follow-up:
  - `docs/ktrace-claude-connector-plan.md`

## Purpose

This document defines the product and implementation plan for letting external consumer agents use Kite Trace through MCP.

It does not introduce a new execution engine.

Primary decision:

- external consumer agents may use MCP as the protocol surface for calling Kite Trace
- consumer onboarding through MCP does not require mandatory `ERC-8004`
- MCP remains an adapter over the existing capability catalog, service invoke flow, consumer authority policy, session pay, and evidence surfaces

## One-Line Summary

**Let consumer agents connect to `ktrace` through MCP, while keeping authority, payment, and audit inside the existing backend control plane.**

## Why This Matters

Kite Trace already supports two core ideas:

- provider identity is separate from consumer payment authority
- MCP is already implemented as a thin adapter over capability discovery plus service invocation

What is still missing is a clear onboarding contract for the consumer side:

- what a consumer MCP client needs
- what happens on list and call
- how payment and authority behave
- what errors are expected
- what is in scope for phase 1 versus later slices

This plan closes that gap.

## Product Decisions

### D1. Consumer MCP Is Allowed

External consumer agents may use MCP as a first-class integration protocol for Kite Trace.

This means:

- a consumer may connect to `/.well-known/mcp.json`
- a consumer may list `ktrace__*` tools
- a consumer may call those tools through `POST /mcp`
- the backend must preserve the same execution, payment, and evidence model as direct HTTP callers

### D2. Consumer MCP Does Not Require `ERC-8004`

Consumer MCP onboarding is authority-first, not identity-first.

Phase 1 requirement:

- valid backend auth
- usable session runtime for paid calls
- active consumer authority policy for paid execution

Phase 1 non-requirement:

- no mandatory `ERC-8004`

Reason:

- consumer first-mile risk is delegated authority and spend safety
- provider trust and discovery still depend on identity
- consumer invocation does not need network-visible identity in order to be safe

### D3. MCP Remains Adapter-Only

The MCP layer must not fork:

- discovery logic
- payment logic
- authority logic
- receipt/evidence logic

The only thing MCP changes is the client protocol.

Canonical internal path:

1. MCP client connects to `POST /mcp`
2. MCP tool list is built from the capability catalog
3. MCP tool call is translated into `/api/services/:serviceId/invoke`
4. service invoke reuses authority validation and session-pay logic
5. receipt and evidence remain the same as any other invoke path

### D4. MCP Consumer Phase 1 Targets The Service Invoke Lane

Phase 1 consumer MCP access should explicitly target the current service invoke lane.

This means:

- MCP `tools/call` maps to service invoke
- direct buy and job lanes remain canonical product concepts
- MCP does not become the orchestration center for the whole platform in phase 1

### D5. Paid MCP Must Respect Consumer Authority

If an MCP tool call triggers a paid capability:

- the backend must validate the active authority policy first
- execution must fail before payment when policy denies the action
- the resulting receipt and evidence must explain the authority context

This aligns MCP with the consumer authority control plane rather than bypassing it.

## Current Repo Anchors

This plan should extend current stable surfaces, not invent parallel ones.

Primary anchors:

- `backend/mcp/mcpServer.js`
- `backend/mcp/toolsAdapter.js`
- `backend/mcp/invokeAdapter.js`
- `backend/docs/mcp-server-runbook.md`
- `docs/kite-trace-mcp-consumer-guide.md`
- `docs/kite-trace-mcp-integration-plan.md`
- `docs/ktrace-consumer-authority-plan.md`
- `backend/docs/consumer-authority-contract.md`
- `backend/docs/consumer-authority-frontend-handoff.md`
- `backend/routes/coreIdentitySessionRoutes.js`
- `backend/routes/marketAgentServiceRoutes.js`
- `backend/routes/receiptEvidenceRoutes.js`

Frontend (CC-owned):

- `agent-network/app/authority/page.tsx` â€?authority control panel page
- `agent-network/components/authority/AuthorityPanelClient.tsx` â€?MCP readiness + authority inspect/grant/revoke + validation
- `agent-network/app/api/authority/mcp-info/route.ts` â€?proxy GET `/.well-known/mcp.json`
- `agent-network/app/api/authority/session-status/route.ts` â€?proxy GET `/api/session/runtime`
- `agent-network/app/mcp/page.tsx` â€?consumer MCP onboarding guide page
- `agent-network/components/mcp/McpGuideClient.tsx` â€?interactive guide with steps, code blocks, failure tables

Current implemented truths:

- `GET /.well-known/mcp.json` exists
- `POST /mcp` exists
- tools are derived from the capability catalog
- tool calls are translated into service invoke
- MCP-originated invocations are tagged with `sourceAgentId = mcp-client`
- receipt and evidence are already produced through the normal backend flow

## Consumer MCP Flow

Phase 1 onboarding flow should be documented as:

1. discover the server
   - `GET /.well-known/mcp.json`
2. authenticate
   - use the backend API key model
3. list tools
   - MCP `tools/list`
4. call a tool
   - MCP `tools/call`
5. backend translates the call into service invoke
6. if the capability is paid:
   - validate authority
   - run session pay
7. return normal result plus trace references
8. consumer may later inspect:
   - receipt
   - evidence
   - public evidence

One-line protocol chain:

`MCP client -> /mcp -> tools/list or tools/call -> service invoke -> authority/session pay -> receipt/evidence`

## Minimum Consumer Requirements

### For Discovery And Tool Listing

Minimum requirements:

- MCP endpoint URL
- `viewer` API key or higher when auth is enabled

This covers:

- `GET /.well-known/mcp.json`
- MCP `tools/list`

### For Tool Calls

Minimum requirements:

- MCP endpoint URL
- `agent` API key or higher when auth is enabled

This covers:

- MCP `tools/call`

### For Paid Calls

Additional requirements:

- session runtime must be ready
- active authority policy must allow the call

Operational meaning:

- a consumer can discover the MCP server and list tools before it has paid-call readiness
- a consumer still needs `agent` role to execute `tools/call`
- paid tool calls are not considered healthy until session and authority are ready

## Contract Expectations

### Discovery Contract

`GET /.well-known/mcp.json` is the discovery entrypoint.

Frozen fields:

- `name`
- `version`
- `endpoint`
- `transport`
- `auth`
- `toolNamePrefix`

### Tool Naming Contract

Tools are named:

- `ktrace__{capability_id}`

The tool list is derived from active capability catalog entries.

### Call Contract

Phase 1 MCP `tools/call` should continue to map to:

- `POST /api/services/:serviceId/invoke`

Expected MCP caller fields:

- `payer` when needed
- `_meta.traceId` optional
- `sourceAgentId` optional
- `targetAgentId` optional
- `paymentProof` optional only for advanced flows

Default audit marker:

- if no caller identity is provided, use `sourceAgentId = mcp-client`

Auth expectation:

- `tools/list` requires `viewer` or higher
- `tools/call` requires `agent` or higher

## Authority And Payment Rules

MCP consumer calls must obey the same backend authority model as direct HTTP consumers.

Required rules:

- no MCP-only bypass of authority policy
- no MCP-only payment path
- no MCP-only receipt/evidence format

Paid tool call evaluation order:

1. authenticate request
2. resolve tool to service
3. validate consumer authority
4. if denied, fail before payment
5. if allowed, invoke service through existing backend flow
6. emit receipt and evidence

Relevant denial classes:

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

## Audit And Evidence Rules

MCP consumer calls must remain fully auditable.

Phase 1 audit requirements:

- service invocation records show `sourceAgentId = mcp-client` unless a stronger caller id is supplied
- receipt and evidence must still be retrievable from normal routes
- paid MCP calls must surface authority metadata through the same receipt/evidence contract used elsewhere

Receipt and evidence lookup after a paid MCP call:

- `GET /api/receipt/:requestId`
- `GET /api/evidence/export?traceId=...`
- `GET /api/public/evidence/:traceId`

## Non-Goals

Out of scope for this plan:

- mandatory consumer `ERC-8004`
- an MCP-only payment system
- an MCP-only authority policy system
- turning MCP into the default path for every execution lane
- exposing raw `402` recovery flows as the main consumer UX in phase 1

## Suggested Phases

### Phase A. Contract Freeze

Freeze the consumer MCP story in docs.

Done means:

- consumer MCP is explicitly allowed
- no mandatory `ERC-8004` for consumers
- MCP is adapter-only
- paid MCP is explicitly authority-bound
- the consumer-facing flow is documented

Current state:

- the MCP adapter contract is stable in backend code and runbooks
- this planning document is the current planning reference

### Phase B. Consumer Onboarding Documentation

Add a user-facing guide for consumer MCP onboarding.

Minimum contents:

- endpoint discovery
- auth expectations
- list tools
- call tools
- paid-call prerequisites
- receipt/evidence follow-up
- common failure states

Current state:

- complete
- dedicated guide now lives at `docs/kite-trace-mcp-consumer-guide.md`
- `backend/docs/consumer-authority-frontend-handoff.md` remains authority-specific and is not used as the MCP onboarding guide

### Phase C. Verification Alignment

Make consumer MCP verification explicit in runbooks.

Required verification expectations:

- MCP smoke still passes
- MCP auth matrix still passes
- paid MCP success still confirms receipt and evidence
- authority-denied MCP failure is documented as a valid, expected state

Current state:

- complete
- `npm --prefix backend run verify:mcp:consumer` now covers auth split, successful paid MCP authority metadata, and deterministic `authority_revoked`
- `npm --prefix backend run verify:mcp:paid` now asserts authority metadata inside internal evidence on successful paid runs

### Phase D. Frontend And Operator Handoff

Give CC and operator-facing surfaces a stable explanation of:

- how to present MCP endpoint onboarding
- what is needed for a paid consumer MCP connection
- what errors belong to auth versus authority versus upstream execution

Phase 1 frontend/operator tasks:

- add MCP endpoint discovery display to the frontend (show `/.well-known/mcp.json` endpoint plus `toolNamePrefix` to the operator or onboarding surface)
- add a paid-call readiness indicator that combines session status and authority status into a single go/no-go signal
- ensure error code rendering follows the handoff rule: show backend `reason` string, never remap error codes, treat `intent_*` as replay/conflict states rather than generic failures
- ensure no frontend copy implies `ERC-8004` is required for consumer MCP access

## Acceptance Criteria

This plan is successful when the following are true:

1. external consumer agents can use MCP as a documented Kite Trace integration path
2. consumer MCP onboarding clearly does not require mandatory `ERC-8004`
3. paid MCP calls are documented as authority-first and session-backed
4. MCP remains a thin adapter over service invoke and audit flows
5. receipt and evidence remain the canonical post-call audit surface
6. operator and frontend teams have a stable doc to reference

## Validation Plan

Minimum validation should continue to rely on existing MCP verification surfaces:

- `node --check backend/mcp/mcpServer.js`
- `node --check backend/mcp/toolsAdapter.js`
- `node --check backend/mcp/invokeAdapter.js`
- `npm --prefix backend run verify:mcp:smoke`
- `npm --prefix backend run verify:mcp:auth`
- `npm --prefix backend run verify:mcp:paid`
- `npm --prefix backend run verify:mcp:consumer`
- `npm --prefix backend run verify:mcp:release`

Consumer authority gate:

- `npm --prefix backend run verify:consumer-authority`

Validation note:

- `verify:mcp:paid` proves the paid MCP path can complete, produce receipt/evidence, and include authority metadata in internal evidence
- `verify:consumer-authority` proves authority policy semantics
- neither should be treated as automatically proving the full behavior covered by the other unless explicitly verified

Documentation validation:

- MCP onboarding docs do not claim consumer identity is mandatory
- MCP onboarding docs explain paid-call prerequisites through session plus authority
- MCP onboarding docs point consumers to receipt/evidence after execution

## Immediate Next Actions

Backend owner:

1. keep MCP docs aligned with consumer authority docs if route names or contracts change
2. expand live MCP verification only if future slices move beyond the service invoke lane
3. keep `verify:mcp:consumer` aligned with the frozen denial code set if authority policy evolves

CC:

1. build MCP endpoint discovery display - show `/.well-known/mcp.json` URL and `toolNamePrefix` to operators
2. build paid-call readiness indicator - combine session runtime status and authority policy status into a single signal
3. use backend auth wording that distinguishes `tools/list` from `tools/call`
4. ensure all error code rendering follows handoff rules (show backend `reason`, no remapping, `intent_*` shown as replay/conflict)
5. do not add frontend copy implying `ERC-8004` is required for consumer MCP access

## Final Product Statement

The clean external message for phase 1 is:

**Providers join Kite Trace through identity. Consumers may call Kite Trace through MCP. Paid consumer MCP calls are controlled by delegated authority, not mandatory onchain identity.**

