import { ethers } from 'ethers';

function dedupeList(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function parseCsv(raw = '') {
  return dedupeList(String(raw || '').split(','));
}

export function buildAgentMetadataPayload(env = {}) {
  const walletFromKey = env.privateKey ? new ethers.Wallet(env.privateKey).address : '';
  const agentWallet = env.agentWallet || walletFromKey || '';
  const endpoints = dedupeList([
    env.baseUrl,
    env.agentEndpoint,
    env.quoteEndpoint,
    env.jobEndpoint
  ]);
  const capabilities = parseCsv(env.capabilities || 'negotiated-buy,x402-payment,erc8183-job');
  const transports = parseCsv(env.transports || 'http');

  return {
    standard: 'erc-8004',
    version: env.version || '1.0.0',
    name: env.name || 'Kite Trace Agent',
    description:
      env.description ||
      'Kite Trace CLI-first MVP agent identity for negotiated commerce, x402 micropayments, and ERC-8183-aware job flows.',
    agentWallet,
    capabilities,
    endpoints,
    transports,
    serviceManifest: env.serviceManifest || '',
    metadataSource: env.metadataSource || 'data-uri',
    chain: env.chain || 'kite-testnet'
  };
}

export function buildAgentMetadataDataUri(env = {}) {
  const payload = buildAgentMetadataPayload(env);
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return {
    payload,
    uri: `data:application/json;base64,${encoded}`
  };
}
