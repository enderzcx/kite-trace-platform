# Consumer Authority Contract Freeze

Updated: 2026-03-18
Status: frozen for phase 1
Owner: backend

AA-native note:

- owner EOA remains control-plane only
- normal consumer execution uses AA wallets and session signers
- `POST /api/jobs/:jobId/fund` and `POST /api/jobs/:jobId/submit` now feed an AA-native job lane

## Goal

Freeze the backend authority-first contract used by consumer execution.

This document is the backend source of truth for:

- session policy object shape
- deny reason codes
- response field names
- phase 1 defaults and compatibility rules

## Phase 1 Decisions

- `consumer agent` onboarding does not require `ERC-8004`
- `allowedProviders: []` means wildcard allow, not default deny
- revocation is global-only in phase 1
- `agent invoke` reuses the same authority validation path and does not become a new canonical lane
- public evidence keeps legacy fields and adds authority metadata
- `job show` and related read paths may degrade gracefully if trace-anchor verification fails

## Canonical Routes

Routes are owned by [coreIdentitySessionRoutes.js](E:/CODEX/kite-trace-platform/backend/routes/coreIdentitySessionRoutes.js).

- `GET /api/session/policy`
- `POST /api/session/policy`
- `POST /api/session/policy/revoke`
- `POST /api/session/validate`

Execution lanes that must consume the same authority evaluator:

- `POST /api/templates/:templateId/buy`
- `POST /api/services/:serviceId/invoke`
- `POST /api/jobs/:jobId/fund`
- `POST /api/jobs/:jobId/submit`

## Session Policy Object

The effective authority object returned from `GET /api/session/policy` and reused in execution/evidence uses these stable fields:

```json
{
  "authorityId": "auth_123",
  "sessionId": "session-smoke",
  "authorizedBy": "0x5555...",
  "payer": "0x1111...",
  "consumerAgentLabel": "example-consumer",
  "allowedCapabilities": ["btc-price-feed"],
  "allowedProviders": ["price-agent"],
  "allowedRecipients": ["0x3333..."],
  "singleLimit": 5,
  "dailyLimit": 25,
  "totalLimit": 40,
  "expiresAt": 1760000000000,
  "status": "active",
  "revokedAt": 0,
  "revocationReason": "",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```

Field rules:

- `allowedProviders=[]` means any provider is allowed if the rest of policy still passes
- `allowedRecipients=[]` means recipient fallback comes from the session/runtime and x402 policy helpers
- `consumerAgentLabel` is informational only and must not imply onchain identity
- `status` is `active` or `revoked` in phase 1

## Validate Response

Allow shape:

```json
{
  "ok": true,
  "traceId": "req_123",
  "allowed": true,
  "authority": {
    "authorityId": "auth_123"
  },
  "policySnapshotHash": "sha256:abcd...",
  "detail": {
    "actionKind": "buy_direct",
    "referenceId": "tpl_svc-price"
  }
}
```

Deny shape:

```json
{
  "ok": false,
  "error": "authority_revoked",
  "reason": "consumer authority has been revoked",
  "traceId": "req_123",
  "authority": {
    "authorityId": "auth_123"
  },
  "detail": {
    "actionKind": "buy_direct",
    "referenceId": "tpl_svc-price"
  }
}
```

Stable field names:

- `authorization`
- `authoritySummary`
- `policySnapshotHash`
- `intentId`

## Denial Reason Codes

The phase 1 reason-code enum is frozen to:

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

## Evidence Contract

Internal receipt/evidence may embed a full sanitized policy snapshot.

Internal payload fields:

- `authorization.authorityId`
- `authorization.intentId`
- `authorization.policySnapshotHash`
- `authorization.policySnapshot`
- `authorization.authoritySummary`
- `authorization.validationDecision`

Public evidence must not embed the full policy snapshot. It exposes:

- `authorityId`
- `authoritySummary`
- `policySnapshotHash`
- `intentId`

Compatibility rule:

- public evidence continues to expose legacy fields such as `authorizedBy` and `authorizationMode`
- the new authority fields are additive in phase 1

## Migration Rule

Legacy session runtime records are auto-materialized on first read, validate, or execution.

- no forced `auth session` rerun in phase 1
- if a safe authority object cannot be derived, execution fails closed with `authority_migration_required`

## Verification Gate

Phase 1 is not done until these pass:

- `npm --prefix backend run verify:consumer-authority`
- `npm --prefix backend run verify:ktrace:smoke`
