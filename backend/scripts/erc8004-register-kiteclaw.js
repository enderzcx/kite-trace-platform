import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAgentMetadataDataUri } from '../lib/contracts/buildAgentMetadata.js';
import { identityRegistryRegisterAbi } from '../lib/contracts/identityRegistryAbi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const AGENT_URI = process.env.ERC8004_AGENT_URI || '';
const AGENT_WALLET = process.env.ERC8004_AGENT_WALLET || '';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8004_IDENTITY_REGISTRY', IDENTITY_REGISTRY);
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);
  if (!ethers.isAddress(IDENTITY_REGISTRY)) {
    throw new Error(`Invalid ERC8004_IDENTITY_REGISTRY: ${IDENTITY_REGISTRY}`);
  }

  const baseUrl = process.env.KTRACE_BASE_URL || process.env.AGENT_ENDPOINT || '';
  const providerId = process.env.ERC8004_PROVIDER_ID || process.env.KITE_AGENT2_ID || '';
  const builtAgentMetadata = buildAgentMetadataDataUri({
    privateKey: PRIVATE_KEY,
    agentWallet: AGENT_WALLET,
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
    metadataSource: AGENT_URI ? 'env-uri' : 'generated-data-uri',
    chain: process.env.KTRACE_CHAIN || 'kite-testnet'
  });
  const resolvedAgentUri = String(AGENT_URI || '').trim() || builtAgentMetadata.uri;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(IDENTITY_REGISTRY, identityRegistryRegisterAbi, wallet);

  console.log(`RPC: ${RPC_URL}`);
  console.log(`ChainId: ${network.chainId}`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`Registrar: ${wallet.address}`);
  console.log(`AgentURI: ${resolvedAgentUri}`);

  const code = await provider.getCode(IDENTITY_REGISTRY);
  if (!code || code === '0x') {
    throw new Error('Identity registry has no code on this network. Deploy registry first.');
  }

  let registerFee = 0n;
  try {
    registerFee = await contract.registerFee();
  } catch {
    registerFee = 0n;
  }
  console.log(`registerFee: ${registerFee.toString()}`);

  const tx = await contract.register(resolvedAgentUri, { value: registerFee });
  console.log(`register tx: ${tx.hash}`);
  const receipt = await tx.wait();

  const transferTopic = contract.interface.getEvent('Transfer').topicHash;
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
      log.topics?.[0] === transferTopic
  );
  if (!transferLog) {
    throw new Error('Transfer event not found in receipt; cannot resolve agentId');
  }
  const parsed = contract.interface.parseLog(transferLog);
  const agentId = parsed?.args?.tokenId?.toString();
  if (!agentId) throw new Error('Failed to parse agentId from Transfer event');

  const owner = await contract.ownerOf(agentId);
  let agentWallet = '';
  try {
    agentWallet = await contract.getAgentWallet(agentId);
  } catch {
    agentWallet = '(getAgentWallet call failed)';
  }

  let finalWallet = agentWallet;
  let walletUpdateTxHash = '';
  const requestedAgentWallet = String(AGENT_WALLET || '').trim();
  if (requestedAgentWallet) {
    if (!ethers.isAddress(requestedAgentWallet)) {
      throw new Error(`Invalid ERC8004_AGENT_WALLET: ${requestedAgentWallet}`);
    }
    if (String(agentWallet).toLowerCase() !== requestedAgentWallet.toLowerCase()) {
      let metadataUpdateFee = 0n;
      try {
        metadataUpdateFee = await contract.metadataUpdateFee();
      } catch {
        metadataUpdateFee = 0n;
      }
      const walletTx = await contract.setAgentWallet(agentId, requestedAgentWallet, { value: metadataUpdateFee });
      walletUpdateTxHash = walletTx.hash;
      await walletTx.wait();
      finalWallet = await contract.getAgentWallet(agentId);
    }
  }

  console.log('----- ERC-8004 REGISTER RESULT -----');
  console.log(`agentId: ${agentId}`);
  console.log(`owner: ${owner}`);
  console.log(`agentWallet: ${finalWallet}`);
  console.log(`txHash: ${tx.hash}`);
  if (walletUpdateTxHash) {
    console.log(`walletUpdateTxHash: ${walletUpdateTxHash}`);
  }
}

main().catch((error) => {
  console.error('ERC-8004 register failed:', error.message);
  process.exit(1);
});
