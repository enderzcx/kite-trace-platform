# Kite Trace Frontend Showcase Plan

## Goal

Build a public-facing showcase frontend at `https://kiteclaw.duckdns.org` that lets any visitor — especially agent builders and Kite team members — immediately understand what Kite Trace does, see it running live, and know how to integrate.

**Target audience:** agent builders, Kite ecosystem team, hackathon judges.

**Hard deadline:** ready before 2026-03-17.

---

## Constraints

- Use the existing `agent-network/` Next.js app (Next.js 16 + Tailwind 4 + shadcn + framer-motion + lucide-react).
- All API calls go to `https://kiteclaw.duckdns.org/api/*` via a Next.js API route proxy (avoid CORS).
- No auth required for the demo — use the public `agent-local-dev-key` API key for the live demo calls.
- Mobile-responsive but desktop-first.
- Dark theme (keep existing dark background style).
- Do not break the existing `/history` route.

---

## Stack

```
Framework:  Next.js (app router, existing setup)
Styling:    Tailwind CSS v4 + shadcn/ui components
Animation:  framer-motion (already installed)
Icons:      lucide-react (already installed)
Data:       fetch from /api/proxy/* → backend at kiteclaw.duckdns.org
```

---

## Page Structure

Single-page layout (`/`) with five sections. Each section is a full-width block.

```
/
  Section 1: Hero
  Section 2: Live Agent Network
  Section 3: Live Demo
  Section 4: How It Works
  Section 5: For Builders
```

---

## Section 1: Hero

**Purpose:** Immediate orientation. What is this, why does it matter, is it real.

**Layout:** Full-width centered block, ~100vh.

**Content:**

```
Logo / wordmark: "Kite Trace Platform"
Tagline: "Trust + Commerce + Audit for open agent networks."
Sub-tagline: "Any agent can discover services, pay, and get verifiable proof — on Kite testnet."

Live stats row (fetched from GET /api/public/health on load):
  [ 3 Agents Live ]   [ 10 Capabilities ]   [ Kite Testnet ]   [ ERC-8004 + ERC-8183 ]

CTA buttons:
  [Try Live Demo]  →  smooth scroll to Section 3
  [View on GitHub]  →  https://github.com/enderzcx/kite-trace-platform
```

**Notes:**
- Stats row should show real numbers from the health endpoint if available, fallback to static values.
- The background gradient can reuse the existing radial dark style.

---

## Section 2: Live Agent Network

**Purpose:** Show what's on the network right now — real agents with real capabilities and prices.

**Layout:** Two agent cards side by side (stack on mobile).

**Data source:** `GET /api/v1/providers?discoverable=true` + `GET /api/v1/capabilities`

**Agent card design:**

```
┌──────────────────────────────────────────┐
│ [Icon]  Fundamental Agent                │
│         agentId=3  •  ERC-8004 Verified ✓│
│         0x... [→ Kite explorer link]     │
│                                          │
│  Capabilities:                           │
│  ● cap-listing-alert      0.002 USDT    │
│  ● cap-news-signal       0.0005 USDT    │
│  ● cap-meme-sentiment    0.0001 USDT    │
│  ● cap-kol-monitor       0.0003 USDT    │
│                                          │
│  News & Social Intelligence              │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ [Icon]  Technical Agent                  │
│         agentId=2  •  ERC-8004 Verified ✓│
│                                          │
│  Capabilities:                           │
│  ● cap-smart-money-signal  0.001 USDT   │
│  ● cap-trenches-scan      0.0015 USDT   │
│  ● cap-token-analysis     0.0005 USDT   │
│  ● cap-wallet-pnl         0.0003 USDT   │
│  ● cap-dex-market         0.0001 USDT   │
│                                          │
│  On-chain & DEX Intelligence             │
└──────────────────────────────────────────┘
```

**Notes:**
- ERC-8004 Verified badge: green checkmark, link to `https://testnet.kitescan.ai/address/0x60BF18964FCB1B2E987732B0477E51594B3659B1`
- Capability rows: clicking a capability should pre-fill it in Section 3 Live Demo.
- If API is unavailable, fall back to static hardcoded data (always show something).

---

## Section 3: Live Demo

**Purpose:** Let the visitor actually run a service call and see the result + evidence. This is the most important section.

**Layout:** Two-column on desktop (left: input panel, right: result + evidence panel). Single column on mobile.

### 3A: Input Panel

```
Title: "Try It Live"
Subtitle: "Call a real agent service. Payment handled automatically."

Step 1 — Select a capability:
  Dropdown with all 10 cap-* options
  Each option shows: name + provider + price
  Default: cap-listing-alert

Step 2 — Input parameters:
  JSON textarea, pre-filled with the default input for the selected capability:
    cap-listing-alert   →  { "exchange": "all", "limit": 3 }
    cap-news-signal     →  { "coin": "BTC", "limit": 3 }
    cap-dex-market      →  { "symbol": "BTCUSDT", "interval": "1h", "limit": 5 }
    cap-smart-money-signal → { "symbol": "BTC", "signalType": "smart-money" }
    (others: sensible defaults)

Step 3 — Buy button:
  [Buy Service  →  0.002 USDT]
  (price updates dynamically based on selected capability)
```

### 3B: Result Panel

Starts empty. After clicking Buy:

```
Status indicator (animated):
  ○ Discovering provider...     [done ✓]
  ○ Session ready               [done ✓]
  ○ x402 payment sent           [done ✓]
  ○ Result received             [done ✓]

Result tab:
  Show the returned data in a clean readable format.
  For listings: card per listing with exchange, coin, signal badge (long=green/short=red/neutral=gray), aiScore, summary.
  For news: article title, source, signal badge, aiScore, [Read Source ↗] button linking to sourceUrl.
  For klines: simple price + change display + kline rows.
  Every record must show sourceUrl as a clickable link if present.

Evidence tab (default visible after result loads):
  Box titled "Audit Evidence"
  Fields:
    traceId:       purchase_xxx
    authorizedBy:  0x4220fc0...   [copy button]
    payment:       0.002 USDT  •  txHash: 0x...
    sourceUrl:     https://... [clickable per record]
    fetchedAt:     2026-03-16T...

  Footer: [View Raw Evidence JSON ↗]  →  GET /api/public/evidence/<traceId>

Error state:
  If the call fails (e.g., API unavailable), show a clear error message.
  Do not crash the page.
```

### 3C: API proxy route

Create `agent-network/app/api/demo/invoke/route.ts`:

```ts
// Proxies POST to https://kiteclaw.duckdns.org/api/services/invoke
// Adds Authorization: Bearer agent-local-dev-key
// Returns the response as-is
```

Create `agent-network/app/api/demo/evidence/[traceId]/route.ts`:

```ts
// Proxies GET to https://kiteclaw.duckdns.org/api/public/evidence/:traceId
```

Create `agent-network/app/api/demo/discovery/route.ts`:

```ts
// Proxies GET /api/v1/discovery/select
```

---

## Section 4: How It Works

**Purpose:** Explain the system in one visual pass. Builders should understand the flow after 30 seconds.

**Layout:** Two blocks stacked.

### Block A: Commerce Flow Diagram

```
Three paths shown as horizontal swimlane:

Direct Buy:
  Discover  →  Pay (x402)  →  Result  →  Evidence

Negotiated Buy:
  Negotiate (XMTP)  →  Pay (x402)  →  Result  →  Evidence

Escrow Job:
  Negotiate  →  Escrow (ERC-8183)  →  Submit  →  Evaluate  →  Settle  →  Evidence
```

Each step is a pill/badge. Arrows between steps. Color-coded by layer (identity=blue, payment=green, audit=purple).

### Block B: Authorization Model

```
Simple visual:

User EOA  ──authorizes──►  AA Wallet
                               │
                         session key
                         (spend limit + time window)
                               │
                          Agent executes
                               │
                    evidence.authorizedBy = User EOA
```

Text below: "The agent never holds your private key. It only holds a constrained session key you can revoke at any time."

---

## Section 5: For Builders

**Purpose:** Give builders everything they need to integrate in one place.

**Layout:** Two-column (Consumer / Provider), then a bottom bar with links.

### Column A: As a Consumer Agent

```
Title: "Buy services from the network"

Code block (copy button):
  # Discover
  GET /api/v1/discovery/select?capability=cap-listing-alert

  # Buy
  POST /api/services/invoke
  { "provider": "fundamental-agent-real",
    "capability": "cap-listing-alert",
    "input": { "exchange": "binance", "limit": 3 } }

  # Verify audit (public)
  GET /api/public/evidence/<traceId>
```

### Column B: As a Provider Agent

```
Title: "Sell your services on the network"

Steps:
  1. Register ERC-8004 identity on Kite testnet
  2. Publish a Service Manifest with your endpoint
  3. Get approved → appear in ranked discovery
  4. Receive forwarded calls, return results

Link: [Provider Onboarding Guide ↗]
```

### Bottom bar

```
[GitHub ↗]   [Provider Docs ↗]   [Agent Integration Guide ↗]   [Wallet Auth Model ↗]
```

---

## Existing Routes to Preserve

- `/history` — keep working as-is, do not modify.

---

## File Changes Required

```
New files:
  agent-network/app/api/demo/invoke/route.ts
  agent-network/app/api/demo/evidence/[traceId]/route.ts
  agent-network/app/api/demo/discovery/route.ts
  agent-network/app/api/health/route.ts
  agent-network/components/showcase/HeroSection.tsx
  agent-network/components/showcase/AgentNetworkSection.tsx
  agent-network/components/showcase/LiveDemoSection.tsx
  agent-network/components/showcase/HowItWorksSection.tsx
  agent-network/components/showcase/ForBuildersSection.tsx

Modified files:
  agent-network/app/page.tsx   → replace with new single-page layout using the five sections above
  agent-network/app/layout.tsx → confirm metadata (title, description, og tags)
```

---

## Environment Variable

Add to `agent-network/.env.local`:

```env
BACKEND_URL=https://kiteclaw.duckdns.org
DEMO_API_KEY=agent-local-dev-key
```

---

## Acceptance Criteria

- [ ] Hero section loads with live stats from `/api/public/health`
- [ ] Both agent cards show real capability data from `/api/v1/capabilities`
- [ ] Capability click in Section 2 pre-fills Section 3 input
- [ ] Live Demo: clicking Buy calls the real backend and returns a result
- [ ] Result panel shows `sourceUrl` as a clickable link per record
- [ ] Evidence panel shows `authorizedBy`, `traceId`, `txHash`
- [ ] "View Raw Evidence JSON" link opens the public evidence endpoint
- [ ] Section 4 flow diagram renders cleanly on desktop
- [ ] Section 5 code blocks have copy buttons
- [ ] `/history` route still works
- [ ] No hardcoded secrets in frontend code
- [ ] Builds without errors: `npm run build`
- [ ] Responsive on mobile (≥ 375px width)
