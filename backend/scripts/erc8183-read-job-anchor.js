import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { jobLifecycleAnchorAbi } from '../lib/contracts/jobLifecycleAnchorAbi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const JOB_ANCHOR = process.env.ERC8183_JOB_ANCHOR_REGISTRY || '';
const anchorIdArg = String(process.argv[2] || '').trim();

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8183_JOB_ANCHOR_REGISTRY', JOB_ANCHOR);
  if (!ethers.isAddress(JOB_ANCHOR)) {
    throw new Error(`Invalid ERC8183_JOB_ANCHOR_REGISTRY: ${JOB_ANCHOR}`);
  }
  if (!anchorIdArg || !/^\d+$/.test(anchorIdArg)) {
    throw new Error('Usage: node scripts/erc8183-read-job-anchor.js <anchorId>');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(JOB_ANCHOR, jobLifecycleAnchorAbi, provider);
  const anchor = await contract.getJobAnchor(anchorIdArg);

  console.log(
    JSON.stringify(
      {
        registry: JOB_ANCHOR,
        anchorId: anchorIdArg,
        anchorType: anchor[0],
        jobId: anchor[1],
        traceId: anchor[2],
        providerId: anchor[3],
        capability: anchor[4],
        status: anchor[5],
        paymentRequestId: anchor[6],
        paymentTxHash: anchor[7],
        validationId: anchor[8],
        referenceId: anchor[9],
        payloadHash: anchor[10],
        detailsURI: anchor[11],
        publisher: anchor[12],
        createdAt: Number(anchor[13] || 0)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERC-8183 job anchor read failed:', error.message);
  process.exit(1);
});
