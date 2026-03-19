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
  return async function ensureAAAccountDeployment({ owner, salt = 0n } = {}) {
    if (!backendSigner) {
      throw new Error('Backend signer unavailable. Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY first.');
    }
    const requiredAaVersion = String(AA_V2_VERSION_TAG || process.env.KITE_AA_REQUIRED_VERSION || '').trim();
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

    if (alreadyDeployed) {
      if (requiredAaVersion) {
        let accountVersion = '';
        try {
          const account = new ethers.Contract(
            accountAddress,
            ['function version() view returns (string)'],
            provider
          );
          accountVersion = String(await account.version()).trim();
        } catch {
          accountVersion = '';
        }
        if (accountVersion !== requiredAaVersion) {
          throw new Error(
            `AA must be upgraded to V2 before use. required=${requiredAaVersion}, current=${accountVersion || 'unknown_or_legacy'}`
          );
        }
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

    throw new Error(
      `Generic AA deployment via createAccount has been removed from KTrace. Provision a V2 AA wallet for owner ${normalizedOwner} at salt ${salt.toString()} before retrying.`
    );
  };
}
