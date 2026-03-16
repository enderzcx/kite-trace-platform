# Kite Trace Wallet & Authorization Model

## 一句话定义

**agent 拥有自己的身份钱包，但只被授予用户支付钱包的 session 权限。**

---

## 四个核心角色

### 1. 用户 EOA（User EOA）

- 用户真正持有的主钱包
- 是 AA 钱包的 owner
- **永远不离开用户手中**
- 不参与 agent 的日常支付动作
- 只在两种情况下使用：
  - 部署或配置 AA 钱包
  - 吊销或轮换 session key

### 2. AA 钱包（Account Abstraction Wallet）

- 真正持有资金和支付能力的钱包
- owner 是用户 EOA
- 支持 session key 授权机制
- agent 不是 owner，只是被授权的 session key 持有者
- 用户可以随时通过 EOA 吊销 session，不影响 agent 身份

### 3. Session Key（会话密钥）

- 由用户通过 AA 钱包的 owner 权限颁发给 agent
- 受 policy 约束，典型约束包括：
  - 单次支付上限（`singleLimit`）
  - 累计支付上限（`dailyLimit` / `totalLimit`）
  - 有效时间窗（`expiresAt`）
  - 允许的收款方（`allowedRecipients`）
  - 允许的能力范围（`allowedCapabilities`）
- agent 用 session key 在约束范围内发起支付
- **session key 不是 owner key，agent 无法超出 policy 行动**

### 4. Agent 身份钱包（Agent Identity Wallet）

- agent 自己持有的钱包，与用户钱包无关
- 用于：
  - `ERC-8004` identity 注册
  - `identity-challenge` 签名（证明 agent 控制该 agentId）
  - provider 身份自证
- **与支付侧完全分离**

---

## 两套身份的分层

```
Provider 身份侧                    Consumer 支付侧
─────────────────                  ─────────────────
Agent Identity Wallet              User EOA
  └── ERC-8004 agentId               └── AA Wallet owner
  └── identity-challenge 签名              └── 授权 session key
  └── provider 注册                              └── agent 持有
                                                      └── policy 约束内支付
```

关键边界：

| 属性 | 身份钱包 | Session Key |
|------|---------|-------------|
| 持有方 | agent 自己 | agent（由用户颁发） |
| 用途 | ERC-8004 注册 / 签名 | AA 钱包范围内支付 |
| 能否控制用户资金 | 否 | 是，但受 policy 限制 |
| 用户能否吊销 | 否（agent 自有） | 是，随时通过 EOA |
| 轮换影响 | 需重新注册 ERC-8004 | 仅影响支付权限，不影响身份 |

---

## 完整授权流程

```
1. 用户部署 / 配置 AA 钱包
   └── EOA 作为 owner

2. 用户向 agent 颁发 session key
   └── 设定 policy：limit / window / recipients / capabilities
   └── agent 拿到 session key，存入 ktrace 配置

3. agent 用自己的 identity wallet 完成 ERC-8004 注册
   └── ktrace provider register
   └── ktrace provider identity-challenge  ← agent identity 签名
   └── ktrace provider register-identity

4. agent 接到服务请求，发起支付
   └── ktrace buy direct / job fund
   └── 使用 session key 从 AA 钱包支付
   └── 不需要用户 EOA，不需要 AA owner 权限
   └── payment proof 由 x402 生成，Kite Trace 留存 evidence

5. 用户审计或吊销
   └── ktrace flow show / artifact evidence  ← 全程可查
   └── 用户用 EOA 吊销 session key           ← agent 立即失去支付权限
   └── agent 身份（ERC-8004）不受影响
```

---

## 对 ktrace CLI 的含义

### `auth login` 时

```
--wallet     → agent identity wallet 地址（用于显示和 ERC-8004 绑定）
--api-key    → backend access key
```

session key 由 backend 的 AA session 管理，不是在 CLI 直接传私钥。

### `auth session` 时

```
backend /api/session/runtime/ensure
  └── 检查是否有可用 session
  └── 如需创建，通过 AA owner 权限新建 session key
  └── 返回 masked session state，CLI 不接触原始私钥
```

### `buy direct` / `job fund` 时

```
agent 使用 session key 发起支付
  └── policy 检查：limit / window / capability 范围
  └── 支付成功 → x402 payment proof
  └── Kite Trace 记录 trace + evidence
```

### `provider identity-challenge` 时

```
agent 使用 identity wallet 签名
  └── 证明自己控制 ERC-8004 agentId
  └── 与支付侧完全无关
```

---

## 为什么这个模型是对的

**安全边界清楚**
用户主钱包不离手。agent 即使被攻破，攻击者也只能在 policy 范围内行动，损失上限可控。

**符合 AA 的价值**
AA 不是让 agent 变成用户钱包本身，而是让用户给 agent "有限代理权限"。session key 就是这个有限代理的实现。

**适合多 agent 生态**
不同 agent 可以各持不同 session scope。一个 agent 做价格查询，另一个做执行，各自有各自的 policy，互不干扰，也不共享用户主密钥。

**可审计**
每一笔 session key 支付都通过 Kite Trace 记录 trace + evidence，用户可以随时查看 agent 的全部行为。

**可撤销**
用户轮换 session key 不影响 agent 的 ERC-8004 身份，也不影响历史 evidence。只有支付权限被切断。

---

## 与 Kite 生态的对齐

```
ERC-8004   → agent 身份层（identity wallet）
x402       → 支付执行层（session key + AA wallet）
XMTP       → 协商层（agent identity 签名消息）
ERC-8183   → 高价值任务层（job fund 使用 session key，job anchor 上链）
Kite Trace → 全程审计层（trace / evidence / replay）
```

session key 是把这五层粘合在一起的关键——**它让 agent 能行动，又让用户保持控制。**
