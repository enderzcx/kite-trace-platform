import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

import { resolveAaExpectedImplementation, resolveAaRequiredVersion } from '../lib/aaConfig.js';
import { compileKTraceAccountFactory } from '../lib/contracts/compileKTraceAccountFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY = process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const FACTORY_OWNER = String(process.env.KITE_AA_FACTORY_OWNER || '').trim();
const TARGET_IMPLEMENTATION = resolveAaExpectedImplementation();
const REQUIRED_VERSION = resolveAaRequiredVersion();
const RPC_TIMEOUT_MS = Number(process.env.KITE_RPC_TIMEOUT_MS || 45_000);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);
  if (!TARGET_IMPLEMENTATION || !ethers.isAddress(TARGET_IMPLEMENTATION)) {
    throw new Error(`Invalid KITE_AA_ACCOUNT_IMPLEMENTATION / KITE_AA_EXPECTED_IMPLEMENTATION: ${TARGET_IMPLEMENTATION}`);
  }

  const compiled = compileKTraceAccountFactory();
  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 45_000;
  const provider = new ethers.JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const initialOwner = FACTORY_OWNER && ethers.isAddress(FACTORY_OWNER) ? ethers.getAddress(FACTORY_OWNER) : wallet.address;
  const implementation = new ethers.Contract(
    TARGET_IMPLEMENTATION,
    ['function version() view returns (string)'],
    provider
  );
  const implementationVersion = String(await implementation.version().catch(() => '')).trim();
  if (implementationVersion !== REQUIRED_VERSION) {
    throw new Error(
      `Target implementation is not the expected V2. required=${REQUIRED_VERSION}, actual=${implementationVersion || 'unknown'}`
    );
  }

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy(initialOwner, TARGET_IMPLEMENTATION);
  const deploymentTx = contract.deploymentTransaction();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployed = new ethers.Contract(
    address,
    [
      'function owner() view returns (address)',
      'function accountImplementation() view returns (address)'
    ],
    provider
  );
  const [owner, accountImplementation] = await Promise.all([
    deployed.owner(),
    deployed.accountImplementation()
  ]);
  if (ethers.getAddress(owner) !== ethers.getAddress(initialOwner)) {
    throw new Error(`Factory owner mismatch after deploy. expected=${initialOwner}, actual=${owner}`);
  }
  if (ethers.getAddress(accountImplementation) !== ethers.getAddress(TARGET_IMPLEMENTATION)) {
    throw new Error(
      `Factory implementation mismatch after deploy. expected=${TARGET_IMPLEMENTATION}, actual=${accountImplementation}`
    );
  }

  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        chainId: String(network.chainId),
        deployer: wallet.address,
        owner,
        accountImplementation,
        requiredVersion: REQUIRED_VERSION,
        implementationVersion,
        txHash: deploymentTx?.hash || '',
        address
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[aa-deploy-factory] failed:', error.message);
  process.exit(1);
});
