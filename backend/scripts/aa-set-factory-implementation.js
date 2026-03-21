import 'dotenv/config';
import { ethers } from 'ethers';

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const FACTORY_ADDRESS =
  process.env.KITE_AA_FACTORY_ADDRESS || '0xAba80c4c8748c114Ba8b61cda3b0112333C3b96E';
const OWNER_PRIVATE_KEY =
  process.env.KITE_AA_FACTORY_OWNER_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
const TARGET_IMPLEMENTATION =
  process.env.KITE_AA_EXPECTED_IMPLEMENTATION || '0xD0dA36a3B402160901dC03a0B9B9f88D6cffA7b6';
const REQUIRED_VERSION =
  process.env.KITE_AA_REQUIRED_VERSION || 'GokiteAccountV2-session-userop';

const FACTORY_ABI = [
  'function owner() view returns (address)',
  'function accountImplementation() view returns (address)',
  'function setAccountImplementation(address newImplementation)'
];

const ACCOUNT_ABI = ['function version() view returns (string)'];

async function main() {
  if (!OWNER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(OWNER_PRIVATE_KEY)) {
    throw new Error(
      'Set KITE_AA_FACTORY_OWNER_PRIVATE_KEY (or PRIVATE_KEY) to the current AccountFactory owner key.'
    );
  }
  if (!ethers.isAddress(FACTORY_ADDRESS)) {
    throw new Error(`Invalid KITE_AA_FACTORY_ADDRESS: ${FACTORY_ADDRESS}`);
  }
  if (!ethers.isAddress(TARGET_IMPLEMENTATION)) {
    throw new Error(`Invalid KITE_AA_EXPECTED_IMPLEMENTATION: ${TARGET_IMPLEMENTATION}`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
  const implementationContract = new ethers.Contract(TARGET_IMPLEMENTATION, ACCOUNT_ABI, provider);

  const [network, owner, currentImplementation, targetVersion] = await Promise.all([
    provider.getNetwork(),
    factory.owner(),
    factory.accountImplementation(),
    implementationContract.version().catch(() => '')
  ]);

  if (ethers.getAddress(owner) !== ethers.getAddress(signer.address)) {
    throw new Error(`Signer is not factory owner. owner=${owner}, signer=${signer.address}`);
  }
  if (String(targetVersion || '').trim() !== String(REQUIRED_VERSION || '').trim()) {
    throw new Error(
      `Target implementation does not match the required AA version. required=${REQUIRED_VERSION}, actual=${String(targetVersion || '').trim() || 'unknown'}`
    );
  }

  console.log('[aa-set-factory-implementation] chainId:', network.chainId.toString());
  console.log('[aa-set-factory-implementation] factory:', FACTORY_ADDRESS);
  console.log('[aa-set-factory-implementation] owner:', owner);
  console.log('[aa-set-factory-implementation] signer:', signer.address);
  console.log('[aa-set-factory-implementation] currentImplementation:', currentImplementation);
  console.log('[aa-set-factory-implementation] targetImplementation:', TARGET_IMPLEMENTATION);
  console.log('[aa-set-factory-implementation] targetVersion:', targetVersion);

  if (ethers.getAddress(currentImplementation) === ethers.getAddress(TARGET_IMPLEMENTATION)) {
    console.log('[aa-set-factory-implementation] Factory already points to the required AA implementation.');
    return;
  }

  const tx = await factory.setAccountImplementation(TARGET_IMPLEMENTATION);
  console.log('[aa-set-factory-implementation] tx submitted:', tx.hash);
  await tx.wait();

  const updatedImplementation = await factory.accountImplementation();
  console.log('[aa-set-factory-implementation] updatedImplementation:', updatedImplementation);
  if (ethers.getAddress(updatedImplementation) !== ethers.getAddress(TARGET_IMPLEMENTATION)) {
    throw new Error(
      `Factory implementation update did not stick. expected=${TARGET_IMPLEMENTATION}, actual=${updatedImplementation}`
    );
  }

  console.log('[aa-set-factory-implementation] Factory implementation updated successfully.');
}

main().catch((error) => {
  console.error('[aa-set-factory-implementation] failed:', error.message);
  process.exit(1);
});
