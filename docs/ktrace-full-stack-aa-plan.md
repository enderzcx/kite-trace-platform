# KTrace Full-Stack AA-Native Plan

Updated: 2026-03-18
Status: active source of truth
Owners: Backend (Codex), Frontend (CC)

## Reference Escrow Test

- Reference-aligned escrow contract deployed for isolated testing:
  - `JobEscrowV3`
  - address: `0x5D8BFBdE80B3dE986158c35C7F84333D7Cd1Fb6c`
  - deploy tx: `0x9b11ce2c5c7954e7447b398a628b3210dc2f282ddcdad7c293760933e91e822e`
- Goal:
  - validate whether a cleaner ERC-8183-style escrow implementation changes AA funding behavior
- Current result:
  - deployment succeeded
  - live requester EOA and read-path diagnostics remain blocked by Kite RPC transport instability
  - no evidence yet that the original `JobEscrowV2` role model is incompatible with AA

## Summary

Kite Trace now treats AA as the only normal execution model.

Canonical model:

- owner EOA: setup, session grant, session revoke, recovery
- consumer AA wallet: buy, MCP paid call, job fund
- executor AA wallet: job accept, job submit
- validator AA wallet: job validate

Normal product execution must not depend on owner EOA signers or EOA relay fallback.

Reference model:

- [ERC-8183 base-contracts](https://github.com/erc-8183/base-contracts)
- [ERC-8183 hook-contracts](https://github.com/erc-8183/hook-contracts)

Both references enforce role addresses onchain. In Kite Trace, those role addresses are now interpreted as AA addresses.

## Platform Rules

1. `ERC-8183` requester / executor / validator fields are AA addresses.
2. Backend normal flow does not use `ERC8183_*_PRIVATE_KEY` to send job lifecycle transactions.
3. `KITE_ALLOW_EOA_RELAY_FALLBACK=0` remains the default.
4. Legacy signer-based records remain readable, but new writes are AA-native.
5. UI and public audit should show AA execution addresses, not owner EOAs.

## Backend Contract

### Buy and MCP

- `buy direct`
- `buy request`
- `POST /api/services/:serviceId/invoke`
- `POST /mcp`

All remain consumer-AA/session driven.

### Job Lane

- `POST /api/jobs`
  - `payer` / `requester` = consumer AA wallet
  - `executor` = executor AA wallet
  - `validator` = validator AA wallet
- `POST /api/jobs/:jobId/fund`
  - requester AA runtime executes `lockFunds`
- `POST /api/jobs/:jobId/accept`
  - executor AA runtime executes `acceptJob`
- `POST /api/jobs/:jobId/submit`
  - executor AA runtime executes `submitResult`
- `POST /api/jobs/:jobId/validate`
  - validator AA runtime executes `validate`

Stable failure codes for AA-native job execution include:

- `runtime_not_found`
- `role_runtime_address_mismatch`
- `owner_eoa_submitted_for_aa_role`
- `aa_role_not_deployed`
- `session_authorization_missing`
- `aa_version_mismatch`
- `insufficient_kite_gas`

## Audit Contract

New AA-native job records should expose:

- `executionMode = aa-native`
- `requesterRuntimeAddress`
- `executorRuntimeAddress`
- `validatorRuntimeAddress`

Public audit should expose:

- `contractPrimitives.roleEnforcement.executionMode = aa_account_role_enforced`
- role runtime summary using AA addresses

## Setup and MCP Implications

- `/setup` continues to use `signMessage`
- generated account API keys remain the MCP credential surface
- consumer MCP onboarding still does not require `ERC-8004`
- frontend should present owner EOA only in authorization/setup/recovery UI
- frontend should present AA addresses in payment/execution/fulfillment UI

## CC Handoff

Frontend should follow:

- [full-stack-aa-frontend-handoff.md](/E:/CODEX/kite-trace-platform/backend/docs/full-stack-aa-frontend-handoff.md)

Related implementation docs that should now be interpreted through this AA-native model:

- [kite-trace-wallet-auth-model.md](/E:/CODEX/kite-trace-platform/docs/kite-trace-wallet-auth-model.md)
- [kite-trace-mcp-consumer-guide.md](/E:/CODEX/kite-trace-platform/docs/kite-trace-mcp-consumer-guide.md)
- [btc-trading-plan-demo-job.md](/E:/CODEX/kite-trace-platform/docs/btc-trading-plan-demo-job.md)
- [aa-session-policy.md](/E:/CODEX/kite-trace-platform/backend/docs/aa-session-policy.md)
