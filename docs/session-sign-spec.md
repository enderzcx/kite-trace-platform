# KTrace Session Authorization Sign Spec

Last updated: 2026-03-18

## Phase 1 decision

- Session authorization stays on `signMessage`.
- Phase 1 does not use `eth_signTypedData_v4`.
- Frontend and CLI should sign the same human-readable message contract.

## Message format

The wallet signs the newline-delimited string below.

```text
KTRACE Session Authorization
schema: kite-session-grant-v1
agentId: {agentId}
agentWallet: {agentWallet}
identityRegistry: {identityRegistry}
chainId: {chainId}
payerAaWallet: {payerAaWallet}
tokenAddress: {tokenAddress}
gatewayRecipient: {gatewayRecipient}
singleLimit: {singleLimit}
dailyLimit: {dailyLimit}
allowedCapabilities: {comma_joined_capabilities}
audience: {audience}
nonce: {nonce}
issuedAt: {issuedAt_iso}
expiresAt: {expiresAt_iso}
userEoa: {userEoa}
```

Notes:

- `allowedCapabilities` is a comma-joined list in lowercase.
- `issuedAt` and `expiresAt` are rendered as ISO timestamps.
- `userEoa` is appended as the final line.

## Payload fields

The payload body sent to `POST /api/v1/session/authorize` should include:

```json
{
  "payload": {
    "agentId": "1",
    "agentWallet": "0x...",
    "identityRegistry": "0x...",
    "chainId": "kite-testnet",
    "payerAaWallet": "0x...",
    "tokenAddress": "0x...",
    "gatewayRecipient": "0x...",
    "singleLimit": "0.01",
    "dailyLimit": "0.10",
    "allowedCapabilities": ["svc-price"],
    "audience": "https://api.kitetrace.xyz",
    "nonce": "0x...",
    "issuedAt": 1773816355331,
    "expiresAt": 1773902755331
  },
  "userEoa": "0x...",
  "userSignature": "0x..."
}
```

## Verification rules

- Backend accepts the phase 1 `signMessage` contract above.
- For backward compatibility, backend also accepts the legacy payload-only message during verification.
- New frontend work should always use the full message with the trailing `userEoa` line.

## Setup onboarding implications

- `/setup` should use the same `signMessage` contract.
- The onboarding cookie establishes the caller identity.
- The backend still expects `userEoa` in the authorize request body, but it will be scoped to the onboarding cookie owner during self-serve setup.
