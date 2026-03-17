# Kite Trace Deployment Guide

## 概述

本文档是当前 `ktrace` backend 的实际上线 runbook，目标是把平台部署到腾讯轻量云，让其他 agent 能通过公网直接调用。

当前建议的公网入口：
- [https://kiteclaw.duckdns.org/](https://kiteclaw.duckdns.org/)

当前上线策略：
- 先上线 backend
- 先让 `ktrace` / `/api/*` 对外可用
- 前端后续重做，不作为这次上线阻塞项

---

## 冲突判断

`https://kiteclaw.duckdns.org/` 本身没有冲突，真正需要检查的是部署层：

1. 旧的 Nginx 配置是否已经把这个域名转发到别的服务
2. 旧的 PM2 进程是否还占着 backend 端口
3. 80/443 是否已经被旧前端或旧 Node 进程占用

结论：
- 域名可以继续沿用
- 如果前端暂时不上，这次可以让这个域名先只服务 backend
- 后续重做前端时，再决定：
  - `/api/*` 给 backend，`/` 给前端
  - 或者前端单独挂子域名

---

## 当前目标架构

```text
Internet agent
  -> https://kiteclaw.duckdns.org
  -> Nginx
  -> backend Express (PM2)
  -> ktrace APIs / discovery / buy / evidence
  -> AA session pay / x402 / ERC-8004 / external feeds
```

说明：
- `fundamental-agent-real` 和 `technical-agent-real` 当前都是平台内置 provider
- 它们不需要外部独立服务进程
- 实际调用走的是 backend 内的 `externalFeeds.js`

---

## 服务器要求

推荐：
- Ubuntu 22.04 LTS
- 2 vCPU / 4GB RAM 以上
- 已开放 `80` / `443`
- 已安装 Git

需要的软件：
- Node.js 20+
- PM2
- Nginx
- Certbot

安装示例：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

---

## 环境变量

生产环境请以 `backend/.env` 为准。当前代码里真正会读取的关键字段如下。

### 公网与运行环境

```env
NODE_ENV=production
PORT=3001
BACKEND_PUBLIC_URL=https://kiteclaw.duckdns.org
```

重要：
- `BACKEND_PUBLIC_URL` 要写域名，不要写公网 IP
- 公网 IP 和内网 IP 可以保留在 `.env` 里做运维记录，但不要作为对外 API base URL

### Kite / x402 / 结算

```env
KITE_RPC_URL=...
KITE_EXPLORER_URL=https://testnet.kitescan.ai/tx/
KITE_SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
KITE_MERCHANT_ADDRESS=...
KITE_AGENT2_AA_ADDRESS=...
KITE_AGENT3_AA_ADDRESS=...
```

说明：
- `KITE_SETTLEMENT_TOKEN` 是当前 backend 真正使用的字段
- 历史文档里的 `SETTLEMENT_TOKEN` 写法不要再作为生产基准

### ERC-8004 / Trust / Job Anchor

```env
ERC8004_IDENTITY_REGISTRY=0x60BF18964FCB1B2E987732B0477E51594B3659B1
ERC8004_AGENT_ID=1
ERC8004_TRUST_ANCHOR_REGISTRY=...
ERC8183_JOB_ANCHOR=...
```

### AA / Session Pay

```env
AA_ADMIN_KEY=...
AA_ENTRY_POINT=...
AA_FACTORY=...
```

### 基本面外部源

```env
OPENNEWS_API_BASE=https://ai.6551.io
OPENNEWS_TOKEN=...
TWITTER_API_BASE=https://ai.6551.io
TWITTER_TOKEN=...
```

### 技术面外部源

优先兼容两组命名：

```env
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
```

以及当前仓库里已经在用的：

```env
ONCHAINOS_API_Key=...
ONCHAINOS_Secret_Key=...
ONCHAINOS_PASSHASE_Key=...
```

说明：
- 当前代码已经兼容 `ONCHAINOS_*` -> `OKX_*`
- 但新服务器建议统一补齐 `OKX_*`

---

## 生产环境网络策略

结论：
- 生产环境默认直连外部服务
- 代理只作为兜底，不作为标准路径

当前 backend/CLI 已经兼容两种模式：
1. 不设置代理环境变量，直接访问外部 API
2. 设置 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 时，Node 运行时自动启用环境代理

生产环境推荐做法：
- 腾讯云硅谷实例默认不要设置：
  - `HTTP_PROXY`
  - `HTTPS_PROXY`
  - `ALL_PROXY`
- 也不要手动设置 `NODE_USE_ENV_PROXY`
- 让 backend 直接访问：
  - `api.coingecko.com`
  - `ai.6551.io`
  - `web3.okx.com` / `onchainos`

为什么：
- 少一层代理 hop，通常更稳定
- 少一个 TLS / 连接池 / 代理节点故障点
- 线上服务器位于硅谷时，外部源大概率直连质量更好

只有在以下情况下才考虑为生产开启代理：
- 服务器到某个外部源直连超时或频繁 `fetch failed`
- 某个外部源存在明确的区域网络问题
- 经验证代理路径比直连更稳定

上线前必须做一次服务器直连检查：
```bash
curl -I "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&per_page=2&page=1&sparkline=false&price_change_percentage=24h"
curl -I "https://ai.6551.io"
```

如果服务器安装了 `onchainos` CLI，还应补做：
```bash
onchainos market price --symbol BTCUSDT
```

判定规则：
- 上述直连检查都通过：生产环境不启用代理
- 只有单个数据源失败：先单独排查该数据源，不要默认把整套 backend 切到代理
- 只有直连明确不稳定时，才把代理加入生产 `.env`

备注：
- 本地开发环境和国内网络环境可以继续保留代理支持
- 生产环境策略与本地开发策略应分开，不要把本地代理设置直接复制到服务器

---

## 首次上线流程

以下流程假设代码目录在 `/srv/kiteclaw/app`。

### Step 1：拉取代码

```bash
cd /srv
git clone <your-repo-url> kiteclaw
cd /srv/kiteclaw/app/backend
```

如果服务器上已经有旧版本：

```bash
cd /srv/kiteclaw/app
git pull
cd backend
```

### Step 2：安装依赖

```bash
npm install --production
```

### Step 3：准备 `.env`

把生产环境变量写入：

`/srv/kiteclaw/app/backend/.env`

必须确认这些值最终正确：
- `BACKEND_PUBLIC_URL=https://kiteclaw.duckdns.org`
- `PORT=3001` 或你实际监听端口
- `OPENNEWS_TOKEN`
- `TWITTER_TOKEN`
- `KITE_RPC_URL`
- `AA_ADMIN_KEY`
- `ERC8004_IDENTITY_REGISTRY`

### Step 4：初始化服务器数据

新服务器第一次部署时，先跑：

```bash
cd /srv/kiteclaw/app
node backend/scripts/seed-server-data.mjs
```

这个脚本会：
- 写入 `backend/data/network_agents.json`
  - `kite-trace-platform` -> `agentId=1`
  - `technical-agent-real` -> `agentId=2`
  - `fundamental-agent-real` -> `agentId=3`
- 写入 `backend/data/services.json` 的基础服务底座
- 复用现有 capability seeding 逻辑，灌入 10 个 `cap-*`
- 自动跑 `npm run erc8004:read`
- 每一步打印 `ok/fail`

本地演练命令：

```bash
node backend/scripts/seed-server-data.mjs --dry-run --skip-erc8004-read
```

### Step 5：启动 backend

确认进程启动入口为 [server.js](/E:/CODEX/kite-trace-platform/backend/server.js)，不是 [app.js](/E:/CODEX/kite-trace-platform/backend/app.js)。`app.js` 当前只负责导出运行时入口。

推荐用 PM2：

```bash
cd /srv/kiteclaw/app/backend
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

检查：

```bash
pm2 status
pm2 logs kiteclaw-backend --lines 100
```

### Step 6：配置 Nginx

建议让 Nginx 反代到本机 `3001`。

`/etc/nginx/sites-available/kite-trace`

```nginx
server {
    listen 80;
    server_name kiteclaw.duckdns.org;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用：

```bash
sudo ln -sf /etc/nginx/sites-available/kite-trace /etc/nginx/sites-enabled/kite-trace
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7：配置 HTTPS

```bash
sudo certbot --nginx -d kiteclaw.duckdns.org
```

---

## 上线后验证

### 1. 健康检查

```bash
curl https://kiteclaw.duckdns.org/api/public/health
```

期望返回：

```json
{
  "ok": true,
  "version": "1.0.0",
  "uptime": 12,
  "network": "kite-testnet"
}
```

### 2. discovery 检查

```bash
curl "https://kiteclaw.duckdns.org/api/v1/discovery/select?capability=cap-listing-alert"
curl "https://kiteclaw.duckdns.org/api/v1/discovery/select?capability=cap-dex-market"
```

期望：
- 能看到 `fundamental-agent-real`
- 能看到 `technical-agent-real`

### 3. CLI 检查

```bash
ktrace --base-url https://kiteclaw.duckdns.org auth whoami
ktrace --base-url https://kiteclaw.duckdns.org discovery select --capability cap-listing-alert
```

### 4. 真实服务检查

```bash
ktrace --base-url https://kiteclaw.duckdns.org buy direct \
  --provider fundamental-agent-real \
  --capability cap-listing-alert \
  --input '{"exchange":"all","limit":3}'
```

再查证据：

```bash
ktrace --base-url https://kiteclaw.duckdns.org artifact evidence <traceId>
```

期望：
- `state=completed`
- `authorizedBy` 存在
- `result` 里带 `sourceUrl / publishedAt / fetchedAt`
- payment proof 是真实 on-chain proof，不是 mock

---

## 更新部署流程

后续更新 backend：

```bash
cd /srv/kiteclaw/app
git pull
cd backend
npm install --production
node scripts/seed-server-data.mjs
pm2 restart kiteclaw-backend
```

说明：
- `seed-server-data.mjs` 设计成可重复执行
- 它会补齐需要的基础数据和 capability seed
- 适合作为每次更新后的安全对齐步骤

---

## 回滚思路

如果新版本异常：

1. 保留当前 `.env`
2. 回退到上一个 git commit
3. `npm install --production`
4. `pm2 restart kiteclaw-backend`

如果问题出在数据层：
- 先备份 `backend/data/*.json`
- 再恢复上一版备份

---

## 当前已知事项

1. 这次上线以 backend-only 为目标，前端不是阻塞项。
2. `kiteclaw.duckdns.org` 可以继续使用，不必因为后续前端重做而现在换域名。
3. 当前 real-agent 调用链已经支持：
   - discovery
   - real AA wallet payment
   - x402
   - on-chain proof
   - evidence export
4. CLI 慢调用已经做了 timeout recovery，公网用户在技术面场景下也不容易被“前台超时”误导。

---

## 推荐上线顺序

最终建议按这个顺序执行：

1. 服务器更新代码
2. 校正 `backend/.env`
3. `npm install --production`
4. `node backend/scripts/seed-server-data.mjs`
5. `pm2 start/restart kiteclaw-backend`
6. Nginx / HTTPS 检查
7. 外网 `discovery`
8. 外网真实 `buy direct`
9. 外网 `artifact evidence`

做到这一步，就可以让其他 agent 通过互联网直接使用 `ktrace` 平台。  
