# Consumer Authority Frontend Handoff

Updated: 2026-03-18
Owner: backend
Audience: CC

## Scope

This handoff freezes the backend payloads the frontend should consume for the consumer authority panel.

Frontend responsibility in phase 1:

- display active authority
- submit policy updates
- submit revoke
- display preflight validation
- render receipt/evidence authority metadata

Frontend should not:

- reimplement policy rules
- infer allow/deny locally
- build a second authority model in the client

## Stable Endpoints

- `GET /api/session/policy`
- `POST /api/session/policy`
- `POST /api/session/policy/revoke`
- `POST /api/session/validate`
- `GET /api/receipt/:requestId`
- `GET /api/evidence/export?traceId=...`
- `GET /api/public/evidence/:traceId`

## Sample: GET /api/session/policy

```json
{
  "ok": true,
  "traceId": "req_123",
  "authority": {
    "authorityId": "auth_123",
    "sessionId": "session-smoke",
    "authorizedBy": "0x5555555555555555555555555555555555555555",
    "payer": "0x1111111111111111111111111111111111111111",
    "consumerAgentLabel": "example-consumer",
    "allowedCapabilities": ["btc-price-feed"],
    "allowedProviders": [],
    "allowedRecipients": ["0x3333333333333333333333333333333333333333"],
    "singleLimit": 5,
    "dailyLimit": 25,
    "totalLimit": 40,
    "expiresAt": 1760000000000,
    "status": "active",
    "revokedAt": 0,
    "revocationReason": "",
    "createdAt": 1760000000000,
    "updatedAt": 1760000000000
  },
  "runtime": {
    "authorityId": "auth_123",
    "authorityStatus": "active",
    "authorityExpiresAt": 1760000000000
  }
}
```

UI note:

- `allowedProviders=[]` should render as "Any provider allowed"

## Sample: POST /api/session/validate

Allow:

```json
{
  "ok": true,
  "traceId": "req_456",
  "allowed": true,
  "authority": {
    "authorityId": "auth_123",
    "status": "active"
  },
  "policySnapshotHash": "sha256:abcd1234",
  "detail": {
    "actionKind": "buy_direct",
    "referenceId": "tpl_svc-price"
  }
}
```

Deny:

```json
{
  "ok": false,
  "error": "provider_not_allowed",
  "reason": "provider is not allowed by the active consumer authority",
  "traceId": "req_789",
  "authority": {
    "authorityId": "auth_123",
    "status": "active"
  },
  "detail": {
    "actionKind": "buy_direct",
    "referenceId": "tpl_svc-price"
  }
}
```

## Sample: Receipt / Evidence Authority Payload

Receipt authority fragment:

```json
{
  "authorityId": "auth_123",
  "intentId": "intent-evidence-1",
  "policySnapshotHash": "sha256:abcd1234",
  "authorization": {
    "authorityId": "auth_123",
    "intentId": "intent-evidence-1",
    "policySnapshotHash": "sha256:abcd1234",
    "policySnapshot": {
      "allowedCapabilities": ["btc-price-feed"]
    },
    "authoritySummary": {
      "authorityId": "auth_123",
      "status": "active",
      "allowedCapabilities": ["btc-price-feed"]
    },
    "validationDecision": "allowed"
  }
}
```

Public evidence fragment:

```json
{
  "authorityId": "auth_123",
  "authoritySummary": {
    "authorityId": "auth_123",
    "status": "active",
    "allowedCapabilities": ["btc-price-feed"]
  },
  "policySnapshotHash": "sha256:abcd1234",
  "intentId": "intent-evidence-1",
  "authorizedBy": "0x5555555555555555555555555555555555555555",
  "authorizationMode": "user_grant_backend_executed"
}
```

UI note:

- internal receipt/evidence may show more fields than public evidence
- public evidence must be treated as a redacted view

## Error Code Mapping

Render these as backend-owned machine codes:

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

Frontend handling rule:

- show the backend `reason`
- do not remap one code into another
- `intent_*` errors should be shown as replay/conflict states, not generic failures

## Frontend Constraints

- client may cache payloads for display, but backend remains the source of truth
- revoke should always trigger a refetch of `GET /api/session/policy`
- validation should display the returned `policySnapshotHash` when present
- no client-side wildcard semantics beyond display; backend enforces them
