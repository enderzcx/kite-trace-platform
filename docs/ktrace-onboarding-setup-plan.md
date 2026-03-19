# Kite Trace User Onboarding and Setup Plan

Last updated: 2026-03-19

## Status

- Backend status: complete
- Frontend status: complete
- `/setup` arbitrary-wallet self-serve chain is live
- Claude-friendly one-click connector is live (see `docs/ktrace-claude-connector-plan.md`)
- Sign-spec reference is frozen at `docs/session-sign-spec.md`
- Canonical source of truth for the upgrade is `docs/ktrace-arbitrary-wallet-setup-upgrade-plan.md`

## Summary

Goal: let a new user self-serve from first visit to a working MCP setup.

Target flow:

1. Connect wallet
2. Sign an onboarding login challenge
3. Prepare AA bootstrap parameters
4. Deploy or fund the AA wallet and create the session from the user's wallet
5. Finalize runtime import, then authorize the session with the existing `signMessage` contract
6. Generate an account-scoped MCP API key
7. Paste the MCP config into Claude Desktop or another MCP client

This iteration keeps the current execution model:

- consumer authority remains the execution control plane
- MCP remains a thin adapter over capability discovery and service invoke
- session authorization stays on `signMessage`
- phase 1 does not migrate to EIP-712
- normal product execution remains AA-native
- owner EOA is only for setup / grant / revoke / recovery

## Current product gap

Before the arbitrary-wallet upgrade, the repo had most backend primitives but not a full self-serve setup chain:

- session runtime ensure exists for backend-managed demo owners
- session authorize exists
- MCP exists
- static env API keys exist
- onboarding auth and account API keys now exist
- arbitrary-wallet AA bootstrap still needs the `prepare -> wallet tx -> finalize` path to be the canonical `/setup` flow

The remaining work in this plan is to finish the arbitrary-wallet upgrade and retire `/api/session/runtime/ensure` from the normal `/setup` path.

## Backend scope (Codex)

### B0. Wallet bootstrap auth

New backend routes:

- `POST /api/onboarding/auth/challenge`
- `POST /api/onboarding/auth/verify`
- `POST /api/onboarding/auth/logout`

Contract:

- login uses a one-time nonce challenge plus wallet `signMessage`
- verify sets a short-lived HTTP-only cookie
- cookie name: `ktrace_onboard`
- cookie policy: `HttpOnly`, `SameSite=Lax`, `Secure` in production
- default TTL: 30 minutes

Implementation notes:

- onboarding challenge state is persisted in `backend/data/onboarding_challenges.json`
- challenge rows are single-use and expire automatically
- owner identity for setup is established by the verified cookie, not by arbitrary request body fields

### B1. Shared auth extension

The auth layer now supports three credential sources:

- static env API keys
- onboarding cookie
- account API keys

Normalized request context:

- `req.authRole`
- `req.authSource`
- `req.authOwnerEoa`
- `req.auth`
- `req.accountCtx`

Important rule:

- onboarding cookie is only accepted on setup-owned routes
- MCP does not accept onboarding cookies

### B2. Session setup integration

Setup now reuses the existing session chain instead of introducing a second flow.

Routes:

- `POST /api/session/runtime/ensure`
- `POST /api/v1/session/authorize`

Auth model:

- static `agent` / `admin` still work
- onboarding cookie is now also accepted

Owner scoping:

- when the request is authenticated by onboarding cookie, backend derives `owner` and `userEoa` from the cookie
- setup requests cannot impersonate another owner through body fields

### B3. Phase 1 sign contract

Phase 1 stays on the current session sign model:

- wallet signs a text message with `signMessage`
- no `eth_signTypedData_v4`
- no EIP-712 migration in this slice

Reference:

- `docs/session-sign-spec.md`

Backward compatibility:

- backend verify path accepts the full phase 1 message
- backend still tolerates the legacy payload-only message for compatibility
- new frontend work should use the full message with the trailing `userEoa` line

### B4. Account API key lifecycle

New routes:

- `GET /api/account/api-key`
- `POST /api/account/api-key/generate`
- `POST /api/account/api-key/revoke`

Phase 1 rules:

- self-serve access requires onboarding cookie
- operator access may still use static admin or agent credentials
- one active key per owner
- rotating a key revokes the previous active key
- stored rows contain only key hash and metadata, never the full secret

Key format:

- returned secret prefix: `ktrace_sk_`

Stored metadata:

- `keyId`
- `ownerEoa`
- `role`
- `prefix`
- `maskedPreview`
- `createdAt`
- `lastUsedAt`
- `revokedAt`

Persistence:

- `backend/data/account_api_keys.json`

### B5. MCP account-key support

`/mcp` now reuses the same shared auth layer.

Role semantics stay frozen:

- `tools/list` requires `viewer` or higher
- `tools/call` requires `agent` or higher

Phase 1 decision:

- self-serve generated account keys resolve to `agent`
- MCP execution path remains:
  - capability discovery
  - service invoke
  - authority enforcement
  - receipt and evidence

No MCP-specific payment or authority path is introduced in this slice.

### B6. Backend docs and env contract

Backend also owns:

- `docs/session-sign-spec.md`
- onboarding env variables in `backend/.env.example`
- onboarding env variables in `backend/.env.production.example`

New env knobs:

- `KTRACE_ONBOARDING_COOKIE_NAME`
- `KTRACE_ONBOARDING_COOKIE_SECRET`
- `KTRACE_ONBOARDING_COOKIE_TTL_MS`
- `KTRACE_ONBOARDING_CHALLENGE_TTL_MS`
- `KTRACE_ONBOARDING_CHALLENGE_MAX_ROWS`

## Frontend dependencies (CC)

Frontend can now build `/setup` against these backend contracts:

- wallet login:
  - `POST /api/onboarding/auth/challenge`
  - `POST /api/onboarding/auth/verify`
- session setup:
  - `POST /api/session/runtime/ensure`
  - `POST /api/v1/session/authorize`
- API key setup:
  - `GET /api/account/api-key`
  - `POST /api/account/api-key/generate`
  - `POST /api/account/api-key/revoke`
- capability listing:
  - `GET /api/v1/capabilities?limit=500`
- MCP endpoint discovery:
  - `GET /.well-known/mcp.json`

Frontend should not implement its own auth or policy logic. It only drives backend contracts.

## Delivery order

Backend must land first:

1. onboarding auth
2. shared auth extension
3. setup route integration
4. account API key lifecycle
5. MCP auth reuse
6. sign spec and env docs

Backend delivery status:

- done: onboarding auth
- done: shared auth extension
- done: setup route integration
- done: account API key lifecycle
- done: MCP auth reuse
- done: sign spec and env docs

Frontend can then wire:

- homepage CTA to `/setup`
- wallet connect step
- rules form
- session authorize step using `signMessage`
- API key reveal and revoke
- MCP config copy surface

Frontend delivery status:

- done: homepage CTA to `/setup`
- done: wallet connect step (Step 0 — `ConnectStep`)
- done: AA wallet prepare + fund (Step 1 — `FundStep`)
- done: session authorize with `signMessage` (Step 2 — `AuthorizeStep`)
- done: Claude connector one-click panel (Step 3 — `ClaudeConnectorPanel`)
- done: developer API key + MCP config (Step 3 — `DeveloperSetupPanel`)
- done: proxy routes for all backend setup APIs

## Acceptance criteria

### Backend

- `POST /api/onboarding/auth/challenge` returns a valid signable message
- `POST /api/onboarding/auth/verify` sets the onboarding cookie
- onboarding cookie can call `POST /api/session/runtime/ensure`
- onboarding cookie can call `POST /api/v1/session/authorize`
- onboarding owner cannot be overridden by request body impersonation
- `GET /api/account/api-key` returns metadata or `404`
- `POST /api/account/api-key/generate` returns the full key once and stores only the hash
- `POST /api/account/api-key/revoke` invalidates the key
- revoked account key receives `401` on `/mcp`
- generated account key can access MCP as `agent`

Backend verification status:

- passed: `npm --prefix backend run verify:onboarding:setup`
- passed: `npm --prefix backend run verify:mcp:auth`
- passed: `npm --prefix backend run verify:mcp:consumer`
- passed: `npm --prefix backend run verify:ktrace:smoke`

### Frontend

- `/setup` can complete the full happy path without CLI
- setup step 3 uses `signMessage`, not typed data
- generated MCP snippet is ready to paste into Claude Desktop

## Decisions closed in this revision

- Q1: session authorize uses `signMessage`, not EIP-712
- Q2: `/api/session/runtime/ensure` is not anonymous; setup reaches it through onboarding cookie
- Q3: wallet bootstrap session is server-issued HTTP-only cookie
- Q4: this slice stays on the current Kite-oriented chain assumptions

