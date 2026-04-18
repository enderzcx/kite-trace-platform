# KTrace Connector — Self-Custodial MCP Proxy

Lets Claude Code pay for KTrace MCP tools (cap_news_signal, cap_dex_market, etc.) using **your own session key**, without ever sending it to the server.

## How it works

```
Claude Code ──MCP stdio──► [local-signing-proxy]
                                 │
                                 │ intercepts 402 payment-required
                                 │ signs ERC20 transfer UserOp locally
                                 │ submits to bundler
                                 ▼
                           KTrace Backend  ◄── retries with paymentProof
```

---

## Prerequisites

- Node.js ≥ 18
- A KTrace account with a **self-custodial connector grant** and session key
  - AA wallet address (`0x...`)
  - Session ID (`0x` + 64 hex chars)
  - Owner EOA address (`0x...`)
  - Session private key (stays local — never sent anywhere)
  - Connector token (`ktrace_cc_...`)

---

## Setup

```bash
# 1. Install deps
cd connector
npm install

# 2. Run interactive setup wizard
node setup.js
```

The wizard will prompt for each value and save to `~/.ktrace-connector/config.json` (mode 0600).
At the end it prints the exact MCP config block to paste.

---

## Claude Code MCP Config

After running `setup.js`, add the printed block to your Claude Code MCP config
(`~/.claude/claude.json` → `mcpServers` section):

```json
{
  "mcpServers": {
    "ktrace-proxy": {
      "command": "node",
      "args": ["/absolute/path/to/connector/local-signing-proxy.js"]
    }
  }
}
```

`setup.js` outputs the correct absolute path automatically — just copy-paste.

Restart Claude Code. The proxy starts alongside it and intercepts all KTrace tool calls transparently.

---

## Payment flow (automatic)

1. Claude calls `cap_news_signal` → backend returns **402 + signingContext**
2. Proxy builds `executeWithSession(ERC20.transfer(recipient, amount))` callData
3. Signs UserOp with your session key locally
4. Submits to bundler, waits for on-chain confirmation
5. Retries original tool call with `paymentProof` → real data returned

---

## Config reference (`~/.ktrace-connector/config.json`)

| Field | Description |
|---|---|
| `backendUrl` | KTrace backend URL (default: `https://kiteclaw.xyz`) |
| `connectorToken` | Your `ktrace_cc_...` connector grant token |
| `aaWallet` | Your AA wallet address (`0x...`) |
| `sessionId` | Your session ID (`0x` + 64 hex) |
| `ownerEoa` | Your owner EOA address (`0x...`) |
| `sessionPrivateKey` | Session private key — stored locally only, never transmitted |

Alternatively set via env vars: `SESSION_PRIVATE_KEY`, `CONNECTOR_TOKEN`, `KTRACE_AA_WALLET`, `KTRACE_SESSION_ID`, `KTRACE_OWNER_EOA`, `KTRACE_BACKEND_URL`.

---

## Security

- Session private key is read from local config / env only
- It is **never sent** to the KTrace backend — only the signed UserOp is submitted to the bundler
- Config file is written with mode `0600` (owner-read-only)
- The proxy only signs ERC20 transfers to the recipient specified in the server's 402 response
