# BTC Trading Plan Demo Job

Last updated: 2026-03-18

## Status

| Owner | Status |
|---|---|
| Backend (Codex) | AA-native implementation landed, live rerun pending |
| Frontend (CC) | Unblocked, can build `/demo` now |

Latest successful live run:

- `jobId`: `job_1773836948620_0d579ff1`
- public audit: `GET /api/public/jobs/job_1773836948620_0d579ff1/audit`
- handoff artifact: `backend/data/demo_btc_job.json`

AA-native update:

- the backend job lane now executes through AA runtimes
- the currently pinned live artifact above predates the AA-native rerun
- the next demo rerun should update `backend/data/demo_btc_job.json` so requester / executor / validator are AA addresses

---

## Purpose

Run one complete ERC-8183-style job on Kite Testnet that exercises the full ktrace stack and produces a publicly auditable result. The resulting `jobId` is pinned to `NEXT_PUBLIC_DEMO_JOB_ID` so the frontend can display a live audit without requiring manual input.

The job task is: **produce a BTC/USDT intraday trading plan, backed by on-chain verifiable data calls and payment receipts from ktrace capabilities.**

---

## Lifecycle Summary

```text
seed script
  POST /api/jobs                 -> state: created
  POST /api/jobs/:jobId/fund     -> state: funded

delivery agent
  POST /api/jobs/:jobId/accept   -> state: accepted
  POST /mcp (tools/list)
  POST /mcp (tools/call x N)     -> collect traceId, requestId, txHash, evidenceRef
  assemble ktrace-btc-trading-plan-v1 payload
  POST /api/jobs/:jobId/submit   -> state: submitted

verifier agent
  GET  /api/public/jobs/:jobId/audit
  schema check + proof check
  POST /api/jobs/:jobId/validate -> state: completed

public audit
  GET  /api/public/jobs/:jobId/audit   (no auth)
```

---

## Actors

### Request Agent (seed script)

- Auth: static `agent` API key
- Script: `backend/scripts/seed-demo-btc-job.js`
- Creates and funds the job, then writes the handoff artifact to `backend/data/demo_btc_job.json`
- Uses requester AA wallet for escrow funding

### Delivery Agent

- Auth: static `agent` API key plus active session authority for MCP calls
- Script: `backend/scripts/run-delivery-agent.js`
- Reads the handoff artifact, accepts the job, calls ktrace MCP tools, assembles the delivery payload, and submits the trading plan
- Uses AA session payer for paid MCP calls

### Verifier Agent

- Auth: static `agent` API key
- Script: `backend/scripts/run-verifier-agent.js`
- Fetches public audit, checks schema conformance and proof references, then calls `POST /api/jobs/:jobId/validate`

---

## Job Specification

### Task text

```text
Provide a BTC/USDT trading plan for today.

Required deliverables:
- current market snapshot (price, 24h volume)
- directional bias (long / short / neutral)
- entry price and entry zone
- at least two take-profit targets, each with a rationale
- stop-loss level with rationale
- risk/reward ratio
- short analysis summary (key levels, sentiment)

All market data must be sourced through registered ktrace capabilities.
At least one capability call must be a paid call that produces a payment receipt.
The final delivery must include the primary traceId and payment receipt references.
```

### Job creation parameters

| Field | Value | Notes |
|---|---|---|
| `provider` | derived from catalog at seed time | current live success used `fundamental-agent-real` |
| `capability` | derived from catalog at seed time | current live success used `btc-price-feed` |
| `input` | task text + schema identifier | embedded in job body |
| `budget` | `0.00015` | current live-success budget |
| `escrowAmount` | `0.00015` | matches budget |
| `expiresAt` | now + 24h | |
| `payer` | requester AA wallet | current pinned artifact should be replaced by the next AA-native rerun |
| `executor` | executor AA wallet | current pinned artifact should be replaced by the next AA-native rerun |
| `validator` | validator AA wallet | current pinned artifact should be replaced by the next AA-native rerun |

Note: the escrow contract enforces requester / executor / validator role addresses onchain. In Kite Trace those role addresses are now interpreted as AA addresses, not owner EOAs.

### Delivery schema

Schema identifier: `ktrace-btc-trading-plan-v1`

```json
{
  "schema": "ktrace-btc-trading-plan-v1",
  "asset": "BTC/USDT",
  "generatedAt": "<ISO timestamp>",
  "marketSnapshot": {
    "price": 0,
    "priceSource": "<capability or service id used>",
    "volume24h": 0,
    "dominance": 0
  },
  "tradingPlan": {
    "bias": "long | short | neutral",
    "timeframe": "1D",
    "entry": {
      "price": 0,
      "zone": [0, 0]
    },
    "takeProfit": [
      { "target": 1, "price": 0, "rationale": "" },
      { "target": 2, "price": 0, "rationale": "" }
    ],
    "stopLoss": {
      "price": 0,
      "rationale": ""
    },
    "riskRewardRatio": 0
  },
  "analysis": {
    "summary": "",
    "keyLevels": [],
    "sentiment": "bullish | bearish | neutral"
  },
  "evidence": {
    "primaryTraceId": "<traceId from primary paid capability call>",
    "primaryEvidenceRef": "/api/evidence/export?traceId=<traceId>",
    "paymentRequestId": "<requestId from paid capability call>",
    "paymentTxHash": "<txHash if present>",
    "dataSourceTraceIds": ["<traceId from each capability call>"],
    "receiptRefs": ["/api/receipt/<requestId>"],
    "deliveredAt": "<ISO timestamp>"
  }
}
```

Evidence field rationale:

- ktrace capability invocations return `traceId`, `requestId`, `txHash`, `receiptRef`, and `evidenceRef`
- the `evidence` block above maps directly to those backend output fields
- there is no separate `x402TxId`; payment proof is represented through `paymentRequestId`, `paymentTxHash`, and `receiptRefs`

---

## Full Lifecycle

### Phase 1 - Create and fund

Script: `backend/scripts/seed-demo-btc-job.js`

1. Discover a valid provider and capability from the current catalog via `GET /api/v1/capabilities`
2. `POST /api/jobs` with provider, capability, input, budget, payer, executor, validator, and `expiresAt`
3. `POST /api/jobs/:jobId/fund` with `escrowAmount = 0.00015`
4. Assert the response state is `funded`
5. Write the handoff artifact:

```json
{
  "jobId": "job_...",
  "traceId": "job_...",
  "provider": "fundamental-agent-real",
  "capability": "btc-price-feed",
  "budget": "0.00015",
  "payer": "0xf02...",
  "executor": "0x2f0...",
  "validator": "0x831...",
  "seededAt": "<ISO timestamp>"
}
```

### Phase 2 - Accept

Script: `backend/scripts/run-delivery-agent.js`

1. Load `backend/data/demo_btc_job.json`
2. `POST /api/jobs/:jobId/accept`
3. Assert the state is `accepted`

### Phase 3 - Gather data via ktrace MCP

Script: `backend/scripts/run-delivery-agent.js`

The delivery agent discovers available tools via `tools/list`, then calls the BTC MCP tool. At least one paid call must succeed and produce a receipt.

MCP call pattern:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "ktrace__svc_fundamental_agent_real_btc",
    "arguments": {
      "pair": "BTCUSDT",
      "symbol": "BTCUSDT",
      "asset": "BTC",
      "timeframe": "1D",
      "payer": "<session aa wallet>"
    }
  }
}
```

Response fields collected per call:

| Field | Required | Use |
|---|---|---|
| `traceId` | yes | goes into `dataSourceTraceIds` and primary evidence |
| `requestId` | yes if paid | `paymentRequestId` |
| `txHash` | if present | `paymentTxHash` |
| `evidenceRef` | yes | `primaryEvidenceRef` |
| `receiptRef` | yes for paid path | `receiptRefs` |

Minimum evidence set required for a valid submission:

- one primary paid capability trace with `traceId` and `requestId`
- one `evidenceRef`
- one `receiptRef`

### Phase 4 - Submit delivery

Script: `backend/scripts/run-delivery-agent.js`

Assemble the `ktrace-btc-trading-plan-v1` payload using the paid MCP call result, then submit:

```json
{
  "delivery": {
    "schema": "ktrace-btc-trading-plan-v1",
    "...": "full trading plan payload"
  },
  "primaryTraceId": "<traceId>",
  "paymentRequestId": "<requestId>",
  "paymentTxHash": "<txHash>",
  "evidenceRef": "/api/evidence/export?traceId=<traceId>",
  "receiptRefs": ["/api/receipt/<requestId>"],
  "dataSourceTraceIds": ["<traceId>"]
}
```

Assert the state after submit is `submitted`.

### Phase 5 - Validate

Script: `backend/scripts/run-verifier-agent.js`

1. `GET /api/public/jobs/:jobId/audit`
2. Assert delivery payload is present
3. Assert `evidence.primaryTraceId` is non-empty
4. Assert `evidence.paymentRequestId` is non-empty
5. Assert `evidence.receiptRefs` has at least one entry
6. Schema-validate the delivery payload against `ktrace-btc-trading-plan-v1`
7. `POST /api/jobs/:jobId/validate` with `{ "approved": true }`
8. Assert final state is `completed`

The verifier does not evaluate trading quality. It only checks that the proof references exist and the payload conforms to schema.

### Phase 6 - Public audit

After completion, any caller can inspect the full audit:

```text
GET /api/public/jobs/:jobId/audit
GET /api/public/jobs/by-trace/:traceId/audit
```

The audit response must include at minimum:

- full lifecycle transitions with timestamps: `created -> funded -> accepted -> submitted -> completed`
- `deliveryStandard.schema = ktrace-btc-trading-plan-v1`
- `deliveryStandard.conformant = true`
- `evidence.primaryTraceId`
- `evidence.paymentRequestId`
- `evidence.receiptRefs`

---

## Backend Scope (Codex)

### Deliverables

| # | File | Description |
|---|---|---|
| 1 | `backend/scripts/seed-demo-btc-job.js` | Create, fund, write handoff artifact |
| 2 | `backend/scripts/run-delivery-agent.js` | Accept, MCP calls, assemble, submit |
| 3 | `backend/scripts/run-verifier-agent.js` | Proof check, schema check, validate |
| 4 | `backend/lib/deliverySchemas/btcTradingPlanV1.js` | Runtime schema validator reused by submit, verifier, and audit |
| 5 | `backend/routes/jobLane/jobMutationRoutes.js` | Submit path accepts and persists `delivery` |
| 6 | `backend/routes/jobLane/sharedJobState.js` | Audit model exposes delivery schema + conformance + evidence refs |
| 7 | `backend/routes/receiptEvidenceRoutes.impl.js` | Audit snapshot includes delivery and delivery standard |

### npm scripts

Current `backend/package.json` entries:

```json
"demo:btc-job:seed": "node .\\scripts\\seed-demo-btc-job.js",
"demo:btc-job:deliver": "node .\\scripts\\run-delivery-agent.js",
"demo:btc-job:validate": "node .\\scripts\\run-verifier-agent.js",
"demo:btc-job:run": "npm run demo:btc-job:seed && npm run demo:btc-job:deliver && npm run demo:btc-job:validate"
```

### Current gap inventory

| Item | Exists today |
|---|---|
| `POST /api/jobs` | yes |
| `POST /api/jobs/:jobId/fund` | yes |
| `POST /api/jobs/:jobId/accept` | yes |
| `POST /api/jobs/:jobId/submit` with `delivery` field | yes |
| `POST /api/jobs/:jobId/validate` | yes |
| `GET /api/public/jobs/:jobId/audit` | yes |
| Audit exposes `deliveryStandard.conformant` | yes |
| `backend/lib/deliverySchemas/btcTradingPlanV1.js` | yes |
| Demo scripts | yes |
| `backend/data/demo_btc_job.json` | yes |

---

## Frontend Scope (CC)

CC does not implement any agent or script logic. Frontend work is limited to:

### 1. Environment variable

Set after seed succeeds:

```env
NEXT_PUBLIC_DEMO_JOB_ID=job_1773836948620_0d579ff1
```

Also document in `.env.example`:

```env
# Pinned demo job for the /demo audit page.
NEXT_PUBLIC_DEMO_JOB_ID=
```

### 2. `/demo` page

Files:

- `app/demo/page.tsx`
- `components/demo/DemoAuditClient.tsx`

Behavior:

- on mount, fetch `GET /api/public/jobs/${NEXT_PUBLIC_DEMO_JOB_ID}/audit`
- if env is unset or fetch returns 404, show `Demo job not seeded yet`
- if fetch succeeds, render the full audit

UI elements to render:

| Element | Source field |
|---|---|
| Job state chip | `audit.summary.state` |
| Lifecycle timeline | `audit.lifecycle` |
| Delivery schema badge | `audit.deliveryStandard.schema` + `audit.deliveryStandard.conformant` |
| Market snapshot card | `audit.delivery.marketSnapshot` |
| Trading plan card | `audit.delivery.tradingPlan` |
| Analysis summary | `audit.delivery.analysis.summary` |
| Evidence links | `audit.evidence.primaryTraceId`, `audit.evidence.receiptRefs`, `audit.evidence.evidenceRef` |
| Escrow info | `audit.contractPrimitives` |

### 3. Homepage link (optional)

If `/demo` is built, add a `Live Demo` link to the homepage nav and footer.

---

## Acceptance Criteria

### Backend

- `npm run demo:btc-job:seed` exits `0`, prints a valid `jobId`, and writes `backend/data/demo_btc_job.json`
- `npm run demo:btc-job:deliver` exits `0`, job state is `submitted`
- `npm run demo:btc-job:validate` exits `0`, job state is `completed`
- `GET /api/public/jobs/:jobId/audit` returns HTTP 200 with:
  - `audit.delivery`
  - `audit.deliveryStandard.schema = "ktrace-btc-trading-plan-v1"`
  - `audit.deliveryStandard.conformant = true`
  - `audit.evidence.primaryTraceId`
  - `audit.evidence.paymentRequestId`
  - `audit.evidence.receiptRefs`

### Frontend

- `NEXT_PUBLIC_DEMO_JOB_ID` is documented in `.env.example`
- `/demo` auto-loads the audit on mount using the pinned env var
- `/demo` shows a graceful `not seeded yet` placeholder when env is unset
- lifecycle timeline renders all five transitions
- delivery schema badge reflects `conformant` status
- evidence links are visible and point to the correct refs

---

## Handoff Artifact

Current artifact file:

```json
{
  "jobId": "job_1773836948620_0d579ff1",
  "traceId": "job_1773836948616_b2682190",
  "provider": "fundamental-agent-real",
  "capability": "btc-price-feed",
  "budget": "0.00015",
  "payer": "0xf02fe12689e5026707d1be150b268e0fa5a37320",
  "executor": "0x2f0CF9B2B2bFbCE4e63DBD44c5AbD772FD2b5122",
  "validator": "0x831C5C93a221D8508ad4808C2A64D58B15f77c85",
  "seededAt": "2026-03-18T12:29:15.435Z"
}
```

CC can use `jobId` directly for `NEXT_PUBLIC_DEMO_JOB_ID` and consume the public audit route immediately.
