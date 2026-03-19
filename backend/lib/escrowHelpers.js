import fs from 'fs';

import { GokiteAASDK } from './gokite-aa-sdk.js';

const ERC20_DECIMALS_FALLBACK = 6;
let cachedJobEscrowAbi = null;

function loadJobEscrowAbi() {
  if (cachedJobEscrowAbi) return cachedJobEscrowAbi;
  const raw = fs.readFileSync(new URL('./abi/JobEscrowV2.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(raw);
  cachedJobEscrowAbi = Array.isArray(parsed) ? parsed : [];
  return cachedJobEscrowAbi;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function buildEscrowError(code = 'escrow_execution_failed', message = 'escrow execution failed', detail = {}) {
  const error = new Error(normalizeText(message) || 'escrow execution failed');
  error.code = normalizeText(code) || 'escrow_execution_failed';
  error.detail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  return error;
}

function isTraceAnchorRequiredError(error = null) {
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
  return message.includes('trace_anchor_required');
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
  resolveSessionRuntime,
  resolveSessionOwnerByAaWallet,
  rpcUrl = '',
  bundlerUrl = '',
  entryPointAddress = '',
  accountFactoryAddress = '',
  accountImplementationAddress = '',
  bundlerRpcTimeoutMs = 15_000,
  bundlerRpcRetries = 3,
  bundlerRpcBackoffBaseMs = 650,
  bundlerRpcBackoffMaxMs = 6_000,
  bundlerRpcBackoffFactor = 2,
  bundlerRpcBackoffJitterMs = 250,
  bundlerReceiptPollIntervalMs = 1_000,
  escrowUserOpSubmitTimeoutMs = 30_000,
  escrowUserOpWaitTimeoutMs = 300_000,
  escrowUserOpPollIntervalMs = 1_500,
  aaVersionTag = '',
  requireAaV2 = false,
  kiteMinNativeGas = '0.0001'
} = {}) {
  const contractAddress = normalizeText(escrowAddress);
  const settlementTokenAddress = normalizeText(settlementToken);
  const abi = loadJobEscrowAbi();
  const erc20MetadataAbi = [
    'function decimals() view returns (uint8)',
    'function allowance(address owner, address spender) view returns (uint256)'
  ];
  const staticNetwork = ethers.Network.from({
    chainId: 2368,
    name: 'kite_testnet'
  });
  const provider =
    backendSigner?.provider ||
    (rpcUrl ? new ethers.JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork }) : null);
  let resolvedTokenDecimalsPromise = null;

  function normalizeAddress(value = '') {
    const normalized = normalizeText(value);
    if (!normalized || !ethers?.isAddress(normalized)) return '';
    return ethers.getAddress(normalized);
  }

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

  async function buildAaExecutionContext({ role = '', roleAddress = '' } = {}) {
    const normalizedRoleAddress = normalizeAddress(roleAddress);
    if (!normalizedRoleAddress) {
      throw buildEscrowError('runtime_not_found', `${role} AA address is required.`, {
        role,
        roleAddress
      });
    }
    if (!resolveSessionRuntime) {
      throw buildEscrowError('runtime_not_found', 'Session runtime resolver is not configured.', {
        role,
        roleAddress: normalizedRoleAddress
      });
    }
    if (!provider) {
      throw buildEscrowError('runtime_not_found', 'RPC provider is not configured for AA execution.', {
        role,
        roleAddress: normalizedRoleAddress
      });
    }

    const inferredOwner = normalizeAddress(resolveSessionOwnerByAaWallet?.(normalizedRoleAddress) || '');
    const runtime = resolveSessionRuntime({
      owner: inferredOwner,
      aaWallet: normalizedRoleAddress
    });
    const runtimeAaWallet = normalizeAddress(runtime?.aaWallet || '');
    const runtimeOwner = normalizeAddress(runtime?.owner || inferredOwner);
    if (!runtimeAaWallet || runtimeAaWallet !== normalizedRoleAddress || !normalizeText(runtime?.sessionPrivateKey)) {
      throw buildEscrowError('runtime_not_found', `${role} AA runtime was not found.`, {
        role,
        roleAddress: normalizedRoleAddress,
        runtimeOwner
      });
    }
    const sessionId = normalizeText(runtime?.sessionId || '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
      throw buildEscrowError('session_authorization_missing', `${role} AA runtime does not have a valid sessionId.`, {
        role,
        roleAddress: normalizedRoleAddress,
        runtimeOwner
      });
    }

    const accountCode = await withTimeout(provider.getCode(runtimeAaWallet), 15000, 'getCode');
    if (!accountCode || accountCode === '0x') {
      throw buildEscrowError('aa_role_not_deployed', `${role} AA runtime is not deployed on-chain.`, {
        role,
        roleAddress: normalizedRoleAddress,
        runtimeOwner
      });
    }

    if (requireAaV2) {
      let aaVersion = '';
      try {
        const versionReadAbi = ['function version() view returns (string)'];
        const versionContract = new ethers.Contract(runtimeAaWallet, versionReadAbi, provider);
        aaVersion = String(await versionContract.version()).trim();
      } catch {
        aaVersion = '';
      }
      if (aaVersion !== aaVersionTag) {
        throw buildEscrowError('aa_version_mismatch', `${role} AA runtime must be upgraded to V2.`, {
          role,
          roleAddress: normalizedRoleAddress,
          runtimeOwner,
          currentVersion: aaVersion || '',
          requiredVersion: aaVersionTag || ''
        });
      }
    }

    const sessionWallet = new ethers.Wallet(runtime.sessionPrivateKey, provider);
    const sessionSignerAddress = normalizeAddress(await sessionWallet.getAddress());
    const sessionReadAbi = [
      'function sessionExists(bytes32 sessionId) view returns (bool)',
      'function getSessionAgent(bytes32 sessionId) view returns (address)'
    ];
    const account = new ethers.Contract(runtimeAaWallet, sessionReadAbi, provider);
    const [exists, agentAddr] = await withTimeout(Promise.all([
      account.sessionExists(sessionId),
      account.getSessionAgent(sessionId)
    ]), 15000, 'session check');
    if (!exists) {
      throw buildEscrowError('session_authorization_missing', `${role} AA runtime does not have an active on-chain session.`, {
        role,
        roleAddress: normalizedRoleAddress,
        runtimeOwner,
        sessionId
      });
    }
    if (normalizeAddress(agentAddr || '') !== sessionSignerAddress) {
      throw buildEscrowError('role_runtime_address_mismatch', `${role} AA runtime session signer does not match on-chain session agent.`, {
        role,
        roleAddress: normalizedRoleAddress,
        runtimeOwner,
        sessionId,
        expectedAgent: normalizeAddress(agentAddr || ''),
        currentAgent: sessionSignerAddress
      });
    }

    let minNativeGas = 0n;
    try {
      minNativeGas = ethers.parseEther(String(kiteMinNativeGas || '0').trim() || '0');
    } catch {
      minNativeGas = 0n;
    }
    if (minNativeGas > 0n) {
      const nativeBalance = await withTimeout(provider.getBalance(runtimeAaWallet), 15000, 'getBalance');
      if (nativeBalance < minNativeGas) {
        throw buildEscrowError('insufficient_kite_gas', `${role} AA runtime has insufficient KITE for gas.`, {
          role,
          roleAddress: normalizedRoleAddress,
          runtimeOwner,
          required: ethers.formatEther(minNativeGas),
          balance: ethers.formatEther(nativeBalance)
        });
      }
    }

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: rpcUrl || '',
      bundlerUrl: bundlerUrl || '',
      entryPointAddress: entryPointAddress || '',
      accountFactoryAddress,
      accountImplementationAddress,
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
    const signFunction = async (userOpHash) => sessionWallet.signMessage(ethers.getBytes(userOpHash));

    return {
      role,
      roleAddress: normalizedRoleAddress,
      runtime,
      runtimeOwner,
      runtimeAddress: runtimeAaWallet,
      sdk,
      signFunction
    };
  }

  async function ensureErc20Allowance(context, amountRequired) {
    if (!settlementTokenAddress || !ethers?.isAddress(settlementTokenAddress) || !provider) {
      return;
    }
    const tokenContract = new ethers.Contract(settlementTokenAddress, erc20MetadataAbi, provider);
    const currentAllowance = await withTimeout(
      runWithOnchainRetry(() => tokenContract.allowance(context.runtimeAddress, contractAddress)),
      15000,
      'allowance check'
    );
    if (ethers.getBigInt(currentAllowance || 0) >= ethers.getBigInt(amountRequired || 0)) {
      return;
    }
    throw buildEscrowError(
      'aa_allowance_required',
      `Escrow allowance missing for ${context.role} AA runtime. Run erc8183:approve:escrow as setup first.`,
      {
        role: context.role,
        roleAddress: context.roleAddress,
        runtimeAddress: context.runtimeAddress,
        requiredAmount: ethers.getBigInt(amountRequired || 0).toString(),
        currentAllowance: ethers.getBigInt(currentAllowance || 0).toString()
      }
    );
  }

  async function executeEscrowCall({
    context,
    target,
    callData,
    gasOverrides = {},
    actionCode = '',
    submitTimeoutMs = escrowUserOpSubmitTimeoutMs,
    waitTimeoutMs = escrowUserOpWaitTimeoutMs
  } = {}) {
    let lastFailure = null;
    const executeCallData = context.sdk.account.interface.encodeFunctionData('execute', [
      target,
      0n,
      callData
    ]);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const submitResult = await withTimeout(
        context.sdk.sendRawCallDataUserOperation(
          executeCallData,
          context.signFunction,
          gasOverrides
        ),
        submitTimeoutMs,
        `${actionCode || 'escrow call'} submit attempt ${attempt}`
      );
      if (submitResult?.status !== 'submitted' || !normalizeText(submitResult?.userOpHash)) {
        const reason = normalizeText(
          submitResult?.reason || submitResult?.error?.message || `${actionCode || 'escrow call'} submit failed`
        );
        lastFailure = buildEscrowError(actionCode || 'aa_userop_failed', reason, {
          role: context.role,
          roleAddress: context.roleAddress,
          runtimeAddress: context.runtimeAddress,
          userOpHash: normalizeText(submitResult?.userOpHash),
          attempt
        });
        if (attempt >= 3 || !isRetryableOnchainError(lastFailure)) break;
        await wait(1000 * attempt);
        continue;
      }
      const result = await context.sdk.waitForUserOperationResult(
        normalizeText(submitResult.userOpHash),
        waitTimeoutMs,
        escrowUserOpPollIntervalMs || bundlerReceiptPollIntervalMs
      );
      if (result?.status === 'success' && normalizeText(result?.transactionHash)) {
        return {
          configured: true,
          txHash: normalizeText(result.transactionHash),
          userOpHash: normalizeText(result.userOpHash || submitResult.userOpHash),
          runtimeAddress: normalizeText(context.runtimeAddress),
          runtimeOwner: normalizeText(context.runtimeOwner),
          executionMode: 'aa-native'
        };
      }
      const reason = normalizeText(result?.reason || result?.error?.message || `${actionCode || 'escrow call'} failed`);
      lastFailure = buildEscrowError(actionCode || 'aa_userop_failed', reason, {
        role: context.role,
        roleAddress: context.roleAddress,
        runtimeAddress: context.runtimeAddress,
        userOpHash: normalizeText(result?.userOpHash || submitResult?.userOpHash),
        attempt
      });
      if (attempt >= 3 || !isRetryableOnchainError(lastFailure)) break;
      await wait(1000 * attempt);
    }
    throw lastFailure || buildEscrowError(actionCode || 'aa_userop_failed', 'AA escrow execution failed.');
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
    if (!contractAddress) {
      return {
        configured: false,
        locked: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }

    const requesterAddress = normalizeAddress(requester);
    const executorAddress = normalizeAddress(executor);
    const validatorAddress = normalizeAddress(validator);
    if (!requesterAddress) throw new Error(`Invalid requester address: ${requester}`);
    if (!executorAddress) throw new Error(`Invalid executor address: ${executor}`);
    if (!validatorAddress) throw new Error(`Invalid validator address: ${validator}`);

    const normalizedAmount = await normalizeUnits(amount);
    const normalizedStake = normalizeText(executorStakeAmount)
      ? await normalizeUnits(executorStakeAmount)
      : 0n;
    const normalizedDeadline = normalizeDeadline(deadlineAt);
    const context = await buildAaExecutionContext({ role: 'requester', roleAddress: requesterAddress });
    await ensureErc20Allowance(context, normalizedAmount);
    const contractInterface = new ethers.Interface(abi);
    const callData = contractInterface.encodeFunctionData('lockFunds', [
      normalizeText(jobId),
      requesterAddress,
      executorAddress,
      validatorAddress,
      normalizedAmount,
      normalizedDeadline,
      normalizedStake
    ]);
    const execution = await executeEscrowCall({
      context,
      target: contractAddress,
      callData,
      gasOverrides: {
        callGasLimit: 420000n,
        verificationGasLimit: 650000n,
        preVerificationGas: 120000n
      },
      actionCode: 'job_fund_failed'
    });
    return {
      configured: true,
      locked: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: execution.txHash,
      userOpHash: execution.userOpHash,
      runtimeAddress: execution.runtimeAddress,
      runtimeOwner: execution.runtimeOwner,
      executionMode: execution.executionMode,
      escrowState: 'funded'
    };
  }

  async function acceptEscrowJob({ jobId = '', executor = '' } = {}) {
    if (!contractAddress) {
      return {
        configured: false,
        accepted: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }
    const executorAddress = normalizeAddress(executor);
    if (!executorAddress) {
      throw buildEscrowError('runtime_not_found', 'executor AA address is required for accept.', {
        executor
      });
    }
    const context = await buildAaExecutionContext({ role: 'executor', roleAddress: executorAddress });
    const escrowJob = await getEscrowJob({ jobId });
    if (Number(escrowJob?.executorStakeAmount || 0) > 0) {
      await ensureErc20Allowance(context, ethers.getBigInt(escrowJob.executorStakeAmount));
    }
    const contractInterface = new ethers.Interface(abi);
    const callData = contractInterface.encodeFunctionData('acceptJob', [normalizeText(jobId)]);
    const execution = await executeEscrowCall({
      context,
      target: contractAddress,
      callData,
      gasOverrides: {
        callGasLimit: 320000n,
        verificationGasLimit: 520000n,
        preVerificationGas: 110000n
      },
      actionCode: 'job_accept_failed'
    });
    return {
      configured: true,
      accepted: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: execution.txHash,
      userOpHash: execution.userOpHash,
      runtimeAddress: execution.runtimeAddress,
      runtimeOwner: execution.runtimeOwner,
      executionMode: execution.executionMode,
      escrowState: 'accepted'
    };
  }

  async function submitEscrowResult({ jobId = '', resultHash = '', executor = '' } = {}) {
    if (!contractAddress) {
      return {
        configured: false,
        submitted: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }
    const executorAddress = normalizeAddress(executor);
    if (!executorAddress) {
      throw buildEscrowError('runtime_not_found', 'executor AA address is required for submit.', {
        executor
      });
    }
    const context = await buildAaExecutionContext({ role: 'executor', roleAddress: executorAddress });
    const contractInterface = new ethers.Interface(abi);
    const callData = contractInterface.encodeFunctionData('submitResult', [
      normalizeText(jobId),
      normalizeBytes32(resultHash)
    ]);

    let execution;
    try {
      execution = await executeEscrowCall({
        context,
        target: contractAddress,
        callData,
        gasOverrides: {
          callGasLimit: 320000n,
          verificationGasLimit: 520000n,
          preVerificationGas: 110000n
        },
        actionCode: 'job_submit_failed'
      });
    } catch (error) {
      if (isTraceAnchorRequiredError(error)) {
        const guardError = new Error('trace_anchor_required');
        guardError.code = 'trace_anchor_required';
        guardError.cause = error;
        throw guardError;
      }
      throw error;
    }

    return {
      configured: true,
      submitted: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: execution.txHash,
      userOpHash: execution.userOpHash,
      runtimeAddress: execution.runtimeAddress,
      runtimeOwner: execution.runtimeOwner,
      executionMode: execution.executionMode,
      escrowState: 'submitted'
    };
  }

  async function validateEscrowJob({ jobId = '', approved = false, validator = '' } = {}) {
    if (!contractAddress) {
      return {
        configured: false,
        validated: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }
    const validatorAddress = normalizeAddress(validator);
    if (!validatorAddress) {
      throw buildEscrowError('runtime_not_found', 'validator AA address is required for validate.', {
        validator
      });
    }
    const context = await buildAaExecutionContext({ role: 'validator', roleAddress: validatorAddress });
    const contractInterface = new ethers.Interface(abi);
    const callData = contractInterface.encodeFunctionData('validate', [
      normalizeText(jobId),
      Boolean(approved)
    ]);
    const execution = await executeEscrowCall({
      context,
      target: contractAddress,
      callData,
      gasOverrides: {
        callGasLimit: 320000n,
        verificationGasLimit: 520000n,
        preVerificationGas: 110000n
      },
      actionCode: 'job_validate_failed'
    });
    return {
      configured: true,
      validated: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: execution.txHash,
      userOpHash: execution.userOpHash,
      runtimeAddress: execution.runtimeAddress,
      runtimeOwner: execution.runtimeOwner,
      executionMode: execution.executionMode,
      escrowState: approved ? 'completed' : 'rejected'
    };
  }

  async function expireEscrowJob({ jobId = '', requester = '' } = {}) {
    if (!contractAddress) {
      return {
        configured: false,
        expired: false,
        contractAddress: '',
        tokenAddress: settlementTokenAddress,
        txHash: ''
      };
    }
    const requesterAddress = normalizeAddress(requester);
    if (!requesterAddress) {
      throw buildEscrowError('runtime_not_found', 'requester AA address is required for expire.', {
        requester
      });
    }
    const context = await buildAaExecutionContext({ role: 'requester', roleAddress: requesterAddress });
    const contractInterface = new ethers.Interface(abi);
    const callData = contractInterface.encodeFunctionData('expireJob', [normalizeText(jobId)]);
    const execution = await executeEscrowCall({
      context,
      target: contractAddress,
      callData,
      gasOverrides: {
        callGasLimit: 320000n,
        verificationGasLimit: 520000n,
        preVerificationGas: 110000n
      },
      actionCode: 'job_expire_failed'
    });
    return {
      configured: true,
      expired: true,
      contractAddress,
      tokenAddress: settlementTokenAddress,
      txHash: execution.txHash,
      userOpHash: execution.userOpHash,
      runtimeAddress: execution.runtimeAddress,
      runtimeOwner: execution.runtimeOwner,
      executionMode: execution.executionMode,
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

    const job = await withTimeout(
      runWithOnchainRetry(() => contract.getJob(normalizeText(jobId))),
      15000,
      'getEscrowJob'
    );
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
