# AA Session Policy

Updated: 2026-03-20
Status: active

## Scope

This policy applies to all normal AA execution paths:

- `POST /api/session/pay`
- x402 settlement
- consumer buy flows
- MCP paid tool calls
- ERC-8183 job fund
- ERC-8183 job accept / submit / validate

## Mandatory Rules

1. Session key must sign normal userOp execution.
2. Backend private keys must not be used to sign normal userOps.
3. `KITE_ALLOW_EOA_RELAY_FALLBACK=0` remains the default.
4. If a flow only works through owner EOA fallback, treat it as a migration blocker, not a valid steady-state path.

## Runtime Guards

Normal AA execution should verify:

- AA account code exists
- required AA version matches when `KITE_REQUIRE_AA_V2=1`
- session exists on-chain
- session agent matches the synced session key
- AA wallet has enough native gas
- runtime capability metadata is present:
  - `accountVersionTag`
  - `accountCapabilities.sessionPayment`
  - `accountCapabilities.sessionGenericExecute`

Where relevant, authority checks should also pass before submission.

## Job Lane Extension

This policy now explicitly applies to ERC-8183 job mutations.

Canonical AA role model:

- requester = consumer AA wallet
- executor = executor AA wallet
- validator = validator AA wallet

The backend normal path must not send job lifecycle transactions with owner EOA signers.

Capability rule for job-lane mutations:

- `GokiteAccountV2-session-userop` is treated as payment-capable only
- V2 may continue to power `/api/session/pay` and x402 settlement
- V2 must fail fast for ERC-8183 `fund / accept / submit / validate` with `aa_session_execute_not_supported`
- session-scoped job-lane execution requires a V3-capable account that exposes a dedicated session-generic entrypoint such as `executeWithSession(...)`
- backend must not fall back to session-signed generic `execute(...)` for job-lane mutations

## Operational Notes

- owner EOA may still be used for setup, authorization, revoke, and recovery
- legacy signer-based records may remain readable
- new execution should emit AA-native audit metadata
- once V3 is deployed, job-lane records should emit:
  - `executionMode = aa-session-generic`
  - `aaMethod = executeWithSession`

## Reference

Platform source of truth:

- [ktrace-full-stack-aa-plan.md](/E:/CODEX/kite-trace-platform/docs/ktrace-full-stack-aa-plan.md)
