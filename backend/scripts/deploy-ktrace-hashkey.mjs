/**
 * Compile and deploy KTrace contracts to HashKey Chain Testnet.
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY env var (deployer private key with testnet HSK)
 *   - node_modules with solc + @openzeppelin/contracts installed
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-ktrace-hashkey.mjs
 *
 * Deploy order:
 *   1. IdentityRegistryV1
 *   2. TrustPublicationAnchorV1
 *   3. JobLifecycleAnchorV2
 *   4. TraceAnchorGuard
 *   5. JobEscrowV4
 *   6. KTraceAccountV3SessionExecute (implementation)
 *   7. ERC1967Proxy (pointing to #6, then initialize)
 *   8. KTraceAccountFactory
 */

import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { ethers } from 'ethers';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const RPC_URL = process.env.KITEAI_RPC_URL || 'https://testnet.hsk.xyz';
const CHAIN_ID = Number(process.env.KITE_CHAIN_ID) || 133;
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const ENTRY_POINT = '0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598';
const SETTLEMENT_TOKEN = '0xDC52db3E9e17d9BE1A457d3fA455f68b52c38e2e';
const GAS_LIMIT_MULTIPLIER = 1.3; // 30% buffer on estimated gas

const CONTRACT_DIR = path.resolve(__dirname, '..', 'contracts');
const NODE_MODULES = path.resolve(__dirname, '..', 'node_modules');
const DATA_DIR = path.resolve(__dirname, '..', 'data');

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_PRIVATE_KEY env var is required');
  process.exit(1);
}

// --- Import resolver for solc ---
function resolveImport(importPath) {
  const normalized = String(importPath || '').trim();

  // Relative imports (e.g. "./ITraceAnchorGuard.sol")
  const localCandidate = path.resolve(CONTRACT_DIR, normalized.replace(/^\.\//, ''));
  if (fs.existsSync(localCandidate)) {
    return { contents: fs.readFileSync(localCandidate, 'utf8') };
  }

  // @openzeppelin and other node_modules imports
  const nodeModuleCandidate = path.resolve(NODE_MODULES, normalized);
  if (fs.existsSync(nodeModuleCandidate)) {
    return { contents: fs.readFileSync(nodeModuleCandidate, 'utf8') };
  }

  return { error: `File not found: ${normalized}` };
}

// --- Compilation ---
function compileContract(filename, contractName, opts = {}) {
  const sourcePath = path.resolve(CONTRACT_DIR, filename);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const sources = {};
  sources[filename] = { content: fs.readFileSync(sourcePath, 'utf8') };

  // For TraceAnchorGuard, include the interface explicitly
  if (filename === 'TraceAnchorGuard.sol') {
    const ifacePath = path.resolve(CONTRACT_DIR, 'ITraceAnchorGuard.sol');
    sources['ITraceAnchorGuard.sol'] = { content: fs.readFileSync(ifacePath, 'utf8') };
    sources['./ITraceAnchorGuard.sol'] = sources['ITraceAnchorGuard.sol'];
  }

  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      ...(opts.viaIR ? { viaIR: true } : {}),
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const messages = Array.isArray(output?.errors) ? output.errors : [];
  const errors = messages.filter((item) => item?.severity === 'error');
  if (errors.length) {
    const errorText = errors
      .map((item) => item.formattedMessage || item.message || String(item))
      .join('\n\n');
    throw new Error(`Compilation failed for ${contractName}:\n${errorText}`);
  }

  const contract = output?.contracts?.[filename]?.[contractName];
  if (!contract?.evm?.bytecode?.object) {
    throw new Error(`${contractName} compilation did not produce bytecode.`);
  }

  const warnings = messages
    .filter((item) => item?.severity !== 'error')
    .map((item) => item.formattedMessage || item.message || String(item));

  return {
    contractName,
    abi: contract.abi || [],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object || ''}`,
    warnings
  };
}

// --- Deployment helper ---
async function deployContract(signer, provider, compiled, constructorArgs, label) {
  console.log(`\n--- Deploying ${label} ---`);
  console.log(`  Bytecode size: ${Math.max(0, (compiled.bytecode.length - 2) / 2)} bytes`);

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, signer);

  // Estimate gas
  const deployTx = await factory.getDeployTransaction(...constructorArgs);
  let gasLimit;
  try {
    gasLimit = await provider.estimateGas(deployTx);
    gasLimit = Math.ceil(Number(gasLimit) * GAS_LIMIT_MULTIPLIER);
  } catch (estimateErr) {
    console.log(`  Gas estimation failed (${estimateErr.message}), using fallback`);
    gasLimit = 6_000_000;
  }
  console.log(`  Gas limit: ${gasLimit}`);

  const contract = await factory.deploy(...constructorArgs, { gasLimit });
  const txHash = contract.deploymentTransaction().hash;
  console.log(`  TX: ${txHash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  Deployed at: ${address}`);

  // Verify code deployed
  const code = await provider.getCode(address);
  if (code === '0x') {
    throw new Error(`No code at ${address} after deployment - deployment may have reverted`);
  }
  console.log(`  Code size: ${code.length} chars`);

  return { address, txHash };
}

// --- Send transaction helper (for initialize call on proxy) ---
async function sendTransaction(signer, provider, to, data, label) {
  console.log(`\n--- ${label} ---`);

  const tx = await signer.sendTransaction({ to, data, gasLimit: 2_000_000 });
  console.log(`  TX: ${tx.hash}`);

  const receipt = await tx.wait();
  if (receipt.status === 0) {
    throw new Error(`Transaction reverted: ${tx.hash}`);
  }
  console.log(`  Confirmed in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);

  return receipt;
}

// --- Main deployment ---
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: 'hashkey-testnet' });
  const signer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const deployerAddr = await signer.getAddress();

  console.log('='.repeat(60));
  console.log('KTrace Full Deployment to HashKey Chain Testnet');
  console.log('='.repeat(60));
  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`EntryPoint: ${ENTRY_POINT}`);
  console.log(`Settlement Token: ${SETTLEMENT_TOKEN}`);

  const balance = await provider.getBalance(deployerAddr);
  console.log(`HSK Balance: ${ethers.formatEther(balance)}`);
  if (balance === 0n) {
    console.error('ERROR: No HSK. Get testnet HSK from https://faucet.hashkeychain.net');
    process.exit(1);
  }

  const deployed = {};
  const txHashes = {};

  // ============================================================
  // Step 1: Compile all contracts
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Phase 1: Compilation');
  console.log('='.repeat(60));

  const compilations = {};
  const compileTargets = [
    ['IdentityRegistryV1.sol', 'IdentityRegistryV1', {}],
    ['TrustPublicationAnchorV1.sol', 'TrustPublicationAnchorV1', { viaIR: true }],
    ['JobLifecycleAnchorV2.sol', 'JobLifecycleAnchorV2', { viaIR: true }],
    ['TraceAnchorGuard.sol', 'TraceAnchorGuard', { viaIR: true }],
    ['JobEscrowV4.sol', 'JobEscrowV4', { viaIR: true }],
    ['KTraceAccountV3SessionExecute.sol', 'KTraceAccountV3SessionExecute', {}],
    ['KTraceAccountFactory.sol', 'KTraceAccountFactory', {}]
  ];

  for (const [filename, contractName, opts] of compileTargets) {
    console.log(`Compiling ${contractName}...`);
    try {
      compilations[contractName] = compileContract(filename, contractName, opts);
      console.log(`  OK - ${compilations[contractName].abi.length} ABI items, ${compilations[contractName].warnings.length} warnings`);
      if (compilations[contractName].warnings.length > 0) {
        compilations[contractName].warnings.forEach((w) => console.log(`    WARN: ${w}`));
      }
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      throw err;
    }
  }

  // ============================================================
  // Step 2: Deploy in dependency order
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Phase 2: Deployment');
  console.log('='.repeat(60));

  // --- 1. IdentityRegistryV1 ---
  {
    const c = compilations.IdentityRegistryV1;
    const result = await deployContract(signer, provider, c, [
      'KTraceAgent',    // name
      'KTA',            // symbol
      deployerAddr,     // initialOwner
      0,                // registerFee
      0                 // metadataUpdateFee
    ], 'IdentityRegistryV1');
    deployed.identityRegistry = result.address;
    txHashes.identityRegistry = result.txHash;
  }

  // --- 2. TrustPublicationAnchorV1 ---
  {
    const c = compilations.TrustPublicationAnchorV1;
    const result = await deployContract(signer, provider, c, [
      deployerAddr,           // initialOwner
      deployed.identityRegistry  // identityRegistry
    ], 'TrustPublicationAnchorV1');
    deployed.trustPublicationAnchor = result.address;
    txHashes.trustPublicationAnchor = result.txHash;
  }

  // --- 3. JobLifecycleAnchorV2 ---
  {
    const c = compilations.JobLifecycleAnchorV2;
    const result = await deployContract(signer, provider, c, [
      deployerAddr  // initialOwner
    ], 'JobLifecycleAnchorV2');
    deployed.jobLifecycleAnchor = result.address;
    txHashes.jobLifecycleAnchor = result.txHash;
  }

  // --- 4. TraceAnchorGuard ---
  {
    const c = compilations.TraceAnchorGuard;
    const result = await deployContract(signer, provider, c, [
      deployed.jobLifecycleAnchor  // registry (JobLifecycleAnchorV2 address)
    ], 'TraceAnchorGuard');
    deployed.traceAnchorGuard = result.address;
    txHashes.traceAnchorGuard = result.txHash;
  }

  // --- 5. JobEscrowV4 ---
  {
    const c = compilations.JobEscrowV4;
    const result = await deployContract(signer, provider, c, [
      SETTLEMENT_TOKEN,  // settlementToken
      deployerAddr       // initialOwner
    ], 'JobEscrowV4');
    deployed.jobEscrow = result.address;
    txHashes.jobEscrow = result.txHash;
  }

  // --- 6. KTraceAccountV3SessionExecute (implementation) ---
  // UUPS pattern: constructor() disables initializers
  {
    const c = compilations.KTraceAccountV3SessionExecute;
    const result = await deployContract(signer, provider, c, [], 'KTraceAccountV3SessionExecute (implementation)');
    deployed.accountImplementation = result.address;
    txHashes.accountImplementation = result.txHash;
  }

  // --- 7. ERC1967Proxy for KTraceAccountV3SessionExecute ---
  // UUPS proxy pattern: deploy implementation, then deploy ERC1967Proxy with initData
  {
    console.log('\n--- Deploying ERC1967Proxy for KTraceAccountV3SessionExecute ---');

    // Build initialize calldata: initialize(address owner_, address entryPoint_)
    const implAbi = compilations.KTraceAccountV3SessionExecute.abi;
    const iface = new ethers.Interface(implAbi);
    const initData = iface.encodeFunctionData('initialize', [deployerAddr, ENTRY_POINT]);

    // Compile ERC1967Proxy from OpenZeppelin using the same resolveImport
    const proxySourcePath = path.resolve(
      NODE_MODULES,
      '@openzeppelin', 'contracts', 'proxy', 'ERC1967', 'ERC1967Proxy.sol'
    );
    const proxySource = fs.readFileSync(proxySourcePath, 'utf8');

    const proxyInput = {
      language: 'Solidity',
      sources: {
        '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol': { content: proxySource }
      },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode.object']
          }
        }
      }
    };

    const proxyOutput = JSON.parse(solc.compile(JSON.stringify(proxyInput), { import: resolveImport }));
    const proxyErrors = (proxyOutput.errors || []).filter((e) => e.severity === 'error');
    if (proxyErrors.length) {
      throw new Error(`ERC1967Proxy compilation failed: ${proxyErrors.map((e) => e.message).join('\n')}`);
    }

    // Find the compiled contract - key may match the source key
    const proxyKey = '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';
    let proxyCompiled = proxyOutput.contracts?.[proxyKey]?.ERC1967Proxy;
    // Fallback: search all contract keys
    if (!proxyCompiled) {
      for (const sourceKey of Object.keys(proxyOutput.contracts || {})) {
        if (proxyOutput.contracts[sourceKey].ERC1967Proxy) {
          proxyCompiled = proxyOutput.contracts[sourceKey].ERC1967Proxy;
          break;
        }
      }
    }
    if (!proxyCompiled?.evm?.bytecode?.object) {
      throw new Error('ERC1967Proxy compilation did not produce bytecode.');
    }

    const proxyBytecode = `0x${proxyCompiled.evm.bytecode.object}`;
    const proxyAbi = proxyCompiled.abi;
    console.log(`  Proxy bytecode size: ${Math.max(0, (proxyBytecode.length - 2) / 2)} bytes`);

    // Deploy proxy: constructor(address _implementation, bytes memory _data)
    const proxyFactory = new ethers.ContractFactory(proxyAbi, proxyBytecode, signer);
    let proxyGas;
    try {
      const proxyDeployTx = await proxyFactory.getDeployTransaction(deployed.accountImplementation, initData);
      proxyGas = await provider.estimateGas(proxyDeployTx);
      proxyGas = Math.ceil(Number(proxyGas) * GAS_LIMIT_MULTIPLIER);
    } catch (err) {
      console.log(`  Gas estimation failed (${err.message}), using fallback`);
      proxyGas = 2_000_000;
    }
    console.log(`  Gas limit: ${proxyGas}`);

    const proxy = await proxyFactory.deploy(deployed.accountImplementation, initData, { gasLimit: proxyGas });
    const proxyTxHash = proxy.deploymentTransaction().hash;
    console.log(`  TX: ${proxyTxHash}`);

    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    console.log(`  Proxy deployed at: ${proxyAddress}`);

    // Verify the proxy has code
    const proxyCode = await provider.getCode(proxyAddress);
    if (proxyCode === '0x') {
      throw new Error(`No code at proxy address ${proxyAddress}`);
    }

    deployed.accountProxy = proxyAddress;
    txHashes.accountProxy = proxyTxHash;

    // Verify initialization by calling owner() and entryPoint() on the proxy
    const proxyContract = new ethers.Contract(proxyAddress, implAbi, provider);
    const proxyOwner = await proxyContract.owner().catch(() => null);
    const proxyEntryPoint = await proxyContract.entryPoint().catch(() => null);
    console.log(`  Proxy owner: ${proxyOwner || 'N/A'}`);
    console.log(`  Proxy entryPoint: ${proxyEntryPoint || 'N/A'}`);

    if (proxyOwner && proxyOwner.toLowerCase() !== deployerAddr.toLowerCase()) {
      console.warn(`  WARNING: Proxy owner mismatch. Expected ${deployerAddr}, got ${proxyOwner}`);
    }
    if (proxyEntryPoint && proxyEntryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) {
      console.warn(`  WARNING: Proxy entryPoint mismatch. Expected ${ENTRY_POINT}, got ${proxyEntryPoint}`);
    }
  }

  // --- 8. KTraceAccountFactory ---
  {
    const c = compilations.KTraceAccountFactory;
    const result = await deployContract(signer, provider, c, [
      deployerAddr,              // initialOwner
      deployed.accountImplementation  // initialImplementation
    ], 'KTraceAccountFactory');
    deployed.accountFactory = result.address;
    txHashes.accountFactory = result.txHash;
  }

  // ============================================================
  // Step 3: Post-deployment setup
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Phase 3: Post-deployment Setup');
  console.log('='.repeat(60));

  // Set TraceAnchorGuard on JobEscrowV4 (initial set, no guard set yet)
  {
    console.log('\n--- Setting TraceAnchorGuard on JobEscrowV4 ---');
    const escrowAbi = compilations.JobEscrowV4.abi;
    const escrow = new ethers.Contract(deployed.jobEscrow, escrowAbi, signer);
    const tx = await escrow.setTraceAnchorGuard(deployed.traceAnchorGuard, { gasLimit: 500_000 });
    console.log(`  TX: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status === 0) {
      console.warn('  WARNING: setTraceAnchorGuard reverted');
    } else {
      console.log(`  Confirmed. Guard set to ${deployed.traceAnchorGuard}`);
    }
  }

  // ============================================================
  // Step 4: Save deployment data
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Phase 4: Save Deployment Data');
  console.log('='.repeat(60));

  const deploymentData = {
    network: 'hashkey-testnet',
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    contracts: {
      identityRegistry: deployed.identityRegistry,
      trustPublicationAnchor: deployed.trustPublicationAnchor,
      jobLifecycleAnchor: deployed.jobLifecycleAnchor,
      traceAnchorGuard: deployed.traceAnchorGuard,
      jobEscrow: deployed.jobEscrow,
      accountImplementation: deployed.accountImplementation,
      accountProxy: deployed.accountProxy,
      accountFactory: deployed.accountFactory
    },
    external: {
      entryPoint: ENTRY_POINT,
      settlementToken: SETTLEMENT_TOKEN
    },
    txHashes,
    compilationWarnings: Object.fromEntries(
      Object.entries(compilations).map(([name, c]) => [name, c.warnings.length])
    )
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outPath = path.resolve(DATA_DIR, 'ktrace-hashkey-deployment.json');
  fs.writeFileSync(outPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment saved to: ${outPath}`);

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Deployment Summary');
  console.log('='.repeat(60));
  console.log(`IdentityRegistryV1:        ${deployed.identityRegistry}`);
  console.log(`TrustPublicationAnchorV1:  ${deployed.trustPublicationAnchor}`);
  console.log(`JobLifecycleAnchorV2:      ${deployed.jobLifecycleAnchor}`);
  console.log(`TraceAnchorGuard:          ${deployed.traceAnchorGuard}`);
  console.log(`JobEscrowV4:               ${deployed.jobEscrow}`);
  console.log(`KTraceAccountV3 Impl:      ${deployed.accountImplementation}`);
  console.log(`KTraceAccountV3 Proxy:     ${deployed.accountProxy}`);
  console.log(`KTraceAccountFactory:      ${deployed.accountFactory}`);

  console.log('\n=== ENV VARS ===');
  console.log(`KITE_IDENTITY_REGISTRY=${deployed.identityRegistry}`);
  console.log(`KITE_TRUST_PUBLICATION_ANCHOR=${deployed.trustPublicationAnchor}`);
  console.log(`KITE_JOB_LIFECYCLE_ANCHOR=${deployed.jobLifecycleAnchor}`);
  console.log(`KITE_TRACE_ANCHOR_GUARD=${deployed.traceAnchorGuard}`);
  console.log(`KITE_JOB_ESCROW=${deployed.jobEscrow}`);
  console.log(`KITE_AA_ACCOUNT_IMPLEMENTATION=${deployed.accountImplementation}`);
  console.log(`KITE_AA_ACCOUNT_PROXY=${deployed.accountProxy}`);
  console.log(`KITE_AA_FACTORY=${deployed.accountFactory}`);
  console.log(`KITE_ENTRYPOINT_ADDRESS=${ENTRY_POINT}`);
  console.log(`KITE_SETTLEMENT_TOKEN=${SETTLEMENT_TOKEN}`);

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('\nFATAL: Deployment failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});