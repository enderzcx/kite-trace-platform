# Networks Reference

This backend supports two testnets. They serve different purposes and have **different contract addresses for every component** — never copy a value from one column to the other.

Source of truth for runtime: `backend/lib/gokite-aa-sdk.js` `NETWORKS` map.

## At-a-glance

|  | **Kite Testnet** | **HashKey Testnet** |
|---|---|---|
| **Chain ID** | `2368` | `133` |
| **Status** | Original KiteAI network | **Primary demo target** (Hackathon Demo Day) |
| **RPC URL** | `https://rpc-testnet.gokite.ai` | `https://testnet.hsk.xyz` |
| **Explorer** | `https://testnet.kitescan.ai` | `https://testnet-explorer.hsk.xyz` |
| **Native gas token** | KITE | HSK |
| **Faucet** | KiteAI faucet | `https://faucet.hashkeychain.net` |

## ERC-4337 infrastructure

|  | **Kite Testnet** | **HashKey Testnet** |
|---|---|---|
| **EntryPoint v0.7** | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | `0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598` |
| **AccountFactory** | `0xF720b28181D4729C66D691e41ADfa3ee027CB22B` | **`0x452bf276B9c93DeF81B6087D78228E2980425D86`** (V2, 2026-04-21) |
| **Account Impl (V3)** | *(bundled with factory)* | `0x2DbBfCdAd28b3A2094BD634Cce4326B1b3D0595C` |
| **Bundler** | KiteAI staging: `https://bundler-service.staging.gokite.ai/rpc/` | Self-hosted relay: VPS `ktrace-relay-bundler` (PM2 id 7), or direct call |

### HashKey Factory V1 is DEPRECATED

`0xF43E94E2163F14c4D62242D8DD45AbAacaa6DB5a` — **do not use**. Its `IKTraceAccountInitializable.initialize(address)` signature mismatches the impl's `initialize(address,address)`, making every `createAccount` revert.

V2 adds an immutable `entryPoint` field and encodes the correct 2-arg init. See `backend/contracts/KTraceAccountFactoryV2.sol`.

## Settlement & escrow

|  | **Kite Testnet** | **HashKey Testnet** |
|---|---|---|
| **Settlement token** | USDT.k (KiteAI's mock) | MockUSDT `0xDC52db3E9e17d9BE1A457d3fA455f68b52c38e2e` (6 decimals) |
| **JobEscrowV4** | *(chain-specific, see `data/kite-deployment.json`)* | See `data/ktrace-hashkey-deployment.json` |
| **IdentityRegistryV1** | *(chain-specific)* | `0x901A2b1c67daB5AC09A4e02bE9c1c8D52Cce650B` |

## Preview AA wallets (HashKey demo convenience)

These are pre-deployed via V1 (before we had V2) and kept for demo startup speed. **Not required architecturally** — fresh users should go through `factory.createAccount(owner, salt)` on V2.

| Handle | Address | Owner |
|---|---|---|
| `preDeployedAA_A` | `0xf9D24F2D1679564aCF289ab2D71C491658145e09` | `0x2a392f5a...da77d` |
| `preDeployedAA_B` | `0xd16434844c215DcDDD653A11060D429f4Bd87661` | `0xfbc19e5e...ff8a` |

## Environment variables

Runtime code reads these (fallbacks baked in):

| Variable | Default (HashKey) | Purpose |
|---|---|---|
| `KITE_RPC_URL` | `https://testnet.hsk.xyz` | Chain RPC |
| `KITE_BUNDLER_URL` | `https://testnet.hsk.xyz/rpc` | Bundler endpoint |
| `KITEAI_BUNDLER_URL` | `https://bundler-service.staging.gokite.ai/rpc/` | Kite-specific |
| `KITE_ENTRYPOINT_ADDRESS` | `0x0Cfe9962...0a598` (HashKey) | **Misleadingly named** — currently defaults to HashKey. Will rename to `HASHKEY_ENTRYPOINT_ADDRESS` post-Demo-Day |
| `HASHKEY_AA_FACTORY_ADDRESS` | `0x452bf276...25D86` (V2) | HashKey factory override |
| `KITE_AA_FACTORY_ADDRESS` | Kite default | Kite factory |
| `KITE_AA_ACCOUNT_IMPLEMENTATION` | `0x2DbBfCd...595C` | Account impl |
| `KITE_CHAIN_ID` | `133` | **Misleadingly named** — currently HashKey |
| `AGENT_A_PRIVATE` / `AGENT_A_OWNER_KEY` | — | Demo agent keys |
| `AGENT_B_PRIVATE` / `AGENT_B_OWNER_KEY` | — | Demo agent keys |
| `DEPLOYER_PRIVATE_KEY` | — | Contract deployment (used by `scripts/deploy-ktrace-hashkey.mjs`) |

## Demo flow decision tree

```
┌─ "Which chain am I on?"
├─ chainId 133 → HashKey — use V2 factory, direct-call payment path
├─ chainId 2368 → Kite — use KiteAI bundler + staging EntryPoint
└─ anything else → unsupported; check NETWORKS map before extending

"User setup flow (HashKey production-shape)"
  owner EOA → factory.createAccount(owner, salt) on V2 → UUPS proxy deployed
           → owner calls aa.createSession(sessionId, agentKey, rules)
           → session key signs EIP-712 TransferAuthorization
           → relayer (EOA or bundler) submits executeTransferWithAuthorizationAndProvider
```

## Known quirks

1. **HashKey RPC lacks `debug_traceCall` / `debug_traceTransaction`.** Bundlers that depend on state-override simulation won't work out of the box. Our self-hosted relay-bundler calls `handleOps` directly; debug reverts via `eth_call` simulation on the raw tx data, which returns `FailedOp(uint256,string)` (selector `0x220266b6`).

2. **HashKey testnet sometimes omits internal ERC20 Transfer logs.** Payment verification must fall back to `SessionPaymentExecuted` event on the AA wallet.

3. **ethers v6 `Contract.getAddress()` shadows the contract's own `getAddress(address,uint256)` view function.** Always use explicit signature: `factory['getAddress(address,uint256)'](owner, salt)`.

4. **Env naming is inconsistent.** `KITE_*` prefixed vars currently default to HashKey values because HashKey is the active demo target. This will be cleaned up in a Phase 3 refactor post-Demo-Day — do NOT assume `KITE_*` means Kite chain today.

## See also

- `backend/contracts/KTraceAccountFactoryV2.sol` — source
- `backend/scripts/deploy-ktrace-hashkey.mjs` — full / `--factory-only` deployment
- `backend/scripts/verify-factory-v2-e2e.mjs` — end-to-end payment path validator
- `backend/data/ktrace-hashkey-factoryV2.json` — latest V2 deployment record
- `backend/data/ktrace-hashkey-deployment.json` — full HashKey deployment record
