# ERC-8183 Live Verification Runbook

Updated: 2026-03-18

## Scope

This note captures the first live `P0-C` verification pass for the current ERC-8183 job lane.

Goal:

- verify escrow allowance readiness
- verify one real escrow-backed job can progress onchain
- record exact tx hashes and failure points before approval work begins
- keep AA-runtime funding requirements explicit once deadline / stake / slash enforcement is enabled

AA-native update:

- requester / executor / validator should now be treated as AA addresses
- `npm run erc8183:approve:escrow` now prepares allowance through AA runtimes, not owner EOAs
- a fresh live rerun should replace any older signer-based demo artifact

## Environment

- repo: `E:\CODEX\kite-trace-platform`
- backend port used for this pass: `3188`
- chain: `kite-testnet`
- settlement token: `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63`
- escrow contract: `0x999a8c5d727a7800E6c44434496E6E1F3D0De092`
- lifecycle anchor registry: `0xbCe10BEA54575d202a4f5894025A20ed0ed58410`

## Reliability Hardening Added During This Pass

To reduce transport flakiness before continuing verification, the following narrow retry changes were added:

- [escrowHelpers.js](/E:/CODEX/kite-trace-platform/backend/lib/escrowHelpers.js)
  - retry transport-like onchain failures for:
    - `lockEscrowFunds`
    - `acceptEscrowJob`
    - `submitEscrowResult`
    - `validateEscrowJob`
    - `getEscrowJob`
- [onchainAnchors.js](/E:/CODEX/kite-trace-platform/backend/lib/onchainAnchors.js)
  - retry transport-like failures for trust/job anchor publish + receipt waits
- [erc8183-approve-escrow.js](/E:/CODEX/kite-trace-platform/backend/scripts/erc8183-approve-escrow.js)
  - retry allowance read and approve transaction flow

These changes were intentionally transport-scoped and did not modify job state-machine logic.

## Allowance Verification

Command:

```powershell
cd backend
npm run erc8183:approve:escrow
```

Observed result shape:

```json
{
  "settlementToken": "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
  "escrow": "0x999a8c5d727a7800E6c44434496E6E1F3D0De092",
  "approvals": [
    {
      "roles": ["requester"],
      "owner": "0x...",
      "approved": false,
      "skipped": true,
      "allowance": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      "txHash": ""
    },
    {
      "roles": ["executor"],
      "owner": "0x...",
      "approved": true,
      "skipped": false,
      "allowance": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      "txHash": "0x..."
    }
  ]
}
```

Interpretation:

- requester allowance must exist for funding
- executor allowance must also exist when executor stake is non-zero
- the helper script now prepares both roles in one pass

## Fresh Backend Startup

Command:

```powershell
cd backend
npm run start:fresh -- -Port 3188
```

Health check:

```json
{
  "ok": true,
  "network": "kite-testnet",
  "autoJobExpiry": {
    "enabled": false
  }
}
```

Session readiness:

```powershell
npm run ktrace -- --json --base-url http://127.0.0.1:3188 --api-key agent-local-dev-key auth session
```

Observed:

- AA session ready
- owner: `0xf02fe12689e5026707d1be150b268e0fa5a37320`
- payer AA wallet: `0x514ae5f90bcfd2a6cd61aea032f76702861fcee4`

## Live Job Attempt A

Provider:

- `fundamental-agent-real`
- capability: `btc-price-feed`

Create:

- jobId: `job_1773734526793_20b1be92`
- traceId: `job_1773734526778_2b9d311a`
- createAnchorId: `34`
- createAnchorTxHash: `0x137df8b64c0da8d0a68e99604dfc8c141eb670eb35190e937fbff4ba03fd610b`

Fund:

- state: `funded`
- escrowFundTxHash / paymentTxHash: `0xfd2c77dd3173858df036315d384e7660a679f98db5ba814dccedf2c0ac85a505`
- fundingAnchorId: `35`
- fundingAnchorTxHash: `0x77e988251dd8d1b0a86ad5663773c9f9313de80c4b52ee89cec907434ce0c3b9`

Accept:

- state: `accepted`
- escrowAcceptTxHash: `0x061a8147d0faceb0ca145990ed8a38bf35ebfbf61d53da250d115193d5853d25`
- acceptAnchorId: `36`
- acceptAnchorTxHash: `0x5fdaa702b2522818acdecd204b4b8baff1a369259a872eb7de67bfbc6a15d6a1`

Submit:

- CLI timed out on first pass
- backend audit/evidence showed:
  - workflow created
  - `challenge_issued` written
  - x402 request created
  - workflow never advanced to `payment_sent`

Key evidence fields:

- runtimeSnapshot.authorizedBy: `0xf02fe12689e5026707d1be150b268e0fa5a37320`
- authorizationMode: `user_grant_self_custodial`
- authorizationPayloadHash present

Interpretation:

- escrow-backed create/fund/accept are live
- submit path is not yet reliable for this provider/capability pair

## Live Job Attempt B

Provider:

- `data-node-real`
- capability: `market-price-feed`

Input file:

- [ktrace-job-market-input.json](/E:/CODEX/kite-trace-platform/backend/data/ktrace-job-market-input.json)

Create:

- jobId: `job_1773735189551_a23852cf`
- traceId: `job_1773735189547_a1dccaf7`
- createAnchorId: `38`
- createAnchorTxHash: `0x9731c878f1d9c47f73056d810f0a60061a6cb2b165b61fa58c6b780e2bd4898c`

Fund:

- state: `funded`
- escrowFundTxHash / paymentTxHash: `0x0eeab74bc22919d7e7b10edc0b08c37ddee4ed00e03dfd877c28397dfc1f25f2`
- fundingAnchorId: `39`
- fundingAnchorTxHash: `0xbf0ad28592604a716f9ea51f8e9e1c06849737b1fd953b5ddfb79c567ffa9206`

Accept:

- state: `accepted`
- escrowAcceptTxHash: `0xf6a49e6eaf10c3c8d5ffd1be3acfd88114fe63d7895f8326f4b6d1724b28afe9`
- acceptAnchorId: `40`
- acceptAnchorTxHash: `0xb0659b5f14cdb597dc05258faa7e676642c7fa979fa6ca811e166a3674f7e043`

Submit:

- failed quickly instead of hanging
- workflow reached explicit terminal failure
- latest failure reason: `This operation was aborted`

Observed workflow details:

- requestId: `x402_1773735265647_c504a301`
- workflow state: `failed`
- steps:
  - `challenge_issued`
  - `failed`

Interpretation:

- transport hardening improved the chain-side reliability enough to make create/fund/accept reproducible
- submit now fails audibly and auditably instead of silently hanging
- current blocker has moved up to provider invoke / x402 execution for this service path

## Smoke Verification

Command:

```powershell
cd backend
npm run verify:ktrace:smoke
```

Current status:

- still failing
- current failure:
  - `job create did not publish create anchor`

Note:

- this smoke script uses its own seeded in-memory scenario and remains flaky under the current network conditions
- the live manual pass above is currently more informative than the smoke result for ERC-8183 readiness

## Current Conclusion

What is already confirmed live:

- escrow allowance is present and sufficient
- real onchain lifecycle write path works for:
  - `create`
  - `fund`
  - `accept`
- lifecycle anchors are being written onchain
- session authorization evidence is carried into job evidence exports

What is not yet confirmed live:

- one full terminal success path for an escrow-backed job under the current network/provider conditions
- reliable `submit -> validate -> outcome anchor` for the tested live provider pairs

## Next Actions

1. Investigate `job submit` provider invoke failures
- `fundamental-agent-real / btc-price-feed`
- `data-node-real / market-price-feed`

2. Decide whether to add narrow retry around provider invoke for job submit

3. Re-run one escrow-backed job until a terminal success path is captured with:
- submit anchor tx hash
- validate tx hash
- outcome anchor tx hash
- receipt ref
- evidence ref
