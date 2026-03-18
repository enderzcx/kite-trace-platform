import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileTraceAnchorGuard } from '../lib/contracts/compileTraceAnchorGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const JOB_ANCHOR_REGISTRY = process.argv[2] || process.env.ERC8183_JOB_ANCHOR_REGISTRY || '';
const RPC_TIMEOUT_MS = Number(process.env.KITE_RPC_TIMEOUT_MS || 45000);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8183_JOB_ANCHOR_REGISTRY or CLI arg', JOB_ANCHOR_REGISTRY);
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);
  if (!ethers.isAddress(JOB_ANCHOR_REGISTRY)) {
    throw new Error(`Invalid ERC8183_JOB_ANCHOR_REGISTRY: ${JOB_ANCHOR_REGISTRY}`);
  }

  const compiled = compileTraceAnchorGuard();
  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 45000;
  const provider = new ethers.JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy(JOB_ANCHOR_REGISTRY);
  const deploymentTx = contract.deploymentTransaction();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        chainId: String(network.chainId),
        deployer: wallet.address,
        owner: wallet.address,
        registry: JOB_ANCHOR_REGISTRY,
        txHash: deploymentTx?.hash || '',
        address
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERC-8183 trace anchor guard deploy failed:', error.message);
  process.exit(1);
});
