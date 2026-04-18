function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function buildPublicBaseUrl(req, deps = {}) {
  const configured = normalizeText(deps.BACKEND_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL || '');
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedProto = normalizeText(req.headers['x-forwarded-proto'] || '');
  const forwardedHost = normalizeText(req.headers['x-forwarded-host'] || '');
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || `127.0.0.1:${normalizeText(process.env.PORT || '3001') || '3001'}`;
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function buildAgentCard(req, deps = {}) {
  const baseUrl = buildPublicBaseUrl(req, deps);
  const authRequired = Boolean(deps.authConfigured?.());

  return {
    name: 'Kite Trace',
    description: 'Auditable multi-agent trading and commerce platform on KiteAI testnet. Supports ERC-8004 identity, ERC-8183 escrow jobs, x402 micropayments, and MCP tool interface.',
    version: normalizeText(deps.PACKAGE_VERSION || '1.0.0') || '1.0.0',
    url: baseUrl,
    operator: {
      wallet: normalizeText(process.env.KITE_AA_WALLET || process.env.KITE_AGENT1_AA_ADDRESS || ''),
      identity_registry: '0x60BF18964FCB1B2E987732B0477E51594B3659B1'
    },
    chain: {
      name: process.env.KITE_NETWORK_NAME || 'KiteAI Testnet',
      chain_id: Number(process.env.KITE_CHAIN_ID) || 2368,
      rpc_url: process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/',
      contracts: {
        identity_registry: '0x60BF18964FCB1B2E987732B0477E51594B3659B1',
        trust_anchor: '0xAcdcF151F4A28fFd07e45c62FfE9DAEDe9556823',
        settlement_token: '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63'
      }
    },
    auth: authRequired
      ? { type: 'api-key-header', header: 'x-api-key' }
      : { type: 'none' },
    protocols: ['erc-8004', 'erc-8183', 'x402', 'mcp'],
    agents: [
      {
        id: 'synthesis-request-agent',
        role: 'requester',
        description: 'Autonomous loop that posts BTC trade plan bounties every hour via ERC-8183 escrow.',
        capabilities: ['job.create', 'job.fund', 'job.validate']
      },
      {
        id: 'fundamental-agent-real',
        role: 'provider',
        description: 'News & social intelligence (listing alerts, news signals, meme sentiment, KOL monitoring).',
        capabilities: ['cap-listing-alert', 'cap-news-signal', 'cap-meme-sentiment', 'cap-kol-monitor']
      },
      {
        id: 'technical-agent-real',
        role: 'provider',
        description: 'On-chain & DEX intelligence (smart money, token analysis, wallet PnL, trenches scan, DEX market data).',
        capabilities: ['cap-smart-money-signal', 'cap-token-analysis', 'cap-wallet-pnl', 'cap-trenches-scan', 'cap-dex-market']
      },
      {
        id: 'data-node-real',
        role: 'provider',
        description: 'General data primitives (market prices, tech news, weather).',
        capabilities: ['cap-market-price-feed', 'cap-tech-buzz-signal', 'cap-weather-context']
      }
    ],
    safety: {
      budget_aware: true,
      max_per_tx: normalizeText(process.env.KITE_POLICY_MAX_PER_TX || '0.05'),
      daily_limit: normalizeText(process.env.KITE_POLICY_DAILY_LIMIT || '0.5'),
      guardrails: [
        'session_key_scoping',
        'aa_wallet_policy_enforcement',
        'x402_payment_proof_verification',
        'on_chain_trust_anchoring',
        'erc8183_escrow_settlement'
      ]
    },
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      agent_json: `${baseUrl}/.well-known/agent.json`,
      agent_log: `${baseUrl}/api/synthesis/agent-log`,
      evidence: `${baseUrl}/api/public/evidence/{traceId}`,
      discovery: `${baseUrl}/api/v1/discovery/select`,
      jobs: `${baseUrl}/api/jobs`
    },
    capabilities: [
      {
        id: 'job.create',
        method: 'POST',
        path: '/api/jobs',
        url: `${baseUrl}/api/jobs`,
        auth: authRequired ? 'agent' : 'none'
      },
      {
        id: 'job.audit.public',
        method: 'GET',
        path: '/api/public/jobs/:jobId/audit',
        url: `${baseUrl}/api/public/jobs/{jobId}/audit`,
        auth: 'none'
      },
      {
        id: 'job.audit.publicByTrace',
        method: 'GET',
        path: '/api/public/jobs/by-trace/:traceId/audit',
        url: `${baseUrl}/api/public/jobs/by-trace/{traceId}/audit`,
        auth: 'none'
      },
      {
        id: 'synthesis.loop.status',
        method: 'GET',
        path: '/api/synthesis/loop/status',
        url: `${baseUrl}/api/synthesis/loop/status`,
        auth: authRequired ? 'agent' : 'none'
      },
      {
        id: 'synthesis.agent-log',
        method: 'GET',
        path: '/api/synthesis/agent-log',
        url: `${baseUrl}/api/synthesis/agent-log`,
        auth: 'none'
      },
      {
        id: 'approval.read',
        method: 'GET',
        path: '/api/approvals/:approvalId',
        url: `${baseUrl}/api/approvals/{approvalId}`,
        auth: authRequired ? 'agent-or-approval-token' : 'none'
      }
    ]
  };
}

export function registerAgentCardRoutes(app, deps = {}) {
  app.get('/.well-known/agent.json', (req, res) => {
    return res.json(buildAgentCard(req, deps));
  });
}
