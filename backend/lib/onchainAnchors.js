import { createKiteRpcProvider } from './kiteRpc.js';

export function createOnchainAnchorHelpers({
  backendSigner,
  backendRpcUrl = '',
  digestStableObject,
  erc8004TrustAnchorRegistry,
  erc8004IdentityRegistry = '',
  erc8183JobAnchorRegistry,
  ethers,
  jobLifecycleAnchorAbi,
  trustPublicationAnchorAbi,
  resolveSessionRuntime,
  resolveSessionOwnerByAaWallet,
  resolveSessionOwnerPrivateKey,
  GokiteAASDK,
  bundlerUrl = '',
  entryPointAddress = '',
  accountFactoryAddress = '',
  accountImplementationAddress = '',
  bundlerRpcTimeoutMs = 15000,
  bundlerRpcRetries = 3,
  bundlerRpcBackoffBaseMs = 650,
  bundlerRpcBackoffMaxMs = 6000,
  bundlerRpcBackoffFactor = 2,
  bundlerRpcBackoffJitterMs = 250,
  bundlerReceiptPollIntervalMs = 1000
}) {
  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function isRetryableOnchainError(error = null) {
    const message = normalizeText(
      [
        error?.message,
        error?.shortMessage,
        error?.code,
        error?.cause?.message,
        error?.cause?.code
      ]
        .filter(Boolean)
        .join(' ')
    ).toLowerCase();
    if (!message) return false;
    return (
      message.includes('tls') ||
      message.includes('fetch failed') ||
      message.includes('socket') ||
      message.includes('econnreset') ||
      message.includes('before secure tls connection') ||
      message.includes('timeout') ||
      message.includes('network')
    );
  }

  async function wait(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  function withTimeout(promise, ms, label = 'operation') {
    if (!ms || ms <= 0) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  async function runWithOnchainRetry(operation, { timeoutMs = 0 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const result = timeoutMs > 0
          ? await withTimeout(operation(), timeoutMs, 'onchain retry')
          : await operation();
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= 5 || !isRetryableOnchainError(error)) {
          throw error;
        }
        await wait(1000 * attempt);
      }
    }
    throw lastError || new Error('onchain anchor publish failed');
  }

  function getReadProvider() {
    if (backendSigner?.provider) return backendSigner.provider;
    const rpcUrl = normalizeText(backendRpcUrl);
    if (!rpcUrl) return null;
    return createKiteRpcProvider(ethers, rpcUrl);
  }

  function normalizeAddress(value = '') {
    return normalizeText(value).toLowerCase();
  }

  const identityRegistryReadAbi = [
    'function getAgentWallet(uint256 agentId) view returns (address)'
  ];
  const accountPermissionReadAbi = [
    'function getSessionSelectorPermission(bytes32 sessionId, address target, bytes4 selector) view returns (bool enabled, uint256 maxAmount)'
  ];
  const accountPermissionWriteAbi = [
    'function setSessionSelectorPermissions(tuple(bytes32 sessionId, address target, bytes4 selector, bool enabled, uint256 maxAmount)[] permissions)'
  ];

  function selectorFromCallData(data = '') {
    const hex = normalizeText(data);
    return hex.length >= 10 ? hex.slice(0, 10).toLowerCase() : '';
  }

  async function resolveAgentAaWallet(agentId = '') {
    const agentIdNum = parseInt(agentId, 10);
    if (!agentIdNum || agentIdNum <= 0) return null;
    const identityAddr = normalizeText(erc8004IdentityRegistry);
    if (!identityAddr || !ethers.isAddress(identityAddr)) return null;
    const provider = getReadProvider();
    if (!provider) return null;
    try {
      const registry = new ethers.Contract(identityAddr, identityRegistryReadAbi, provider);
      const wallet = await runWithOnchainRetry(
        () => registry.getAgentWallet(agentIdNum),
        { timeoutMs: 15000 }
      );
      const addr = normalizeAddress(wallet);
      return addr && addr !== ethers.ZeroAddress.toLowerCase() ? addr : null;
    } catch {
      return null;
    }
  }

  async function ensureTrustAnchorSessionPermission(context, registryAddress, callData) {
    const provider = getReadProvider();
    if (!context?.runtimeAddress || !context?.sessionId || !provider) return null;
    const target = normalizeAddress(registryAddress);
    const selector = selectorFromCallData(callData);
    if (!target || !selector) return null;
    const readContract = new ethers.Contract(context.runtimeAddress, accountPermissionReadAbi, provider);
    const [enabled] = await withTimeout(
      runWithOnchainRetry(() => readContract.getSessionSelectorPermission(context.sessionId, target, selector)),
      15000,
      'getSessionSelectorPermission'
    );
    if (enabled) return { configured: false, selector, target };
    const ownerKey = normalizeText(resolveSessionOwnerPrivateKey?.(context.runtimeOwner) || '');
    if (!ownerKey) return null;
    const ownerWallet = new ethers.Wallet(ownerKey, provider);
    const writeContract = new ethers.Contract(context.runtimeAddress, accountPermissionWriteAbi, ownerWallet);
    const tx = await withTimeout(
      runWithOnchainRetry(() =>
        writeContract.setSessionSelectorPermissions([
          { sessionId: context.sessionId, target, selector, enabled: true, maxAmount: 0n }
        ])
      ),
      30000,
      'setSessionSelectorPermissions'
    );
    await withTimeout(tx.wait(), 60000, 'wait permission bootstrap tx');
    return { configured: true, selector, target, txHash: normalizeText(tx?.hash) };
  }

  async function publishViaAaSession(registryAddress, callData, agentAaWallet) {
    const provider = getReadProvider();
    if (!provider || !resolveSessionRuntime || !GokiteAASDK) return null;
    const inferredOwner = normalizeAddress(resolveSessionOwnerByAaWallet?.(agentAaWallet) || '');
    const runtime = resolveSessionRuntime({ owner: inferredOwner, aaWallet: agentAaWallet });
    if (!runtime?.sessionPrivateKey || !runtime?.sessionId) return null;
    const runtimeAaWallet = normalizeAddress(runtime.aaWallet || '');
    if (runtimeAaWallet !== normalizeAddress(agentAaWallet)) return null;
    const runtimeOwner = normalizeAddress(runtime.owner || inferredOwner);
    const sessionId = normalizeText(runtime.sessionId);

    const context = { runtimeAddress: runtimeAaWallet, runtimeOwner, sessionId };
    await ensureTrustAnchorSessionPermission(context, registryAddress, callData);

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: normalizeText(backendRpcUrl),
      bundlerUrl: normalizeText(bundlerUrl),
      entryPointAddress: normalizeText(entryPointAddress),
      accountFactoryAddress: normalizeText(accountFactoryAddress),
      accountImplementationAddress: normalizeText(accountImplementationAddress),
      proxyAddress: runtimeAaWallet,
      bundlerRpcTimeoutMs,
      bundlerRpcRetries,
      bundlerRpcBackoffBaseMs,
      bundlerRpcBackoffMaxMs,
      bundlerRpcBackoffFactor,
      bundlerRpcBackoffJitterMs,
      bundlerReceiptPollIntervalMs
    });
    if (runtimeOwner && ethers.isAddress(runtimeOwner)) {
      sdk.config.ownerAddress = runtimeOwner;
    }
    const sessionWallet = new ethers.Wallet(runtime.sessionPrivateKey, provider);
    const signFunction = async (hash) => sessionWallet.signMessage(ethers.getBytes(hash));

    const actionId = ethers.keccak256(ethers.toUtf8Bytes(`trust_publication:${registryAddress}`));
    const result = await sdk.sendSessionGenericExecute(
      { sessionId, target: registryAddress, value: 0n, data: callData, actionId, authz: '0x' },
      signFunction
    );
    const txHash = normalizeText(result?.transactionHash || result?.receipt?.transactionHash || '');
    const receipt = result?.receipt || (txHash ? await runWithOnchainRetry(
      () => provider.getTransactionReceipt(txHash),
      { timeoutMs: 30000 }
    ) : null);
    return { txHash, receipt, publishedVia: 'aa-session', publisherWallet: runtimeAaWallet };
  }

  async function publishTrustPublicationOnChain(input = {}) {
    const registryAddress = String(erc8004TrustAnchorRegistry || '').trim();
    if (!ethers.isAddress(registryAddress)) {
      return {
        configured: false,
        published: false,
        registryAddress: registryAddress || '',
        anchorId: '',
        anchorTxHash: ''
      };
    }

    const publicationType = String(input?.publicationType || '').trim().toLowerCase();
    const sourceId = String(input?.sourceId || '').trim();
    const agentId = String(input?.agentId || '').trim();
    const agentIdNum = parseInt(agentId, 10) || 0;
    const referenceId = String(input?.referenceId || '').trim();
    const traceId = String(input?.traceId || '').trim();
    const detailsURI = String(input?.detailsURI || input?.publicationRef || '').trim();
    const digest = digestStableObject({
      scope: 'ktrace-trust-publication-v1',
      publicationType,
      sourceId,
      agentId,
      referenceId,
      traceId,
      detailsURI
    });
    const payloadHash = /^([0-9a-f]{64})$/i.test(String(digest?.value || '').trim())
      ? `0x${String(digest.value).trim()}`
      : ethers.ZeroHash;

    const anchorInterface = new ethers.Interface(trustPublicationAnchorAbi);
    const callData = anchorInterface.encodeFunctionData('publishTrustPublication', [
      publicationType, sourceId, agentId, agentIdNum,
      referenceId, traceId, payloadHash, detailsURI
    ]);

    let txHash = '';
    let receipt = null;
    let publishedVia = 'backend-signer';

    // Try AA session execution first (provider's own AA wallet)
    if (agentIdNum > 0) {
      try {
        const agentAaWallet = await resolveAgentAaWallet(agentId);
        console.log('[trust-anchor] agentId=' + agentId + ' → aaWallet=' + (agentAaWallet || 'null'));
        if (agentAaWallet) {
          const aaResult = await publishViaAaSession(registryAddress, callData, agentAaWallet);
          if (aaResult?.txHash) {
            txHash = aaResult.txHash;
            receipt = aaResult.receipt;
            publishedVia = aaResult.publishedVia;
          }
        }
      } catch (aaError) {
        // AA path failed, fall back to backendSigner
        console.error('[trust-anchor] AA session path failed for agentId=' + agentId + ':', aaError?.message || String(aaError));
        txHash = '';
        receipt = null;
      }
    }

    // Fallback: backendSigner direct call (legacy path)
    if (!txHash && backendSigner) {
      const anchorTimeoutMs = 30000;
      const contract = new ethers.Contract(registryAddress, trustPublicationAnchorAbi, backendSigner);
      const tx = await runWithOnchainRetry(() =>
        contract.publishTrustPublication(
          publicationType, sourceId, agentId, agentIdNum,
          referenceId, traceId, payloadHash, detailsURI
        ),
        { timeoutMs: anchorTimeoutMs }
      );
      receipt = await runWithOnchainRetry(() => tx.wait(), { timeoutMs: anchorTimeoutMs });
      txHash = String(tx?.hash || '').trim();
      publishedVia = 'backend-signer';
    }

    if (!txHash) {
      return {
        configured: true,
        published: false,
        registryAddress,
        anchorId: '',
        anchorTxHash: '',
        payloadHash
      };
    }

    const anchorLog = receipt?.logs
      ?.filter((log) => String(log?.address || '').toLowerCase() === registryAddress.toLowerCase())
      .map((log) => {
        try {
          return anchorInterface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === 'TrustPublicationAnchored');

    return {
      configured: true,
      published: true,
      registryAddress,
      anchorId: String(anchorLog?.args?.anchorId || '').trim(),
      anchorTxHash: txHash,
      payloadHash,
      publishedVia
    };
  }

  async function publishJobLifecycleAnchorOnChain(input = {}) {
    const signer = backendSigner;
    const registryAddress = String(erc8183JobAnchorRegistry || '').trim();
    if (!signer || !ethers.isAddress(registryAddress)) {
      return {
        configured: false,
        published: false,
        registryAddress: registryAddress || '',
        anchorId: '',
        anchorTxHash: '',
        payloadHash: ethers.ZeroHash
      };
    }

    const anchorType = String(input?.anchorType || '').trim().toLowerCase();
    const jobId = String(input?.jobId || '').trim();
    const traceId = String(input?.traceId || '').trim();
    const providerId = String(input?.providerId || '').trim();
    const capability = String(input?.capability || '').trim();
    const status = String(input?.status || '').trim().toLowerCase();
    const paymentRequestId = String(input?.paymentRequestId || '').trim();
    const paymentTxHash = String(input?.paymentTxHash || '').trim();
    const validationId = String(input?.validationId || '').trim();
    const referenceId = String(input?.referenceId || '').trim();
    const detailsURI = String(input?.detailsURI || '').trim();
    const digest = digestStableObject({
      scope: 'ktrace-job-lifecycle-anchor-v1',
      anchorType,
      jobId,
      traceId,
      providerId,
      capability,
      status,
      paymentRequestId,
      paymentTxHash,
      validationId,
      referenceId,
      detailsURI
    });
    const payloadHash = /^([0-9a-f]{64})$/i.test(String(digest?.value || '').trim())
      ? `0x${String(digest.value).trim()}`
      : ethers.ZeroHash;

    const anchorTimeoutMs = 30000;
    const contract = new ethers.Contract(registryAddress, jobLifecycleAnchorAbi, signer);
    const tx = await runWithOnchainRetry(() =>
      contract.publishJobLifecycleAnchor(
        anchorType,
        jobId,
        traceId,
        providerId,
        capability,
        status,
        paymentRequestId,
        paymentTxHash,
        validationId,
        referenceId,
        payloadHash,
        detailsURI
      ),
      { timeoutMs: anchorTimeoutMs }
    );
    const receipt = await runWithOnchainRetry(() => tx.wait(), { timeoutMs: anchorTimeoutMs });
    const anchorInterface = new ethers.Interface(jobLifecycleAnchorAbi);
    const anchorLog = receipt?.logs
      ?.filter((log) => String(log?.address || '').toLowerCase() === registryAddress.toLowerCase())
      .map((log) => {
        try {
          return anchorInterface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === 'JobLifecycleAnchored');

    return {
      configured: true,
      published: true,
      registryAddress,
      anchorId: String(anchorLog?.args?.anchorId || '').trim(),
      anchorTxHash: String(tx?.hash || '').trim(),
      payloadHash
    };
  }

  async function checkAnchorExistsOnChain(jobId = '') {
    const registryAddress = String(erc8183JobAnchorRegistry || '').trim();
    const provider = getReadProvider();
    if (!provider || !ethers.isAddress(registryAddress)) {
      return {
        configured: false,
        registryAddress: registryAddress || '',
        jobId: normalizeText(jobId),
        hasAnchor: false,
        latestAnchorId: ''
      };
    }
    const contract = new ethers.Contract(registryAddress, jobLifecycleAnchorAbi, provider);
    const normalizedJobId = normalizeText(jobId);
    const [hasAnchor, latestAnchorId] = await runWithOnchainRetry(() =>
      Promise.all([contract.hasAnchor(normalizedJobId), contract.latestAnchorId(normalizedJobId)])
    );
    return {
      configured: true,
      registryAddress,
      jobId: normalizedJobId,
      hasAnchor: Boolean(hasAnchor),
      latestAnchorId: String(latestAnchorId || '').trim()
    };
  }

  async function readLatestAnchorIdOnChain(jobId = '') {
    const status = await checkAnchorExistsOnChain(jobId);
    return {
      configured: status.configured,
      registryAddress: status.registryAddress,
      jobId: status.jobId,
      latestAnchorId: status.latestAnchorId
    };
  }

  return {
    checkAnchorExistsOnChain,
    publishTrustPublicationOnChain,
    publishJobLifecycleAnchorOnChain,
    readLatestAnchorIdOnChain
  };
}
