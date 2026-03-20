import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ethers } from 'ethers';

import { resolveAaAccountImplementation, resolveAaFactoryAddress } from '../lib/aaConfig.js';
import { compileOfficialAgenticCommerce } from '../lib/contracts/compileOfficialAgenticCommerce.js';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

loadEnv({ path: path.resolve(backendDir, '.env') });

const RPC_URL = String(process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/').trim();
const BUNDLER_URL = String(
  process.env.KITEAI_BUNDLER_URL || process.env.KITEAA_BUNDLER_URL || ''
).trim();
const ENTRYPOINT_ADDRESS = String(
  process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
).trim();
const ACCOUNT_FACTORY_ADDRESS = resolveAaFactoryAddress();
const ACCOUNT_IMPLEMENTATION_ADDRESS = resolveAaAccountImplementation();
const DEPLOYER_PRIVATE_KEY = String(
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY ||
    process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY ||
    ''
).trim();
const TOKEN_ADDRESS = String(process.env.KITE_SETTLEMENT_TOKEN || '').trim();
const TREASURY_ADDRESS = String(
  process.env.ERC8183_DEPLOY_OWNER ||
    process.env.KITE_MERCHANT_ADDRESS ||
    process.env.ERC8183_REQUESTER_ADDRESS ||
    ''
).trim();
const REQUESTER_OWNER = String(process.env.ERC8183_REQUESTER_ADDRESS || '').trim();
const REQUESTER_OWNER_KEY = String(process.env.ERC8183_REQUESTER_PRIVATE_KEY || '').trim();
const PROVIDER_ADDRESS = String(
  process.env.ERC8183_EXECUTOR_ADDRESS || process.env.ERC8183_EXECUTOR_AA_ADDRESS || ''
).trim();
const PROVIDER_PRIVATE_KEY = String(process.env.ERC8183_EXECUTOR_PRIVATE_KEY || '').trim();
const EVALUATOR_ADDRESS = String(
  process.env.ERC8183_VALIDATOR_ADDRESS || process.env.ERC8183_REQUESTER_ADDRESS || ''
).trim();
const BUDGET_HUMAN = String(process.env.ERC8183_OFFICIAL_TEST_BUDGET || '0.0001').trim();
const REQUEST_TIMEOUT_MS = Math.max(15_000, Number(process.env.KITE_RPC_TIMEOUT_MS || 60_000));
const USEROP_WAIT_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS || 120_000)
);
const USEROP_POLL_INTERVAL_MS = Math.max(
  800,
  Number(process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS || 3_000)
);
const SESSION_RUNTIME_PATH = path.resolve(backendDir, 'data', 'session_runtime.json');
const SESSION_RUNTIME_INDEX_PATH = path.resolve(backendDir, 'data', 'session_runtimes.json');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizePrivateKey(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) return normalized;
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) return `0x${normalized}`;
  return '';
}

function normalizeAddress(value = '') {
  const normalized = normalizeText(value);
  if (!normalized || !ethers.isAddress(normalized)) return '';
  return ethers.getAddress(normalized);
}

function requireValue(label, value) {
  if (!value) throw new Error(`Missing required value: ${label}`);
}

function readJsonObject(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function readRuntimes() {
  const current = readJsonObject(SESSION_RUNTIME_PATH);
  const index = readJsonObject(SESSION_RUNTIME_INDEX_PATH);
  const runtimes = [];
  if (current && typeof current === 'object') runtimes.push(current);
  const indexed = index?.runtimes && typeof index.runtimes === 'object' ? Object.values(index.runtimes) : [];
  for (const runtime of indexed) {
    runtimes.push(runtime);
  }
  const unique = new Map();
  for (const runtime of runtimes) {
    const aaWallet = normalizeAddress(runtime?.aaWallet || '');
    if (!aaWallet) continue;
    unique.set(aaWallet, {
      aaWallet,
      owner: normalizeAddress(runtime?.owner || ''),
      sessionAddress: normalizeAddress(runtime?.sessionAddress || ''),
      sessionPrivateKey: normalizePrivateKey(runtime?.sessionPrivateKey || ''),
      sessionId: normalizeText(runtime?.sessionId || '')
    });
  }
  return Array.from(unique.values());
}

function findRuntime({ aaWallet = '', owner = '' } = {}) {
  const runtimes = readRuntimes();
  const normalizedAaWallet = normalizeAddress(aaWallet);
  const normalizedOwner = normalizeAddress(owner);
  if (normalizedAaWallet) {
    const byAa = runtimes.find((runtime) => runtime.aaWallet === normalizedAaWallet);
    if (byAa) return byAa;
  }
  if (normalizedOwner) {
    const byOwner = runtimes.find((runtime) => runtime.owner === normalizedOwner);
    if (byOwner) return byOwner;
  }
  return null;
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function createProvider() {
  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = REQUEST_TIMEOUT_MS;
  const staticNetwork = ethers.Network.from({
    chainId: 2368,
    name: 'kite_testnet'
  });
  return new ethers.JsonRpcProvider(rpcRequest, staticNetwork, { staticNetwork });
}

function buildAaSdk({ provider, runtime }) {
  return new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT_ADDRESS,
    accountFactoryAddress: ACCOUNT_FACTORY_ADDRESS,
    accountImplementationAddress: ACCOUNT_IMPLEMENTATION_ADDRESS,
    proxyAddress: runtime.aaWallet,
    ownerAddress: runtime.owner,
    bundlerRpcTimeoutMs: Number(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS || 15_000),
    bundlerRpcRetries: Number(process.env.KITE_BUNDLER_RPC_RETRIES || 3),
    bundlerRpcBackoffBaseMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_BASE_MS || 650),
    bundlerRpcBackoffMaxMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_MAX_MS || 6_000),
    bundlerRpcBackoffFactor: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_FACTOR || 2),
    bundlerRpcBackoffJitterMs: Number(process.env.KITE_BUNDLER_RPC_BACKOFF_JITTER_MS || 325),
    bundlerReceiptPollIntervalMs: Number(process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS || 3_000),
    rpcTimeoutMs: REQUEST_TIMEOUT_MS
  });
}

async function readUserOpDiagnostics(sdk, userOpHash = '') {
  const normalizedHash = normalizeText(userOpHash);
  if (!normalizedHash) {
    return {
      receipt: null,
      byHash: null
    };
  }
  let receipt = null;
  let byHash = null;
  try {
    receipt = await sdk.getUserOperationReceipt(normalizedHash);
  } catch (error) {
    receipt = { error: normalizeText(error?.message || error) };
  }
  try {
    byHash = await sdk.getUserOperationByHash(normalizedHash);
  } catch (error) {
    byHash = { error: normalizeText(error?.message || error) };
  }
  return { receipt, byHash };
}

async function waitForPredicate({
  label,
  timeoutMs = USEROP_WAIT_TIMEOUT_MS,
  pollIntervalMs = USEROP_POLL_INTERVAL_MS,
  predicate
} = {}) {
  const startedAt = Date.now();
  let lastValue = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await predicate();
    if (lastValue?.matched) {
      return {
        matched: true,
        elapsedMs: Date.now() - startedAt,
        value: lastValue
      };
    }
    await wait(pollIntervalMs);
  }
  return {
    matched: false,
    elapsedMs: Date.now() - startedAt,
    value: lastValue,
    label: normalizeText(label)
  };
}

async function ensureAllowance({
  provider,
  runtime,
  spender,
  ownerPrivateKey,
  tokenAddress
} = {}) {
  const token = new ethers.Contract(
    tokenAddress,
    [
      'function allowance(address owner, address spender) view returns (uint256)'
    ],
    provider
  );
  const beforeAllowance = await token.allowance(runtime.aaWallet, spender);
  if (beforeAllowance >= ethers.MaxUint256 / 2n) {
    return {
      skipped: true,
      beforeAllowance: beforeAllowance.toString(),
      afterAllowance: beforeAllowance.toString(),
      txHash: '',
      userOpHash: ''
    };
  }

  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  const sdk = buildAaSdk({ provider, runtime });
  const signFunction = async (userOpHash) => ownerWallet.signMessage(ethers.getBytes(userOpHash));
  const approval = await sdk.approveERC20(
    {
      tokenAddress,
      spender,
      amount: ethers.MaxUint256
    },
    signFunction
  );
  const afterAllowance = await token.allowance(runtime.aaWallet, spender);
  return {
    skipped: false,
    beforeAllowance: beforeAllowance.toString(),
    afterAllowance: afterAllowance.toString(),
    txHash: normalizeText(approval?.transactionHash || ''),
    userOpHash: normalizeText(approval?.userOpHash || ''),
    status: normalizeText(approval?.status || ''),
    reason: normalizeText(approval?.reason || approval?.error?.message || '')
  };
}

async function executeAaCall({
  provider,
  runtime,
  target,
  callData,
  gasOverrides = {},
  waitTimeoutMs = USEROP_WAIT_TIMEOUT_MS
} = {}) {
  const sdk = buildAaSdk({ provider, runtime });
  const sessionWallet = new ethers.Wallet(runtime.sessionPrivateKey, provider);
  const signFunction = async (userOpHash) => sessionWallet.signMessage(ethers.getBytes(userOpHash));
  const submit = await sdk.sendRawCallDataUserOperation(callData, signFunction, gasOverrides);
  const result = {
    submit,
    wait: null,
    bundler: {
      receipt: null,
      byHash: null
    }
  };
  if (submit?.status === 'submitted' && normalizeText(submit?.userOpHash)) {
    result.wait = await sdk.waitForUserOperationResult(
      submit.userOpHash,
      waitTimeoutMs,
      USEROP_POLL_INTERVAL_MS
    );
    result.bundler = await readUserOpDiagnostics(sdk, submit.userOpHash);
  }
  return result;
}

async function main() {
  requireValue('KITEAI_BUNDLER_URL', BUNDLER_URL);
  requireValue('deployer private key', normalizePrivateKey(DEPLOYER_PRIVATE_KEY));
  requireValue('KITE_SETTLEMENT_TOKEN', normalizeAddress(TOKEN_ADDRESS));
  requireValue('requester owner', normalizeAddress(REQUESTER_OWNER));
  requireValue('requester owner key', normalizePrivateKey(REQUESTER_OWNER_KEY));
  requireValue('provider address', normalizeAddress(PROVIDER_ADDRESS));
  requireValue('provider private key', normalizePrivateKey(PROVIDER_PRIVATE_KEY));
  requireValue('evaluator address', normalizeAddress(EVALUATOR_ADDRESS));

  const provider = createProvider();
  const deployerWallet = new ethers.Wallet(normalizePrivateKey(DEPLOYER_PRIVATE_KEY), provider);
  const providerWallet = new ethers.Wallet(normalizePrivateKey(PROVIDER_PRIVATE_KEY), provider);
  const requesterRuntime =
    findRuntime({ owner: REQUESTER_OWNER }) ||
    findRuntime({ aaWallet: process.env.ERC8183_REQUESTER_AA_ADDRESS || '' });
  if (!requesterRuntime?.aaWallet || !requesterRuntime?.sessionPrivateKey || !requesterRuntime?.sessionId) {
    throw new Error(`Requester AA runtime not found for owner ${REQUESTER_OWNER}.`);
  }

  const compiled = compileOfficialAgenticCommerce();
  const token = new ethers.Contract(
    TOKEN_ADDRESS,
    [
      'function decimals() view returns (uint8)',
      'function balanceOf(address account) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)'
    ],
    provider
  );
  const decimals = Number(await token.decimals());
  const budgetUnits = ethers.parseUnits(BUDGET_HUMAN, decimals);
  const requesterBalanceBefore = await token.balanceOf(requesterRuntime.aaWallet);
  if (requesterBalanceBefore < budgetUnits) {
    throw new Error(
      `Requester AA token balance too low. balance=${ethers.formatUnits(
        requesterBalanceBefore,
        decimals
      )}, required=${BUDGET_HUMAN}`
    );
  }

  const implementationFactory = new ethers.ContractFactory(
    compiled.abi,
    compiled.bytecode,
    deployerWallet
  );
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();

  const proxyFactory = new ethers.ContractFactory(
    compiled.proxyAbi,
    compiled.proxyBytecode,
    deployerWallet
  );
  const treasuryAddress = normalizeAddress(TREASURY_ADDRESS) || deployerWallet.address;
  const initializeData = new ethers.Interface(compiled.abi).encodeFunctionData('initialize', [
    normalizeAddress(TOKEN_ADDRESS),
    treasuryAddress
  ]);
  const proxy = await proxyFactory.deploy(await implementation.getAddress(), initializeData);
  await proxy.waitForDeployment();

  const officialAddress = await proxy.getAddress();
  const official = new ethers.Contract(officialAddress, compiled.abi, provider);

  const eoaCreateExpiry = Math.floor(Date.now() / 1000) + 3600;
  const eoaCreateTx = await official.connect(deployerWallet).createJob(
    normalizeAddress(PROVIDER_ADDRESS),
    normalizeAddress(EVALUATOR_ADDRESS),
    BigInt(eoaCreateExpiry),
    `official-eoa-create-${Date.now()}`,
    ethers.ZeroAddress
  );
  await eoaCreateTx.wait();
  const eoaCreateCounter = await official.jobCounter();

  const allowance = await ensureAllowance({
    provider,
    runtime: requesterRuntime,
    spender: officialAddress,
    ownerPrivateKey: normalizePrivateKey(REQUESTER_OWNER_KEY),
    tokenAddress: normalizeAddress(TOKEN_ADDRESS)
  });

  const preCreateCounter = await official.jobCounter();
  const createExpiry = Math.floor(Date.now() / 1000) + 3600;
  const createCallData = official.interface.encodeFunctionData('createJob', [
    normalizeAddress(PROVIDER_ADDRESS),
    normalizeAddress(EVALUATOR_ADDRESS),
    BigInt(createExpiry),
    `official-aa-fund-${Date.now()}`,
    ethers.ZeroAddress
  ]);
  let createSimulation = {
    ok: false,
    result: '',
    error: ''
  };
  try {
    const simulated = await provider.call({
      from: requesterRuntime.aaWallet,
      to: officialAddress,
      data: createCallData
    });
    const [simulatedJobId] = official.interface.decodeFunctionResult('createJob', simulated);
    createSimulation = {
      ok: true,
      result: simulatedJobId?.toString?.() || ''
    };
  } catch (error) {
    createSimulation = {
      ok: false,
      result: '',
      error: normalizeText(error?.message || error)
    };
  }
  const createExecution = await executeAaCall({
    provider,
    runtime: requesterRuntime,
    target: officialAddress,
    callData: createCallData,
    gasOverrides: {
      callGasLimit: 360000n,
      verificationGasLimit: 620000n,
      preVerificationGas: 120000n
    }
  });
  const createState = await waitForPredicate({
    label: 'job created',
    predicate: async () => {
      const currentCounter = await official.jobCounter();
      return {
        matched: currentCounter > preCreateCounter,
        jobCounter: currentCounter.toString()
      };
    }
  });
  const jobId = createState?.value?.jobCounter ? BigInt(createState.value.jobCounter) : 0n;

  let budgetTxHash = '';
  let fundExecution = null;
  let fundState = null;
  let jobAfterFund = null;
  let contractBalanceAfterFund = null;
  let requesterBalanceAfterFund = null;

  if (jobId > 0n) {
    const providerOfficial = official.connect(providerWallet);
    const budgetTx = await providerOfficial.setBudget(jobId, budgetUnits, '0x');
    await budgetTx.wait();
    budgetTxHash = normalizeText(budgetTx.hash);

    const fundCallData = official.interface.encodeFunctionData('fund', [jobId, '0x']);
    fundExecution = await executeAaCall({
      provider,
      runtime: requesterRuntime,
      target: officialAddress,
      callData: fundCallData,
      gasOverrides: {
        callGasLimit: 320000n,
        verificationGasLimit: 560000n,
        preVerificationGas: 120000n
      }
    });
    fundState = await waitForPredicate({
      label: 'job funded',
      predicate: async () => {
        const job = await official.getJob(jobId);
        return {
          matched: Number(job.status || 0) === 1,
          status: Number(job.status || 0),
          budget: job.budget?.toString?.() || '0'
        };
      }
    });
    jobAfterFund = await official.getJob(jobId);
    contractBalanceAfterFund = await token.balanceOf(officialAddress);
    requesterBalanceAfterFund = await token.balanceOf(requesterRuntime.aaWallet);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        rpcUrl: RPC_URL,
        bundlerUrl: BUNDLER_URL,
        officialBaseDir: compiled.officialBaseDir,
        compilation: {
          sourcePath: compiled.sourcePath,
          warnings: compiled.warnings
        },
        deploy: {
          deployer: deployerWallet.address,
          implementation: await implementation.getAddress(),
          proxy: officialAddress,
          treasury: treasuryAddress,
          implementationTxHash: normalizeText(implementation.deploymentTransaction()?.hash || ''),
          proxyTxHash: normalizeText(proxy.deploymentTransaction()?.hash || ''),
          eoaCreateTxHash: normalizeText(eoaCreateTx.hash || ''),
          eoaCreateJobCounter: eoaCreateCounter.toString()
        },
        requester: {
          owner: requesterRuntime.owner,
          aaWallet: requesterRuntime.aaWallet,
          sessionId: requesterRuntime.sessionId,
          balanceBefore: ethers.formatUnits(requesterBalanceBefore, decimals)
        },
        allowance,
        create: {
          preCreateCounter: preCreateCounter.toString(),
          simulation: createSimulation,
          execution: createExecution,
          state: createState,
          jobId: jobId.toString()
        },
        budget: {
          amountHuman: BUDGET_HUMAN,
          amountUnits: budgetUnits.toString(),
          provider: normalizeAddress(PROVIDER_ADDRESS),
          txHash: budgetTxHash
        },
        fund: {
          execution: fundExecution,
          state: fundState,
          job: jobAfterFund
            ? {
                id: jobAfterFund.id?.toString?.() || '0',
                client: normalizeAddress(jobAfterFund.client || ''),
                provider: normalizeAddress(jobAfterFund.provider || ''),
                evaluator: normalizeAddress(jobAfterFund.evaluator || ''),
                budget: jobAfterFund.budget?.toString?.() || '0',
                expiredAt: jobAfterFund.expiredAt?.toString?.() || '0',
                status: Number(jobAfterFund.status || 0)
              }
            : null,
          contractBalance: contractBalanceAfterFund
            ? ethers.formatUnits(contractBalanceAfterFund, decimals)
            : '',
          requesterBalance: requesterBalanceAfterFund
            ? ethers.formatUnits(requesterBalanceAfterFund, decimals)
            : ''
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: normalizeText(error?.message || error),
        stack: normalizeText(error?.stack || '')
      },
      null,
      2
    )
  );
  process.exit(1);
});
