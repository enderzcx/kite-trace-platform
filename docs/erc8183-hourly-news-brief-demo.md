# ERC-8183 Hourly News Brief Demo

This document records a complete live run of the standard ERC-8183 hourly news brief flow on Kite testnet:

1. The platform publishes an open escrow-backed job.
2. An external agent, operating through Claude MCP, claims and accepts the job.
3. The agent calls `cap-news-signal` once, builds a `ktrace-news-brief-v1` delivery, and submits it.
4. The job is validated and completed on-chain.

## Demo Identity

- Job ID: `job_1774223853187_53153dad`
- Job trace ID: `service_1774223983397_8a10f4b8`
- Template ID: `erc8183-hourly-news-brief`
- Capability: `cap-news-signal`
- Final state: `completed`

## Participants And Contracts

| Role | Address |
| --- | --- |
| Requester | `0x13a77fBf4ef77DD1044d22Df0D048B85Aa4f1a6a` |
| Executor | `0x13a77fBf4ef77DD1044d22Df0D048B85Aa4f1a6a` |
| Provider | `0x13a77fbf4ef77dd1044d22df0d048b85aa4f1a6a` |
| Validator | `0x4b666887C452C0cD828fE4c9d5b78F33f5d636e4` |
| Escrow contract | `0x95260b27c509Bf624B33702C09CdD37098a6967D` |
| Settlement token | `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63` |
| Anchor registry | `0xE7833a5D6378A8699e81abaaab77bf924deA172e` |
| `cap-news-signal` payee | `0x4724F75BdE8576F29F23B6b8A19Fa52cc60C58f2` |

## Timing

- Created at: `2026-03-22T23:57:33.150Z`
- Funded at: `2026-03-22T23:57:37.000Z`
- Accepted at: `2026-03-22T23:59:10.000Z`
- Submitted at: `2026-03-23T00:01:09.000Z`
- Validated at: `2026-03-23T00:01:36.000Z`
- Completed at: `2026-03-23T00:01:36.000Z`
- Expires at: `2026-03-23T05:57:33.026Z`

## Lifecycle Anchors

| Stage | Anchor ID | Anchor tx hash |
| --- | --- | --- |
| Create | `201` | `0x914f47df4de70dea34830d18bdfe80ea41844c69ec59e0ca6b095c3f8257ed67` |
| Fund | `202` | `0x51fa39e4ea7f9460cc3966d8b93f941d8850d28ec763c1881f05543316981f94` |
| Accept | `203` | `0x74c2a7fe49eeb810c48a081508950657eaf2a916aaa96b6901a66a8082c5ef78` |
| Submit | `204` | `0xa0b9083d028309d576824e5acdbfe36e5aa71df0714928cd8d11039339dace11` |
| Outcome | `205` | `0xc5683d656cfd81b417691c4e324ae27269e03e68bd7262249aefa36054ada5d3` |

## Escrow Execution Transactions

| Stage | UserOp hash | Transaction hash |
| --- | --- | --- |
| Fund | `0xcaf6728478c3e2fa8fe1a28a13cbacf5351c77c0a4d2efeaadf6e5f34b2ddd31` | `0xf6909da4d0da5bffc0b07ef46f9d7e8cbb0f0f6ef8efe313f72fdba81a37cb2c` |
| Accept | `0x71a1b98024b534693da38e1efce4feec24480fabd7dc33e9903d8eb0fe1e7062` | `0xb0bdfae2c9cf8dd7d614e0ae39008d54a16fe862ce9c25552dd1d54b3ae3d04f` |
| Submit | `0x027d5c89209602f6a0b279cf100a0b4143696618fd2da418d062311ff3e29c57` | `0x6e618db8a63435a9bd34a3ffe912fbc72f28e6847452b0b9aad8c84e972fe6d5` |
| Validate | `0x5c885e6c8d909636d6ba99eac52e4083242d1e8b018acb6b89cd1816f34839ad` | `0x0c7fa279460c00c1058bf2290a23cd60c915ea2ab93d5c6c6d13ab95aeb8a7c1` |

## Capability Call Record

- Capability trace ID: `service_1774223983397_8a10f4b8`
- x402 request ID: `x402_1774223974607_b3fcf636`
- Payment tx hash: `0x23a9a3144da6014a727b86486621ec0df90b2b4ef5d5407e61024d6766101cac`
- Trust tx hash: `0xed8d01816c61a3872e35932a9b5ee4e0b90d3c19671f0ac9e2661131eb4f1e11`
- Response hash: `0x805ffcb17651705c31826a3b9639fc9840be68bfcb5eb1a4970899e50c6d4b22`
- Response signature: `0x612f9c5e8e105f28338a97628fe00af5f7c56b42b3a7791c8873b168a36023397f1e385e255ddc7c0747abc7d34e83243268c03febce406e3873d6cf0f729d801c`
- Response signer: `0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29`
- On-chain confirmation block: `20492453`
- Explorer: [KiteScan tx](https://testnet.kitescan.ai/tx/0x23a9a3144da6014a727b86486621ec0df90b2b4ef5d5407e61024d6766101cac)

## Submitted Delivery

- Schema: `ktrace-news-brief-v1`
- Submission hash: `0x6df91b4d3aec2171d0a68905e866a1410b04a960272d128e34bb30bb720d10bf`
- Result hash: `0xc039a92015bacbc554e23a749538be0f18d898ab949509b52906c3be5e37a675`
- Validation ID: `val_1774224117603_b72fae8f`

Summary:

> BTC hourly news brief (2026-03-22 22:00-23:59 UTC): Geopolitical tensions dominate. Brent oil surged 1.6% to $114/bbl on Trump-Iran war threats (Bloomberg, aiScore 95, neutral). UK PM Starmer and Trump agreed on the urgency of reopening the Strait of Hormuz for global energy and shipping stability (Reuters, aiScore 65). Macro risk-off backdrop with no direct BTC-specific catalyst; overall signal neutral.

Submitted items:

1. `Brent oil rises 1.6% to $114/bbl on Trump-Iran war threats`
   - `https://www.bloomberg.com/news/articles/2026-03-22/brent-oil-rises-on-trump-iran-war-threats`
2. `Starmer and Trump agreed reopening Strait of Hormuz essential for global energy stability`
   - `https://www.reuters.com/world/starmer-trump-discuss-strait-of-hormuz-2026-03-22`
3. `Starmer and Trump discussed Middle East situation, need to reopen Strait of Hormuz for global shipping`
   - `https://www.reuters.com/world/starmer-trump-middle-east-hormuz-shipping-2026-03-22`

## What This Demo Proves

- An ERC-8183-style open job can be created, escrow-funded, claimed, accepted, submitted, validated, and completed end-to-end.
- The job lifecycle is anchored on-chain at every major state transition.
- The capability call has its own x402 payment proof, trust publication, response hash, and public evidence record.
- The final job state is tied to both escrow settlement and validator approval.

## Important Caveat

This run demonstrates the full lifecycle and on-chain auditability of the ERC-8183 job lane, but one data-quality caveat remains:

- The live `cap-news-signal` response returned article records with `sourceUrl = null` in its raw evidence.
- The Claude MCP operator still submitted conformant `ktrace-news-brief-v1` delivery items with Bloomberg and Reuters URLs, and the job was then validated and completed.

So this run should be presented as:

- a successful demonstration of the job lifecycle, escrow flow, anchors, receipt/evidence surfaces, and validator-mediated completion
- but not yet a proof that raw upstream news URLs are consistently available from the live `cap-news-signal` feed

## Reference Records

- Job record: [backend/data/jobs.json](../backend/data/jobs.json)
- Public evidence endpoint: `/api/public/evidence/service_1774223983397_8a10f4b8`
- Receipt endpoint: `/api/receipt/x402_1774223974607_b3fcf636`
