# Kite Trace Quality & Audit Explorer Plan

Created: 2026-03-18

## Purpose

This plan scopes the next `ktrace` upgrade across three areas:

1. **Code Quality** — structural logging, error standardization, CORS hardening, CLI fix
2. **Functional Gaps** — flexible approval thresholds, SSE real-time push, A2A Agent Card endpoint
3. **Audit Explorer Frontend** — a live API explorer page on the showcase site that lets any visitor inspect a real job audit inline

Backend work (`backend/`) is assigned to **Codex**.
Frontend work (`agent-network/`) is assigned to **CC (Claude Code)**.

---

## Status Snapshot

### Completed
- Codex backend foundation pass is implemented:
  - P0-A structured logging
  - P0-B canonical error response
  - P0-C runtime CORS restriction
  - P0-D CLI help/dispatcher parity
- Codex functional backend slices implemented:
  - P1-A flexible approval thresholds with `approvalPolicy.matchedRule`
  - P1-C `GET /.well-known/agent.json`
- Backend verification has been run against the new surfaces:
  - request/response `traceId` + `requestId` headers
  - canonical approval/job/public audit error envelopes
  - CORS allowlist behavior
  - approval-threshold rule matching
  - Agent Card payload
  - CLI parsing of the new error shape

### In Progress
- CC frontend work has not started yet.
- `P1-B` remains intentionally deferred.

### Ready Now
- CC can start `P2-A Audit Explorer` immediately.
- CC can start `P2-B Approval Inbox Polling UX` immediately.
- `P2-C Audit Explorer deep-link` can start after `P2-A` UI structure lands.

---

## P0 — Code Quality (Backend: Codex)

These are the backend reliability and correctness fixes that should land before the Vik meeting or any public demo. The scope here is intentionally narrow: use the current runtime and route structure, do not do a repo-wide refactor.

### P0-A Structured Logging

**Problem:** Backend logging is still mostly ad-hoc `console.*` output. High-signal failure paths do not consistently include a parseable request identifier or structured metadata.

**Implementation shape:**

- Add `backend/lib/logger.js` with minimal `info`, `warn`, and `error` helpers that emit JSON lines:
  ```json
  {
    "level": "error",
    "timestamp": "2026-03-18T00:00:00.000Z",
    "requestId": "req_xxx",
    "traceId": "req_xxx",
    "component": "approval-route",
    "message": "approval_request_complete_failed",
    "meta": {}
  }
  ```
- Reuse the existing `traceId` ingress in `backend/runtime/server.js` instead of inventing a second ID system:
  - set `req.requestId = req.traceId`
  - return both `x-trace-id` and `x-request-id` headers on every request
- Mask any sensitive value before logging:
  - API keys
  - approval tokens
  - private keys
  - bearer tokens
  - query-param admin tokens for SSE handshakes if present
- Replace only the critical route-level `console.error` and startup/shutdown failure logs in this pass:
  - `backend/server.js`
  - `backend/routes/coreIdentityApprovalRoutes.js`
  - `backend/routes/jobLane/jobMutationRoutes.js`
  - `backend/routes/jobLane/jobReadRoutes.js`
- Keep non-critical `console.log` status lines unchanged for now.

**Output:** Critical backend failures log as parseable JSON with `requestId` and `traceId`.

---

### P0-B Standardized Error Response Shape

**Problem:** Error envelopes on approval, job, and public audit surfaces still vary between `{ error, reason, traceId }` and other ad-hoc shapes. That makes agent-side parsing brittle.

**Implementation shape:**

- Add `backend/lib/errorResponse.js` with a single helper:
  - `sendErrorResponse(req, res, { status, code, message, detail })`
- Standard shape for this pass:
  ```json
  {
    "ok": false,
    "error": {
      "code": "job_not_found",
      "message": "Job was not found.",
      "detail": {}
    },
    "requestId": "req_xxx",
    "traceId": "req_xxx"
  }
  ```
- Apply only to the canonical inspection and decision surfaces Vik is likely to hit:
  - `backend/routes/coreIdentityApprovalRoutes.js`
  - `backend/routes/jobLane/jobMutationRoutes.js`
  - `backend/routes/jobLane/jobReadRoutes.js`
- Keep 2xx success shapes unchanged in this pass.
- Preserve HTTP status codes exactly as they work today.

**Output:** Approval + job + public audit routes return one canonical error shape while preserving current success payloads.

---

### P0-C CORS Restriction

**Problem:** Runtime CORS is currently `app.use(cors())`, which is effectively open. That is especially weak around admin and approval surfaces.

**Implementation shape:**

- Parse `KTRACE_ALLOWED_ORIGINS` in `backend/runtime/config.js` as a normalized CSV list.
- Replace open CORS in `backend/runtime/server.js` with a dynamic origin function:
  - allow requests with no `Origin` header
  - if `KTRACE_ALLOWED_ORIGINS` is empty, preserve permissive behavior for local/dev
  - if `KTRACE_ALLOWED_ORIGINS` is set, allow only exact matches
- Add an extra rule for browser access to admin-style approval surfaces:
  - if `KTRACE_ADMIN_KEY` is set and the request targets `/api/approvals`
  - wildcard browser CORS is not accepted
  - browser requests must come from an explicit allowed origin
- Do not change non-browser server-to-server access.

**Output:** CORS is environment-configurable, and browser access to approval/admin surfaces is no longer implicitly open when admin auth is configured.

---

### P0-D Fix Unimplemented CLI Paths

**Problem:** The CLI still has a generic not-implemented fallback path in `backend/cli/output.js`. Even if current catalog entries are marked implemented, help and dispatcher parity should be enforced so no help-visible command can ever fall through to that placeholder.

**Implementation shape:**

- Audit these files together:
  - `backend/cli/commandCatalog.js`
  - `backend/cli/lib/commandDispatcher.js`
  - `backend/cli/output.js`
- Rule for this pass:
  - every command shown in `ktrace --help` must dispatch to a real handler
  - unknown commands should fail as parser/usage errors, not "not implemented"
- If any help-visible command still falls through:
  - wire the handler if the backend already supports it
  - otherwise remove it from help/catalog for now

**Output:** `ktrace --help` lists only commands that resolve to real handlers, and the not-implemented placeholder is no longer reachable through documented commands.

---

## P1 — Functional Gaps (Backend: Codex)

These are the backend feature gaps worth closing in the same implementation line, but still without broad refactors.

### P1-A Flexible Approval Thresholds

**Problem:** Job approval policy is still driven by one global threshold, while the current implementation logic already lives inside `backend/routes/jobLane/jobApprovalHelpers.js`. Real deployments need provider/capability-specific rules.

**Implementation shape:**

- Extend the existing approval policy logic in `backend/routes/jobLane/jobApprovalHelpers.js`.
- Parse optional `KTRACE_APPROVAL_RULES` in `backend/runtime/config.js`.
- Recommended rule shape:
  ```json
  [
    { "provider": "technical-agent-real", "capability": "cap-dex-market", "threshold": 10 },
    { "capability": "cap-news-signal", "threshold": 50 },
    { "provider": "*", "capability": "*", "threshold": 100 }
  ]
  ```
- Matching order is fixed:
  1. exact `provider + capability`
  2. exact `capability`
  3. exact `provider`
  4. wildcard `*`
  5. fallback to `KTRACE_JOB_APPROVAL_THRESHOLD`
- The comparison remains against the existing numeric escrow/job amount in settlement-token units for this pass.
  - no FX conversion
  - current deployments assume USDC-like settlement values
- Surface the chosen rule in job approval payloads and job audit as:
  - `approvalPolicy.matchedRule.provider`
  - `approvalPolicy.matchedRule.capability`
  - `approvalPolicy.matchedRule.threshold`
  - `approvalPolicy.matchedRule.source`

**Output:** Approval thresholds are configurable per provider/capability, and the matched rule is visible in approval and audit data.

---

### P1-B Approval Inbox Real-Time Push

**Decision:** Defer this slice for now. It is not required for the current CLI-first / backend-first MVP.

**Why deferred:**

- Current approval review still works with explicit refresh.
- The existing `broadcastEvent(...)` hook in `appRuntime.impl.js` is a no-op, so shipping SSE would require a fresh backend event system, token handshake, and reconnect semantics.
- That cost is not justified until we have a real operator workflow or demo requirement that depends on live approval pushes.

**Phase 1 replacement:**

- Do not build backend SSE endpoints in this pass.
- Frontend approval inbox should use polling against the existing approval list endpoint.
- Recommended polling interval:
  - foreground: every 30 seconds
  - manual refresh remains available
- Optional later trigger to revive this item:
  - a demo explicitly needs approvals to appear live without refresh
  - an operator is actively monitoring the inbox for long periods and polling becomes a real UX problem

**CC handoff for now:** treat `P2-B` as a polling UX improvement, not as an EventSource integration.

**Output:** Approval inbox remains functionally correct in phase 1 without adding new backend stream infrastructure.

---

### P1-C A2A-Compatible Agent Card Endpoint

**Problem:** There is still no simple public discovery card for external agents to learn what `ktrace` exposes.

**Implementation shape:**

- Add a new route module, for example `backend/routes/agentCardRoutes.js`.
- Register it from `backend/appRuntime.impl.js` like the other route modules.
- Expose:
  - `GET /.well-known/agent.json`
  - public, no auth
- Response should be derived from current runtime config and existing public APIs, not hard-coded magic values:
  - `name`
  - `description`
  - `version`
  - `url` from `BACKEND_PUBLIC_URL` when present
  - a small capabilities list for the currently stable surfaces
- Keep header naming aligned with the actual backend auth extractor:
  - `"header": "x-api-key"`
- Minimal advertised capabilities for this pass:
  - `job.create` -> `POST /api/jobs`
  - `job.audit.public` -> `GET /api/public/jobs/:jobId/audit`
  - `job.audit.publicByTrace` -> `GET /api/public/jobs/by-trace/:traceId/audit`
  - `approval.read` -> `GET /api/approvals/:approvalId`
- Do not advertise endpoints that are frontend-only redirects or still unstable.

**Output:** External agents can fetch `/.well-known/agent.json` and discover a small, accurate, public-facing `ktrace` capability card.

---

## P2 — Audit Explorer Frontend (CC)

A new section on the showcase homepage that lets any visitor paste a Job ID and see the live audit data rendered inline — no login, no wallet, just paste and see.

### P2-A Audit Explorer Section on Showcase Homepage

**Location:** New section on `/` (ShowcasePageClient), below the existing "How It Works" section.

**Design (warm cream theme, consistent with existing):**
- Section header: "Audit Any Job" (Crimson Text serif, `#3a4220` olive)
- Subheader: "Paste a Job ID to inspect its full lifecycle, delivery standard, and on-chain evidence."
- Input row: text input (JetBrains Mono) + "Inspect" button (olive fill)
- Below input: renders `<JobAuditView>` inline — the same component already used at `/jobs/[jobId]`
- Loading state: skeleton cards (three placeholder blocks)
- Error state: "Job not found or not yet anchored" with a subtle amber banner
- On first load (no ID entered): show a static "example" teaser — a truncated mock audit card with a "Try it →" CTA that populates the input with a real demo job ID (read from env `NEXT_PUBLIC_DEMO_JOB_ID`)

**Fetch logic:**
```ts
// Hits the existing public endpoint — no auth required
GET /api/public/jobs/:jobId/audit
```

**Component:** `agent-network/components/showcase/AuditExplorer.tsx`

---

### P2-B Approval Inbox Polling UX

**Location:** `agent-network/components/approvals/ApprovalsInboxClient.tsx`

**Work:**
- After admin key is entered and inbox loads, keep fetching the existing approvals list endpoint on a timer.
- Recommended behavior:
  - foreground polling every 30 seconds
  - keep the existing manual refresh button
  - avoid overlapping requests if the previous fetch is still in flight
- UX additions for this pass:
  - show a small "auto-refresh every 30s" indicator in the inbox header
  - update "Last fetched" after each successful poll
  - if a newly fetched approval was not in the previous list, briefly highlight that row
  - if polling fails, keep the last known list and show a subtle stale-state hint instead of wiping the page

**Depends on:** no new backend work; uses the current `GET /api/approvals` path with `X-Admin-Key`.

---

### P2-C Audit Explorer Link from Approval Panel

**Location:** `agent-network/components/approval/ApprovalPageClient.tsx` → `JobApprovalPanel`

**Work:**
- The "audit links" card already exists in `JobApprovalPanel` (renders `links.publicJobAuditUrl`)
- Add a second link: "Inspect in Audit Explorer →" that deep-links to `/?jobId=<jobId>#audit-explorer`
- The homepage audit explorer section should accept a `jobId` query param / hash and auto-populate + auto-run on mount

**Output:** Reviewer on the approval page can click straight into the inline audit explorer.

---

## Current Handoff

**Codex backend status:** phase 1 backend dependencies are implemented and validated for `P0`, `P1-A`, and `P1-C`.

**CC can start now:**
- `P2-A Audit Explorer`
- `P2-B Approval Inbox Polling UX`

**CC should wait for:**
- `P2-C Audit Explorer deep-link`
  Start this after `P2-A` lands, because it depends on the homepage explorer section existing.

**Backend assumptions CC should use right now:**
- `P1-B` remains deferred. Do not wait for SSE or `stream-token`.
- Approval inbox should use the existing `GET /api/approvals` path with `X-Admin-Key`.
- Audit explorer should use the existing public job audit endpoint.

---

## Implementation Order

```
P0-A  →  P0-B  →  P0-C  →  P0-D   (Codex foundation pass)
P1-C                                (Codex, easiest independent backend slice)
P1-A                                (Codex, extends current job approval policy logic)
P1-B                                (Deferred; not in phase 1)

P2-A                                (CC, starts immediately — no backend dependency)
P2-B                                (CC, polling-only; no backend dependency)
P2-C                                (CC, depends on P2-A landing)
```

Recommended Codex order:

1. P0-A logging and request ID aliasing
2. P0-B canonical error helper on approval/job/public audit routes
3. P0-C runtime CORS restriction
4. P0-D CLI catalog/dispatcher parity cleanup
5. P1-C public agent card
6. P1-A flexible approval rules
7. P1-B deferred unless a live approval demo becomes a concrete requirement

CC can begin P2-A and P2-B in parallel with Codex doing P0/P1 work.

---

## CC Ready Checklist (what CC needs confirmed before each piece)

**Frontend sync note:** CC should stop waiting for backend SSE. For phase 1, approval inbox live-ness is satisfied by polling the existing approvals endpoint.

**Current status:** treat `P2-A` and `P2-B` as ready now. `P2-C` is backend-ready but still depends on `P2-A` landing first on the frontend side.

| Task | Dependency |
|---|---|
| P2-A Audit Explorer | `GET /api/public/jobs/:id/audit` — already live ✓ |
| P2-B Approval Polling UX | existing `GET /api/approvals` with `X-Admin-Key` |
| P2-C Deep-link | P2-A section live |

---

## Files CC Will Touch

- `agent-network/components/showcase/AuditExplorer.tsx` — new component
- `agent-network/components/showcase/ShowcasePageClient.tsx` — add AuditExplorer section
- `agent-network/components/approvals/ApprovalsInboxClient.tsx` — polling UX improvement
- `agent-network/components/approval/ApprovalPageClient.tsx` — deep-link addition
- `agent-network/app/page.tsx` — query param pass-through to ShowcasePageClient if needed

## Files Codex Will Touch

- `backend/lib/logger.js` — new
- `backend/lib/errorResponse.js` — new
- `backend/runtime/config.js` — parse allowed origins and approval rules
- `backend/runtime/server.js` — CORS config + `requestId` aliasing
- `backend/server.js` — startup/shutdown logging cleanup only
- `backend/appRuntime.impl.js` — route registration and shared deps for new backend slices
- `backend/routes/coreIdentityApprovalRoutes.js` — canonical error shape
- `backend/routes/jobLane/jobApprovalHelpers.js` — flexible approval threshold matching
- `backend/routes/jobLane/jobMutationRoutes.js` — canonical error shape
- `backend/routes/jobLane/jobReadRoutes.js` — canonical error shape on audit/public audit reads
- `backend/cli/output.js` — remove reachable not-implemented placeholder path
- `backend/cli/lib/commandDispatcher.js` — enforce catalog/handler parity
- `backend/cli/commandCatalog.js` — remove or hide any help-visible non-dispatchable command
- `backend/routes/agentCardRoutes.js` — new (serves `/.well-known/agent.json`)
