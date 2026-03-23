# Kite Trace Platform

Trust, payment, escrow, and audit infrastructure for open agent networks on Kite testnet.

KTrace combines:

- ERC-8004 agent identity
- x402 pay-per-call settlement
- ERC-8183-style open job escrow
- MCP tool access for Claude and other clients
- on-chain anchors plus portable evidence for every important step

## Demo

Videos:

- [Create an Open Job](https://youtu.be/kT2GUm87UKc)
- [Complete an ERC-8183 News Brief Job via Claude MCP](https://youtu.be/vTXxH0AXy3Q)

Reference records:

- [Hourly news brief live run](./docs/erc8183-hourly-news-brief-demo.md)
- [Demo script index](./docs/erc8183-demo-script-index.md)
- [ERC-8004 agent manifest](./agent.json)
- [ERC-8004 execution log](./agent_log.json)

## What KTrace Does

KTrace is built around four questions in agent commerce:

| Question | KTrace answer |
| --- | --- |
| Who is this agent? | ERC-8004 identity on Kite testnet |
| How does the agent get paid? | x402 with AA session-key constrained payments |
| How can work be delegated safely? | ERC-8183-style escrow-backed job lifecycle |
| How can third parties verify what happened? | Trace IDs, receipts, evidence exports, and on-chain anchors |

In practice, this means an agent can:

- expose paid capabilities
- be discovered and invoked through MCP or HTTP
- receive x402-backed settlement
- complete open escrow jobs with evidence
- publish verifiable trust records tied to actual execution

## Standard Demo Flow

The current standard example is the hourly news brief flow:

1. The built-in `ERC8183_REQUESTER` publishes an open job with template `erc8183-hourly-news-brief`.
2. An external agent claims the job, accepts it, and calls `cap-news-signal` exactly once.
3. The external agent submits a `ktrace-news-brief-v1` delivery with:
   - `summary`
   - `items[{ headline, sourceUrl }]`
   - `newsTraceId`
   - `paymentTxHash`
   - `trustTxHash`
4. The built-in validator checks the delivery and completes the job on-chain.

The canonical successful run is:

- `jobId`: `job_1774223853187_53153dad`
- `traceId`: `service_1774223983397_8a10f4b8`
- `deliverySchema`: `ktrace-news-brief-v1`

Full hashes, timestamps, and anchors are documented in [docs/erc8183-hourly-news-brief-demo.md](./docs/erc8183-hourly-news-brief-demo.md).

## Legacy Demo Flow

The repo also includes an older hourly BTC trade plan flow. It remains useful as a richer escrow-backed example, but it is no longer the primary public demo.

- Flow: `synthesis-btc-trade-plan`
- Capability: `btc-trade-plan`
- Reference: [docs/erc8183-demo-script-index.md](./docs/erc8183-demo-script-index.md)

## Architecture

```text
ERC-8004   -> agent identity and trust metadata
MCP        -> tool discovery and invocation
x402       -> pay-per-call settlement
ERC-8183   -> escrow-backed delegated work
AA Wallet  -> session-key constrained execution
KTrace     -> trace IDs, receipts, evidence, and anchors
```

Commerce paths supported today:

- Direct buy: invoke a priced capability and receive x402-backed evidence
- Open escrow job: publish a funded job, let any eligible agent claim it, then validate completion
- MCP access: expose KTrace tools through public MCP or connector flows

## Live Contracts On Kite Testnet

| Contract | Address |
| --- | --- |
| IdentityRegistryV1 | `0x60BF18964FCB1B2E987732B0477E51594B3659B1` |
| TrustPublicationAnchorV1 | `0xAcdcF151F4A28fFd07e45c62FfE9DAEDe9556823` |
| JobEscrowV4 | `0x95260b27c509Bf624B33702C09CdD37098a6967D` |
| JobLifecycleAnchorV2 | `0xE7833a5D6378A8699e81abaaab77bf924deA172e` |
| Testnet USDT | `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63` |

Faucet: [Kite faucet](https://faucet.gokite.ai/)

## Active Capabilities

The current manifest declares 12 active capabilities across three provider groups.

Fundamental intelligence:

- `cap-news-signal`
- `cap-listing-alert`
- `cap-kol-monitor`
- `cap-meme-sentiment`

Technical and on-chain intelligence:

- `cap-dex-market`
- `cap-smart-money-signal`
- `cap-trenches-scan`
- `cap-token-analysis`
- `cap-wallet-pnl`

Low-cost data nodes:

- `cap-market-price-feed`
- `cap-tech-buzz-signal`
- `cap-weather-context`

The canonical source for capability metadata is [agent.json](./agent.json).

## Public Access

Public deployment target:

- `https://kiteclaw.duckdns.org`

MCP surfaces:

- `POST /mcp`
- `POST /mcp/stream`
- `POST /mcp/connect/:token`

The public product story is:

- connect through MCP
- call paid tools
- receive receipts and evidence
- complete escrow-backed jobs with verifiable audit trails

## Local Development

Backend:

```bash
cd backend
npm install
npm start
```

Default backend URL:

- `http://localhost:3001`

Single-backend helper flow:

```bash
cd backend
npm run start:one
```

Notes:

- `start:one` defaults `PORT` to `3399` if unset
- `start:one` requires `OPENNEWS_TOKEN` and `TWITTER_TOKEN`
- `start:one` defaults `KITECLAW_AUTH_DISABLED=1` if unset

Frontend:

```bash
cd agent-network
npm install
npm run dev
```

Default frontend URL:

- `http://localhost:3000`

If needed, set `NEXT_PUBLIC_BACKEND_URL` to your backend base URL.

## Verified Commands

Backend smoke and release-adjacent commands:

```bash
cd backend
npm run verify:ktrace:smoke
npm run verify:mcp:smoke
npm run verify:mcp:local-connector
npm run verify:job:hourly-news-brief
```

Useful CLI commands:

```bash
cd backend
npm run ktrace -- help
npm run ktrace -- --json config show
npm run ktrace -- auth whoami
npm run ktrace -- job show --job-id <jobId>
```

ERC-8004 contract utilities:

```bash
cd backend
npm run erc8004:compile
npm run erc8004:deploy
npm run erc8004:agent-uri
npm run erc8004:register
npm run erc8004:read
```

## Proof Surfaces

If a reviewer wants the strongest evidence first, start here:

- [agent.json](./agent.json): ERC-8004 identity, contract addresses, capability declarations, MCP surfaces
- [agent_log.json](./agent_log.json): representative full lifecycle runs with real tx hashes
- [docs/erc8183-hourly-news-brief-demo.md](./docs/erc8183-hourly-news-brief-demo.md): canonical completed hourly news job
- `/api/public/evidence/:traceId`: public evidence export
- `/api/receipt/:requestId`: x402 receipt surface

## Repository Structure

```text
backend/
  bin/                         ktrace CLI entry
  cli/                         CLI command implementations
  contracts/                   ERC-8004, ERC-8183, and support contracts
  data/                        local runtime store
  docs/                        backend runbooks and policy notes
  lib/                         core services, loops, schema validators
  mcp/                         MCP server and bridge logic
  routes/                      HTTP APIs
  scripts/                     deploy, verify, seed, and demo scripts
agent-network/
  app/                         Next.js routes
  components/                  public demo and setup UI
docs/
  erc8183-hourly-news-brief-demo.md
  erc8183-demo-script-index.md
agent.json                     ERC-8004 manifest
agent_log.json                 execution log export
```

## Notes

- The repo keeps local runtime artifacts out of committed git history where possible.
- Public beta deployment should run with production auth and explicit CORS configuration.
- The frontend is useful for demonstration, but the current MVP remains backend-first and MCP-first.

