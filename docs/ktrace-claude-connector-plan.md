# KTrace Claude Connector Plan

Last updated: 2026-03-19
Status: backend complete, frontend complete
Audience: Codex backend implementation + CC frontend implementation

## Status

- Backend status: complete
- Frontend status: complete

Backend implementation completed in this repo:

- Claude connector persistence is live:
  - `backend/lib/claudeConnectorAuth.js`
  - `backend/data/connector_install_codes.json`
  - `backend/data/connector_grants.json`
- Claude connector setup routes are live:
  - `GET /api/connector/claude/status`
  - `POST /api/connector/claude/install-code`
  - `POST /api/connector/claude/revoke`
- Claude connector MCP routes are live:
  - `GET /mcp/connect/:token`
  - `POST /mcp/connect/:token`
- Generic MCP remains live:
  - `GET /.well-known/mcp.json`
  - `POST /mcp`
  - `POST /mcp/stream`
- Owner-scoped MCP invoke resolution is fixed for both:
  - connector grants
  - account API keys

Backend verification completed:

- `npm --prefix backend run verify:mcp:claude-connector`
- `npm --prefix backend run verify:mcp:auth`
- `npm --prefix backend run verify:mcp:consumer`
- `npm --prefix backend run verify:ktrace:smoke`

Frontend implementation completed in this repo:

- Setup wizard Step 4 split into two panels (F1):
  - `ClaudeConnectorPanel` - recommended one-click path
  - `DeveloperSetupPanel` - advanced API key + manual config
- Frontend proxy routes for connector backend APIs:
  - `agent-network/app/api/setup/connector/claude/status/route.ts`
  - `agent-network/app/api/setup/connector/claude/install-code/route.ts`
  - `agent-network/app/api/setup/connector/claude/revoke/route.ts`
- Setup wizard updated:
  - `agent-network/components/setup/SetupWizardClient.tsx`
  - Progress bar label updated from "API Key" to "Connect"

## Summary

This document defines the next product step for making Kite Trace feel closer to a one-click Claude integration like mem, while keeping the current generic MCP path available for developers.

The product will support two MCP entry paths:

1. Claude-friendly connector path
   - target audience: normal Claude Desktop users
   - entrypoint: a short-lived install link that Claude can connect to directly
   - no manual `claude_desktop_config.json` editing in the recommended path

2. Generic MCP / developer path
   - target audience: developers and non-Claude MCP clients
   - entrypoint: `ktrace_sk_...` plus `/.well-known/mcp.json` and `/mcp/stream`
   - this remains supported and documented

Phase 1 decision:

- do not introduce full OAuth yet
- use a short-lived install code in the Claude connector URL
- first successful connector use upgrades that install code into a persistent server-side connector grant
- keep long-lived API keys for the generic MCP path only

## Product Decisions

### D1. Claude gets a dedicated one-click path

The recommended path for normal users is no longer "generate API key and edit a local config file."

Instead:

1. user completes `/setup`
2. user clicks `Connect to Claude`
3. backend creates a short-lived install code
4. UI shows a Claude-ready connector URL
5. user adds that URL in Claude custom connector
6. first successful connector use converts install code into a persistent connector grant

### D2. Generic MCP stays API-key based

The existing API-key model remains the official generic MCP integration path for:

- developers
- local configs
- non-Claude MCP clients
- automation and scripts

This means:

- `ktrace_sk_...` is not removed
- `/.well-known/mcp.json` and `/mcp/stream` remain stable
- Step 4 of `/setup` still includes an "Advanced / Developer" path

### D3. Connector path changes auth only, not execution

The Claude connector path must not fork:

- discovery logic
- capability catalog
- authority enforcement
- session pay
- receipt/evidence generation

It only changes how Claude gets authenticated to the existing MCP server.

### D4. Install code is short-lived and single-use

Security model for the Claude connector path:

- install code is short-lived
- install code is single-use for the first successful binding
- install code is tied to the current owner/account/session-authority context
- backend upgrades the install code into a persistent connector grant after first successful connect
- connector grant can be revoked independently

### D5. No silent fallback to demo-only behavior

This connector path must be compatible with the arbitrary-wallet `/setup` model.

It must not:

- depend on backend-managed demo owner keys
- require manual owner-key mapping on the server
- silently fall back to the old demo-owner compatibility flow

## Backend Scope (Codex)

### B1. Connector auth model

Add a new connector auth layer alongside the existing account API key model.

New concepts:

- `installCode`
  - short-lived
  - single-use
  - intended client = `claude`
  - tied to current owner and active setup/auth context
- `connectorGrant`
  - persistent server-side connector credential
  - created from first successful install-code use
  - role = `agent`
  - revocable without touching account API keys

Persistence may reuse the same JSON-store style as the current onboarding/account-key flows.

Minimum stored fields:

- `installCodeId`
- `grantId`
- `ownerEoa`
- `aaWallet`
- `authorityId`
- `policySnapshotHash`
- `createdAt`
- `expiresAt`
- `claimedAt`
- `lastUsedAt`
- `revokedAt`
- `client = claude`

### B2. New backend routes

Add connector-owned backend routes:

- `POST /api/connector/claude/install-code`
  - setup-authenticated user creates a short-lived install code
- `POST /api/connector/claude/revoke`
  - revoke an existing Claude connector grant
- `GET /api/connector/claude/status`
  - return whether a connector is active for the current owner

Add connector-facing MCP entrypoints:

- `GET /mcp/connect/:token`
- `POST /mcp/connect/:token`

Behavior:

- token may be an install code or a connector grant token
- first successful use of an install code claims it and upgrades it to a connector grant
- later use of the claimed connector path resolves through the grant
- all normal MCP requests continue to execute through the existing invoke/authority/evidence path

### B3. MCP auth resolution changes

Extend `backend/mcp/mcpServer.js` auth resolution order:

1. connector token from `/mcp/connect/:token`
2. existing account API key
3. existing static env key

Role behavior remains frozen:

- `tools/list` requires `viewer` or higher
- `tools/call` requires `agent` or higher

Connector grants should resolve as `agent` for the Claude path.

### B4. Setup API integration

`/setup` should continue using the arbitrary-wallet self-serve path and then expose connector actions only after:

- wallet login complete
- runtime imported/finalized
- session authorize complete
- authority/session state is healthy enough for paid calls

The connector install-code route must reject requests when setup is incomplete, with a stable JSON error explaining the missing prerequisite.

### B5. Generic MCP path remains unchanged

Do not break:

- `GET /.well-known/mcp.json`
- `POST /mcp/stream`
- account API key generation and revoke
- generic MCP documentation

The backend must support both:

- Claude connector path
- API-key developer path

at the same time.

### B6. Backend docs owned by Codex

Codex-owned doc updates:

- this file
- `docs/ktrace-onboarding-setup-plan.md`
- `docs/ktrace-mcp-consumer-onboarding-plan.md`
- `docs/kite-trace-mcp-consumer-guide.md`
- production runbook notes if nginx or public routes change

## Frontend Scope (CC)

CC should treat this section as the frontend source of truth.

### F1. `/setup` Step 4 split

Step 4 must be split into two clear panels:

1. `Connect to Claude`
   - recommended
   - show connector status
   - generate install link
   - copy connector URL
   - revoke connector

2. `Advanced / Developer Setup`
   - generate `ktrace_sk_...`
   - show local config instructions
   - clearly mark this as advanced / generic MCP

The recommended panel must appear first.

### F2. Claude connector UX

UI requirements:

- show a clear "Connect to Claude" CTA
- after generation, display a single Claude-ready connector URL
- explain that the link is short-lived and used only for first-time binding
- after successful binding, show an active connector state instead of asking the user to keep reusing the install link
- provide revoke + reconnect actions

### F3. Do not treat masked API key previews as usable secrets

Frontend must never:

- copy masked previews as if they were full secrets
- inject masked previews into generated config snippets
- present an existing `Active Key` preview as a valid Claude config value

If only a masked preview exists:

- explicitly state that the full secret cannot be recovered
- require revoke or rotation before showing a usable config snippet

### F4. Claude-specific wording

The recommended path should say:

- use Claude custom connector / Remote MCP flow
- do not edit config files unless using the advanced path

The advanced path should continue to document:

- Windows config location
- manual file creation if needed
- `cmd /c npx` on Windows

### F5. CC-owned frontend files

CC can implement this in the existing setup surface.

Primary likely frontend surfaces:

- `agent-network/components/setup/SetupWizardClient.tsx`
- `agent-network/app/mcp/page.tsx`
- any setup-owned proxy routes needed to call the new connector backend APIs

## Public Interfaces

New backend routes:

- `POST /api/connector/claude/install-code`
- `POST /api/connector/claude/revoke`
- `GET /api/connector/claude/status`
- `GET /mcp/connect/:token`
- `POST /mcp/connect/:token`

Existing generic MCP routes remain:

- `GET /.well-known/mcp.json`
- `POST /mcp/stream`

No change to the internal payment/authority/evidence contracts.

## Acceptance Criteria

### Claude connector path

- a normal user can finish `/setup`
- click `Connect to Claude`
- receive a connector URL
- add that URL in Claude custom connector
- list tools and call tools through Claude
- use paid calls without bypassing session pay or authority

### Generic developer path

- a developer can still generate `ktrace_sk_...`
- use `/.well-known/mcp.json`
- connect with `claude_desktop_config.json` or another MCP client

### Safety and revocation

- install code expires if unused
- install code cannot be reused after first successful claim
- connector grant can be revoked independently
- revocation immediately blocks further Claude MCP requests

### UX

- `/setup` no longer pushes normal users toward manual config editing first
- masked key previews are never presented as valid secrets
- generic MCP instructions remain available for advanced users

## Assumptions

- Full OAuth is deferred.
- Claude custom connector can accept a remote MCP URL but does not provide a good place for `x-api-key`, which is why the install-code URL path is needed.
- Generic MCP clients continue using API keys.
- Backend implementation is owned by Codex.
- Frontend implementation is owned by CC.

