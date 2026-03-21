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

## 当前状态（2026-03-21）

### Codex（后端）

- [x] `B-1` 已完成：connector install code / grant 已要求并持久化 `agentId`、`identityRegistry`、`allowedBuiltinTools`
- [x] `B-1` 已完成：grant 唯一性与 active lookup 已升级为 `ownerEoa + client + clientId + agentId + identityRegistry`
- [x] `B-1` 已完成：legacy install code / grant 会返回 `connector_reconnect_required`，不做迁移
- [x] `B-2` 已完成：`/api/services/:serviceId/invoke` paid-success 会自动写 consumer/provider reputation，并同步尝试 trust publication
- [x] `B-2` 已完成：A2A x402 paid-success 路径也已复用同一 trust helper，不再只覆盖 MCP 主路径
- [x] `B-3` 已完成：`GET /api/v1/trust/chain-profile` 已上线，支持公开只读聚合与链上 anchor 查询
- [x] `B-4` 已完成：capability tools 与 builtin tools 已分开治理，支持 `audience / scopeMode / riskLevel`
- [x] `B-4` 已完成：connector `tools/list` 只返回当前 grant 实际可用的 builtin + capability tools
- [x] `B-5` 已完成：默认对外边界已落地为 `artifact_* / flow_* / authorized capability invoke tools`
- [x] `B-6` 已完成：`verify-mcp-trust-boundary.mjs` 已接入 `verify-mcp-release.mjs`
- [x] `B-6` 已完成：新增 `verify-a2a-trust-smoke.mjs`，A2A paid path 的 trust publication 也已进入 release gate

### Claude（前端）

- [ ] `F-1` 到 `F-4` 仍待前端侧实现

### 当前结论

- Codex 负责的 Route C 后端部分已完成，可以进入前端衔接与联调阶段。
- 后续若继续扩展，优先级应放在前端展示面、文档对外叙事和必要的补充验收，而不是再扩新的后端入口。

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

> **⚠ Codex 审阅修正**: 只加字段还不够。当前 `findActiveGrantByOwner` 和
> `findActiveGrantByCode` 按 `ownerEoa + client + clientId` 查 active grant。
> 如果同一 owner 切换不同 agentId，旧 grant 身份会被复用到新 agent。
> 必须同步更新以下规则：

**唯一性规则扩展**（`claudeConnectorAuth.js`）:

1. `findActiveGrantByOwner` — 查询条件加 `agentId` 匹配：
   ```js
   function findActiveGrantByOwner(ownerEoa, { client, clientId, agentId } = {}) {
     // ... 现有过滤 + 加上：
     && (!agentId || row.agentId === normalizeText(agentId))
   }
   ```

2. `issueInstallCode` — 冲突检测加 `agentId` 维度：
   ```js
   const activeGrant = findActiveGrantByOwner(normalizedOwner, {
     client: normalizedClient,
     clientId: normalizedClientId,
     agentId: normalizedAgentId  // 新增
   });
   ```

3. `claimGrant` / `revokeGrant` — grant 归属验证需匹配 `agentId`，避免跨 agent 越权操作

**CLI 支持**（`backend/cli/parsers/authParsers.js`）:

`--agent-id` 和 `--identity-registry` 已存在，但需要确认写入 grant 记录。

---

### B-2：x402 完成 → 自动写 reputation signal

> **⚠ Codex 审阅修正**: 原计划只挂在 `a2aTaskNetworkRoutes.js`，但当前 MCP 主调用面是
> `tools/call → /api/services/:serviceId/invoke`，核心落点在 `marketAgentServiceRoutes.js:1825`。
> 只改 A2A 路由会导致 MCP/connector 成功调用在 Trust Profile 里仍然缺数据。
> 修正后同时覆盖两条执行面。

**文件（主）**: `backend/routes/marketAgentServiceRoutes.js` — `/api/services/:serviceId/invoke` 成功后追加
**文件（辅）**: `backend/routes/a2aTaskNetworkRoutes.js` — A2A x402 路径保留

在 `marketAgentServiceRoutes.js` 的 `upsertServiceInvocation(next)` 之后、`return res.status(...)` 之前追加：

```js
if (next.state === 'success' || next.state === 'completed') {
  appendReputationSignal?.({
    signalId: createTraceId('rep'),
    agentId: service?.agentId || targetAgentId || '',
    sourceLane: 'buy',
    sourceKind: authSource === 'connector-grant' ? 'x402-mcp' : 'x402-invoke',
    referenceId: next.requestId,
    traceId: next.traceId,
    paymentRequestId: next.requestId,
    verdict: 'positive',
    score: 1,
    summary: `x402 payment settled for ${effectiveAction}`,
    evaluator: sourceAgentId || payer || '',
    createdAt: new Date().toISOString()
  });
}
```

在 `a2aTaskNetworkRoutes.js` 的 `"unlocked by x402 payment"` 节点后同样追加（保持 A2A 路径覆盖）：

```js
appendReputationSignal?.({
  signalId: createTraceId('rep'),
  agentId: reqItem?.a2a?.targetAgentId || '',
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
**覆盖路径**: MCP `tools/call`（主） + A2A direct invoke（辅）

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

> **⚠ Codex 审阅修正**: 原计划只改 capability catalog 和 toolsAdapter，但 `flow_history`、
> `flow_show`、`job_*` 等是独立定义在 `ktraceBuiltinTools.js` 的 builtin tools，不走
> capability 查询。只改 capability 侧不会给 builtin tools 带上边界，connector 暴露过宽
> 的问题会原样保留。修正后将 builtin tools 和 capability tools 分开治理。

#### 4a. capabilities 加 audience 元数据

**文件**: `backend/routes/v1/capabilitiesV1Routes.js`

为每个 capability 增加字段：

```js
audience: 'public',      // 'public' | 'trusted' | 'internal'
scopeMode: 'global',     // 'global' | 'owner-scoped'
```

默认值规则：
- 所有现有 capability invoke tools → `public`

#### 4b. builtin tools 加 audience 元数据（新增）

**文件**: `backend/mcp/ktraceBuiltinTools.js`

为 `KTRACE_BUILTIN_TOOLS` 数组中每个 tool 增加 `audience` 和 `scopeMode` 字段：

```js
// ktraceBuiltinTools.js — 每个 tool 定义中增加：
{ name: 'ktrace__flow_history',  audience: 'public',   scopeMode: 'owner-scoped', ... },
{ name: 'ktrace__flow_show',     audience: 'public',   scopeMode: 'owner-scoped', ... },
{ name: 'ktrace__artifact_receipt',  audience: 'public',   scopeMode: 'owner-scoped', ... },
{ name: 'ktrace__artifact_evidence', audience: 'public',   scopeMode: 'owner-scoped', ... },
{ name: 'ktrace__job_create',    audience: 'trusted',  scopeMode: 'owner-scoped', ... },
{ name: 'ktrace__job_fund',      audience: 'internal', scopeMode: 'owner-scoped', ... },
{ name: 'ktrace__job_accept',    audience: 'internal', scopeMode: 'owner-scoped', ... },
// ... 其余 job_* → 'internal'
```

#### 4c. toolsAdapter 按 authSource 过滤（覆盖 capability + builtin 两层）

**文件**: `backend/mcp/toolsAdapter.js`

```js
async function listTools({ traceId, apiKey, authSource, grantId } = {}) {
  // ... 拉 capabilities
  const capabilityTools = items.filter(...).map(buildToolDefinition);

  // builtin tools 也要过滤
  let builtinTools = KTRACE_BUILTIN_TOOLS.map((tool) => ({ ...tool }));

  if (authSource === 'connector-grant') {
    // capability tools: 只暴露 audience=public
    capabilityTools = capabilityTools.filter(t => t.audience !== 'internal' && t.audience !== 'trusted');
    // builtin tools: 按 grant.allowedBuiltinTools 白名单过滤
    const allowed = grant?.allowedBuiltinTools || DEFAULT_CONNECTOR_BUILTIN_TOOLS;
    builtinTools = builtinTools.filter(t => allowed.includes(t.builtinId));
  }
  // env-api-key → 排除 internal
  // admin → 全部工具

  return [...builtinTools, ...capabilityTools];
}
```

#### 4d. connector grant 加 allowedBuiltinTools 字段

```js
// grant 默认值：
const DEFAULT_CONNECTOR_BUILTIN_TOOLS = ['flow_history', 'flow_show', 'artifact_receipt', 'artifact_evidence'];
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

> **⚠ Codex 审阅修正**: 原计划指向 `verify-consumer-authority-policy.mjs`，但当前 MCP
> 发布门禁实际跑的是 `verify-mcp-release.mjs`（调用 smoke → auth → consumer → paid），
> 且 `package.json` 的 `verify:mcp:release` 也没有接这些新 checks。
> 修正后新建独立验证脚本并接入 release gate。

**已实现文件**:
- `backend/scripts/verify-mcp-trust-boundary.mjs`
- `backend/scripts/verify-a2a-trust-smoke.mjs`

验证项：
- [x] connector-grant 只看到 `audience=public` 的 capability tools
- [x] connector-grant 只看到 `allowedBuiltinTools` 白名单内的 builtin tools
- [x] connector-grant 的 `flow_history` 只返回 ownerEoa scoped 记录
- [x] connector revoke 后旧 token 立即失效
- [x] `tools/list` 对不同 authSource 返回不同集合
- [x] agentId 字段在 grant 中正确持久化
- [x] 同一 owner 不同 agentId 可各自独立持有 grant
- [x] A2A paid-success 路径会自动写 reputation + trust publication，并验证 `pending/published/failed` 三种 publication 状态

**接入 release gate**: `backend/scripts/verify-mcp-release.mjs`

```js
// 在 mcp_paid 之后追加：
await runStep('a2a_trust_smoke', '.\\scripts\\verify-a2a-trust-smoke.mjs');
await runStep('mcp_trust_boundary', '.\\scripts\\verify-mcp-trust-boundary.mjs');
```

**更新 package.json**:
```json
"verify:a2a:trust-smoke": "node .\\scripts\\verify-a2a-trust-smoke.mjs",
"verify:mcp:trust-boundary": "node .\\scripts\\verify-mcp-trust-boundary.mjs"
```

**已实现补充**：
- `backend/scripts/verify-a2a-trust-smoke.mjs`
- `backend/scripts/verify-mcp-release.mjs` 已纳入 `a2aTrust`
- `backend/package.json` 已新增 `verify:a2a:trust-smoke`

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
Auth:  public（无鉴权，不走 requireRole）— 公开可验证是核心卖点
```

> **⚠ Codex 审阅修正**: 原文写 `viewer role` 又写"无需登录"，自相矛盾。
> 明确定义为 public route（无鉴权），前后端按同一假设落地。
> 理由：Trust Profile 是面向评委的核心 demo，"任何人都可验证"需要 public 访问。

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
| `backend/routes/marketAgentServiceRoutes.js` | 修改 | MCP invoke 成功 → appendReputationSignal（主路径） |
| `backend/routes/a2aTaskNetworkRoutes.js` | 修改 | A2A x402 → appendReputationSignal（辅路径） |
| `backend/routes/v1/trustV1Routes.js` | 修改 | 新增 chain-profile 端点（public route） |
| `backend/routes/v1/capabilitiesV1Routes.js` | 修改 | capabilities 加 audience / scopeMode |
| `backend/mcp/ktraceBuiltinTools.js` | 修改 | builtin tools 加 audience / scopeMode |
| `backend/mcp/toolsAdapter.js` | 修改 | listTools 按 authSource 过滤（capability + builtin 两层） |
| `backend/scripts/verify-mcp-trust-boundary.mjs` | 新建 | trust boundary 验证脚本 |
| `backend/scripts/verify-mcp-release.mjs` | 修改 | 接入 mcp_trust_boundary step |
