import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileJobEscrowV4 } from '../lib/contracts/compileJobEscrowV4.js';
import { createKiteRpcProvider } from '../lib/kiteRpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const DEPLOY_OWNER = process.env.ERC8183_DEPLOY_OWNER || '';
const TOKEN_ADDRESS = process.env.KITE_SETTLEMENT_TOKEN || '';

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('KITE_SETTLEMENT_TOKEN', TOKEN_ADDRESS);
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);
  if (!ethers.isAddress(TOKEN_ADDRESS)) {
    throw new Error(`Invalid KITE_SETTLEMENT_TOKEN: ${TOKEN_ADDRESS}`);
  }

  console.log('Compiling JobEscrowV4...');
  const compiled = compileJobEscrowV4();
  console.log('Compilation OK. Warnings:', compiled.warnings.length);

  const provider = createKiteRpcProvider(ethers, RPC_URL, { timeoutMs: 60000 });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const initialOwner = DEPLOY_OWNER && ethers.isAddress(DEPLOY_OWNER) ? DEPLOY_OWNER : wallet.address;

  console.log(`Deploying JobEscrowV4 from ${wallet.address}...`);
  console.log(`  owner: ${initialOwner}`);
  console.log(`  token: ${TOKEN_ADDRESS}`);

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy(TOKEN_ADDRESS, initialOwner);
  const deploymentTx = contract.deploymentTransaction();
  console.log(`  tx: ${deploymentTx?.hash || '(pending)'}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(
    JSON.stringify(
      {
        contract: 'JobEscrowV4',
        rpcUrl: RPC_URL,
        chainId: '2368',
        deployer: wallet.address,
        owner: initialOwner,
        settlementToken: TOKEN_ADDRESS,
        txHash: deploymentTx?.hash || '',
        address
      },
      null,
      2
    )
  );

  console.log(`\nDone! Update .env:`);
  console.log(`  ERC8183_ESCROW_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error('ERC-8183 escrow V4 deploy failed:', error.message);
  process.exit(1);
});
