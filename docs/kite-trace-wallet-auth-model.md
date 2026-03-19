# Kite Trace Wallet and Authorization Model

Updated: 2026-03-18
Status: AA-native

## One-Line Summary

Kite Trace uses owner EOA for authorization, but uses AA wallets for normal payment and execution.

## Roles

### 1. Owner EOA

Owner EOA is for control-plane actions only:

- setup
- session grant
- session revoke
- recovery

Owner EOA is not the normal payer for buy, MCP, or job execution.

### 2. Consumer AA Wallet

Consumer AA wallet is the normal execution wallet for:

- buy direct
- buy request
- MCP paid tool calls
- job fund

This wallet is controlled through session authorization and consumer authority policy.

### 3. Session Key

Session key is the delegated signer for normal AA execution.

It operates within policy constraints such as:

- `allowedCapabilities`
- `allowedProviders`
- `allowedRecipients`
- `singleLimit`
- `dailyLimit`
- `totalLimit`
- `expiresAt`

### 4. Agent AA Wallets

Executor and validator should also execute through AA wallets.

Normal job lifecycle model:

- requester = consumer AA wallet
- executor = executor AA wallet
- validator = validator AA wallet

### 5. Agent Identity Wallet

Identity wallet remains separate from payment and execution.

Use it for:

- `ERC-8004` registration
- provider identity proof
- identity challenge signing

Identity wallet is not the normal settlement wallet.

## Canonical Platform Model

AA-native source of truth:

- [ktrace-full-stack-aa-plan.md](/E:/CODEX/kite-trace-platform/docs/ktrace-full-stack-aa-plan.md)

Canonical execution split:

- owner EOA = control plane
- AA wallets = execution plane

## Implications

1. Consumer onboarding does not require `ERC-8004`.
2. MCP consumer onboarding does not require `ERC-8004`.
3. Job requester / executor / validator should be shown as AA addresses in UI and audit.
4. Legacy owner-signer records remain readable, but are not the recommended model.
