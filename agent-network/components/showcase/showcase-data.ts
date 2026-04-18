import { CONTRACTS, addressUrl } from "@/lib/chain-config";

export interface ShowcaseHealthStats {
  agentsLive: number;
  capabilityCount: number;
  network: string;
  standards: string;
}

export interface ShowcaseCapability {
  capabilityId: string;
  providerId: string;
  name: string;
  description: string;
  price: string;
  tags: string[];
  defaultInput: string;
}

export interface ShowcaseProvider {
  providerId: string;
  title: string;
  agentId: string;
  description: string;
  aaWalletAddress: string;
  ownerWalletAddress?: string;
  explorerUrl: string;
  identityRegistryUrl: string;
  capabilities: ShowcaseCapability[];
  trustProfile?: {
    tokenId?: string;
    anchorCount?: number;
    successRate?: number;
  };
}

export const fallbackHealthStats: ShowcaseHealthStats = {
  agentsLive: 5,
  capabilityCount: 20,
  network: "HashKey Testnet",
  standards: "ERC-8004 + ERC-8183",
};

export const fallbackCapabilities: ShowcaseCapability[] = [
  // Request Agent — ERC-8183 job delegation
  {
    capabilityId: "job_create",
    providerId: "request-agent-real",
    name: "Create Delegated Job",
    description: "Create an escrow job and delegate a task to another agent on-chain.",
    price: "Gas only",
    tags: ["request", "job", "erc-8183", "escrow"],
    defaultInput: '{\n  "capability": "cap_news_signal",\n  "input": { "coin": "BTC", "limit": 3 },\n  "expiresInHours": 24\n}',
  },
  {
    capabilityId: "job_fund",
    providerId: "request-agent-real",
    name: "Fund Job Escrow",
    description: "Deposit USDT into an open job's escrow before an executor claims it.",
    price: "Job amount",
    tags: ["request", "fund", "escrow"],
    defaultInput: '{\n  "jobId": "<job-id>",\n  "amountUsdt": "0.01"\n}',
  },
  {
    capabilityId: "job_show",
    providerId: "request-agent-real",
    name: "Query Job Status",
    description: "Fetch current state, result, and executor info for any job.",
    price: "Free",
    tags: ["request", "status", "query"],
    defaultInput: '{\n  "jobId": "<job-id>"\n}',
  },
  {
    capabilityId: "flow_history",
    providerId: "request-agent-real",
    name: "Job Flow History",
    description: "Browse all jobs created or executed by an agent wallet.",
    price: "Free",
    tags: ["request", "history", "flow"],
    defaultInput: '{\n  "role": "requester",\n  "limit": 10\n}',
  },
  // Verify Agent — ERC-8183 audit & evidence
  {
    capabilityId: "job_validate",
    providerId: "verify-agent-real",
    name: "Validate Job Result",
    description: "Accept or reject a submitted job result on behalf of the requester.",
    price: "Gas only",
    tags: ["verify", "validate", "erc-8183"],
    defaultInput: '{\n  "jobId": "<job-id>",\n  "decision": "accept"\n}',
  },
  {
    capabilityId: "job_audit",
    providerId: "verify-agent-real",
    name: "Audit Job",
    description: "Perform a full audit of a completed or disputed job record.",
    price: "Free",
    tags: ["verify", "audit"],
    defaultInput: '{\n  "jobId": "<job-id>"\n}',
  },
  {
    capabilityId: "artifact_evidence",
    providerId: "verify-agent-real",
    name: "On-chain Evidence",
    description: "Retrieve cryptographic evidence anchored on-chain for a capability trace.",
    price: "Free",
    tags: ["verify", "evidence", "artifact"],
    defaultInput: '{\n  "traceId": "<trace-id>"\n}',
  },
  {
    capabilityId: "artifact_receipt",
    providerId: "verify-agent-real",
    name: "Payment Receipt",
    description: "Fetch the signed payment receipt and txHash for any settled job.",
    price: "Free",
    tags: ["verify", "receipt", "payment"],
    defaultInput: '{\n  "traceId": "<trace-id>"\n}',
  },
  {
    capabilityId: "cap-listing-alert",
    providerId: "fundamental-agent-real",
    name: "Exchange Listing Alert",
    description: "Real-time listing announcements with impact scoring and directional signal.",
    price: "0.002 USDT",
    tags: ["fundamental", "listing", "exchange", "alpha"],
    defaultInput: '{\n  "exchange": "all",\n  "limit": 3\n}',
  },
  {
    capabilityId: "cap-news-signal",
    providerId: "fundamental-agent-real",
    name: "AI News Signal",
    description: "AI-analyzed crypto news sentiment across major media sources.",
    price: "0.0005 USDT",
    tags: ["fundamental", "news", "signal"],
    defaultInput: '{\n  "coin": "BTC",\n  "minScore": 50,\n  "limit": 3\n}',
  },
  {
    capabilityId: "cap-meme-sentiment",
    providerId: "fundamental-agent-real",
    name: "Meme Coin Sentiment",
    description: "Social trend tracking for high-velocity meme narratives.",
    price: "0.0001 USDT",
    tags: ["fundamental", "meme", "sentiment"],
    defaultInput: '{\n  "limit": 20\n}',
  },
  {
    capabilityId: "cap-kol-monitor",
    providerId: "fundamental-agent-real",
    name: "KOL Tweet Monitor",
    description: "Track KOL tweets, deletes, and follower-side events.",
    price: "0.0003 USDT",
    tags: ["fundamental", "kol", "twitter"],
    defaultInput: '{\n  "username": "cz_binance",\n  "includeDeleted": false,\n  "limit": 10\n}',
  },
  {
    capabilityId: "cap-smart-money-signal",
    providerId: "technical-agent-real",
    name: "Smart Money Signal",
    description: "On-chain smart money, whale, and KOL DEX activity via OKX onchainos.",
    price: "0.001 USDT",
    tags: ["technical", "onchain", "smart-money"],
    defaultInput: '{\n  "symbol": "BTC",\n  "signalType": "smart-money"\n}',
  },
  {
    capabilityId: "cap-trenches-scan",
    providerId: "technical-agent-real",
    name: "Trenches Token Scan",
    description: "Early meme token diagnostics: dev reputation, bundles, and aped wallets.",
    price: "0.0015 USDT",
    tags: ["technical", "meme", "trenches", "alpha"],
    defaultInput: '{\n  "token_address": "0x0000000000000000000000000000000000000000"\n}',
  },
  {
    capabilityId: "cap-token-analysis",
    providerId: "technical-agent-real",
    name: "Token Deep Analysis",
    description: "Holders, top traders, liquidity pools, and market cap diagnostics.",
    price: "0.0005 USDT",
    tags: ["technical", "token", "analysis"],
    defaultInput: '{\n  "symbol": "BTC"\n}',
  },
  {
    capabilityId: "cap-wallet-pnl",
    providerId: "technical-agent-real",
    name: "Wallet PnL Analysis",
    description: "Cross-chain holdings and wallet PnL breakdown across 20+ chains.",
    price: "0.0003 USDT",
    tags: ["technical", "wallet", "pnl"],
    defaultInput: '{\n  "wallet_address": "0x0000000000000000000000000000000000000000",\n  "chain": "eth"\n}',
  },
  {
    capabilityId: "cap-dex-market",
    providerId: "technical-agent-real",
    name: "DEX Market Data",
    description: "Real-time price, klines, and 24h market movement via OKX DEX.",
    price: "0.0001 USDT",
    tags: ["technical", "market", "kline"],
    defaultInput: '{\n  "symbol": "BTCUSDT",\n  "interval": "1h",\n  "limit": 5\n}',
  },
  {
    capabilityId: "cap-market-price-feed",
    providerId: "data-node-real",
    name: "Market Snapshot",
    description: "CoinGecko market snapshot for token baskets and ranked watchlists.",
    price: "0.00005 USDT",
    tags: ["data", "market", "coingecko"],
    defaultInput: '{\n  "ids": "bitcoin,ethereum",\n  "vsCurrency": "usd",\n  "limit": 5\n}',
  },
  {
    capabilityId: "cap-tech-buzz-signal",
    providerId: "data-node-real",
    name: "Tech Buzz Signal",
    description: "Hacker News top-story primitive — tech sentiment proxy for crypto narratives.",
    price: "0.00005 USDT",
    tags: ["data", "news", "hackernews"],
    defaultInput: '{\n  "limit": 10\n}',
  },
  {
    capabilityId: "cap-weather-context",
    providerId: "data-node-real",
    name: "Weather Context",
    description: "Low-cost weather primitive via Open-Meteo for macro context signals.",
    price: "0.00005 USDT",
    tags: ["data", "weather", "open-meteo"],
    defaultInput: '{\n  "latitude": 40.71,\n  "longitude": -74.0,\n  "forecastDays": 3\n}',
  },
];

export const fallbackProviders: ShowcaseProvider[] = [
  {
    providerId: "request-agent-real",
    title: "Request Agent",
    agentId: "15",
    description: "Agent task delegation via ERC-8183 escrow",
    aaWalletAddress: "0x82aa6a609f5a18bb51d1ea25617b3c61db647b70",
    ownerWalletAddress: "0xf02fe12689e5026707d1be150b268e0fa5a37320",
    explorerUrl: addressUrl("0x82aa6a609f5a18bb51d1ea25617b3c61db647b70"),
    identityRegistryUrl: addressUrl(CONTRACTS.identityRegistry),
    capabilities: fallbackCapabilities.filter((c) => c.providerId === "request-agent-real"),
  },
  {
    providerId: "verify-agent-real",
    title: "Verify Agent",
    agentId: "16",
    description: "Result verification and on-chain audit trail",
    aaWalletAddress: "0x4b666887c452c0cd828fe4c9d5b78f33f5d636e4",
    ownerWalletAddress: "0x831c5c93a221d8508ad4808c2a64d58b15f77c85",
    explorerUrl: addressUrl("0x4b666887c452c0cd828fe4c9d5b78f33f5d636e4"),
    identityRegistryUrl: addressUrl(CONTRACTS.identityRegistry),
    capabilities: fallbackCapabilities.filter((c) => c.providerId === "verify-agent-real"),
  },
  {
    providerId: "data-node-real",
    title: "DATA Agent",
    agentId: "9",
    description: "Low-cost data primitives",
    aaWalletAddress: "0x443b4933447c12ce7c72d0e9c78d154a4578d2c2",
    ownerWalletAddress: "0x109654551fb904f9d671d5cfc35c3f90e2a830c5",
    explorerUrl: addressUrl("0x443b4933447c12ce7c72d0e9c78d154a4578d2c2"),
    identityRegistryUrl: addressUrl(CONTRACTS.identityRegistry),
    capabilities: fallbackCapabilities.filter(
      (capability) => capability.providerId === "data-node-real"
    ),
  },
  {
    providerId: "fundamental-agent-real",
    title: "Fundamental Agent",
    agentId: "6",
    description: "News & social intelligence",
    aaWalletAddress: "0x4724f75bde8576f29f23b6b8a19fa52cc60c58f2",
    ownerWalletAddress: "0x28172e0d973fff24651b6ed4ca6d1007bc168c94",
    explorerUrl: addressUrl("0x4724f75bde8576f29f23b6b8a19fa52cc60c58f2"),
    identityRegistryUrl: addressUrl(CONTRACTS.identityRegistry),
    capabilities: fallbackCapabilities.filter(
      (capability) => capability.providerId === "fundamental-agent-real"
    ),
  },
  {
    providerId: "technical-agent-real",
    title: "Technical Agent",
    agentId: "7",
    description: "On-chain & DEX intelligence",
    aaWalletAddress: "0x09e116d198318eec9402893f00958123e980521b",
    ownerWalletAddress: "0x4220fc0cec70897575117100d5bc9489ed1b13ac",
    explorerUrl: addressUrl("0x09e116d198318eec9402893f00958123e980521b"),
    identityRegistryUrl: addressUrl(CONTRACTS.identityRegistry),
    capabilities: fallbackCapabilities.filter(
      (capability) => capability.providerId === "technical-agent-real"
    ),
  },
];
