# Kite Trace Deployment Guide

## 概述

本文档描述将 Kite Trace Platform 从本地开发环境部署到公网服务器的完整流程。

部署目标：
- Kite Trace backend 公开可访问
- fundamental-agent-real 和 technical-agent-real 服务端点可被平台转发调用
- 第三方 agent 可以通过公网 URL 接入平台

---

## 基础设施

### 服务器要求

```
系统：Ubuntu 22.04 LTS（推荐）
配置：2 核 / 4GB RAM 以上
端口：80、443 需要开放
```

### 依赖安装

```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2（进程守护）
npm install -g pm2

# Nginx
sudo apt-get install -y nginx

# Certbot（SSL 证书，可选）
sudo apt-get install -y certbot python3-certbot-nginx
```

---

## 环境变量配置

在服务器上创建 `backend/.env`，必须包含以下字段：

### 网络配置
```env
PORT=3000
BACKEND_PUBLIC_URL=https://your-server-domain-or-ip
NODE_ENV=production
```

### Kite 测试网配置
```env
# Kite testnet RPC
KITE_RPC_URL=https://rpc.gokite.ai

# 测试网 USDT（硬性标准，不可更改）
SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
SETTLEMENT_TOKEN_SYMBOL=USDT
SETTLEMENT_TOKEN_DECIMALS=6

# 水龙头（文档展示用）
KITE_FAUCET_URL=https://faucet.gokite.ai/

# 区块浏览器
KITE_EXPLORER_URL=https://scan.gokite.ai/tx/
```

### ERC-8004 身份配置
```env
ERC8004_IDENTITY_REGISTRY=0x60BF18964FCB1B2E987732B0477E51594B3659B1
ERC8004_AGENT_ID=1
ERC8004_TRUST_ANCHOR_REGISTRY=0xFADc508ddA981E0C22A836a91d3404DC3A6c6a6C
ERC8183_JOB_ANCHOR=<已部署的 JobLifecycleAnchorV1 地址>
```

### AA 钱包与会话
```env
AA_ADMIN_KEY=<admin 私钥>
AA_ENTRY_POINT=<EntryPoint 合约地址>
AA_FACTORY=<Factory 合约地址>
```

### 外部 API 密钥
```env
# 基本面 agent
OPENNEWS_TOKEN=<opennews API token>
TWITTER_TOKEN=<opentwitter API token>

# 技术面 agent（OKX onchainos）
OKX_API_KEY=<okx api key>
OKX_SECRET_KEY=<okx secret key>
OKX_PASSPHRASE=<okx passphrase>
```

### Agent 服务端点（平台转发用）
```env
AGENT_FUNDAMENTAL_ENDPOINT=${BACKEND_PUBLIC_URL}/agents/fundamental/invoke
AGENT_TECHNICAL_ENDPOINT=${BACKEND_PUBLIC_URL}/agents/technical/invoke
```

---

## 部署流程

### Step 1：部署前检查

```bash
cd /path/to/kite-trace-platform/backend
npm run deploy-check
# 检查所有必要环境变量是否已配置
# 缺少任何一个会报错并说明用途
```

### Step 2：安装依赖

```bash
cd /path/to/kite-trace-platform/backend
npm install --production
```

### Step 3：用 PM2 启动

```bash
# 启动主进程
pm2 start app.js --name kite-trace --env production

# 设置开机自启
pm2 save
pm2 startup

# 查看状态
pm2 status
pm2 logs kite-trace
```

### Step 4：配置 Nginx 反向代理

```nginx
# /etc/nginx/sites-available/kite-trace
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kite-trace /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5：配置 SSL（可选但推荐）

```bash
sudo certbot --nginx -d your-domain.com
```

### Step 6：验证部署

```bash
# 健康检查
curl https://your-domain.com/api/public/health
# 期望返回：{ "ok": true, "version": "...", "network": "kite-testnet" }

# 验证服务发现
curl https://your-domain.com/api/v1/discovery/select?capability=cap-listing-alert

# 验证 CLI 连接
ktrace --base-url https://your-domain.com auth whoami
```

---

## Testnet USDT 说明

### 合约信息
```
网络：Kite Testnet
Token：USDT
合约地址：0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
精度：6 位小数
```

### 测试资金获取
访问水龙头：https://faucet.gokite.ai/
连接测试网钱包，领取测试 USDT。

### 定价换算
```
测试网定价 = 主网定价 × 1/1000

示例：
  listing-alert：主网 2 USDT → 测试网 0.002 USDT
  smart-money：主网 1 USDT → 测试网 0.001 USDT
```

---

## Provider 审批流程

### 当前方案：自动审批

provider 完成 `identity-challenge` 验证后自动设为 `approved`，无需人工干预。

适用于 MVP 阶段。

### 未来方案：Admin API 审批

```bash
# 查看待审批 provider
GET /api/admin/providers?status=pending
Header: X-Admin-Key: <secret>

# 审批通过
POST /api/admin/providers/:providerId/approve
Header: X-Admin-Key: <secret>

# 暂停
POST /api/admin/providers/:providerId/suspend
Header: X-Admin-Key: <secret>
```

---

## ServiceEndpoint 转发机制

当平台收到买方的服务购买请求时，如果 capability 配置了 `serviceEndpoint`，平台会：

1. 验证 provider 身份和 capability 状态
2. 完成 x402 支付
3. 转发请求到 `serviceEndpoint`：

```
POST {serviceEndpoint}
Headers:
  X-Kite-Trace-Id: <traceId>
  X-Kite-Payment-Proof: <paymentProofHash>

Body:
{
  "capability": "cap-my-service",
  "input": { ... },
  "traceId": "ktrace-xxx",
  "paymentProof": { ... }
}
```

4. 将 provider 返回的 result 纳入 trace + evidence 体系

**超时处理**：若 `serviceEndpoint` 超时（默认 `sla.maxLatencyMs`），标记 invocation failed 并触发退款流程。

---

## 内置 Agent 服务端点

`fundamental-agent-real` 和 `technical-agent-real` 使用平台内置 handler（`externalFeeds.js`），无需外部转发。

平台路由逻辑：
```
if provider === 'fundamental-agent-real' or 'technical-agent-real':
  → 调用内置 externalFeeds.js handler

else if capability.serviceEndpoint 已配置:
  → 转发到第三方 serviceEndpoint

else:
  → 返回 404 capability not routable
```

---

## 监控与运维

```bash
# 查看实时日志
pm2 logs kite-trace --lines 100

# 重启服务
pm2 restart kite-trace

# 查看资源占用
pm2 monit

# 更新部署
git pull
npm install --production
pm2 restart kite-trace
```
