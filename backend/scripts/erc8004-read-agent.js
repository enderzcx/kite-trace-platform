import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { identityRegistryReadAbi } from '../lib/contracts/identityRegistryAbi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const AGENT_ID = process.env.ERC8004_AGENT_ID || '';

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8004_IDENTITY_REGISTRY', IDENTITY_REGISTRY);
  requireEnv('ERC8004_AGENT_ID', AGENT_ID);
  if (!ethers.isAddress(IDENTITY_REGISTRY)) {
    throw new Error(`Invalid ERC8004_IDENTITY_REGISTRY: ${IDENTITY_REGISTRY}`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const contract = new ethers.Contract(IDENTITY_REGISTRY, identityRegistryReadAbi, provider);

  const owner = await contract.ownerOf(AGENT_ID);
  const tokenURI = await contract.tokenURI(AGENT_ID);
  let agentWallet = '';
  let agentRegistry = '';
  try {
    agentWallet = await contract.getAgentWallet(AGENT_ID);
  } catch {
    agentWallet = '(getAgentWallet call failed)';
  }
  try {
    agentRegistry = await contract.getMetadataByName(AGENT_ID, 'agentRegistry');
  } catch {
    agentRegistry = '(getMetadataByName call failed)';
  }

  console.log(`RPC: ${RPC_URL}`);
  console.log(`ChainId: ${network.chainId}`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`AgentId: ${AGENT_ID}`);
  console.log('----- ERC-8004 AGENT PROFILE -----');
  console.log(`owner: ${owner}`);
  console.log(`tokenURI: ${tokenURI}`);
  console.log(`agentWallet: ${agentWallet}`);
  console.log(`agentRegistry(metadata): ${agentRegistry}`);
}

main().catch((error) => {
  console.error('ERC-8004 read failed:', error.message);
  process.exit(1);
});
