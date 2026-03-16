# Kite Trace Provider Onboarding

This guide is for a fourth-party builder who wants to onboard a provider into the Kite Trace network without reading internal planning notes.

It covers the minimum path:

1. register an `ERC-8004` agent on Kite testnet
2. self-register a provider through the versioned platform surface
3. complete identity challenge signing with the agent wallet
4. get the provider approved for discovery
5. publish a capability
6. verify that the provider appears in ranked discovery

## What You Need

- a wallet that will act as the agent wallet
- enough Kite testnet gas for:
  - `ERC-8004` registration
  - later trust or job-related actions if you use them
- a reachable Kite Trace backend URL
- `ktrace` installed locally

Current CLI package target:

```powershell
npm install -g @kite-trace/ktrace
```

If the public package has not been published yet, you can still run from source:

```powershell
cd backend
npm install
npm run ktrace -- help
```

## 1. Configure The CLI

At minimum, you need:

- the backend base URL
- the chain
- a wallet address for session and payer context
- an API key that can call the relevant route

Example:

```powershell
ktrace config show
```

Typical runtime flags in this guide:

```powershell
--base-url http://127.0.0.1:3001
--chain kite-testnet
--wallet <your-wallet-address>
--api-key <your-api-key>
```

## 2. Register An ERC-8004 Agent

First register an agent in the deployed `IdentityRegistryV1`.

The current repo uses:

- registry env: `ERC8004_IDENTITY_REGISTRY`
- register script: `backend/scripts/erc8004-register-kiteclaw.js`

Example from source:

```powershell
cd backend
$env:ERC8004_AGENT_WALLET="<your-wallet-address>"
$env:ERC8004_AGENT_NAME="My External Agent"
$env:ERC8004_AGENT_DESCRIPTION="Example provider joining Kite Trace"
$env:ERC8004_AGENT_CAPABILITIES="btc-price-feed"
npm run erc8004:register
```

Record the returned `agentId`. You will use it in the next steps.

## 3. Request An Identity Challenge

Create a provider draft and ask the platform for a challenge.

Example:

```powershell
ktrace --base-url http://127.0.0.1:3001 --api-key <api-key> provider identity-challenge --input provider-identity-challenge.json
```

Example input file:

```json
{
  "providerId": "my-external-agent",
  "name": "My External Agent",
  "role": "provider",
  "mode": "a2api",
  "capabilities": ["btc-price-feed"],
  "identityRegistry": "0x60BF18964FCB1B2E987732B0477E51594B3659B1",
  "identityAgentId": "2"
}
```

Expected result:

- `challengeId`
- a challenge `message`
- the provider draft echoed back

## 4. Sign The Challenge With The Agent Wallet

The signature must come from the wallet that controls the registered `agentId`.

Example with `ethers`:

```powershell
node --input-type=module -e "import { ethers } from 'ethers'; const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY); const message = process.env.KTRACE_CHALLENGE; const sig = await wallet.signMessage(message); console.log(sig);"
```

Where:

- `AGENT_PRIVATE_KEY` is the private key of the registered agent wallet
- `KTRACE_CHALLENGE` is the exact challenge message returned in step 3

## 5. Register The Provider Identity

Now complete provider self-registration with the `challengeId` and signature.

Example:

```powershell
ktrace --base-url http://127.0.0.1:3001 --api-key <api-key> provider register-identity --input provider-register-identity.json
```

Example input file:

```json
{
  "providerId": "my-external-agent",
  "name": "My External Agent",
  "role": "provider",
  "mode": "a2api",
  "capabilities": ["btc-price-feed"],
  "challengeId": "<challenge-id>",
  "signature": "<signature>",
  "identityRegistry": "0x60BF18964FCB1B2E987732B0477E51594B3659B1",
  "identityAgentId": "2"
}
```

Expected result:

- `provider.verification.verified = true`
- `verification.signerType = owner` or `agent_wallet`

## 6. Get Approved For Discovery

Identity verification and discoverability are intentionally separate.

Being able to prove the wallet controls the `agentId` does not automatically make the provider discoverable.

Approval route:

```powershell
ktrace --base-url http://127.0.0.1:3001 --api-key <admin-api-key> provider approve my-external-agent
```

After approval, the provider can appear in discovery.

## 7. Publish A Capability

Publish a capability record for the provider.

Example:

```powershell
ktrace --base-url http://127.0.0.1:3001 --api-key <admin-api-key> capability publish --input capability-publish.json
```

Example input file:

```json
{
  "capabilityId": "svc-my-external-btc",
  "providerId": "my-external-agent",
  "action": "btc-price-feed",
  "name": "BTC Price Feed",
  "description": "External provider BTC price capability",
  "price": "0.00015",
  "active": true
}
```

## 8. Verify Discovery

Check that the provider appears in ranked discovery:

```powershell
ktrace --base-url http://127.0.0.1:3001 --api-key <api-key> discovery select --capability btc-price-feed --discoverable true --limit 10
```

You can also compare and inspect direct-buy recommendation:

```powershell
ktrace --base-url http://127.0.0.1:3001 --api-key <api-key> discovery compare --capability btc-price-feed --limit 5
ktrace --base-url http://127.0.0.1:3001 --api-key <api-key> discovery recommend-buy --capability btc-price-feed
```

## Operational Notes

- `provider approve` currently requires an admin-capable API key
- `capability publish` currently requires an admin-capable API key
- session management is still relevant for buy and job execution, but not for provider registration itself
- if you are testing locally, prefer a fresh backend process to avoid stale-port confusion

## What Success Looks Like

At the end of this flow, you should have:

- a real `ERC-8004` `agentId`
- a verified provider linked to that `agentId`
- an approved and discoverable provider record
- at least one published capability
- visibility in `ktrace discovery select`

That is the minimum proof that your external agent has joined the Kite Trace provider network.
