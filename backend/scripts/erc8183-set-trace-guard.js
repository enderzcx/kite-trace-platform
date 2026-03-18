import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const ESCROW_ADDRESS = process.env.ERC8183_ESCROW_ADDRESS || '';
const NEXT_GUARD_RAW = process.argv[2] || process.env.ERC8183_TRACE_ANCHOR_GUARD || '';
const RPC_TIMEOUT_MS = Number(process.env.KITE_RPC_TIMEOUT_MS || 45000);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

function loadEscrowAbi() {
  const raw = fs.readFileSync(new URL('../lib/abi/JobEscrowV2.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

async function main() {
  requireEnv('ERC8183_ESCROW_ADDRESS', ESCROW_ADDRESS);
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);
  requireEnv('CLI arg or ERC8183_TRACE_ANCHOR_GUARD', NEXT_GUARD_RAW);

  if (!ethers.isAddress(ESCROW_ADDRESS)) {
    throw new Error(`Invalid ERC8183_ESCROW_ADDRESS: ${ESCROW_ADDRESS}`);
  }
  const nextGuard =
    /^0x0{40}$/i.test(String(NEXT_GUARD_RAW || '').trim()) || String(NEXT_GUARD_RAW || '').trim() === '0x0'
      ? ethers.ZeroAddress
      : String(NEXT_GUARD_RAW || '').trim();
  if (!ethers.isAddress(nextGuard)) {
    throw new Error(`Invalid trace anchor guard address: ${NEXT_GUARD_RAW}`);
  }

  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 45000;
  const provider = new ethers.JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(ESCROW_ADDRESS, loadEscrowAbi(), wallet);
  const owner = String((await contract.owner()) || '').trim();
  const previousGuard = String((await contract.traceAnchorGuard()) || '').trim();

  const tx = await contract.setTraceAnchorGuard(nextGuard);
  await tx.wait();

  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        chainId: String(network.chainId),
        deployer: wallet.address,
        owner,
        txHash: tx.hash || '',
        address: ESCROW_ADDRESS,
        previousGuard,
        nextGuard
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERC-8183 set trace guard failed:', error.message);
  process.exit(1);
});
