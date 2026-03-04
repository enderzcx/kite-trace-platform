# Kite Trace Platform

Kite Trace Platform is an auditable multi-agent trading workflow demo built on Kite testnet.

Core loop:

`ERC8004 identity -> XMTP negotiation -> x402 settlement -> Agent001 decision -> API execution`

## What this repo contains

- `backend/`: Express backend, workflow routes, XMTP/x402 orchestration, Hyperliquid testnet execution bridge
- `agent-network/`: Next.js frontend for flow visualization, BTC panel, position view, and execution controls
- `data/`: shared static/demo data used by the app

## Quick start

### 1) Backend

```bash
cd backend
npm install
npm start
```

Backend default: `http://localhost:3001`

### 2) Frontend

```bash
cd agent-network
npm install
npm run dev
```

Frontend default: `http://localhost:3000`

If needed, set `NEXT_PUBLIC_BACKEND_URL` in frontend runtime env.

## Demo flow

1. Click **Fetch Current Trade Plan**
2. Watch flow steps: ERC8004 -> XMTP quote -> x402 service settlement -> service result
3. Review Agent001 plan and rationale
4. Click **Execute This Plan** for Agent-to-API execution
5. Verify tx references and audit trail

## Security and publishing notes

This repo intentionally excludes sensitive/runtime files:

- `重要信息.md` (must never be uploaded)
- `backend/.env`
- runtime DB/log/temp artifacts under `backend/data`, `backend/logs`, and build folders

Use `backend/.env.example` as the template.

## Status

Current stage: demo/prototype focused on auditability and full traceability.
