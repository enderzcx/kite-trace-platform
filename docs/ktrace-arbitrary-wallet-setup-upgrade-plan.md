# KTrace Arbitrary-Wallet Setup Upgrade Plan

Last updated: 2026-03-19

## Status

- Backend status: in progress
- Frontend status: in progress
- Current `/setup` target: arbitrary-wallet self-serve
- Demo-owner backend-managed runtime creation remains available only as a hidden compatibility path

## Summary

`/setup` is being upgraded from a demo-owner-only backend-managed flow into a true arbitrary-wallet self-serve flow.

Canonical model:

1. User connects an owner wallet.
2. User signs an onboarding challenge and receives the `ktrace_onboard` cookie.
3. Frontend calls `POST /api/setup/runtime/prepare` to get AA bootstrap parameters.
4. User wallet deploys or funds the predicted AA account and creates the session on-chain.
5. Frontend calls `POST /api/setup/runtime/finalize` to import and verify the runtime.
6. Frontend calls `POST /api/v1/session/authorize` with `executionMode=external`.
7. User generates a `ktrace_sk_*` API key and connects Claude or another MCP client.

## Current backend contract

### Onboarding auth

- `POST /api/onboarding/auth/challenge`
- `POST /api/onboarding/auth/verify`
- `POST /api/onboarding/auth/logout`

### Self-serve runtime bootstrap

- `POST /api/setup/runtime/prepare`
- `POST /api/setup/runtime/finalize`

### Runtime compatibility path

- `POST /api/session/runtime/ensure`

Important rule:

- when authenticated by onboarding cookie, `POST /api/session/runtime/ensure` now returns a deterministic error telling callers to use `prepare/finalize`
- backend-managed runtime creation is no longer the canonical `/setup` path

### Authorization and API key follow-up

- `POST /api/v1/session/authorize`
- `GET /api/account/api-key`
- `POST /api/account/api-key/generate`
- `POST /api/account/api-key/revoke`

## Runtime verification rules

`POST /api/setup/runtime/finalize` verifies:

- onboarding cookie owner matches the submitted owner
- submitted `aaWallet` matches the address predicted during `prepare`
- AA account code exists on-chain
- session exists on-chain
- on-chain session agent matches the submitted session address
- on-chain owner matches the submitted owner

Imported runtime records are written with:

- `source = self_serve_wallet`
- `runtimePurpose = consumer`

Legacy demo runtimes remain readable and keep:

- `source = backend_managed_demo` or equivalent historical source labels

## Frontend requirements for CC

- `/setup` must no longer call `POST /api/session/runtime/ensure` in the normal path
- `/setup` must drive:
  - challenge / verify
  - runtime prepare
  - wallet-driven AA deploy or funding
  - wallet-driven session creation
  - runtime finalize
  - session authorize
  - API key generation
- switching wallets must:
  - call logout
  - clear local wizard state
  - restart from step 1
- setup UI should treat owner EOA as a setup/auth identity only
- execution and payment surfaces should continue to show AA addresses

## Phase 1 decisions

- keep `signMessage`
- do not migrate to EIP-712 in this slice
- keep `KITE_ALLOW_EOA_RELAY_FALLBACK=0`
- do not silently fall back from an arbitrary wallet to a demo signer

## Acceptance criteria

- a wallet with no backend-managed owner key can complete:
  - challenge
  - verify
  - prepare
  - AA deploy or funding
  - session creation
  - finalize
  - authorize
  - API key generation
- `/setup` never reports a demo signer mismatch as the primary error for a normal arbitrary-wallet flow
- onboarding-cookie callers never hit backend-managed runtime creation through the normal setup UI
- MCP account key flow remains unchanged after authorization
