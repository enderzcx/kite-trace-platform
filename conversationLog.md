# KiteTrace — Human × Agent Collaboration Log

> Submitted to The Synthesis Hackathon (March 2026)
> Builder: Sunny Zheng (@0xenderzcx) — AI payment infrastructure
> Co-builders: Claude Code (CC) + Codex

---

## How it started

The project began from a direct observation: when an AI agent pays for a service, neither the human nor any third party can independently verify what was paid, to whom, or whether the result was actually delivered. Existing solutions either trust the platform or ignore the problem entirely. KiteTrace was built to solve this at the protocol level.

---

## The AA contract evolution — the hardest part

The first major technical arc was the smart contract layer. We started with Kite's native AA wallet, but quickly hit the ceiling: it didn't support ERC-4337 UserOperation flows, which meant no bundler compatibility and no programmable session keys.

CC and I upgraded to a V2 contract with ERC-4337 support — but then hit another wall: the escrow logic for ERC-8183 jobs needed to be co-located with the AA identity, not bolted on separately.

So we designed and deployed a V3 AA factory contract from scratch: a custom `AccountFactory` that deploys ERC-4337-compatible accounts with ERC-8183 escrow hooks built in. This involved:

- Days of debugging the Kite bundler RPC
- Tracking UserOperation reverts
- Diagnosing EntryPoint gas estimation edge cases
- Aligning the AA nonce model with the escrow state machine

Every step was a back-and-forth: Sunny flagged the on-chain revert, CC diagnosed the calldata encoding, Sunny confirmed the fix on Kite testnet explorer.

---

## RPC and bundler debugging

A recurring theme across the build was infrastructure-level debugging. The Kite bundler had subtle differences from the standard ERC-4337 bundler spec — different error codes, non-standard gas fields, and a NO_PROXY requirement for the MCP bridge that took several sessions to isolate. CC traced the bundler response diffs, Sunny tested proxy/no-proxy configurations, and we converged on a routing fix that made the UserOperation pipeline stable.

---

## Building the three-agent job lifecycle

Once the contract layer was stable, we designed the ERC-8183 job lifecycle around three specialized agents:

| Agent | Role |
|-------|------|
| **Requester** | Publishes and funds bounties via escrow |
| **Executor** (via Claude MCP) | Discovers open jobs, pays for ktrace capabilities via x402, builds schema-validated deliveries, submits on-chain |
| **Validator** | Reads the public audit trail, verifies delivery schema, approves completion and releases escrow |

Every state transition (`publish → claim → accept → submit → validate → settle`) is hooked to `TrustPublicationAnchorV1`, producing an immutable on-chain anchor.

The full audit trail — `traceId → paymentTxHash → trustTxHash → on-chain event` — is publicly verifiable by anyone, no platform trust required.

---

## The MCP trust/paid capability debugging arc

After the job lifecycle was running, we hit a harder problem: fresh paid capability calls (`cap-news-signal`, `cap-market-price-feed`, `cap-smart-money-signal`) were failing or timing out, while reads of existing-history evidence worked fine.

CC and I spent several sessions doing layered diagnosis:

1. Confirmed consumer runtime was correctly bound to the self-serve AA (`owner=0x4C8A...`, `aa=0x8D27...`) and not the legacy wallet
2. Traced the upstream provider chain (Hyperliquid, Binance, Open-Meteo) for abort and ECONNRESET patterns
3. Identified that workflow state was staying in `running` after the MCP client aborted, leaving orphaned invocations

This led to fixes in `trustLayerHelpers.js` and `receiptEvidenceRoutes.impl.js` to close the verification loop and make fresh paid calls stable.

---

## The BTC trade plan demo — agent as a real economic actor

The most revealing moment in the build was watching an external Claude Code session (a completely separate MCP client) autonomously:

1. Claim an open BTC trade plan bounty
2. Call `cap-market-price-feed` + `cap-news-signal` + `cap-smart-money-signal` in parallel
3. Build a schema-validated delivery with real traceIds and x402 payment proofs
4. Submit it on-chain
5. Have the validator approve completion and release escrow

All without any human intervention beyond the initial "yes" to claim the job.

At that point the system stopped being a demo and started being infrastructure.

---

## Working style

Every session ran in YOLO mode by Sunny's explicit preference: autonomous execution, minimal confirmation prompts, just build and fix. This forced both agents (CC and Codex) to develop a real judgment about when to pause vs. proceed.

The 54 commits across 20 days reflect that rhythm — architecture discussions, pivot decisions, on-chain debugging, and delivery all happened in the same conversation threads.

---

## What we believe we built

Not a hackathon demo.

An open network where any agent — regardless of platform, provider, or operator — can show up, prove its identity on-chain, discover services, pay for them with cryptographic receipts, execute jobs under enforceable escrow, and leave an audit trail that any human or agent can independently verify.

The infrastructure underneath. The audit layer for agent commerce.
