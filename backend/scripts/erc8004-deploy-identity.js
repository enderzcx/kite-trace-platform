import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileIdentityRegistry } from '../lib/contracts/compileIdentityRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const REGISTRY_NAME = process.env.ERC8004_IDENTITY_NAME || 'Kite Trace Identity Registry';
const REGISTRY_SYMBOL = process.env.ERC8004_IDENTITY_SYMBOL || 'KTRC';
const DEPLOY_OWNER = process.env.ERC8004_DEPLOY_OWNER || '';
const REGISTER_FEE_RAW = process.env.ERC8004_REGISTER_FEE || '0';
const METADATA_UPDATE_FEE_RAW = process.env.ERC8004_METADATA_UPDATE_FEE || '0';
const RPC_TIMEOUT_MS = Number(process.env.KITE_RPC_TIMEOUT_MS || 45000);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

function parseFee(label, raw) {
  try {
    return ethers.parseEther(String(raw || '0'));
  } catch {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
}

async function main() {
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);

  const compiled = compileIdentityRegistry();
  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 45000;
  const provider = new ethers.JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const initialOwner = DEPLOY_OWNER && ethers.isAddress(DEPLOY_OWNER) ? DEPLOY_OWNER : wallet.address;
  const registerFee = parseFee('ERC8004_REGISTER_FEE', REGISTER_FEE_RAW);
  const metadataUpdateFee = parseFee('ERC8004_METADATA_UPDATE_FEE', METADATA_UPDATE_FEE_RAW);

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy(
    REGISTRY_NAME,
    REGISTRY_SYMBOL,
    initialOwner,
    registerFee,
    metadataUpdateFee
  );
  const deploymentTx = contract.deploymentTransaction();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(JSON.stringify({
    rpcUrl: RPC_URL,
    chainId: String(network.chainId),
    deployer: wallet.address,
    owner: initialOwner,
    registerFeeWei: registerFee.toString(),
    metadataUpdateFeeWei: metadataUpdateFee.toString(),
    txHash: deploymentTx?.hash || '',
    address
  }, null, 2));
}

main().catch((error) => {
  console.error('ERC-8004 deploy failed:', error.message);
  process.exit(1);
});
