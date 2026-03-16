import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { trustPublicationAnchorAbi } from '../lib/contracts/trustPublicationAnchorAbi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const TRUST_ANCHOR = process.env.ERC8004_TRUST_ANCHOR_REGISTRY || '';
const anchorIdArg = String(process.argv[2] || '').trim();

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8004_TRUST_ANCHOR_REGISTRY', TRUST_ANCHOR);
  if (!ethers.isAddress(TRUST_ANCHOR)) {
    throw new Error(`Invalid ERC8004_TRUST_ANCHOR_REGISTRY: ${TRUST_ANCHOR}`);
  }
  if (!anchorIdArg || !/^\d+$/.test(anchorIdArg)) {
    throw new Error('Usage: node scripts/erc8004-read-trust-anchor.js <anchorId>');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(TRUST_ANCHOR, trustPublicationAnchorAbi, provider);
  const publication = await contract.getPublication(anchorIdArg);

  console.log(
    JSON.stringify(
      {
        registry: TRUST_ANCHOR,
        anchorId: anchorIdArg,
        publicationType: publication[0],
        sourceId: publication[1],
        agentId: publication[2],
        referenceId: publication[3],
        traceId: publication[4],
        payloadHash: publication[5],
        detailsURI: publication[6],
        publisher: publication[7],
        createdAt: Number(publication[8] || 0)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERC-8004 trust anchor read failed:', error.message);
  process.exit(1);
});
