export function createOnchainAnchorHelpers({
  backendSigner,
  backendRpcUrl = '',
  digestStableObject,
  erc8004TrustAnchorRegistry,
  erc8183JobAnchorRegistry,
  ethers,
  jobLifecycleAnchorAbi,
  trustPublicationAnchorAbi
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
    return new ethers.JsonRpcProvider(rpcUrl);
  }

  async function publishTrustPublicationOnChain(input = {}) {
    const signer = backendSigner;
    const registryAddress = String(erc8004TrustAnchorRegistry || '').trim();
    if (!signer || !ethers.isAddress(registryAddress)) {
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

    const anchorTimeoutMs = 30000;
    const contract = new ethers.Contract(registryAddress, trustPublicationAnchorAbi, signer);
    const tx = await runWithOnchainRetry(() =>
      contract.publishTrustPublication(
        publicationType,
        sourceId,
        agentId,
        referenceId,
        traceId,
        payloadHash,
        detailsURI
      ),
      { timeoutMs: anchorTimeoutMs }
    );
    const receipt = await runWithOnchainRetry(() => tx.wait(), { timeoutMs: anchorTimeoutMs });
    const anchorInterface = new ethers.Interface(trustPublicationAnchorAbi);
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
      anchorTxHash: String(tx?.hash || '').trim(),
      payloadHash
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
