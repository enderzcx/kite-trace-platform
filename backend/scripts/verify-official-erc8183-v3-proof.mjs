import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  resolveAaAccountImplementation,
  resolveAaFactoryAddress
} from '../lib/aaConfig.js';
import { compileKTraceAccountFactory } from '../lib/contracts/compileKTraceAccountFactory.js';
import { compileKTraceAccountV3SessionExecute } from '../lib/contracts/compileKTraceAccountV3SessionExecute.js';
import { compileOfficialMinimalAgenticCommerce } from '../lib/contracts/compileOfficialMinimalAgenticCommerce.js';
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
const TOKEN_ADDRESS = String(process.env.KITE_SETTLEMENT_TOKEN || '').trim();
const DEPLOYER_PRIVATE_KEY = normalizePrivateKey(
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY ||
    process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    ''
);
const PROOF_TOKEN_SOURCE_KEY = normalizePrivateKey(
  process.env.ERC8183_PROOF_TOKEN_SOURCE_KEY || ''
);
const LEGACY_REQUESTER_OWNER = normalizeAddress(process.env.ERC8183_REQUESTER_ADDRESS || '');
const LEGACY_REQUESTER_OWNER_KEY = normalizePrivateKey(
  process.env.ERC8183_REQUESTER_PRIVATE_KEY || ''
);
const ACCOUNT_IMPLEMENTATION_ADDRESS = resolveAaAccountImplementation();
const DEFAULT_FACTORY_ADDRESS = resolveAaFactoryAddress();
const SESSION_RUNTIME_PATH = path.resolve(backendDir, 'data', 'session_runtime.json');
const SESSION_RUNTIME_INDEX_PATH = path.resolve(backendDir, 'data', 'session_runtimes.json');

const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.KITE_RPC_TIMEOUT_MS || 120_000));
const USEROP_WAIT_TIMEOUT_MS = Math.max(
  180_000,
  Number(process.env.ERC8183_PROOF_USEROP_WAIT_TIMEOUT_MS || process.env.KITE_USEROP_WAIT_TIMEOUT_MS || 300_000)
);
const STEP_VERBOSE = !/^(0|false|no|off)$/i.test(String(process.env.ERC8183_PROOF_VERBOSE || '1').trim());
const BUDGET_HUMAN = String(process.env.ERC8183_OFFICIAL_TEST_BUDGET || '0.0001').trim();
const TOKEN_MULTIPLIER = BigInt(Math.max(2, Number(process.env.ERC8183_PROOF_TOKEN_MULTIPLIER || 3)));
const OWNER_NATIVE_HUMAN = String(process.env.ERC8183_PROOF_OWNER_NATIVE || '0.001').trim();
const AA_NATIVE_HUMAN = String(process.env.ERC8183_PROOF_AA_NATIVE || '0.002').trim();
const SESSION_SINGLE_LIMIT_HUMAN = String(
  process.env.ERC8183_PROOF_SESSION_SINGLE_LIMIT || '1'
).trim();
const SESSION_DAILY_LIMIT_HUMAN = String(
  process.env.ERC8183_PROOF_SESSION_DAILY_LIMIT || '10'
).trim();

const STATUS_NAMES = Object.freeze([
  'Open',
  'Funded',
  'Submitted',
  'Completed',
  'Rejected',
  'Expired'
]);

const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const SELECTORS = Object.freeze({
  approve: '0x095ea7b3',
  createJob: ethers.id('createJob(address,address,uint256,string,address)').slice(0, 10),
  setProvider: ethers.id('setProvider(uint256,address)').slice(0, 10),
  setBudget: ethers.id('setBudget(uint256,uint256,bytes)').slice(0, 10),
  fund: ethers.id('fund(uint256,bytes)').slice(0, 10),
  submit: ethers.id('submit(uint256,bytes32,bytes)').slice(0, 10),
  complete: ethers.id('complete(uint256,bytes32,bytes)').slice(0, 10),
  reject: ethers.id('reject(uint256,bytes32,bytes)').slice(0, 10),
  claimRefund: ethers.id('claimRefund(uint256)').slice(0, 10)
});

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizePrivateKey(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return '';
}

function normalizeAddress(value = '') {
  const raw = normalizeText(value);
  if (!raw || !ethers.isAddress(raw)) return '';
  return ethers.getAddress(raw);
}

function requireValue(label, value) {
  if (!value) throw new Error(`Missing required value: ${label}`);
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

function buildAaSdk({
  proxyAddress,
  ownerAddress,
  implementationAddress,
  factoryAddress
} = {}) {
  return new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT_ADDRESS,
    accountFactoryAddress: factoryAddress || DEFAULT_FACTORY_ADDRESS,
    accountImplementationAddress: implementationAddress || ACCOUNT_IMPLEMENTATION_ADDRESS,
    proxyAddress,
    ownerAddress,
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

function buildSessionRules({
  singleLimit,
  dailyLimit,
  nowTs
} = {}) {
  return [
    {
      timeWindow: 0n,
      budget: singleLimit,
      initialWindowStartTime: 0,
      targetProviders: []
    },
    {
      timeWindow: 86_400n,
      budget: dailyLimit,
      initialWindowStartTime: Math.max(0, Number(nowTs || 0) - 1),
      targetProviders: []
    }
  ];
}

function formatToken(amount, decimals) {
  return ethers.formatUnits(amount, decimals);
}

function jobStatusName(value) {
  const index = Number(value);
  return STATUS_NAMES[index] || `Unknown(${index})`;
}

function logStep(message = '', detail = null) {
  if (!STEP_VERBOSE) return;
  const text = normalizeText(message || '');
  if (!text) return;
  if (detail && typeof detail === 'object') {
    console.error(`[verify-official-erc8183-v3-proof] ${text}: ${JSON.stringify(detail)}`);
    return;
  }
  console.error(`[verify-official-erc8183-v3-proof] ${text}`);
}

async function readJobSnapshot(official, jobId) {
  const job = await official.getJob(jobId);
  return {
    id: Number(job.id),
    client: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    description: job.description,
    budget: job.budget.toString(),
    expiredAt: Number(job.expiredAt),
    status: Number(job.status),
    statusName: jobStatusName(job.status),
    hook: job.hook
  };
}

async function ensureNativeBalance(funder, recipient, amountWei) {
  const current = await funder.provider.getBalance(recipient);
  if (current >= amountWei) {
    return {
      funded: false,
      before: current.toString(),
      after: current.toString(),
      txHash: ''
    };
  }
  const tx = await funder.sendTransaction({
    to: recipient,
    value: amountWei - current
  });
  await tx.wait();
  const after = await funder.provider.getBalance(recipient);
  return {
    funded: true,
    before: current.toString(),
    after: after.toString(),
    txHash: tx.hash
  };
}

async function executeOwnerAaTokenTransfer({
  provider,
  sourceAaWallet,
  sourceOwner,
  sourceOwnerKey,
  target,
  amount,
  tokenAddress
} = {}) {
  const sdk = buildAaSdk({
    proxyAddress: sourceAaWallet,
    ownerAddress: sourceOwner,
    implementationAddress: ACCOUNT_IMPLEMENTATION_ADDRESS,
    factoryAddress: DEFAULT_FACTORY_ADDRESS
  });
  const ownerWallet = new ethers.Wallet(sourceOwnerKey, provider);
  const tokenInterface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const transferCallData = tokenInterface.encodeFunctionData('transfer', [target, amount]);
  return sdk.sendUserOperationAndWait(
    {
      target: tokenAddress,
      value: 0n,
      callData: transferCallData
    },
    async (userOpHash) => ownerWallet.signMessage(ethers.getBytes(userOpHash))
  );
}

async function ensureTokenBalance({
  provider,
  token,
  deployerWallet,
  target,
  amountRequired
} = {}) {
  const current = await token.balanceOf(target);
  if (current >= amountRequired) {
    return {
      funded: false,
      source: 'existing',
      before: current.toString(),
      after: current.toString(),
      txHash: '',
      userOpHash: ''
    };
  }

  const missing = amountRequired - current;
  const deployerBalance = await token.balanceOf(deployerWallet.address);
  if (deployerBalance >= missing) {
    const tokenWithSigner = token.connect(deployerWallet);
    const tx = await tokenWithSigner.transfer(target, missing);
    await tx.wait();
    const after = await token.balanceOf(target);
    return {
      funded: true,
      source: 'deployer-eoa',
      before: current.toString(),
      after: after.toString(),
      txHash: tx.hash,
      userOpHash: ''
    };
  }

  if (PROOF_TOKEN_SOURCE_KEY) {
    const sourceWallet = new ethers.Wallet(PROOF_TOKEN_SOURCE_KEY, provider);
    const sourceBalance = await token.balanceOf(sourceWallet.address);
    if (sourceBalance >= missing) {
      const tokenWithSigner = token.connect(sourceWallet);
      const tx = await tokenWithSigner.transfer(target, missing);
      await tx.wait();
      const after = await token.balanceOf(target);
      return {
        funded: true,
        source: 'proof-source-eoa',
        before: current.toString(),
        after: after.toString(),
        txHash: tx.hash,
        userOpHash: ''
      };
    }
  }

  if (LEGACY_REQUESTER_OWNER && LEGACY_REQUESTER_OWNER_KEY) {
    const runtime = findRuntime({ owner: LEGACY_REQUESTER_OWNER });
    if (runtime?.aaWallet) {
      const transfer = await executeOwnerAaTokenTransfer({
        provider,
        sourceAaWallet: runtime.aaWallet,
        sourceOwner: LEGACY_REQUESTER_OWNER,
        sourceOwnerKey: LEGACY_REQUESTER_OWNER_KEY,
        target,
        amount: missing,
        tokenAddress: await token.getAddress()
      });
      const after = await token.balanceOf(target);
      return {
        funded: true,
        source: 'legacy-requester-aa',
        before: current.toString(),
        after: after.toString(),
        txHash: normalizeText(transfer?.transactionHash || ''),
        userOpHash: normalizeText(transfer?.userOpHash || '')
      };
    }
  }

  throw new Error(
    `Unable to fund requester proof AA with settlement token. missing=${missing.toString()} target=${target}`
  );
}

async function deployProofAccount({
  provider,
  deployerWallet,
  factoryContract,
  implementationAddress,
  role,
  salt
} = {}) {
  const ownerWallet = ethers.Wallet.createRandom().connect(provider);
  const predictedAddress = await factoryContract['getAddress(address,uint256)'](
    ownerWallet.address,
    salt
  );
  const createTx = await factoryContract['createAccount(address,uint256)'](ownerWallet.address, salt);
  await createTx.wait();

  const account = new ethers.Contract(
    predictedAddress,
    [
      'function version() view returns (string)',
      'function addSupportedToken(address token) external',
      'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
      'function setSessionSelectorPermissions(tuple(bytes32 sessionId,address target,bytes4 selector,bool enabled,uint256 maxAmount)[] updates) external',
      'function sessionExists(bytes32 sessionId) view returns (bool)',
      'function getSessionAgent(bytes32 sessionId) view returns (address)'
    ],
    ownerWallet
  );

  const version = String(await account.version()).trim();
  const latestBlock = await provider.getBlock('latest');
  const singleLimit = ethers.parseUnits(SESSION_SINGLE_LIMIT_HUMAN, 18);
  const dailyLimit = ethers.parseUnits(SESSION_DAILY_LIMIT_HUMAN, 18);
  const sessionWallet = ethers.Wallet.createRandom();
  const sessionId = ethers.keccak256(
    ethers.toUtf8Bytes(`${role}:${sessionWallet.address}:${Date.now()}:${salt.toString()}`)
  );

  await ensureNativeBalance(deployerWallet, ownerWallet.address, ethers.parseEther(OWNER_NATIVE_HUMAN));
  await ensureNativeBalance(deployerWallet, predictedAddress, ethers.parseEther(AA_NATIVE_HUMAN));

  const addSupportedTokenTx = await account.addSupportedToken(TOKEN_ADDRESS);
  await addSupportedTokenTx.wait();

  const createSessionTx = await account.createSession(
    sessionId,
    sessionWallet.address,
    buildSessionRules({
      singleLimit,
      dailyLimit,
      nowTs: Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000))
    })
  );
  await createSessionTx.wait();

  const [exists, onchainAgent] = await Promise.all([
    account.sessionExists(sessionId),
    account.getSessionAgent(sessionId)
  ]);
  if (!exists || normalizeAddress(onchainAgent) !== normalizeAddress(sessionWallet.address)) {
    throw new Error(`Session verification failed for ${role} AA ${predictedAddress}`);
  }

  return {
    role,
    ownerWallet,
    aaWallet: predictedAddress,
    account,
    version,
    implementationAddress,
    sessionId,
    sessionWallet,
    createAccountTxHash: createTx.hash,
    createSessionTxHash: createSessionTx.hash
  };
}

async function configurePermissions({
  runtime,
  officialAddress,
  budgetUnits,
  totalTokenUnits
} = {}) {
  const updates = [];
  const push = (target, selector, maxAmount = 0n) => {
    updates.push({
      sessionId: runtime.sessionId,
      target,
      selector,
      enabled: true,
      maxAmount
    });
  };

  if (runtime.role === 'requester') {
    push(TOKEN_ADDRESS, SELECTORS.approve, totalTokenUnits);
    push(officialAddress, SELECTORS.createJob, 0n);
    push(officialAddress, SELECTORS.setProvider, 0n);
    push(officialAddress, SELECTORS.fund, budgetUnits);
    push(officialAddress, SELECTORS.claimRefund, 0n);
  } else if (runtime.role === 'provider') {
    push(officialAddress, SELECTORS.setBudget, budgetUnits);
    push(officialAddress, SELECTORS.submit, 0n);
  } else if (runtime.role === 'evaluator') {
    push(officialAddress, SELECTORS.complete, 0n);
    push(officialAddress, SELECTORS.reject, 0n);
  }

  const tx = await runtime.account.setSessionSelectorPermissions(updates);
  await tx.wait();
  return {
    txHash: tx.hash,
    permissionCount: updates.length
  };
}

async function sendSessionExecute({
  provider,
  runtime,
  target,
  data,
  label,
  implementationAddress,
  factoryAddress
} = {}) {
  const sdk = buildAaSdk({
    proxyAddress: runtime.aaWallet,
    ownerAddress: runtime.ownerWallet.address,
    implementationAddress,
    factoryAddress
  });
  const actionId = ethers.keccak256(
    ethers.toUtf8Bytes(`${label}:${runtime.role}:${Date.now()}:${Math.random()}`)
  );
  const callData = sdk.account.interface.encodeFunctionData('executeWithSession', [
    runtime.sessionId,
    target,
    0n,
    data,
    actionId,
    '0x'
  ]);
  logStep(`submit ${label}`, {
    role: runtime.role,
    aaWallet: runtime.aaWallet,
    target,
    selector: data.slice(0, 10)
  });
  const submitResult = await sdk.sendRawCallDataUserOperation(
    callData,
    async (userOpHash) => runtime.sessionWallet.signMessage(ethers.getBytes(userOpHash))
  );
  if (submitResult?.status !== 'submitted' || !submitResult?.userOpHash) {
    logStep(`submit failed ${label}`, {
      status: normalizeText(submitResult?.status || ''),
      reason: normalizeText(submitResult?.reason || submitResult?.error?.message || '')
    });
    return {
      label,
      role: runtime.role,
      aaWallet: runtime.aaWallet,
      target,
      selector: data.slice(0, 10),
      actionId,
      status: normalizeText(submitResult?.status || ''),
      userOpHash: normalizeText(submitResult?.userOpHash || ''),
      transactionHash: normalizeText(submitResult?.transactionHash || ''),
      reason: normalizeText(submitResult?.reason || submitResult?.error?.message || '')
    };
  }
  logStep(`wait ${label}`, {
    userOpHash: submitResult.userOpHash,
    timeoutMs: USEROP_WAIT_TIMEOUT_MS
  });
  const result = await sdk.waitForUserOperationResult(submitResult.userOpHash, USEROP_WAIT_TIMEOUT_MS);
  logStep(`done ${label}`, {
    status: normalizeText(result?.status || ''),
    userOpHash: normalizeText(result?.userOpHash || ''),
    transactionHash: normalizeText(result?.transactionHash || '')
  });

  return {
    label,
    role: runtime.role,
    aaWallet: runtime.aaWallet,
    target,
    selector: data.slice(0, 10),
    actionId,
    status: normalizeText(result?.status || ''),
    userOpHash: normalizeText(result?.userOpHash || ''),
    transactionHash: normalizeText(result?.transactionHash || ''),
    reason: normalizeText(result?.reason || result?.error?.message || '')
  };
}

async function main() {
  requireValue('KITEAI_BUNDLER_URL', BUNDLER_URL);
  requireValue('KITE_SETTLEMENT_TOKEN', normalizeAddress(TOKEN_ADDRESS));
  requireValue('deployer private key', DEPLOYER_PRIVATE_KEY);

  const provider = createProvider();
  logStep('network ready', {
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    userOpWaitTimeoutMs: USEROP_WAIT_TIMEOUT_MS
  });
  const deployerWallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);
  const decimals = Number(await token.decimals());
  const budgetUnits = ethers.parseUnits(BUDGET_HUMAN, decimals);
  const proofTokenUnits = budgetUnits * TOKEN_MULTIPLIER;

  const compiledV3 = compileKTraceAccountV3SessionExecute();
  const compiledFactory = compileKTraceAccountFactory();
  const compiledOfficial = compileOfficialMinimalAgenticCommerce();

  const implementationFactory = new ethers.ContractFactory(
    compiledV3.abi,
    compiledV3.bytecode,
    deployerWallet
  );
  logStep('deploy implementation');
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  const factoryFactory = new ethers.ContractFactory(
    compiledFactory.abi,
    compiledFactory.bytecode,
    deployerWallet
  );
  logStep('deploy proof factory');
  const proofFactory = await factoryFactory.deploy(deployerWallet.address, implementationAddress);
  await proofFactory.waitForDeployment();
  const proofFactoryAddress = await proofFactory.getAddress();

  const officialFactory = new ethers.ContractFactory(
    compiledOfficial.abi,
    compiledOfficial.bytecode,
    deployerWallet
  );
  logStep('deploy official minimal erc8183');
  const official = await officialFactory.deploy(TOKEN_ADDRESS, deployerWallet.address);
  await official.waitForDeployment();
  const officialAddress = await official.getAddress();

  const saltBase = BigInt(Date.now());
  const requester = await deployProofAccount({
    provider,
    deployerWallet,
    factoryContract: proofFactory,
    implementationAddress,
    role: 'requester',
    salt: saltBase + 1n
  });
  const providerRuntime = await deployProofAccount({
    provider,
    deployerWallet,
    factoryContract: proofFactory,
    implementationAddress,
    role: 'provider',
    salt: saltBase + 2n
  });
  const evaluator = await deployProofAccount({
    provider,
    deployerWallet,
    factoryContract: proofFactory,
    implementationAddress,
    role: 'evaluator',
    salt: saltBase + 3n
  });

  const requesterFunding = await ensureTokenBalance({
    provider,
    token,
    deployerWallet,
    target: requester.aaWallet,
    amountRequired: proofTokenUnits
  });

  const [requesterPermissions, providerPermissions, evaluatorPermissions] = await Promise.all([
    configurePermissions({
      runtime: requester,
      officialAddress,
      budgetUnits,
      totalTokenUnits: proofTokenUnits
    }),
    configurePermissions({
      runtime: providerRuntime,
      officialAddress,
      budgetUnits,
      totalTokenUnits: proofTokenUnits
    }),
    configurePermissions({
      runtime: evaluator,
      officialAddress,
      budgetUnits,
      totalTokenUnits: proofTokenUnits
    })
  ]);

  const steps = [];
  const officialInterface = new ethers.Interface(compiledOfficial.abi);

  const recordStep = async (stepResult, jobId = 0) => {
    if (stepResult.status !== 'success') {
      throw new Error(`${stepResult.label} failed: ${stepResult.reason || 'unknown'}`);
    }
    const snapshot = jobId ? await readJobSnapshot(official, jobId) : null;
    steps.push({
      ...stepResult,
      job: snapshot
    });
    return snapshot;
  };

  const createData = officialInterface.encodeFunctionData('createJob', [
    ethers.ZeroAddress,
    evaluator.aaWallet,
    BigInt(Math.floor(Date.now() / 1000) + 3600),
    'AA V3 official ERC-8183 proof',
    ethers.ZeroAddress
  ]);
  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: requester,
      target: officialAddress,
      data: createData,
      label: 'requester-createJob',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    })
  );

  const jobId1 = Number(await official.jobCounter());

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: requester,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('setProvider', [jobId1, providerRuntime.aaWallet]),
      label: 'requester-setProvider',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId1
  );

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: providerRuntime,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('setBudget', [jobId1, budgetUnits, '0x']),
      label: 'provider-setBudget',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId1
  );

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: requester,
      target: TOKEN_ADDRESS,
      data: new ethers.Interface(TOKEN_ABI).encodeFunctionData('approve', [officialAddress, proofTokenUnits]),
      label: 'requester-approve',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    })
  );

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: requester,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('fund', [jobId1, '0x']),
      label: 'requester-fund',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId1
  );

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: providerRuntime,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('submit', [
        jobId1,
        ethers.keccak256(ethers.toUtf8Bytes('deliverable:positive')),
        '0x'
      ]),
      label: 'provider-submit',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId1
  );

  const positiveTerminal = await recordStep(
    await sendSessionExecute({
      provider,
      runtime: evaluator,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('complete', [
        jobId1,
        ethers.keccak256(ethers.toUtf8Bytes('complete:proof')),
        '0x'
      ]),
      label: 'evaluator-complete',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId1
  );

  const createRejectData = officialInterface.encodeFunctionData('createJob', [
    providerRuntime.aaWallet,
    evaluator.aaWallet,
    BigInt(Math.floor(Date.now() / 1000) + 3600),
    'AA V3 official ERC-8183 reject path proof',
    ethers.ZeroAddress
  ]);
  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: requester,
      target: officialAddress,
      data: createRejectData,
      label: 'requester-createJob-reject',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    })
  );
  const jobId2 = Number(await official.jobCounter());

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: providerRuntime,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('setBudget', [jobId2, budgetUnits, '0x']),
      label: 'provider-setBudget-reject',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId2
  );

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: requester,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('fund', [jobId2, '0x']),
      label: 'requester-fund-reject',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId2
  );

  await recordStep(
    await sendSessionExecute({
      provider,
      runtime: providerRuntime,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('submit', [
        jobId2,
        ethers.keccak256(ethers.toUtf8Bytes('deliverable:negative')),
        '0x'
      ]),
      label: 'provider-submit-reject',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId2
  );

  const negativeTerminal = await recordStep(
    await sendSessionExecute({
      provider,
      runtime: evaluator,
      target: officialAddress,
      data: officialInterface.encodeFunctionData('reject', [
        jobId2,
        ethers.keccak256(ethers.toUtf8Bytes('reject:proof')),
        '0x'
      ]),
      label: 'evaluator-reject',
      implementationAddress,
      factoryAddress: proofFactoryAddress
    }),
    jobId2
  );

  const summary = {
    chainId: String(network.chainId),
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    tokenAddress: TOKEN_ADDRESS,
    officialAddress,
    proofFactoryAddress,
    implementationAddress,
    defaultFactoryAddress: DEFAULT_FACTORY_ADDRESS,
    budgetHuman: BUDGET_HUMAN,
    budgetUnits: budgetUnits.toString(),
    proofTokenUnits: proofTokenUnits.toString(),
    requesterFunding,
    permissions: {
      requester: requesterPermissions,
      provider: providerPermissions,
      evaluator: evaluatorPermissions
    },
    accounts: {
      requester: {
        owner: requester.ownerWallet.address,
        aaWallet: requester.aaWallet,
        sessionAddress: requester.sessionWallet.address,
        sessionId: requester.sessionId,
        version: requester.version
      },
      provider: {
        owner: providerRuntime.ownerWallet.address,
        aaWallet: providerRuntime.aaWallet,
        sessionAddress: providerRuntime.sessionWallet.address,
        sessionId: providerRuntime.sessionId,
        version: providerRuntime.version
      },
      evaluator: {
        owner: evaluator.ownerWallet.address,
        aaWallet: evaluator.aaWallet,
        sessionAddress: evaluator.sessionWallet.address,
        sessionId: evaluator.sessionId,
        version: evaluator.version
      }
    },
    positivePathFinal: positiveTerminal,
    negativePathFinal: negativeTerminal,
    balances: {
      requesterAaToken: formatToken(await token.balanceOf(requester.aaWallet), decimals),
      providerAaToken: formatToken(await token.balanceOf(providerRuntime.aaWallet), decimals),
      evaluatorAaToken: formatToken(await token.balanceOf(evaluator.aaWallet), decimals)
    },
    steps
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[verify-official-erc8183-v3-proof] failed:', error?.message || String(error));
  process.exit(1);
});
