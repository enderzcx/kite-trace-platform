# Kite Trace MCP Consumer Guide

Updated: 2026-03-18
Audience: external consumer-agent builders

## Summary

Kite Trace lets a consumer agent use MCP as the protocol surface for discovery and tool calls.

Consumer MCP onboarding does not require `ERC-8004`.

The execution path stays the same as the rest of the backend:

`MCP client -> /mcp -> tools/call -> /api/services/:serviceId/invoke -> authority validation -> session pay -> receipt/evidence`

AA-native note:

- owner EOA is only for setup and authorization
- normal MCP paid execution uses the consumer AA wallet
- do not model MCP paid calls as owner-signer execution

## What You Need

### For Discovery

- the backend base URL
- `/.well-known/mcp.json`
- a `viewer` API key or higher when auth is enabled

### For Tool Calls

- the backend base URL
- `POST /mcp`
- an `agent` API key or higher when auth is enabled

### For Paid Tool Calls

- a ready session runtime
- an active consumer authority policy that allows the provider, capability, recipient, and amount

You do not need:

- mandatory `ERC-8004`

## Step 1: Discover The MCP Server

Request:

```http
GET /.well-known/mcp.json
```

Expected fields:

- `endpoint`
- `transport`
- `auth`
- `toolNamePrefix`

Typical response:

```json
{
  "name": "Kite Trace MCP Server",
  "version": "1.0.0",
  "endpoint": "http://127.0.0.1:3001/mcp",
  "transport": "streamable-http",
  "auth": {
    "type": "api-key-header",
    "header": "x-api-key",
    "listRole": "viewer",
    "toolCallRole": "agent"
  },
  "toolNamePrefix": "ktrace__"
}
```

## Step 2: List Tools

`tools/list` requires `viewer` or higher.

Minimal JSON-RPC example:

```json
{
  "jsonrpc": "2.0",
  "id": "list-1",
  "method": "tools/list",
  "params": {}
}
```

Example `curl`:

```bash
curl -s http://127.0.0.1:3001/mcp \
  -H "accept: application/json, text/event-stream" \
  -H "content-type: application/json" \
  -H "x-api-key: <VIEWER_OR_HIGHER_KEY>" \
  -d '{"jsonrpc":"2.0","id":"list-1","method":"tools/list","params":{}}'
```

Tool names follow:

- `ktrace__{capability_id}`

## Step 3: Call A Tool

`tools/call` requires `agent` or higher.

Minimal JSON-RPC example:

```json
{
  "jsonrpc": "2.0",
  "id": "call-1",
  "method": "tools/call",
  "params": {
    "name": "ktrace__svc_price",
    "arguments": {
      "pair": "BTCUSDT",
      "payer": "0x1111111111111111111111111111111111111111",
      "_meta": {
        "traceId": "mcp_consumer_demo_001"
      }
    }
  }
}
```

Example `curl`:

```bash
curl -s http://127.0.0.1:3001/mcp \
  -H "accept: application/json, text/event-stream" \
  -H "content-type: application/json" \
  -H "x-api-key: <AGENT_OR_HIGHER_KEY>" \
  -d '{"jsonrpc":"2.0","id":"call-1","method":"tools/call","params":{"name":"ktrace__svc_price","arguments":{"pair":"BTCUSDT","payer":"0x1111111111111111111111111111111111111111","_meta":{"traceId":"mcp_consumer_demo_001"}}}}'
```

Successful results return normal MCP content plus structured fields such as:

- `traceId`
- `requestId`
- `invocationId`
- `serviceId`
- `state`
- `receipt`
- `evidenceRef`

## Paid Call Behavior

For paid tools, Kite Trace validates consumer authority before payment.

Evaluation order:

1. authenticate the MCP request
2. resolve the tool to a service invoke target
3. validate consumer authority
4. if denied, fail before payment
5. if allowed, run the normal paid invoke flow
6. expose receipt and evidence through the standard audit routes

This means MCP does not bypass:

- consumer authority policy
- session pay
- receipt/evidence generation

## Audit Lookups After A Paid Tool Call

After a successful call, use the structured fields returned by `tools/call`.

Lookup paths:

- `GET /api/receipt/:requestId`
- `GET /api/evidence/export?traceId=...`
- `GET /api/public/evidence/:traceId`

What to expect:

- receipt includes `authorityId` and `policySnapshotHash`
- internal evidence includes `authorization.authorityId`, `authorization.policySnapshotHash`, and `authorization.validationDecision`
- public evidence keeps legacy audit fields and adds `authoritySummary` plus `policySnapshotHash`

## Common Failure States

### Auth Failures

- `Missing or invalid API key.`
  - the request is missing a valid backend key
- `Role "viewer" cannot access "agent" MCP method.`
  - the client tried to use `tools/call` with only viewer access

### Authority Failures

Machine-readable denial codes may include:

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

These failures happen before payment.

### Session Or Upstream Failures

- `session_runtime_not_ready`
  - paid execution is not ready yet
- `payment_required`
  - the invoke path could not complete the paid flow
- `upstream_unavailable`
  - upstream execution or network dependency is unhealthy

## Practical Integration Rules

- Use `viewer` for discovery only.
- Use `agent` for `tools/call`.
- Treat MCP as an adapter over service invoke, not a separate product surface.
- Keep your own `traceId` stable per user-facing action when you want clean audit lookups.
- Read receipt and evidence from the standard backend routes after execution.

## One-Line Product Message

**Providers join Kite Trace through identity. Consumers may call Kite Trace through MCP. Paid MCP calls are controlled by delegated authority, not mandatory onchain identity.**
