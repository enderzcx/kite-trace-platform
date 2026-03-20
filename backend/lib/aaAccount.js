import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk.js';

export function createEnsureAAAccountDeployment({
  backendSigner,
  normalizeAddress,
  BACKEND_RPC_URL,
  BACKEND_BUNDLER_URL,
  BACKEND_ENTRYPOINT_ADDRESS,
  KITE_AA_FACTORY_ADDRESS,
  KITE_AA_ACCOUNT_IMPLEMENTATION,
  AA_V2_VERSION_TAG = '',
  KITE_BUNDLER_RPC_TIMEOUT_MS,
  KITE_BUNDLER_RPC_RETRIES,
  BUNDLER_RPC_BACKOFF_POLICY,
  KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
} = {}) {
  return async function ensureAAAccountDeployment({ owner, salt = 0n, requiredVersion = '' } = {}) {
    if (!backendSigner) {
      throw new Error('Backend signer unavailable. Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY first.');
    }
    const requiredAaVersion = String(
      requiredVersion || AA_V2_VERSION_TAG || process.env.KITE_AA_REQUIRED_VERSION || ''
    ).trim();
    const normalizedOwner = normalizeAddress(owner || '');
    if (!ethers.isAddress(normalizedOwner)) {
      throw new Error('A valid owner address is required.');
    }

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: BACKEND_RPC_URL,
      bundlerUrl: BACKEND_BUNDLER_URL,
      entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
      accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
      accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
      bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
      bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
      bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
      bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
      bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
      bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
      bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
    });
    const accountAddress = await sdk.resolveAccountAddress(normalizedOwner, salt);
    const provider = backendSigner.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const beforeCode = await provider.getCode(accountAddress);
    const alreadyDeployed = Boolean(beforeCode && beforeCode !== '0x');

    async function readAccountVersion() {
      if (!requiredAaVersion) return '';
      try {
        const account = new ethers.Contract(
          accountAddress,
          ['function version() view returns (string)'],
          provider
        );
        return String(await account.version()).trim();
      } catch {
        return '';
      }
    }

    if (alreadyDeployed) {
      const accountVersion = await readAccountVersion();
      if (requiredAaVersion && accountVersion !== requiredAaVersion) {
        throw new Error(
          `AA version mismatch. required=${requiredAaVersion}, current=${accountVersion || 'unknown_or_legacy'}`
        );
      }
      return {
        owner: normalizedOwner,
        accountAddress,
        salt: salt.toString(),
        deployed: true,
        createdNow: false,
        txHash: ''
      };
    }

    const factory = new ethers.Contract(
      KITE_AA_FACTORY_ADDRESS,
      ['function createAccount(address owner, uint256 salt) returns (address)'],
      backendSigner
    );
    const tx = await factory.createAccount(normalizedOwner, salt);
    await tx.wait();

    const afterCode = await provider.getCode(accountAddress);
    const deployedNow = Boolean(afterCode && afterCode !== '0x');
    if (!deployedNow) {
      throw new Error(
        `AA deployment did not produce contract code. owner=${normalizedOwner} account=${accountAddress} salt=${salt.toString()}`
      );
    }

    const accountVersion = await readAccountVersion();
    if (requiredAaVersion && accountVersion !== requiredAaVersion) {
      throw new Error(
        `AA deployment produced an unexpected version. required=${requiredAaVersion}, current=${accountVersion || 'unknown_or_legacy'}`
      );
    }

    return {
      owner: normalizedOwner,
      accountAddress,
      salt: salt.toString(),
      deployed: true,
      createdNow: true,
      txHash: String(tx.hash || '').trim()
    };
  };
}
