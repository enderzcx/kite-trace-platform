import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAgentMetadataDataUri } from '../lib/contracts/buildAgentMetadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

function main() {
  const baseUrl = process.env.KTRACE_BASE_URL || process.env.AGENT_ENDPOINT || '';
  const providerId = process.env.ERC8004_PROVIDER_ID || process.env.KITE_AGENT2_ID || '';
  const built = buildAgentMetadataDataUri({
    privateKey:
      process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '',
    agentWallet: process.env.ERC8004_AGENT_WALLET || '',
    name: process.env.ERC8004_AGENT_NAME || '',
    description: process.env.ERC8004_AGENT_DESCRIPTION || '',
    capabilities: process.env.ERC8004_AGENT_CAPABILITIES || '',
    transports: process.env.ERC8004_AGENT_TRANSPORTS || '',
    baseUrl,
    agentEndpoint: process.env.AGENT_ENDPOINT || '',
    quoteEndpoint: process.env.QUOTE_ENDPOINT || '',
    jobEndpoint: process.env.JOB_ENDPOINT || '',
    serviceManifest:
      process.env.ERC8004_SERVICE_MANIFEST ||
      (baseUrl && providerId ? `${String(baseUrl).replace(/\/+$/, '')}/api/v1/providers/${encodeURIComponent(providerId)}/manifest` : ''),
    metadataSource: 'generated-data-uri',
    chain: process.env.KTRACE_CHAIN || 'kite-testnet'
  });

  console.log(JSON.stringify(built, null, 2));
}

try {
  main();
} catch (error) {
  console.error('ERC-8004 agent URI build failed:', error.message);
  process.exit(1);
}
