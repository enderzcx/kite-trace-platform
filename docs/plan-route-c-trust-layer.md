# Route C: Trust Layer — Implementation Plan

> **赛道目标**: Agents That Trust
> **核心命题**: 两个陌生 Agent 第一次相遇，凭什么相互信任？
> **一句话原则**: `Skill + API (Agent Program Interface) + Trust Layer = Trustworthy New App`

---

## 分工说明

| 负责方 | 范围 |
|--------|------|
| **Claude（前端）** | agent-network Next.js 前端：新增 Trust Profile 页、改造 AuditExplorer、Provider 卡片信任指标 |
| **Codex（后端）** | MCP 权限边界改造 + ERC-8004 agentId 注入 connector grant + x402 → reputation 自动写入 |

---

## 背景：两件事为什么要并行

### 问题1：x402 是信任黑洞
每次 x402 支付完成，钱付了、服务给了，但没有产生任何可被信任系统消费的记录。
`appendReputationSignal` 和 `publishTrustPublicationOnChain` 从未被 x402 流程调用。

### 问题2：MCP connector 没有 Agent 身份
`connector grant` 现在只存 `ownerEoa / aaWallet`（资金主体），没有 `agentId`（身份主体）。
这意味着 x402 产生的信誉记录没有 Agent 主体，链上锚点也没有意义。

### 问题3：tools/list 没有边界
`connector-grant` 和 `env-api-key` 看到完全一样的工具列表。
工具没有 `audience` 元数据，无法做最小权限过滤。

### 这三个问题的依赖关系

```
agentId 进 grant（后端）
    ↓
x402 完成 → appendReputationSignal(agentId)（后端）
    ↓
/api/v1/trust/chain-profile?agentId=xxx 有数据（后端）
    ↓
前端 Trust Profile 页能展示有意义的内容（前端）
```

**后端的 agentId 字段是前端一切工作的前提。两件事必须并行，但后端先于前端完成关键 API。**

---

## 后端任务（Codex 负责）

### B-1：connector grant 加 agentId 字段

**文件**: `backend/lib/claudeConnectorAuth.js`

在 `sanitizeGrantRow` 和 grant 创建流程中加入：

```js
agentId: normalizeText(row.agentId || ''),
identityRegistry: normalizeText(row.identityRegistry || '')
```

**语义**:
- `ownerEoa` → 谁为这次调用付钱（资金主体）
- `agentId` → 谁在调用（身份主体，对应 ERC-8004 链上 tokenId）
- 两者可以不是同一实体

**CLI 支持**（`backend/cli/parsers/authParsers.js`）:

`--agent-id` 和 `--identity-registry` 已存在，但需要确认写入 grant 记录。

---

### B-2：x402 完成 → 自动写 reputation signal

**文件**: `backend/routes/a2aTaskNetworkRoutes.js`

在每个 `"unlocked by x402 payment"` 节点后追加：

```js
appendReputationSignal?.({
  signalId: createTraceId('rep'),
  agentId: reqItem?.a2a?.targetAgentId || '',          // 服务提供方
  sourceLane: 'buy',
  sourceKind: 'x402-a2a',
  referenceId: reqItem.requestId,
  traceId: workflow?.traceId || '',
  paymentRequestId: reqItem.requestId,
  verdict: 'positive',
  score: 1,
  summary: `x402 payment settled for ${capability}`,
  evaluator: reqItem?.a2a?.sourceAgentId || reqItem.payer || '',
  createdAt: new Date().toISOString()
});
```

**覆盖能力**: `btc-price-feed`、`risk-score-feed`、`x-reader-feed`、`info-analysis-feed`、`hyperliquid-order-testnet`

---

### B-3：新增 `/api/v1/trust/chain-profile` 端点

**文件**: `backend/routes/v1/trustV1Routes.js`

```
GET /api/v1/trust/chain-profile?agentId=xxx
```

从两个来源聚合，不依赖平台本地数据：

1. **链上读取**（`TrustPublicationAnchorV1` events）:
   - 历史锚点数
   - 最近 10 条 `anchorTxHash`（可在 kitescan.ai 验证）

2. **本地聚合**（已有 reputation signals）:
   - 总调用次数、成功率
   - 平均 score
   - 最近活跃时间

响应结构：

```json
{
  "agentId": "...",
  "identity": {
    "tokenId": "42",
    "ownerOf": "0x...",
    "registry": "0x...",
    "registryUrl": "https://testnet.kitescan.ai/address/0x..."
  },
  "onchain": {
    "configured": true,
    "anchorCount": 24,
    "latestAnchorId": "88",
    "latestAnchorTxHash": "0x...",
    "registryAddress": "0x..."
  },
  "reputation": {
    "totalSignals": 24,
    "positiveCount": 22,
    "negativeCount": 2,
    "successRate": 0.917,
    "averageScore": 0.91,
    "latestAt": "2026-03-20T..."
  },
  "publications": {
    "total": 3,
    "published": 3,
    "latestAnchorTxHash": "0x..."
  }
}
```

---

### B-4：MCP 权限边界 — Audience 三层模型

#### 4a. capabilities 加 audience 元数据

**文件**: `backend/routes/v1/capabilitiesV1Routes.js`

为每个 capability 增加字段：

```js
audience: 'public',      // 'public' | 'trusted' | 'internal'
scopeMode: 'global',     // 'global' | 'owner-scoped'
```

默认值规则：
- 所有现有 capability invoke tools → `public`
- `flow_history` / `flow_show` → `public` + `owner-scoped`
- `job_*` → `internal`（暂不通过 MCP 暴露）

#### 4b. toolsAdapter 按 authSource 过滤

**文件**: `backend/mcp/toolsAdapter.js`

```js
async function listTools({ traceId, apiKey, authSource, grantId } = {}) {
  // ... 拉 capabilities

  if (authSource === 'connector-grant') {
    tools = tools.filter(t => t.audience === 'public');
  }
  // env-api-key / admin → 全部工具

  return tools;
}
```

#### 4c. connector grant 加 allowedBuiltinTools 字段

```js
// grant 默认值：
allowedBuiltinTools: ['flow_history', 'flow_show', 'artifact_receipt', 'artifact_evidence']
// job_* 默认不在里面
```

---

### B-5：Audience 权限矩阵（正式边界定义）

| Tool | Audience | Visible To | Scope | Default Status |
|------|----------|-----------|-------|---------------|
| `ktrace__svc_*`（所有 capability invoke） | public | connector-grant, env-key, admin | global | ✅ 默认开放 |
| `ktrace__artifact_receipt` | public | connector-grant, env-key | owner-scoped | ✅ 默认开放 |
| `ktrace__artifact_evidence` | public | connector-grant, env-key | owner-scoped | ✅ 默认开放 |
| `ktrace__flow_history` | public | connector-grant, env-key | owner-scoped | ✅ 默认开放 |
| `ktrace__flow_show` | public | connector-grant, env-key | owner-scoped | ✅ 默认开放 |
| `ktrace__job_create` | trusted | env-key + policy allowlist | owner-scoped | 🔒 feature flag |
| `ktrace__job_fund/accept/submit/validate/complete/reject/expire` | internal | admin only | — | 🔒 不暴露 |
| 全局 list / 全局审计 / 全局恢复 | internal | admin only | — | 🔒 不暴露 |

---

### B-6：verify:mcp:release gate 补充测试项

**文件**: `backend/scripts/verify-consumer-authority-policy.mjs`

新增验证：
- [ ] connector-grant 只看到 `audience=public` 工具
- [ ] connector-grant 的 `flow_history` 只返回 ownerEoa scoped 记录
- [ ] connector revoke 后旧 token 立即失效
- [ ] `tools/list` 对不同 authSource 返回不同集合
- [ ] agentId 字段在 grant 中正确持久化

---

## 前端任务（Claude 负责）

### F-1：新增 `/trust` 页面

**文件**: `agent-network/app/trust/page.tsx`（新建）

#### 功能
输入任意 `agentId` → 展示该 Agent 的完整链上信任档案。

这是路线C的核心 demo 界面——评委在这里看到"无需信任平台的独立验证"。

#### 数据来源
```
GET /api/v1/trust/chain-profile?agentId={id}  ← B-3 提供
GET /api/v1/trust/reputation?agentId={id}&limit=10
GET /api/v1/trust/publications?agentId={id}&limit=10
```

#### UI 布局

```
┌─────────────────────────────────────────────┐
│  Agent Trust Profile                        │
│  agentId: [___________________] [查询]      │
└─────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 🔗 链上身份  │  │ 📊 信誉指标  │  │ ⚓ 链上锚点  │
│ ERC-8004 #42 │  │ 成功率 91%   │  │ 24 tasks     │
│ ownerOf:0x.. │  │ 24 signals   │  │ anchored      │
│ [kitescan↗]  │  │ avg score:9.1│  │ [kitescan↗]  │
└──────────────┘  └──────────────┘  └──────────────┘

┌─────────────────────────────────────────────┐
│ 最近 Trust Publications                     │
│ #88 job-completion  ✓ 0xabc...  Mar 20      │
│ #72 validation      ✓ 0xdef...  Mar 18      │
│ #61 reputation      ✓ 0x123...  Mar 15      │
│                              [查看全部 →]   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 独立验证说明                                 │
│ 以上链上记录可通过 TrustPublicationAnchorV1 │
│ 合约独立验证，无需信任本平台。              │
│ Registry: 0x... [kitescan↗]                │
└─────────────────────────────────────────────┘
```

---

### F-2：改造 AuditExplorer — 加 payloadHash 验证

**文件**: `agent-network/components/showcase/AuditExplorer.tsx`

#### 现在
展示：traceId、state、step timeline

#### 加上
在 Evidence & Proof 区域加入：

```
┌─────────────────────────────────────────────┐
│ On-chain Integrity Proof                    │
│                                             │
│ payloadHash  0x7f3a...c21e                 │
│ anchorTxHash 0xabc...123  [kitescan↗]      │
│ anchorId     #88                            │
│                                             │
│ ✅ Anchored on Kite Testnet                │
│    Any party can verify independently       │
└─────────────────────────────────────────────┘
```

**Badge 逻辑**:
- `anchorTxHash` 存在 → 绿色 `On-chain Verified`
- `anchorTxHash` 为空但 `configured=true` → 黄色 `Pending Anchor`
- `configured=false` → 灰色 `Off-chain Only`

---

### F-3：Provider 卡片加信任指标

**文件**: `agent-network/app/page.tsx` → `mapProviders` 函数

#### 改动
在 `mapProviders` 里调用 `/api/v1/trust/chain-profile?agentId={agentId}` 并聚合到 Provider 数据中。

#### 展示位置
Provider 卡片（AgentNetworkSection）里加一行：

```
ERC-8004 #42  |  24 tasks on-chain  |  91% success  |  [Trust Profile →]
```

`[Trust Profile →]` 链接到 `/trust?agentId=xxx`。

---

### F-4：导航栏加 Trust 入口

**文件**: `agent-network/components/showcase/ShowcasePageClient.tsx`

在 nav links 里加：

```tsx
<a href="/trust" className="...">Trust</a>
```

---

## 交付顺序建议

```
后端先行：
  Day 1 → B-1（agentId 进 grant）+ B-2（x402 → reputation）
  Day 1 → B-3（chain-profile API）
  Day 2 → B-4（audience 元数据 + toolsAdapter 过滤）
  Day 2 → B-5（grant allowedBuiltinTools）
  Day 3 → B-6（release gate 补测试）

前端跟进：
  Day 1 → F-4（导航）+ F-1 骨架（页面结构，mock 数据先跑通）
  Day 2 → F-1 接真实 API（等 B-3 完成）+ F-2（AuditExplorer 改造）
  Day 3 → F-3（Provider 卡片信任指标）+ 联调
```

---

## 关键 API 契约（后端需对齐）

前端强依赖以下接口，格式需稳定：

### `GET /api/v1/trust/chain-profile`
```
Query: agentId (string, required)
Auth:  viewer role（无需登录可访问，公开可验证）
```

### `GET /api/v1/trust/reputation`
现有接口，确认字段：`signalId, agentId, verdict, score, referenceId, traceId, createdAt`

### `GET /api/v1/trust/publications`
现有接口，确认字段：`publicationId, publicationType, agentId, anchorTxHash, publicationRef, status, createdAt`

---

## Demo 流程（给评委看的）

```
1. 首页 → 看到 Provider 列表，每个 Provider 显示链上任务数和成功率

2. 点 "Trust Profile" → /trust?agentId=agent-007
   → 展示 ERC-8004 #42，链接到 kitescan
   → 24 tasks anchored，22 success，2 failed
   → 最近 10 条 anchorTxHash，每条可独立验证

3. 点一条 anchorTxHash → kitescan.ai 上看到链上真实记录
   → payloadHash 字段 = sha256(result)，可自行验证

4. 回到 Audit Explorer，找一条 completed 的 trace
   → "On-chain Verified" badge
   → payloadHash + anchorTxHash 都展示

5. 评委问："这个信任记录是你们平台维护的吗？"
   → 答：不是，TrustPublicationAnchorV1 合约部署在 Kite Testnet，
     任何人都可以调 getPublication(anchorId) 独立验证。
```

**这就是赛道要求的「无需中心化注册表的 agent-to-agent 信任」。**

---

## 文件清单

### 前端新建 / 修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `agent-network/app/trust/page.tsx` | 新建 | Trust Profile SSR 页 |
| `agent-network/app/trust/TrustProfileClient.tsx` | 新建 | 客户端交互组件 |
| `agent-network/components/showcase/AuditExplorer.tsx` | 修改 | 加 payloadHash + anchor badge |
| `agent-network/components/showcase/ShowcasePageClient.tsx` | 修改 | 导航加 Trust 入口 |
| `agent-network/app/page.tsx` | 修改 | mapProviders 加信任聚合 |

### 后端新建 / 修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/lib/claudeConnectorAuth.js` | 修改 | grant 加 agentId / allowedBuiltinTools |
| `backend/routes/a2aTaskNetworkRoutes.js` | 修改 | x402 完成 → appendReputationSignal |
| `backend/routes/v1/trustV1Routes.js` | 修改 | 新增 chain-profile 端点 |
| `backend/routes/v1/capabilitiesV1Routes.js` | 修改 | capabilities 加 audience / scopeMode |
| `backend/mcp/toolsAdapter.js` | 修改 | listTools 按 authSource 过滤 |
| `backend/scripts/verify-consumer-authority-policy.mjs` | 修改 | release gate 补测试项 |
