# ERC-8183 Demo Script Index

This file labels the two hourly demo tracks in this repo so reviewers can quickly find the right entry points.

## 1. Hourly BTC Trade Plan Demo

Status:

- Legacy showcase flow
- Useful as an advanced escrow-backed job example
- Not the current "standard example" flow

Primary capability:

- `btc-trade-plan`

Primary template ID:

- `synthesis-btc-trade-plan`

Main scripts:

| Purpose | Script | Notes |
| --- | --- | --- |
| Seed a BTC trade-plan demo job | `backend/scripts/seed-demo-btc-job.js` | Creates the BTC trade-plan job payload and initial job record. |
| Simulate executor delivery | `backend/scripts/run-delivery-agent.js` | Produces and submits the BTC trade-plan result. |
| Simulate validator decision | `backend/scripts/run-verifier-agent.js` | Validates the BTC trade-plan submission. |
| Shared BTC demo helpers | `backend/scripts/demoBtcJobHelpers.js` | Shared helper logic used by the BTC demo scripts. |

Package commands:

```bash
cd backend
npm run demo:btc-job:seed
npm run demo:btc-job:deliver
npm run demo:btc-job:validate
```

Full one-shot run:

```bash
cd backend
npm run demo:btc-job:run
```

Where it appears in the codebase:

- Package scripts: [backend/package.json](../backend/package.json)
- Seed script: [backend/scripts/seed-demo-btc-job.js](../backend/scripts/seed-demo-btc-job.js)
- Delivery script: [backend/scripts/run-delivery-agent.js](../backend/scripts/run-delivery-agent.js)
- Validator script: [backend/scripts/run-verifier-agent.js](../backend/scripts/run-verifier-agent.js)
- Helpers: [backend/scripts/demoBtcJobHelpers.js](../backend/scripts/demoBtcJobHelpers.js)

## 2. Hourly News Brief Demo

Status:

- Current standard ERC-8183 example
- Built around `claim -> accept -> cap-news-signal -> submit -> validate`
- Uses the delivery schema `ktrace-news-brief-v1`

Primary capability:

- `cap-news-signal`

Primary template ID:

- `erc8183-hourly-news-brief`

Main scripts:

| Purpose | Script | Notes |
| --- | --- | --- |
| Trigger the hourly requester loop | `backend/scripts/synthesisDemo.mjs` | Creates and funds hourly news brief jobs. |
| Verify the news brief loop and validator contract | `backend/scripts/verify-hourly-news-brief-job.mjs` | Checks job creation, duplicate suppression, direct-delivery validation, and completion. |

Core runtime implementation:

| Purpose | File | Notes |
| --- | --- | --- |
| Hourly requester/validator loop | `backend/lib/loops/synthesisRequestLoop.js` | Creates open news jobs and validates submitted ones. |
| News delivery schema and hard validation | `backend/lib/deliverySchemas/newsBriefV1.js` | Defines `ktrace-news-brief-v1` and validates `newsTraceId`, `paymentTxHash`, `trustTxHash`, and URLs. |
| Loop control routes | `backend/routes/synthesisRoutes.js` | Exposes status and trigger endpoints for the loop. |

Package commands:

```bash
cd backend
node scripts/synthesisDemo.mjs
```

Verification:

```bash
cd backend
npm run verify:job:hourly-news-brief
```

Where it appears in the codebase:

- Package scripts: [backend/package.json](../backend/package.json)
- Demo trigger script: [backend/scripts/synthesisDemo.mjs](../backend/scripts/synthesisDemo.mjs)
- Verification script: [backend/scripts/verify-hourly-news-brief-job.mjs](../backend/scripts/verify-hourly-news-brief-job.mjs)
- Loop runtime: [backend/lib/loops/synthesisRequestLoop.js](../backend/lib/loops/synthesisRequestLoop.js)
- Delivery schema: [backend/lib/deliverySchemas/newsBriefV1.js](../backend/lib/deliverySchemas/newsBriefV1.js)
- Route surface: [backend/routes/synthesisRoutes.js](../backend/routes/synthesisRoutes.js)

## Recommended Reviewer Path

If a reviewer only has time to inspect one flow:

1. Start with the hourly news brief demo.
2. Use the live run record in [erc8183-hourly-news-brief-demo.md](./erc8183-hourly-news-brief-demo.md).
3. Treat the BTC trade-plan flow as the older, richer showcase of a custom fulfillment job.
