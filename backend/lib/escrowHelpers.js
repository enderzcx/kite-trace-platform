import fs from 'fs';

const ERC20_DECIMALS_FALLBACK = 6;
let cachedJobEscrowAbi = null;

function loadJobEscrowAbi() {
  if (cachedJobEscrowAbi) return cachedJobEscrowAbi;
  const raw = fs.readFileSync(new URL('./abi/JobEscrowV1.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(raw);
  cachedJobEscrowAbi = Array.isArray(parsed) ? parsed : [];
  return cachedJobEscrowAbi;
}

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

function mapEscrowState(state) {
  const numericState = Number(state || 0);
  switch (numericState) {
    case 1:
      return 'funded';
    case 2:
      return 'accepted';
    case 3:
      return 'submitted';
    case 4:
      return 'completed';
    case 5:
      return 'rejected';
    case 6:
      return 'expired';
    default:
      return 'none';
  }
}

export function createEscrowHelpers({
  backendSigner,
  ethers,
  escrowAddress = '',
  settlementToken = '',
  tokenDecimals = ERC20_DECIMALS_FALLBACK,
  requesterPrivateKey = '',
  executorPrivateKey = '',
  validatorPrivateKey = ''
} = {}) {
  const contractAddress = normalizeText(escrowAddress);
  const settlementTokenAddress = normalizeText(settlementToken);
  const abi = loadJobEscrowAbi();
  const erc20MetadataAbi = ['function decimals() view returns (uint8)'];
  const provider = backendSigner?.provider || null;
  let resolvedTokenDecimalsPromise = null;
  let requesterSignerPromise = null;
  let executorSignerPromise = null;
  let validatorSignerPromise = null;

  async function runWithOnchainRetry(operation) {
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt >= 5 || !isRetryableOnchainError(error)) {
          throw error;
        }
        await wait(1000 * attempt);
      }
    }
    throw lastError || new Error('onchain operation failed');
  }

  function getReadContract() {
    if (!contractAddress) return null;
    if (!ethers?.isAddress(contractAddress)) {
      throw new Error(`Invalid ERC8183_ESCROW_ADDRESS: ${contractAddress}`);
    }
    const signerOrProvider = backendSigner || provider;
    if (!signerOrProvider) {
      throw new Error('No signer or provider available for escrow helper.');
    }
    return new ethers.Contract(contractAddress, abi, signerOrProvider);
  }

  async function buildRoleSigner(privateKey = '', role = '') {
    const normalizedKey = normalizeText(privateKey);
    if (!normalizedKey) {
      throw new Error(`Missing ${role} signer private key for escrow role enforcement.`);
    }
    if (!provider) {
      throw new Error(`No provider available for ${role} signer.`);
    }
    return new ethers.Wallet(normalizedKey, provider);
  }

  async function getRequesterSigner() {
    requesterSignerPromise ||= buildRoleSigner(requesterPrivateKey, 'requester');
    return requesterSignerPromise;
  }

  async function getExecutorSigner() {
    executorSignerPromise ||= buildRoleSigner(executorPrivateKey, 'executor');
    return executorSignerPromise;
  }

  async function getValidatorSigner() {
    validatorSignerPromise ||= buildRoleSigner(validatorPrivateKey, 'validator');
    return validatorSignerPromise;
  }

  async function getRoleContract(role = '') {
    if (!contractAddress) return null;
    if (!ethers?.isAddress(contractAddress)) {
      throw new Error(`Invalid ERC8183_ESCROW_ADDRESS: ${contractAddress}`);
    }
    if (role === 'requester') {
      return new ethers.Contract(contractAddress, abi, await getRequesterSigner());
    }
    if (role === 'executor') {
      return new ethers.Contract(contractAddress, abi, await getExecutorSigner());
    }
    if (role === 'validator') {
      return new ethers.Contract(contractAddress, abi, await getValidatorSigner());
    }
    if (backendSigner) {
      return new ethers.Contract(contractAddress, abi, backendSigner);
    }
    throw new Error(`Unsupported escrow signer role: ${role}`);
  }

  function normalizeBytes32(value = '') {
    const normalized = normalizeText(value);
    if (!normalized) return ethers.ZeroHash;
    if (/^0x[0-9a-f]{64}$/i.test(normalized)) return normalized;
    if (/^[0-9a-f]{64}$/i.test(normalized)) return `0x${normalized}`;
    return ethers.keccak256(ethers.toUtf8Bytes(normalized));
  }

  async function resolveTokenDecimals() {
    if (resolvedTokenDecimalsPromise) return resolvedTokenDecimalsPromise;
    resolvedTokenDecimalsPromise = (async () => {
      if (!settlementTokenAddress || !ethers?.isAddress(settlementTokenAddress)) {
        return tokenDecimals;
      }
      const signerOrProvider = backendSigner || provider;
      if (!signerOrProvider) return tokenDecimals;
      try {
        const tokenContract = new ethers.Contract(settlementTokenAddress, erc20MetadataAbi, signerOrProvider);
        const decimals = Number(await tokenContract.decimals());
        return Number.isFinite(decimals) && decimals >= 0 ? decimals : tokenDecimals;
      } catch {
        return tokenDecimals;
      }
    })();
    return resolvedTokenDecimalsPromise;
  }

  async function normalizeUnits(amount) {
    const normalized = normalizeText(amount);
    if (!normalized) {
      throw new Error('Escrow amount is required.');
    }
    const decimals = await resolveTokenDecimals();
    return ethers.parseUnits(normalized, decimals);
  }

  function normalizeDeadline(deadlineAt = '') {
    if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && deadlineAt > 0) {
      return BigInt(Math.round(deadlineAt));
    }
    const normalized = normalizeText(deadlineAt);
    if (!normalized) throw new Error('Escrow deadline is required.');
    if (/^\d+$/.test(normalized)) return BigInt(normalized);
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid escrow deadline: ${deadlineAt}`);
    }
    return BigInt(Math.floor(parsed / 1000));
  }

  async function lockEscrowFunds({
    jobId = '',
    requester = '',
    executor = '',
    validator = '',
    amount = '',
    deadlineAt = '',
    executorStakeAmount = ''
  } = {}) {
    const contract = await getRoleContract('requester');
    if (!contract) {
      return {
        configured: false,
        locked: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }

    if (!ethers.isAddress(requester)) throw new Error(`Invalid requester address: ${requester}`);
    if (!ethers.isAddress(executor)) throw new Error(`Invalid executor address: ${executor}`);
    if (!ethers.isAddress(validator)) throw new Error(`Invalid validator address: ${validator}`);

    const normalizedAmount = await normalizeUnits(amount);
    const normalizedStake = normalizeText(executorStakeAmount)
      ? await normalizeUnits(executorStakeAmount)
      : 0n;
    const normalizedDeadline = normalizeDeadline(deadlineAt);
    const tx = await runWithOnchainRetry(() =>
      contract.lockFunds(
        normalizeText(jobId),
        requester,
        executor,
        validator,
        normalizedAmount,
        normalizedDeadline,
        normalizedStake
      )
    );
    await runWithOnchainRetry(() => tx.wait());
    return {
      configured: true,
      locked: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: normalizeText(tx?.hash),
      escrowState: 'funded'
    };
  }

  async function acceptEscrowJob({ jobId = '' } = {}) {
    const contract = await getRoleContract('executor');
    if (!contract) {
      return {
        configured: false,
        accepted: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }

    const tx = await runWithOnchainRetry(() => contract.acceptJob(normalizeText(jobId)));
    await runWithOnchainRetry(() => tx.wait());
    return {
      configured: true,
      accepted: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: normalizeText(tx?.hash),
      escrowState: 'accepted'
    };
  }

  async function submitEscrowResult({ jobId = '', resultHash = '' } = {}) {
    const contract = await getRoleContract('executor');
    if (!contract) {
      return {
        configured: false,
        submitted: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }

    const tx = await runWithOnchainRetry(() =>
      contract.submitResult(normalizeText(jobId), normalizeBytes32(resultHash))
    );
    await runWithOnchainRetry(() => tx.wait());
    return {
      configured: true,
      submitted: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: normalizeText(tx?.hash),
      escrowState: 'submitted'
    };
  }

  async function validateEscrowJob({ jobId = '', approved = false } = {}) {
    const contract = await getRoleContract('validator');
    if (!contract) {
      return {
        configured: false,
        validated: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }

    const tx = await runWithOnchainRetry(() => contract.validate(normalizeText(jobId), Boolean(approved)));
    await runWithOnchainRetry(() => tx.wait());
    return {
      configured: true,
      validated: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: normalizeText(tx?.hash),
      escrowState: approved ? 'completed' : 'rejected'
    };
  }

  async function expireEscrowJob({ jobId = '' } = {}) {
    const contract = await getRoleContract('requester');
    if (!contract) {
      return {
        configured: false,
        expired: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }

    const tx = await runWithOnchainRetry(() => contract.expireJob(normalizeText(jobId)));
    await runWithOnchainRetry(() => tx.wait());
    return {
      configured: true,
      expired: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: normalizeText(tx?.hash),
      escrowState: 'expired'
    };
  }

  async function getEscrowJob({ jobId = '' } = {}) {
    const contract = getReadContract();
    if (!contract) {
      return {
        configured: false,
        found: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress
      };
    }

    const job = await runWithOnchainRetry(() => contract.getJob(normalizeText(jobId)));
    const state = mapEscrowState(job?.state ?? job?.[5]);
    return {
      configured: true,
      found: state !== 'none',
      contractAddress,
      tokenAddress: settlementTokenAddress,
      requester: normalizeText(job?.requester ?? job?.[0]),
      executor: normalizeText(job?.executor ?? job?.[1]),
      validator: normalizeText(job?.validator ?? job?.[2]),
      amount: normalizeText(job?.amount ?? job?.[3]),
      executorStakeAmount: normalizeText(job?.executorStakeAmount ?? job?.[4]),
      escrowState: state,
      resultHash: normalizeText(job?.resultHash ?? job?.[6]),
      deadlineAt: Number(job?.deadlineAt ?? job?.[7] ?? 0),
      fundedAt: Number(job?.fundedAt ?? job?.[8] ?? 0),
      acceptedAt: Number(job?.acceptedAt ?? job?.[9] ?? 0),
      submittedAt: Number(job?.submittedAt ?? job?.[10] ?? 0),
      resolvedAt: Number(job?.resolvedAt ?? job?.[11] ?? 0),
      stakeFundedAt: Number(job?.stakeFundedAt ?? job?.[12] ?? 0)
    };
  }

  return {
    lockEscrowFunds,
    acceptEscrowJob,
    submitEscrowResult,
    validateEscrowJob,
    expireEscrowJob,
    getEscrowJob
  };
}
