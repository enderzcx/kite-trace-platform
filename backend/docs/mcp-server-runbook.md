# MCP Server Runbook

Last updated: 2026-03-18 (Asia/Shanghai)

## Goal

- Keep the remote MCP server stable for frontend status views, CC onboarding, and external MCP client demos.
- Treat `/mcp` as a thin adapter over the existing capability catalog and service invoke flow.
- Treat normal MCP paid execution as AA-native consumer execution.

## Public Interface Freeze

- `GET /.well-known/mcp.json`
  - frozen fields: `name`, `version`, `endpoint`, `transport`, `auth`, `toolNamePrefix`
- `POST /mcp`
  - transport: Streamable HTTP
  - tool naming: `ktrace__{capability_id}`
- `GET /api/service-invocations`
  - caller fields used by MCP audits: `sourceAgentId`, `targetAgentId`

## Required Runtime Environment

### MCP endpoint basics

- `PORT`
- `BACKEND_PUBLIC_URL`
- capability and invocation persistence under `backend/data/`

### Auth modes

- Local dev-open:
  - `KITECLAW_AUTH_DISABLED=1`
- Protected mode:
  - `KITECLAW_AUTH_DISABLED=0`
  - `KITECLAW_API_KEY_VIEWER`
  - `KITECLAW_API_KEY_AGENT`
  - optional `KITECLAW_API_KEY_ADMIN`

### Paid capability dependencies

- Kite RPC and bundler:
  - `KITEAI_RPC_URL`
  - `KITEAI_BUNDLER_URL`
  - `KITE_ENTRYPOINT_ADDRESS`
- Session runtime material:
  - `KITECLAW_SESSION_KEY`
  - `KITECLAW_SESSION_ADDRESS`
  - `KITECLAW_SESSION_ID`
- Backend signer / settlement helpers:
  - `KITECLAW_BACKEND_SIGNER_PRIVATE_KEY`
  - `KITE_AGENT2_AA_ADDRESS`
- Retry and reliability knobs:
  - `KITE_SESSION_PAY_RETRIES`
  - `KITE_BUNDLER_RPC_TIMEOUT_MS`
  - `KITE_BUNDLER_RPC_RETRIES`
  - `KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS`

Reference details stay in:

- `backend/docs/aa-session-policy.md`
- `backend/docs/session-pay-reliability-runbook.md`
- `docs/ktrace-full-stack-aa-plan.md`

## Verification Commands

- `npm --prefix backend run verify:mcp:smoke`
- `npm --prefix backend run verify:mcp:auth`
- `npm --prefix backend run verify:mcp:consumer`
- `npm --prefix backend run verify:mcp:paid`
- `npm --prefix backend run verify:mcp:release`

## Verification Commands

- Static checks:
  - `node --check .\mcp\mcpServer.js`
  - `node --check .\mcp\toolsAdapter.js`
  - `node --check .\mcp\invokeAdapter.js`
- Deterministic harness smoke:
  - `npm run verify:mcp:smoke`
- Deterministic auth matrix:
  - `npm run verify:mcp:auth`
- Deterministic consumer authority coverage:
  - `npm run verify:mcp:consumer`
- Live paid-path check:
  - `npm run verify:mcp:paid`
  - optional strict mode: `MCP_REQUIRE_PAID_SUCCESS=1 npm run verify:mcp:paid`
- Full backend release check:
  - `npm run verify:mcp:release`

## Common Failure Signals

- `coingecko_rate_limited`
  - Upstream CoinGecko limit hit. Retry later or reduce demo frequency.
- `coingecko_request_aborted`
  - Upstream request timed out or transport aborted before completion.
- `Missing or invalid API key.`
  - MCP auth is enabled and the client is not sending a valid viewer/agent key.
- `Role "viewer" cannot access "agent" MCP method.`
  - Viewer key is trying to call `tools/call`.
- `authority_revoked` and other frozen authority denial codes
  - MCP is reaching the normal consumer authority gate and correctly failing before payment.
- `session_runtime_not_ready`
  - MCP paid-path verification cannot proceed until `/api/session/runtime` shows an AA wallet and session key.
- Bundler or proof verification failures
  - Check `/api/session/pay/config`, `/api/session/pay/metrics`, and the session-pay runbook.

## Release Checklist

1. `GET /.well-known/mcp.json` is reachable from the target environment.
2. `npm run verify:mcp:smoke` passes.
3. `npm run verify:mcp:auth` passes in protected mode.
4. `npm run verify:mcp:consumer` passes and proves:
   - `viewer` can list tools
   - `viewer` cannot call tools
   - `agent` paid calls emit authority-aware receipt/evidence
   - authority-denied MCP calls fail with frozen machine-readable codes
5. `npm run verify:mcp:paid` either succeeds or exits with an explicit environment blocker that is documented.
6. `npm run verify:mcp:paid` confirms `/api/receipt/:requestId`, `/api/evidence/export?traceId=...`, and authority metadata inside internal evidence after a paid MCP call.
7. `/api/service-invocations` shows `sourceAgentId = mcp-client` for MCP-originated calls.
8. Frontend status card is pointed at the real `.well-known` endpoint only after backend smoke passes.
