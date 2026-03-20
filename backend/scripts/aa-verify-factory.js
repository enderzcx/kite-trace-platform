import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  resolveAaAccountImplementation,
  resolveAaFactoryAddress,
  resolveAaRequiredVersion
} from '../lib/aaConfig.js';
import { applyNodeEnvProxyPreference, getEnvProxyDiagnostics } from '../lib/envProxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });
applyNodeEnvProxyPreference();

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
      'function accountImplementation() view returns (address)',
      'function getAddress(address owner, uint256 salt) view returns (address)'
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
      `Configured implementation does not match the required AA version. required=${REQUIRED_VERSION}, actual=${String(implementationVersion || '').trim() || 'unknown'}`
    );
  }

  const sampleOwner = parseArg('sample-owner');
  const expectedCodeHash = String(parseArg('expected-code-hash') || '').trim().toLowerCase();
  let sample = null;
  if (sampleOwner && ethers.isAddress(sampleOwner)) {
    let salt = 0n;
    const sampleSalt = parseArg('salt');
    if (sampleSalt) {
      try {
        salt = BigInt(sampleSalt);
      } catch {
        throw new Error(`Invalid --salt value: ${sampleSalt}`);
      }
    }
    const predictedAddress = await factory['getAddress(address,uint256)'](sampleOwner, salt);
    const predictedCode = await provider.getCode(predictedAddress);
    const predictedRuntimeBytes =
      predictedCode && predictedCode !== '0x' ? Math.max(0, (predictedCode.length - 2) / 2) : 0;
    const predictedCodeHash =
      predictedRuntimeBytes > 0 ? ethers.keccak256(predictedCode) : '';
    sample = {
      owner: ethers.getAddress(sampleOwner),
      salt: salt.toString(),
      predictedAddress: ethers.getAddress(predictedAddress),
      deployed: Boolean(predictedCode && predictedCode !== '0x'),
      runtimeCodeBytes: predictedRuntimeBytes,
      runtimeCodeHash: predictedCodeHash,
      expectedCodeHash: expectedCodeHash || '',
      matchesExpectedCodeHash: Boolean(
        expectedCodeHash && predictedCodeHash && predictedCodeHash.toLowerCase() === expectedCodeHash
      )
    };
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
        implementationVersion: String(implementationVersion || '').trim(),
        proxyDiagnostics: getEnvProxyDiagnostics(),
        sample
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
