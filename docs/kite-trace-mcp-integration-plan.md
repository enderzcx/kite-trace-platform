# Kite Trace MCP Integration Plan

Updated: 2026-03-18

## Purpose

This document turns the rough MCP integration idea into a reviewable implementation plan for the current Kite Trace repo.

Audience:

- CC for frontend review and implementation
- backend owner for server-side delivery
- project team for scope control and acceptance

Ownership split:

- Frontend: CC
- Backend: Codex / backend owner

## Executive Summary

The goal is to expose the existing Kite Trace capability catalog as MCP tools without creating a second execution pipeline.

The core implementation principle is:

- discovery reuses `GET /api/v1/capabilities`
- invocation reuses `POST /api/services/:serviceId/invoke`
- payment reuses `postSessionPayWithRetry(...)`
- audit reuses `upsertServiceInvocation(...)`
- trace propagation reuses the current `traceId` middleware and evidence flow

Two design corrections are recommended before approval:

1. `/mcp` should be implemented with Streamable HTTP as the primary transport
- SSE compatibility can be retained only if needed
- this keeps the server aligned with current MCP SDK direction and remote connector expectations

2. Frontend onboarding should not assume remote MCP can be configured via `claude_desktop_config.json`
- remote MCP should be presented as a connector URL flow
- generating `claude_desktop_config.json` only makes sense if a local `stdio` bridge is added later

## Goals

- Expose active `cap-*` capability records as MCP tools
- Allow MCP clients to call the existing service invoke path
- Preserve current x402 session-pay behavior and retries
- Preserve current audit, receipt, and evidence generation
- Preserve current trace linkage from request to evidence export
- Add a minimal frontend surface so users can discover and connect the MCP server

## Non-Goals

- No new business logic path for service execution
- No separate MCP-only payment implementation
- No expansion of frontend scope beyond status and onboarding surfaces
- No refactor of existing market/workflow route files unless required by integration
- No local desktop `stdio` bridge in the first pass

## Current Repo Anchors

The MCP server should be built on top of the current backend surfaces rather than beside them.

Primary backend anchors:

- `backend/appRuntime.js`
- `backend/routes/v1/capabilitiesV1Routes.js`
- `backend/routes/marketAgentServiceRoutes.js`
- `backend/lib/sessionPay.js`

Confirmed existing reuse points:

- global trace propagation already exists in `backend/appRuntime.js`
- capability discovery already exists at `GET /api/v1/capabilities`
- service execution already exists at `POST /api/services/:serviceId/invoke`
- service invocation audit already persists through `upsertServiceInvocation(...)`
- session pay retry logic already exists in `postSessionPayWithRetry(...)`

This means the MCP layer can remain a thin adapter.

## Key Decisions

### D1. Transport

Recommended:

- primary: Streamable HTTP on `/mcp`
- optional compatibility: SSE only if a concrete client requires it

Reason:

- better alignment with current MCP SDK direction
- better fit for remote connector usage
- less likely to create short-term protocol churn

### D2. Tool Naming

Tool names should be deterministic and derived from capability IDs.

Format:

- `ktrace__{capability_id}`

Examples:

- `ktrace__cap_listing_alert`
- `ktrace__cap_news_signal`
- `ktrace__cap_smart_money_signal`

Rules:

- lowercase only
- replace `-` with `_`
- one tool maps to one active capability record

### D3. Auth Model

Reuse the current backend auth model.

- keep API key and role enforcement unchanged
- MCP requests should be authorized through the same backend trust boundary
- no separate MCP auth subsystem in phase 1

### D4. Audit Model

Every MCP tool call must land in the same audit model as HTTP service invocation.

Minimum invariant:

- one MCP tool call -> one `service invocation` record

This keeps:

- `/api/service-invocations`
- receipt export
- evidence export
- trace-based audit inspection

fully consistent across HTTP and MCP callers.

### D5. Trace Propagation

Canonical trace mapping:

- `MCP call params._meta.traceId`
- `req.traceId`
- `invocation.traceId`
- workflow/evidence trace references

Fallback:

- if MCP caller does not provide `_meta.traceId`, backend generates one through existing trace helpers

### D6. Frontend Onboarding Mode

Phase 1 frontend guidance should describe remote MCP connection, not local config JSON.

Show:

- MCP endpoint URL
- auth header expectation
- transport type
- quick copy snippets for remote connector setup

Do not show by default:

- remote `claude_desktop_config.json`

Optional later addition:

- local `stdio` bridge and local desktop config snippet

## Proposed Delivery Plan

## Phase 0: Protocol And Scope Lock

Estimate:

- 0.5 day

Owner:

- backend owner with CC review

Deliverables:

- confirm transport choice
- confirm tool naming
- confirm onboarding mode
- confirm minimum `.well-known` response shape
- confirm no local `stdio` bridge in this pass

Approval gate:

- CC agrees frontend will target remote connector onboarding
- backend agrees MCP remains adapter-only

## Phase 1: MCP Server Core

Estimate:

- 1.5 to 2 days

Owner:

- backend owner

### Backend Changes

Add:

- `backend/mcp/mcpServer.js`
- `backend/mcp/toolsAdapter.js`
- `backend/mcp/invokeAdapter.js`

Wire in:

- `backend/appRuntime.js`

Add dependency:

- `@modelcontextprotocol/sdk`

Recommended helper dependency:

- `zod`

### `backend/mcp/mcpServer.js`

Responsibilities:

- initialize MCP server
- register tool list and tool call handlers
- expose `/mcp`
- normalize request context from Express into MCP runtime calls

Expected behavior:

- supports tool discovery
- supports tool invocation
- returns backend-correlated metadata such as `traceId`, `requestId`, and `invocationId`

### `backend/mcp/toolsAdapter.js`

Responsibilities:

- call or reuse `GET /api/v1/capabilities`
- filter to active capability records
- map each capability to MCP tool shape

Mapping rules:

- `name`: `ktrace__{capability_id}`
- `title`: capability `name`
- `description`: capability `description`
- `inputSchema`: normalized from capability `inputSchema`
- `annotations.readOnlyHint`: true for clearly read-only/query capabilities only

Important note:

Current capability `inputSchema` values are descriptive objects, not guaranteed strict JSON Schema.

Therefore the adapter should:

- accept simple schema-like objects from the catalog
- normalize them into valid MCP-compatible JSON Schema
- fall back to permissive object schema if a capability schema cannot be fully normalized

Recommended fallback shape:

```json
{
  "type": "object",
  "additionalProperties": true
}
```

### `backend/mcp/invokeAdapter.js`

Responsibilities:

- resolve tool name back to capability and service ID
- forward calls into the existing service invoke route
- preserve trace metadata
- transparently reuse existing x402 session pay behavior
- map backend responses into MCP tool result payloads

Call flow:

1. resolve `tool.name` to capability record
2. build invoke payload for `POST /api/services/:serviceId/invoke`
3. pass through supported fields:
   - `traceId`
   - `payer`
   - `sourceAgentId`
   - `targetAgentId`
   - `requestId`
   - `paymentProof`
   - `x402Mode`
4. if backend returns payment-required state and adapter is configured for hosted payment, reuse `postSessionPayWithRetry(...)`
5. return normalized MCP result
6. on all paths, preserve `traceId`

### Route Mounting In `appRuntime.js`

Add:

- `/mcp`

Suggested shape:

- mount after core middleware so existing `traceId` and auth behavior can be reused
- keep it outside unrelated route modules to avoid inflating route files further

## Phase 2: Discovery, Audit, And Error Alignment

Estimate:

- 1 day

Owner:

- backend owner

### Add `GET /.well-known/mcp.json`

Purpose:

- basic MCP discovery surface
- allows frontend health checks and external connector guidance

Minimum response should include:

- server name
- server version
- MCP endpoint URL
- transport type
- auth expectation
- tool naming convention

Example shape:

```json
{
  "name": "Kite Trace MCP Server",
  "version": "1.0.0",
  "endpoint": "/mcp",
  "transport": "streamable-http",
  "auth": {
    "type": "api-key-header",
    "header": "x-api-key"
  },
  "toolNamePrefix": "ktrace__"
}
```

This should stay intentionally minimal in the first pass.

### Audit Reuse

Requirement:

- every MCP tool call must result in an `upsertServiceInvocation(...)` write

Expected audit continuity:

- MCP caller can later inspect the same trace through:
  - `/api/service-invocations`
  - `/api/evidence/export?traceId=...`
  - existing receipt and evidence surfaces

### Trace Reuse

Requirement:

- `MCP _meta.traceId` is treated as the upstream trace seed

Fallback:

- backend-generated trace when absent

### Error Mapping

Backend HTTP errors should map into structured MCP tool failures without losing backend debugging context.

Recommended mapping:

- `401` -> unauthorized
- `403` -> forbidden / service guard blocked
- `404` -> capability or service not found
- `402` -> payment required or payment validation failure
- `409` -> payment or request mismatch
- `422` -> invocation failed with valid request shape
- `500` -> execution failure

Every mapped error should preserve:

- `traceId`
- `serviceId`
- `invocationId`
- `requestId` when available
- backend `reason`

## Phase 3: Frontend Status And Onboarding

Estimate:

- 1 to 1.5 days

Owner:

- CC

## Frontend Phase 1: Status Surface

Estimate:

- 1 day

Deliverables:

- new MCP status card in the frontend
- tool name display in service/capability UI

Recommended UI fields:

- `.well-known` reachable
- `/mcp` reachable
- transport type
- reported tool count
- last probe timestamp

Recommended tool row addition:

- `MCP Tool Name`
- value example: `ktrace__cap_listing_alert`

Backend dependency:

- `.well-known` endpoint must be available

## Frontend Phase 2: Connection Guide

Estimate:

- 0.5 day

Deliverables:

- MCP onboarding page or modal
- copyable endpoint URL
- auth guidance
- connector instructions

Recommended content:

- server URL
- required header name
- whether API key is required
- sample remote connector steps

Not recommended in this phase:

- generate `claude_desktop_config.json` for remote `/mcp`

If the product later adds a local `stdio` wrapper, a separate optional section can be added for:

- local desktop config JSON

## Detailed Backend Task Breakdown

## Task Group A: Foundation

1. Add MCP SDK dependency
2. Add `backend/mcp/` folder
3. Add MCP route mount in `backend/appRuntime.js`
4. Add lightweight tests or smoke checks for adapter modules

## Task Group B: Tool Discovery

1. Read active capabilities
2. Normalize capability schema to JSON Schema
3. Generate stable MCP tool names
4. Expose tool list through MCP server

Done when:

- all active `cap-*` records appear in MCP tool listing
- tool names are deterministic across restarts

## Task Group C: Tool Invocation

1. Resolve tool name to service
2. Build invoke payload
3. Reuse backend internal auth and trace handling
4. Reuse service invocation route
5. Normalize success response into MCP result
6. Normalize failure response into MCP error

Done when:

- a read-only/query capability can be called end to end through MCP
- a paid capability can be called end to end through MCP

## Task Group D: Payment Reuse

1. Detect payment-required response path
2. Reuse `postSessionPayWithRetry(...)`
3. Preserve request and proof references
4. Ensure final response includes payment artifacts

Done when:

- no MCP-only payment code path exists
- x402 session pay behavior matches HTTP behavior

## Task Group E: Audit And Discovery

1. Add `/.well-known/mcp.json`
2. Persist MCP calls through `upsertServiceInvocation(...)`
3. Verify trace continuity into evidence export

Done when:

- MCP and HTTP callers are indistinguishable at the service invocation audit layer except for caller metadata

## API And Data Contracts

## MCP Tool Result Contract

Successful MCP tool calls should return a stable high-level shape.

Recommended result fields:

```json
{
  "traceId": "trace_xxx",
  "requestId": "x402_xxx",
  "invocationId": "svc_call_xxx",
  "serviceId": "cap-listing-alert",
  "state": "success",
  "summary": "Listing alert unlocked by x402 payment.",
  "txHash": "0x...",
  "userOpHash": "0x...",
  "result": {},
  "receipt": {},
  "evidenceRef": "/api/evidence/export?traceId=trace_xxx"
}
```

Not every field is required on every tool, but the shape should stay stable.

## MCP Error Contract

Recommended error payload fields:

```json
{
  "error": "invoke_failed",
  "reason": "on-chain proof verification failed",
  "traceId": "trace_xxx",
  "requestId": "x402_xxx",
  "invocationId": "svc_call_xxx",
  "serviceId": "cap-news-signal"
}
```

## Risks And Mitigations

## Risk 1: Transport Mismatch

Risk:

- implementing only SSE creates short-term compatibility and maintenance risk

Mitigation:

- ship Streamable HTTP first
- add SSE compatibility only if a real client needs it

## Risk 2: Capability Schemas Are Not Strict JSON Schema

Risk:

- some current catalog schema fields are descriptive and may not map perfectly into MCP tool schemas

Mitigation:

- normalize what is valid
- fall back to permissive object schema
- keep tool descriptions rich enough to compensate in phase 1

## Risk 3: Duplicate Execution Logic

Risk:

- MCP adapter accidentally forks invoke, payment, or audit logic

Mitigation:

- enforce adapter-only architecture
- all business execution must still pass through existing service invoke route

## Risk 4: Frontend Generates Misleading Desktop Config

Risk:

- users copy a config snippet that does not actually work for remote MCP

Mitigation:

- remote connector guidance first
- local desktop config only after a real local bridge exists

## Risk 5: Slow RPC Or Bundler Causes MCP Calls To Look Flaky

Risk:

- session pay and proof verification already depend on Kite RPC and bundler latency

Mitigation:

- reuse current retry path
- preserve `traceId` in all error responses
- let frontend show degraded but explicit server status

## Acceptance Criteria

Backend acceptance:

- `GET /.well-known/mcp.json` returns a valid minimal server descriptor
- `/mcp` is reachable and lists active capability-derived tools
- at least one query capability works end to end through MCP
- at least one paid capability works end to end through MCP
- MCP calls create normal service invocation audit entries
- `traceId` survives through invocation, receipt, and evidence layers

Frontend acceptance:

- frontend can show MCP server reachability
- frontend can display MCP tool names for capability rows
- frontend can present a correct remote MCP onboarding guide
- frontend does not present invalid remote desktop JSON config

## Suggested Validation Checklist

Backend validation:

1. Start backend locally
2. `GET /api/v1/capabilities`
3. `GET /.well-known/mcp.json`
4. MCP tools/list returns expected tool count
5. Invoke one read-only capability
6. Invoke one paid capability
7. Query `/api/service-invocations?traceId=...`
8. Query `/api/evidence/export?traceId=...`

Frontend validation:

1. status card reflects `.well-known` availability
2. status card reflects `/mcp` availability
3. capability rows show `ktrace__{capability_id}` names
4. onboarding guide copies the correct endpoint and auth instructions

## Open Questions For Review

These should be closed during review before coding starts:

1. Do we want SSE compatibility in phase 1, or only Streamable HTTP?
2. Should hosted MCP invocation always auto-run session pay when possible, or only when explicitly enabled?
3. Do we want to mark specific capabilities as read-only in MCP metadata now, or wait for a cleaner capability taxonomy?
4. Does the frontend want onboarding as a full page, modal, or inline card?
5. Do we want a future optional local `stdio` bridge, or is remote-only enough for this milestone?

## Recommended Approval Outcome

Approve this plan if the team agrees with the following:

- backend MCP is an adapter layer, not a new execution engine
- transport is Streamable HTTP first
- payment and audit stay on the current backend rails
- frontend onboarding targets remote connector usage in phase 1

If CC strongly requires `claude_desktop_config.json` in phase 1, that should be treated as a scope change and moved into a separate optional phase for a local `stdio` bridge.
