# AA Session Policy

Updated: 2026-03-18
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

Where relevant, authority checks should also pass before submission.

## Job Lane Extension

This policy now explicitly applies to ERC-8183 job mutations.

Canonical AA role model:

- requester = consumer AA wallet
- executor = executor AA wallet
- validator = validator AA wallet

The backend normal path must not send job lifecycle transactions with owner EOA signers.

## Operational Notes

- owner EOA may still be used for setup, authorization, revoke, and recovery
- legacy signer-based records may remain readable
- new execution should emit AA-native audit metadata

## Reference

Platform source of truth:

- [ktrace-full-stack-aa-plan.md](/E:/CODEX/kite-trace-platform/docs/ktrace-full-stack-aa-plan.md)
