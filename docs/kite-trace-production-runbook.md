# Kite Trace Production Runbook

## Scope

This runbook is the current source of truth for deploying and validating Kite Trace on:

- Domain: `https://kiteclaw.duckdns.org`
- Host: `root@49.51.247.141`
- App root: `/srv/kiteclaw/app`

It reflects the live production layout that is working as of `2026-03-19`.

For the shortest repeatable deployment path and the lessons learned from recent live pushes, also read:

- `docs/kite-trace-fast-deploy-checklist.md`

## Live Topology

Production currently runs as:

- Nginx on `80/443`
- Backend Express on `127.0.0.1:3001`
- Next frontend on `127.0.0.1:4010`
- PM2 process names:
  - `kiteclaw-backend`
  - `kiteclaw-agent-network`

Request routing is:

- `/.well-known/mcp.json` -> backend
- `/mcp` -> backend
- `/api/events/stream` -> backend
- `/api/setup/*` -> frontend Next API routes
- `/api/authority/*` -> frontend Next API routes
- `/api/demo/*` -> frontend Next API routes
- `/api/health` -> frontend Next API route
- `/api/*` -> backend
- `/` -> frontend

## Deployment Artifacts

Recommended deployment unit:

- `backend/`
- `agent-network/`

Do not overwrite these runtime-owned paths during deployment:

- `/srv/kiteclaw/app/backend/.env`
- `/srv/kiteclaw/app/backend/data/`
- `/srv/kiteclaw/app/agent-network/.env.production.local` unless intentionally updating frontend env

## Environment Ownership

### Backend

Runtime secrets and chain config live in:

- `/srv/kiteclaw/app/backend/.env`

This file should be preserved across code deploys.

Critical fields that must exist for the currently deployed stack:

- `KITEAI_RPC_URL`
- `KITEAI_BUNDLER_URL`
- `KITECLAW_BACKEND_SIGNER_PRIVATE_KEY`
- `OPENNEWS_TOKEN`
- `TWITTER_TOKEN`
- `ERC8183_REQUESTER_AA_ADDRESS`
- `ERC8183_EXECUTOR_AA_ADDRESS`
- `ERC8183_VALIDATOR_AA_ADDRESS`

### Frontend

Frontend runtime config lives in:

- `/srv/kiteclaw/app/agent-network/.env.production.local`

Current required fields:

```env
BACKEND_URL=http://127.0.0.1:3001
NEXT_PUBLIC_BACKEND_URL=https://kiteclaw.duckdns.org
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_KITE_RPC_URL=https://rpc-testnet.gokite.ai/
NEXT_PUBLIC_KITE_EXPLORER=https://testnet.kitescan.ai
NEXT_PUBLIC_KITE_ACCOUNT_FACTORY=0xAba80c4c8748c114Ba8b61cda3b0112333C3b96E
NEXT_PUBLIC_KITE_AA_SALT=0
DEMO_API_KEY=dev-open-demo
NEXT_PUBLIC_DEMO_JOB_ID=job_1773851319672_12deff30
```

`DEMO_API_KEY` is required for `/api/demo/invoke`.
`NEXT_PUBLIC_DEMO_JOB_ID` pins the completed BTC demo job for the `/demo` audit page. Update after each successful `demo:btc-job:run`.

## PM2 Requirements

Both processes must run on Node `22.22.0`.

Check:

```bash
pm2 show kiteclaw-backend
pm2 show kiteclaw-agent-network
```

Expected:

- backend interpreter: `/root/.nvm/versions/node/v22.22.0/bin/node`
- frontend interpreter: `/root/.nvm/versions/node/v22.22.0/bin/node`

If frontend gets stuck in `waiting restart`, delete and recreate it with Node 22 instead of repeatedly restarting the broken PM2 record.

Known-good recreate command:

```bash
export PATH=/root/.nvm/versions/node/v22.22.0/bin:$PATH
pm2 delete kiteclaw-agent-network || true
pm2 start npm --name kiteclaw-agent-network --cwd /srv/kiteclaw/app/agent-network -- run start -- --port 4010
pm2 save
```

## Nginx Configuration

Active config file:

- `/etc/nginx/conf.d/kiteclaw.conf`

Current working split:

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name kiteclaw.duckdns.org;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name kiteclaw.duckdns.org;

  ssl_certificate /etc/letsencrypt/live/kiteclaw.duckdns.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/kiteclaw.duckdns.org/privkey.pem;

  client_max_body_size 10m;

  location = /.well-known/mcp.json {
    proxy_pass http://127.0.0.1:3001/.well-known/mcp.json;
  }

  location /mcp {
    proxy_pass http://127.0.0.1:3001/mcp;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    add_header Cache-Control "no-cache";
  }

  location = /api/events/stream {
    proxy_pass http://127.0.0.1:3001/api/events/stream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    add_header Cache-Control "no-cache";
  }

  location /api/setup/ {
    proxy_pass http://127.0.0.1:4010/api/setup/;
  }

  location /api/authority/ {
    proxy_pass http://127.0.0.1:4010/api/authority/;
  }

  location /api/demo/ {
    proxy_pass http://127.0.0.1:4010/api/demo/;
  }

  location = /api/health {
    proxy_pass http://127.0.0.1:4010/api/health;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_read_timeout 300s;
  }

  location / {
    proxy_pass http://127.0.0.1:4010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
  }
}
```

After edits:

```bash
nginx -t
systemctl reload nginx
```

## Deployment Procedure

### 1. Backup current live app

```bash
mkdir -p /srv/kiteclaw/backups
ts=$(date +%Y%m%d-%H%M%S)
tar -czf /srv/kiteclaw/backups/pre-codex-$ts.tar.gz -C /srv/kiteclaw app/backend app/agent-network
```

### 2. Upload code

Recommended approach is tarball upload, not `git pull`, when deploying the current local workspace.

Local tarballs should exclude:

- `backend/node_modules`
- `backend/data`
- `backend/.env`
- `agent-network/node_modules`
- `agent-network/.next`
- `agent-network/.env.local`

### 3. Deploy backend

```bash
tar -xzf /tmp/backend-deploy.tgz -C /srv/kiteclaw/app
cd /srv/kiteclaw/app/backend
export NVM_DIR=/root/.nvm
. /root/.nvm/nvm.sh
nvm use 22 >/dev/null
npm install
pm2 restart kiteclaw-backend --update-env
```

### 4. Deploy frontend

```bash
tar -xzf /tmp/agent-network-deploy.tgz -C /srv/kiteclaw/app
cd /srv/kiteclaw/app/agent-network
export NVM_DIR=/root/.nvm
. /root/.nvm/nvm.sh
nvm use 22 >/dev/null
npm install
npm run build
pm2 delete kiteclaw-agent-network || true
export PATH=/root/.nvm/versions/node/v22.22.0/bin:$PATH
pm2 start npm --name kiteclaw-agent-network --cwd /srv/kiteclaw/app/agent-network -- run start -- --port 4010
pm2 save
```

## Verification Order

Run verification in this order.

### 1. Public surfaces

```bash
curl -I https://kiteclaw.duckdns.org/
curl -s https://kiteclaw.duckdns.org/api/public/health
curl -s https://kiteclaw.duckdns.org/api/health
```

### 2. Setup and authority

```bash
curl -s -X POST https://kiteclaw.duckdns.org/api/setup/auth/challenge \
  -H 'Content-Type: application/json' \
  --data '{"ownerEoa":"0x0000000000000000000000000000000000000001","chainId":2368}'

curl -s https://kiteclaw.duckdns.org/api/authority/mcp-info
curl -s https://kiteclaw.duckdns.org/api/authority/session-status
```

### 3. MCP

```bash
curl -s https://kiteclaw.duckdns.org/.well-known/mcp.json

curl -X POST https://kiteclaw.duckdns.org/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### 4. Demo invoke

```bash
curl -X POST https://kiteclaw.duckdns.org/api/demo/invoke \
  -H 'Content-Type: application/json' \
  --data '{"serviceId":"svc_btcusd_technical","input":{"pair":"BTCUSDT","source":"hyperliquid"}}'
```

Expect:

- `ok: true`
- `traceId`
- `requestId`
- `txHash`
- `userOpHash`

### 5. ERC-8183 demo last

Run on server with Node 22:

```bash
cd /srv/kiteclaw/app/backend
export NVM_DIR=/root/.nvm
. /root/.nvm/nvm.sh
nvm use 22 >/dev/null
npm run demo:btc-job:seed
npm run demo:btc-job:deliver
npm run demo:btc-job:validate
```

Then verify audit:

```bash
curl -s http://127.0.0.1:3001/api/public/jobs/<jobId>/audit
```

## Known Pitfalls

### 1. Frontend `/api/*` routes can be shadowed by nginx

If `setup` page loads but actions fail with `Cannot POST /api/setup/...`, nginx is still sending all `/api/*` traffic to backend.

### 2. Backend MCP can be alive while public MCP is broken

If backend local `/.well-known/mcp.json` works but domain returns `404`, nginx is missing explicit MCP forwarding.

### 3. PM2 can silently keep using the wrong Node

Repeated `next start` failures with Node 18 are usually a bad PM2 process definition, not a build problem.

### 4. Demo frontend requires `DEMO_API_KEY`

Without it, `/api/demo/invoke` returns:

- `proxy_invoke_failed`
- `DEMO_API_KEY is not configured`

### 5. `demo:btc-job:*` scripts must stay cross-platform

Use `./scripts/...`, not `.\scripts\...`, in `backend/package.json`, or Linux `npm run` will fail.

### 6. Delivery script must be idempotent

If `accept` already succeeded but the first `deliver` run timed out, reruns must continue from `accepted` instead of failing on `job_not_acceptable`.

## Current Smoke Result

As of this runbook update, these paths were verified live:

- public homepage
- setup challenge
- authority session status
- public MCP discovery
- MCP `tools/list`
- demo invoke
- ERC-8183 `seed`
- ERC-8183 `deliver`
- ERC-8183 `validate`

Reference completed demo job:

- `job_1773851319672_12deff30`
