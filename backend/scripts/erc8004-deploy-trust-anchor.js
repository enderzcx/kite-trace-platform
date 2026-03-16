import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileTrustPublicationAnchor } from '../lib/contracts/compileTrustPublicationAnchor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const DEPLOY_OWNER = process.env.ERC8004_DEPLOY_OWNER || '';
const RPC_TIMEOUT_MS = Number(process.env.KITE_RPC_TIMEOUT_MS || 45000);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);

  const compiled = compileTrustPublicationAnchor();
  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 45000;
  const provider = new ethers.JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const initialOwner = DEPLOY_OWNER && ethers.isAddress(DEPLOY_OWNER) ? DEPLOY_OWNER : wallet.address;

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy(initialOwner);
  const deploymentTx = contract.deploymentTransaction();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        chainId: String(network.chainId),
        deployer: wallet.address,
        owner: initialOwner,
        txHash: deploymentTx?.hash || '',
        address
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERC-8004 trust anchor deploy failed:', error.message);
  process.exit(1);
});
