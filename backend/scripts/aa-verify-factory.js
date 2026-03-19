import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  resolveAaAccountImplementation,
  resolveAaFactoryAddress,
  resolveAaRequiredVersion
} from '../lib/aaConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const FACTORY_ADDRESS = resolveAaFactoryAddress();
const EXPECTED_IMPLEMENTATION = resolveAaAccountImplementation();
const REQUIRED_VERSION = resolveAaRequiredVersion();

function parseArg(name) {
  const idx = process.argv.findIndex((item) => item === `--${name}`);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
}

async function main() {
  const factoryAddress = parseArg('factory') || FACTORY_ADDRESS;
  if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
    throw new Error(`Invalid KITE_AA_FACTORY_ADDRESS: ${factoryAddress}`);
  }
  if (!EXPECTED_IMPLEMENTATION || !ethers.isAddress(EXPECTED_IMPLEMENTATION)) {
    throw new Error(`Invalid KITE_AA_ACCOUNT_IMPLEMENTATION: ${EXPECTED_IMPLEMENTATION}`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const factory = new ethers.Contract(
    factoryAddress,
    [
      'function owner() view returns (address)',
      'function accountImplementation() view returns (address)'
    ],
    provider
  );
  const implementation = new ethers.Contract(
    EXPECTED_IMPLEMENTATION,
    ['function version() view returns (string)'],
    provider
  );

  const [code, owner, accountImplementation, implementationVersion] = await Promise.all([
    provider.getCode(factoryAddress),
    factory.owner(),
    factory.accountImplementation(),
    implementation.version().catch(() => '')
  ]);
  if (!code || code === '0x') {
    throw new Error(`No contract code found at factory ${factoryAddress}`);
  }
  if (ethers.getAddress(accountImplementation) !== ethers.getAddress(EXPECTED_IMPLEMENTATION)) {
    throw new Error(
      `Factory implementation mismatch. expected=${EXPECTED_IMPLEMENTATION}, actual=${accountImplementation}`
    );
  }
  if (String(implementationVersion || '').trim() !== REQUIRED_VERSION) {
    throw new Error(
      `Configured implementation is not the expected V2. required=${REQUIRED_VERSION}, actual=${String(implementationVersion || '').trim() || 'unknown'}`
    );
  }

  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        chainId: String(network.chainId),
        factoryAddress,
        owner,
        accountImplementation,
        expectedImplementation: EXPECTED_IMPLEMENTATION,
        requiredVersion: REQUIRED_VERSION,
        implementationVersion: String(implementationVersion || '').trim()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[aa-verify-factory] failed:', error.message);
  process.exit(1);
});
