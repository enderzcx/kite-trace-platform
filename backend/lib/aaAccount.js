import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk.js';

export function createEnsureAAAccountDeployment({
  backendSigner,
  normalizeAddress,
  BACKEND_RPC_URL,
  BACKEND_BUNDLER_URL,
  BACKEND_ENTRYPOINT_ADDRESS,
  KITE_BUNDLER_RPC_TIMEOUT_MS,
  KITE_BUNDLER_RPC_RETRIES,
  BUNDLER_RPC_BACKOFF_POLICY,
  KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
} = {}) {
  return async function ensureAAAccountDeployment({ owner, salt = 0n } = {}) {
    if (!backendSigner) {
      throw new Error('Backend signer unavailable. Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY first.');
    }
    const normalizedOwner = normalizeAddress(owner || '');
    if (!ethers.isAddress(normalizedOwner)) {
      throw new Error('A valid owner address is required.');
    }

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: BACKEND_RPC_URL,
      bundlerUrl: BACKEND_BUNDLER_URL,
      entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
      bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
      bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
      bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
      bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
      bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
      bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
      bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
    });
    const accountAddress = sdk.getAccountAddress(normalizedOwner, salt);
    const provider = backendSigner.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const beforeCode = await provider.getCode(accountAddress);
    const alreadyDeployed = Boolean(beforeCode && beforeCode !== '0x');

    if (alreadyDeployed) {
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
      sdk.config.accountFactoryAddress,
      ['function createAccount(address owner, uint256 salt) returns (address)'],
      backendSigner
    );
    const tx = await factory.createAccount(normalizedOwner, salt);
    await tx.wait();

    const afterCode = await provider.getCode(accountAddress);
    const deployed = Boolean(afterCode && afterCode !== '0x');
    if (!deployed) {
      throw new Error('AA createAccount confirmed, but no code found at predicted address.');
    }

    return {
      owner: normalizedOwner,
      accountAddress,
      salt: salt.toString(),
      deployed: true,
      createdNow: true,
      txHash: tx.hash
    };
  };
}
