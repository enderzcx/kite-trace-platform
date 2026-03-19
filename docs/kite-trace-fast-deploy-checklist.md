# Kite Trace Fast Deploy Checklist

Last updated: 2026-03-19

## Purpose

This is the shortest reliable path for pushing Kite Trace to:

- domain: `https://kiteclaw.duckdns.org`
- host: `root@49.51.247.141`
- app root: `/srv/kiteclaw/app`

Use this together with:

- `docs/kite-trace-production-runbook.md`

This checklist exists because the full runbook is accurate, but day-to-day deploys got slowed down by a few repeatable issues:

- Windows PowerShell eating remote shell syntax
- PM2 restarts running without the expected Node 22 environment
- nginx route splits drifting from the frontend/backend contract
- frontend env drift after backend changes
- local TLS / PowerShell clients giving misleading errors during validation

## Fast Path

### 1. Build locally first

Always verify the changed surface before upload.

Backend:

```powershell
cd backend
node --check .\routes\coreIdentitySessionRoutes.js
node --check .\routes\coreIdentityChatRoutes.impl.js
```

Frontend:

```powershell
cd agent-network
npm run build
```

If `/setup` changed, also run:

```powershell
cd backend
npm run verify:onboarding:setup
```

### 2. Package tarballs, do not `git pull`

From the repo root:

```powershell
tar -czf backend-deploy-<ts>.tgz `
  --exclude='backend/node_modules' `
  --exclude='backend/data' `
  --exclude='backend/.env' `
  --exclude='backend/.codex-run' `
  -C E:/CODEX/kite-trace-platform backend

tar -czf agent-network-deploy-<ts>.tgz `
  --exclude='agent-network/node_modules' `
  --exclude='agent-network/.next' `
  --exclude='agent-network/.env.local' `
  --exclude='agent-network/.env.production.local' `
  -C E:/CODEX/kite-trace-platform agent-network
```

Why:

- avoids dirty live git state
- preserves live secrets and runtime stores
- gives a simple rollback unit

### 3. Upload with the SSH key already in repo-local ops path

Use:

- key: `E:\CC\key\ktrace.pem`

Upload:

```powershell
scp -i E:\CC\key\ktrace.pem -o StrictHostKeyChecking=no `
  backend-deploy-<ts>.tgz agent-network-deploy-<ts>.tgz `
  root@49.51.247.141:/tmp/
```

### 4. Backup with a fixed timestamp string

Do not rely on remote `$(date ...)` interpolation from Windows PowerShell. It can be eaten by the local shell.

Use a fixed timestamp string created locally, then run:

```bash
mkdir -p /srv/kiteclaw/backups
tar -czf /srv/kiteclaw/backups/pre-deploy-<ts>.tar.gz -C /srv/kiteclaw app/backend app/agent-network
```

### 5. Extract and rebuild

Backend:

```bash
tar -xzf /tmp/backend-deploy-<ts>.tgz -C /srv/kiteclaw/app
cd /srv/kiteclaw/app/backend
export NVM_DIR=/root/.nvm
. /root/.nvm/nvm.sh
nvm use 22 >/dev/null
npm install
```

Frontend:

```bash
tar -xzf /tmp/agent-network-deploy-<ts>.tgz -C /srv/kiteclaw/app
cd /srv/kiteclaw/app/agent-network
export NVM_DIR=/root/.nvm
. /root/.nvm/nvm.sh
nvm use 22 >/dev/null
npm install
npm run build
```

### 6. Restart PM2 from a Node 22 shell

Do not assume `pm2` is on PATH in a non-login shell.

Reliable pattern:

```bash
export NVM_DIR=/root/.nvm
. /root/.nvm/nvm.sh
nvm use 22 >/dev/null
/usr/local/bin/pm2 restart kiteclaw-backend
/usr/local/bin/pm2 restart kiteclaw-agent-network
/usr/local/bin/pm2 save
```

Why:

- plain `pm2` may not exist in PATH when invoked through remote command wrappers
- using `nvm use 22` first keeps the runtime aligned with Next 16 and the current backend

## High-Value Checks

Run these in order after restart.

### Public health

```bash
curl -I https://kiteclaw.duckdns.org/
curl -s https://kiteclaw.duckdns.org/api/public/health
curl -s https://kiteclaw.duckdns.org/setup > /dev/null
```

### Setup

Check these first if `/setup` changed:

- `POST /api/setup/auth/challenge`
- `POST /api/setup/auth/verify`
- `POST /api/setup/runtime/prepare`
- legacy `POST /api/session/runtime/ensure` behavior if setup semantics changed

Best practice:

- run the setup smoke from the server itself when possible
- this avoids local Windows TLS / quoting noise

### MCP

Always verify both:

- page: `/mcp`
- endpoint: `/.well-known/mcp.json` and `/mcp/stream`

If `/mcp` renders backend JSON-RPC instead of a frontend page, nginx route splitting is wrong.

## Lessons Learned

### 1. PowerShell can mangle remote shell syntax

What went wrong:

- remote commands like `$(date +%Y%m%d-%H%M%S)` were interpreted by local PowerShell instead of the remote shell

Rule:

- avoid shell interpolation in remote commands launched from PowerShell
- prefer fixed timestamps created locally
- or use a remote script file instead of inline shell fragments

### 2. `pm2` and `node` are not the same environment

What went wrong:

- remote shell had Node 18 by default
- frontend and current backend need Node 22
- `pm2` was also sometimes missing from PATH

Rule:

- always source `nvm.sh`
- always `nvm use 22`
- prefer `/usr/local/bin/pm2` explicitly

### 3. Local validation clients can lie

What went wrong:

- local `fetch`, `curl.exe`, and `Invoke-WebRequest` sometimes produced TLS resets or JSON quoting issues that looked like app bugs

Rule:

- if local validation looks inconsistent, run the same check from the server itself
- for live `/setup` validation, a tiny Node script on the server is often faster than debugging Windows client behavior

### 4. Frontend env drift causes fake app failures

High-risk fields:

- `BACKEND_URL`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_DEMO_JOB_ID`

Symptoms:

- `BACKEND_URL is not configured`
- demo page pinned to an old job
- setup proxy routes calling the wrong backend

Rule:

- after frontend deploys, confirm `/srv/kiteclaw/app/agent-network/.env.production.local`

### 5. Backend env drift causes HTML error pages in setup

High-risk fields:

- `KTRACE_ONBOARDING_COOKIE_SECRET`

Symptoms:

- setup verify returns HTML instead of JSON
- frontend shows JSON parse errors such as `Unexpected token '<'`

Rule:

- if setup auth changed, confirm the backend cookie and onboarding env values before blaming frontend code

### 6. nginx must reflect the product contract exactly

Current critical split:

- `/mcp` page -> frontend
- `/mcp/stream` endpoint -> backend
- `/.well-known/mcp.json` -> backend
- `/api/setup/*` -> frontend Next API routes
- `/api/*` -> backend

If these drift, the app can look half-updated even when code is correct.

### 7. Validate the semantic change, not just HTTP 200

Example from `/setup`:

- for arbitrary-wallet self-serve, the important check was not just that `prepare` returned `200`
- the important check was that onboarding-cookie calls to legacy `POST /api/session/runtime/ensure` now fail with:
  - `self_serve_runtime_prepare_required`

This kind of semantic check catches accidental fallback to old demo-only code paths.

## Recommended Deploy Template

For future pushes, treat this as the minimum standard:

1. local build passes
2. tarballs created
3. live backup created
4. backend extracted and `npm install`
5. frontend extracted and `npm run build`
6. PM2 restarted from Node 22 shell
7. health checks pass
8. changed feature gets one semantic live check, not just status-code checks
