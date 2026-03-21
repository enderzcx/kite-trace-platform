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
  agentsLive: 3,
  capabilityCount: 9,
  network: "Kite Testnet",
  standards: "ERC-8004 + ERC-8183",
};

export const fallbackCapabilities: ShowcaseCapability[] = [
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
];

export const fallbackProviders: ShowcaseProvider[] = [
  {
    providerId: "fundamental-agent-real",
    title: "Fundamental Agent",
    agentId: "3",
    description: "News & social intelligence",
    aaWalletAddress: "0x28172e0d973fff24651b6ed4ca6d1007bc168c94",
    ownerWalletAddress: "0x6d705b93f0da7dc26e46cb39decc3baa4fb4dd29",
    explorerUrl: "https://testnet.kitescan.ai/address/0x28172e0d973fff24651b6ed4ca6d1007bc168c94",
    identityRegistryUrl:
      "https://testnet.kitescan.ai/address/0x60BF18964FCB1B2E987732B0477E51594B3659B1",
    capabilities: fallbackCapabilities.filter(
      (capability) => capability.providerId === "fundamental-agent-real"
    ),
  },
  {
    providerId: "technical-agent-real",
    title: "Technical Agent",
    agentId: "2",
    description: "On-chain & DEX intelligence",
    aaWalletAddress: "0x4220fc0cec70897575117100d5bc9489ed1b13ac",
    ownerWalletAddress: "0x6d705b93f0da7dc26e46cb39decc3baa4fb4dd29",
    explorerUrl: "https://testnet.kitescan.ai/address/0x4220fc0cec70897575117100d5bc9489ed1b13ac",
    identityRegistryUrl:
      "https://testnet.kitescan.ai/address/0x60BF18964FCB1B2E987732B0477E51594B3659B1",
    capabilities: fallbackCapabilities.filter(
      (capability) => capability.providerId === "technical-agent-real"
    ),
  },
];
