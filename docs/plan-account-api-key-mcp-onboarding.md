# Plan: Account API Key + MCP Onboarding

Updated: 2026-03-18

Owner split:

- Backend: Codex
- Frontend: CC

Primary goal:

- Give each user one stable Account API Key that survives AA session rotation.
- Make that key the only credential needed for remote MCP access.
- Keep execution on the current backend rails: existing auth, existing invoke flow, existing x402 flow, existing receipt/evidence flow.

## 0. Why this plan needed refinement

The original draft was directionally correct, but the current repo adds a few implementation realities that must be explicit:

1. `backend/mcp/mcpServer.js` does not use `requireRole(...)`.
It authenticates `/mcp` by calling `extractApiKey(...)` and `resolveRoleByApiKey(...)` directly, so adding account keys only in route middleware is not enough.

2. `ensureBackendSessionRuntime(...)` is not a shared library today.
It currently lives inside `backend/routes/coreIdentityChatRoutes.impl.js`, so the backend cannot simply "import it into auth.js" without first extracting or re-exposing it cleanly.

3. `backend/runtime/config.js` and `backend/appRuntime.impl.js` are the real path/dependency wiring points.
Any new `api_keys.json` store must be added there first, otherwise `dataStoreAccessors` cannot see it.

4. The original draft stored raw API secrets in JSON.
For a permanent user-facing key, phase 1 should store only a hash plus display metadata, not the full secret.

5. "Current caller account" is not automatically available from static role keys.
The account-key management routes need an explicit account-resolution rule, or the frontend cannot safely ask for "my current key".

This version turns the idea into an execution-ready repo plan.

## 1. Scope

In scope:

- backend account-scoped API key storage
- backend auth extension for account keys
- MCP auth path reuse for account keys
- minimal frontend API Key + MCP onboarding cards
- narrow verification scripts and release checks

Out of scope:

- a new desktop `stdio` bridge
- multi-key management per account
- user-configurable spending caps on the account key itself
- frontend auth refactor beyond what is required to resolve the current account

## 2. Product outcome

After this work:

- a user generates one permanent key such as `ktrace_sk_...`
- the backend maps that key to one owner EOA and AA wallet
- the backend silently refreshes the underlying AA session runtime when needed
- the user configures Claude Desktop, Cursor, or another MCP client once against `/mcp`
- rotating the AA session no longer forces MCP reconfiguration

## 3. Repo anchors that this plan must fit

Backend anchors:

- [config.js](/E:/CODEX/kite-trace-platform/backend/runtime/config.js)
- [appRuntime.impl.js](/E:/CODEX/kite-trace-platform/backend/appRuntime.impl.js)
- [auth.js](/E:/CODEX/kite-trace-platform/backend/lib/auth.js)
- [dataStoreAccessors.js](/E:/CODEX/kite-trace-platform/backend/lib/dataStoreAccessors.js)
- [sessionRuntimeHelpers.js](/E:/CODEX/kite-trace-platform/backend/lib/sessionRuntimeHelpers.js)
- [coreIdentityChatRoutes.impl.js](/E:/CODEX/kite-trace-platform/backend/routes/coreIdentityChatRoutes.impl.js)
- [mcpServer.js](/E:/CODEX/kite-trace-platform/backend/mcp/mcpServer.js)
- [aa-session-policy.md](/E:/CODEX/kite-trace-platform/backend/docs/aa-session-policy.md)

Important current behaviors:

- static env keys still come from `KITECLAW_API_KEY_ADMIN`, `KITECLAW_API_KEY_AGENT`, `KITECLAW_API_KEY_VIEWER`
- `createAuthHelpers(...)` currently resolves only static role keys
- `/mcp` currently authorizes requests without going through `requireRole(...)`
- session runtime data already has owner, AA wallet, expiry, authorization, and spending metadata
- AA policy still forbids normal-flow backend private-key userOp signing

## 4. Design decisions

### D1. Account API Key is account-scoped

The key identifies one owner EOA plus its managed AA wallet, not a global backend role.

Phase 1 authorization result:

- static keys keep their existing `admin/agent/viewer` behavior
- account keys resolve to `agent`

### D2. Account API Key secret is write-only

The backend returns the full secret only at creation time.

The JSON store persists:

- `keyHash`
- `keyValuePrefix`
- `keyValueLast4`
- account metadata
- lifecycle metadata

The backend does not persist the raw `keyValue`.

### D3. One active key per account in phase 1

Generating a new key immediately revokes the previous active key for the same owner.

There is no list-of-keys surface in this phase.

### D4. Session lifecycle stays backend-owned

The user never manages the AA session private key.

The backend:

- reads session runtime by owner
- ensures a valid runtime before protected account-key execution paths
- renews or recreates session runtime transparently when expired

### D5. MCP reuses the same auth resolution as HTTP

This is not optional.

Because `/mcp` authenticates in [mcpServer.js](/E:/CODEX/kite-trace-platform/backend/mcp/mcpServer.js), the account-key path must be implemented in a shared auth API that both:

- `requireRole(...)`
- MCP request auth

can call.

### D6. Management routes must resolve a real account, not trust a free-form `eoaAddress`

The original draft used `POST /api/account/api-key/generate { eoaAddress }`.
That is too loose for a permanent credential.

Phase 1 rule:

- generation and revoke routes derive the target owner from authenticated account context
- if the backend cannot resolve the current account, the route must fail clearly

Recommended error:

- `409 account_context_required`

### D7. Read-only settings views should not force a renewal transaction

`GET /api/account/api-key` should return a session snapshot, not trigger session creation.

Behavior split:

- settings read: snapshot only
- protected capability and MCP execution: ensure session runtime before proceeding

## 5. Required backend foundation before feature work

## B0. Shared auth and session dependency extraction

This is the real first step, before storage or routes.

### B0.1 Add `apiKeysPath` to runtime config

Add a new path in [config.js](/E:/CODEX/kite-trace-platform/backend/runtime/config.js):

```js
const apiKeysPath = path.resolve('data', 'api_keys.json');
```

Then thread it through [appRuntime.impl.js](/E:/CODEX/kite-trace-platform/backend/appRuntime.impl.js):

- config destructuring
- `PERSIST_ARRAY_PATHS`
- `createDataStoreAccessors(...)` path map
- any route dependency object that needs API key helpers

### B0.2 Promote session ensure logic into a shared dependency

Current reality:

- `ensureBackendSessionRuntime(...)` is defined inside [coreIdentityChatRoutes.impl.js](/E:/CODEX/kite-trace-platform/backend/routes/coreIdentityChatRoutes.impl.js)

Phase 1 implementation requirement:

- move the reusable logic into [sessionRuntimeHelpers.js](/E:/CODEX/kite-trace-platform/backend/lib/sessionRuntimeHelpers.js)
- expose a stable dependency such as `ensureManagedSessionRuntimeForOwner(...)`

It must preserve AA policy from [aa-session-policy.md](/E:/CODEX/kite-trace-platform/backend/docs/aa-session-policy.md):

- no normal-flow backend private-key userOp signing
- no default EOA relay fallback

### B0.3 Replace "role-only" auth helper shape with "authenticate request" shape

Recommended addition in [auth.js](/E:/CODEX/kite-trace-platform/backend/lib/auth.js):

- `authenticateApiKeyRequest({ providedKey, requiredRole, ensureSession })`

Recommended return shape:

```json
{
  "ok": true,
  "role": "agent",
  "authSource": "account",
  "apiKeyId": "ktrace_key_abc123",
  "accountContext": {
    "ownerEoa": "0x...",
    "aaWallet": "0x..."
  }
}
```

This shared function should be used by:

- `requireRole(...)`
- MCP request auth in [mcpServer.js](/E:/CODEX/kite-trace-platform/backend/mcp/mcpServer.js)

## 6. Backend delivery plan

## B1. API key persistence

New file:

- `backend/data/api_keys.json`

Reuse existing JSON persistence patterns:

- `readJsonArray(...)`
- `writeJsonArray(...)`
- `loadJsonArrayFromFile(...)`
- `writeJsonArrayToFile(...)`

### Record shape

Recommended phase 1 shape:

```json
{
  "keyId": "ktrace_key_abc123",
  "keyHash": "sha256:...",
  "keyValuePrefix": "ktrace_sk_ab12",
  "keyValueLast4": "9f3c",
  "ownerEoa": "0x...",
  "aaWallet": "0x...",
  "status": "active",
  "createdAt": 1234567890000,
  "lastUsedAt": 0,
  "revokedAt": 0,
  "rotatedFromKeyId": "ktrace_key_old123"
}
```

### Helper functions

Add to [dataStoreAccessors.js](/E:/CODEX/kite-trace-platform/backend/lib/dataStoreAccessors.js):

- `readApiKeys()`
- `writeApiKeys(records)`
- `findActiveApiKeyByOwner(ownerEoa)`
- `findApiKeyById(keyId)`
- `findApiKeyBySecret(keyValue)`
- `upsertApiKey(record)`
- `revokeApiKey(keyId)`
- `touchApiKeyLastUsed(keyId, usedAt)`

Implementation details:

- `findApiKeyBySecret(...)` hashes the presented secret and compares against stored `keyHash`
- secret comparison should be constant-time after hashing
- helper returns only active or revoked records; deleted rows are not required in phase 1

### Generation rules

- `keyId = "ktrace_key_" + randomHex(8 to 16 bytes)`
- `keyValue = "ktrace_sk_" + randomHex(32 bytes)`
- `keyHash = "sha256:" + sha256(keyValue)`
- generation revokes any existing active key for the same `ownerEoa`
- raw `keyValue` is returned only once in the HTTP response

## B2. Auth resolution

Update [auth.js](/E:/CODEX/kite-trace-platform/backend/lib/auth.js).

### Resolution order

1. extract key from `x-api-key`
2. fallback to `Authorization: Bearer`
3. keep current stream-query exception for `GET .../stream`
4. match static env key first
5. if no static key matched, try account key lookup

### Account-key success result

On success:

- `role = "agent"`
- `authSource = "account"`
- `req.accountContext = { ownerEoa, aaWallet, apiKeyId }`

Optional but useful:

- `req.authKeyType = "account"`
- `req.authKeyId = keyId`

### Failure mapping

| Condition | HTTP | Error |
|---|---|---|
| Key not found | 401 | `unauthorized` |
| Key revoked | 401 | `key_revoked` |
| Account context missing | 409 | `account_context_required` |
| Session unavailable during ensure path | 503 | `session_unavailable` |

### Session ensure rule

For account-key execution paths:

- tool invocation through `/mcp`
- protected capability execution routes

the backend should call the shared ensure helper before execution continues.

For metadata-only reads:

- account key settings view
- `.well-known/mcp.json`
- tool listing

the backend may authenticate without forcing renewal.

## B3. Account context resolution

This is the main product risk and must be explicit.

The backend needs one canonical way to answer:

- "which account is asking to generate or revoke a permanent key?"

### Recommended phase 1 rule

Prefer existing session-runtime identity already present in backend state:

1. current authenticated request already has `req.accountContext.ownerEoa`
2. otherwise resolve from current managed session runtime owner
3. otherwise fail with `409 account_context_required`

Do not trust a free-form request body address by itself.

If the team later wants true multi-user frontend self-service, that should be a separate auth milestone.

## B4. Account API key routes

New file:

- `backend/routes/accountApiKeyRoutes.js`

Recommended registration pattern:

- add `registerAccountApiKeyRoutes(app, deps)`
- mount from [appRuntime.impl.js](/E:/CODEX/kite-trace-platform/backend/appRuntime.impl.js)
- keep route file small and dependency-driven like the newer route modules

### Route contract

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/account/api-key` | Return current key metadata and session snapshot |
| `POST` | `/api/account/api-key/generate` | Generate or rotate key for current account |
| `POST` | `/api/account/api-key/revoke` | Revoke current active key |

### Auth rule

These routes need:

- `agent` role
- resolved account context

Static role auth alone is not sufficient unless it can also resolve the current owner.

### `GET /api/account/api-key`

Response when key exists:

```json
{
  "ok": true,
  "hasKey": true,
  "key": {
    "keyId": "ktrace_key_abc123",
    "keyValueMasked": "ktrace_sk_ab12...9f3c",
    "keyValuePrefix": "ktrace_sk_ab12",
    "keyValueLast4": "9f3c",
    "status": "active",
    "createdAt": 1234567890000,
    "lastUsedAt": 1234567899999
  },
  "account": {
    "ownerEoa": "0x...",
    "aaWallet": "0x..."
  },
  "session": {
    "status": "active",
    "expiresAt": 1234567890000,
    "authorizedBy": "0x...",
    "dailyLimit": 0.6,
    "dailyLimitRemaining": null
  }
}
```

Response when key does not exist:

```json
{
  "ok": true,
  "hasKey": false,
  "account": {
    "ownerEoa": "0x...",
    "aaWallet": "0x..."
  },
  "session": {
    "status": "missing"
  }
}
```

Notes:

- this route should mask the key every time
- this route should read session snapshot only
- `dailyLimitRemaining` is optional and may be `null` in phase 1 if there is no cheap exact computation

### `POST /api/account/api-key/generate`

Request body:

```json
{}
```

No free-form `eoaAddress` input in phase 1.

Response:

```json
{
  "ok": true,
  "created": true,
  "rotated": true,
  "key": {
    "keyId": "ktrace_key_abc123",
    "keyValue": "ktrace_sk_...",
    "keyValuePrefix": "ktrace_sk_ab12",
    "keyValueLast4": "9f3c",
    "createdAt": 1234567890000
  },
  "account": {
    "ownerEoa": "0x...",
    "aaWallet": "0x..."
  }
}
```

### `POST /api/account/api-key/revoke`

Request body:

```json
{}
```

Response:

```json
{
  "ok": true,
  "revoked": true,
  "keyId": "ktrace_key_abc123",
  "revokedAt": 1234567890000
}
```

## B5. MCP auth path changes

This is the most important integration detail missing from the original draft.

Update [mcpServer.js](/E:/CODEX/kite-trace-platform/backend/mcp/mcpServer.js) so it no longer authorizes only with `resolveRoleByApiKey(...)`.

### Required change

Replace the local static-only auth logic with the shared auth function from [auth.js](/E:/CODEX/kite-trace-platform/backend/lib/auth.js).

### Expected MCP behavior

`tools/list`:

- account key works
- no forced session renewal

`tools/call`:

- account key works
- backend resolves current account
- backend ensures session runtime before invoke
- existing hosted x402 path remains unchanged

### Request context passed into invoke adapter

Recommended fields:

```json
{
  "apiKey": "ktrace_sk_...",
  "authSource": "account",
  "accountContext": {
    "ownerEoa": "0x...",
    "aaWallet": "0x...",
    "apiKeyId": "ktrace_key_abc123"
  },
  "paymentMode": ""
}
```

This keeps MCP compatible with the rest of the backend instead of becoming a parallel auth system.

## B6. Operational visibility

Recommended small additions:

- include `authSource` and `apiKeyId` in relevant debug logs when an account key is used
- update `lastUsedAt` on successful authenticated use
- surface account-key auth path in the verification scripts

Do not log the raw API secret.

## B7. Verification scripts

New script:

- `backend/scripts/verify-account-api-key.mjs`

Recommended second script:

- `backend/scripts/verify-mcp-account-api-key.mjs`

### Verification scenarios

`verify-account-api-key.mjs`:

1. generate a key for the current resolved account
2. read `GET /api/account/api-key` and confirm masked output
3. use the account key against one protected backend capability path
4. confirm normal x402 and audit artifacts are created
5. generate again and confirm old key returns `401 key_revoked`
6. revoke current key and confirm it stops working
7. static env keys still work unchanged

`verify-mcp-account-api-key.mjs`:

1. use account key for MCP `tools/list`
2. use account key for one MCP paid tool call
3. confirm service invocation audit exists
4. confirm receipt and evidence still resolve by `traceId`

### Validation command wiring

If these scripts land, add npm aliases in `backend/package.json` so release validation can call them directly.

## 7. Frontend plan

Frontend remains intentionally small.

## F1. API Key management card

Recommended location:

- existing Settings or Developer surface

States:

- no key yet
- key exists
- just generated
- session unavailable

Core UI:

- masked key display
- show/hide toggle only for the just-generated key in the current browser state
- copy button
- regenerate button

Phase 1 product decision:

- do not include a separate revoke button in the frontend
- regeneration is the only user-facing rotation action in phase 1
- manual revoke remains backend-capable and script-capable for operators and future UI expansion

Recommended text on generation success:

- "This key is shown only once. Save it now."

### Frontend API usage

- `GET /api/account/api-key`
- `POST /api/account/api-key/generate`
- `POST /api/account/api-key/revoke`

### Important UI behavior

- after generation, auto-copy the full key
- after refresh, only show masked form from backend
- regeneration must show a warning that existing MCP clients will stop working until updated

## F2. MCP access card

Recommended location:

- directly below the API key card

Content:

- server status from `GET /.well-known/mcp.json`
- endpoint copy button
- auth header copy button
- short note for Claude Desktop / Cursor / remote MCP connectors

### Status probing

Probe only:

- `GET /.well-known/mcp.json`

Optional:

- show tool count only if the descriptor eventually exposes it
- do not add a second custom health route unless required

### Disabled state

If the user has no account key yet:

- MCP card should still show endpoint
- auth copy should be disabled or show "Generate API Key first"

## 8. Delivery order and gates

| Step | Owner | Deliverable | Gate |
|---|---|---|---|
| 1 | Codex | B0 shared auth/session extraction | must finish first |
| 2 | Codex | B1 api key store + accessors | step 1 done |
| 3 | Codex | B2 auth resolution with account keys | step 2 done |
| 4 | Codex | B3 account context resolution | step 3 done |
| 5 | Codex | B4 account key routes | step 4 done |
| 6 | Codex | B5 MCP account-key auth path | step 3 done |
| 7 | Codex | B7 verification scripts | steps 5-6 done |
| 8 | CC | F1 API key card | step 5 response contract stable |
| 9 | CC | F2 MCP card | step 6 `.well-known` contract confirmed |

Important handoff rule:

- CC should not start UI copy logic until backend confirms the final `GET /api/account/api-key` response shape.

## 9. Risks and mitigations

### Risk 1. No trustworthy current-account resolution

If the backend cannot safely determine "which user account is asking", self-service key management becomes ambiguous.

Mitigation:

- make this a hard gate in B0/B3
- fail with `account_context_required` instead of guessing
- keep frontend scope dependent on that rule being explicit

### Risk 2. MCP path accidentally remains static-key only

This would make the product appear complete in HTTP UI but fail in the actual MCP onboarding flow.

Mitigation:

- require a dedicated MCP verification script
- do not sign off until account key succeeds on both `tools/list` and `tools/call`

### Risk 3. Permanent key stored in plaintext

This increases blast radius if local runtime data is exposed.

Mitigation:

- store only `keyHash` plus masked display metadata
- never persist raw `keyValue`

### Risk 4. Session renewal on every request adds avoidable latency

Mitigation:

- authenticate first
- only ensure session for execution paths
- optionally add a 60-second in-memory TTL cache per `ownerEoa` if repeated MCP calls make this hot

### Risk 5. Key rotation silently breaks existing MCP clients

Mitigation:

- regeneration warning in UI
- immediate success screen with full key and auto-copy
- do not expose "rotate" without explicit confirmation

## 10. Acceptance criteria

Backend:

- `backend/runtime/config.js` and `backend/appRuntime.impl.js` include `apiKeysPath`
- account API keys are persisted as hashes, not plaintext secrets
- `POST /api/account/api-key/generate` returns the full key once and revokes any previous active key for that owner
- `GET /api/account/api-key` returns masked key metadata plus session snapshot
- account keys authenticate normal protected backend calls
- account keys authenticate MCP `tools/list`
- account keys authenticate MCP `tools/call`
- revoked keys fail immediately with `401 key_revoked`
- static env keys still behave exactly as before

Frontend:

- user can generate, copy, and rotate a key from a single inline card
- the old key revoke warning is visible before regeneration
- the newly generated key is shown once and auto-copied
- MCP card shows endpoint and auth guidance
- MCP card handles "no key yet" state cleanly

Operational:

- verification scripts cover both HTTP and MCP account-key paths
- no new code path violates the AA session policy

## 11. One-line implementation summary

Ship a hashed, account-scoped permanent API key that plugs into both backend HTTP auth and `/mcp`, while keeping AA session renewal invisible to the user and preserving the current x402 plus audit pipeline.
