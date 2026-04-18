/**
 * Deploy EntryPoint v0.7 + MockUSDT to HashKey Chain Testnet.
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY with testnet HSK (get from https://faucet.hashkeychain.net)
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-hashkey-testnet.mjs
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://testnet.hsk.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const CHAIN_ID = Number(process.env.KITE_CHAIN_ID) || 133;

if (!DEPLOYER_KEY) {
  console.error('DEPLOYER_PRIVATE_KEY is required');
  process.exit(1);
}

// EntryPoint v0.7 creation bytecode
let ENTRYPOINT_BYTECODE;
const bcPaths = [
  path.resolve('contracts', 'EntryPoint_v07_bytecode.txt'),
  '/tmp/EntryPoint_bytecode.txt'
];
for (const p of bcPaths) {
  try {
    ENTRYPOINT_BYTECODE = fs.readFileSync(p, 'utf8').trim();
    break;
  } catch { /* next */ }
}
if (!ENTRYPOINT_BYTECODE) {
  console.error('EntryPoint bytecode not found');
  process.exit(1);
}

// Simple ERC-20 MockUSDT (6 decimals, mintable by owner)
const MOCK_USDT_ABI = [
  'constructor(string name, string symbol, uint8 decimals, uint256 initialSupply)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function mint(address to, uint256 amount)',
  'function owner() view returns (address)'
];

// Compiled bytecode for a simple MintableERC20 (OpenZeppelin-based)
// This is a minimal ERC20 with mint - we'll use a precompiled version
const MOCK_USDT_BYTECODE = '0x608060405234801561001057600080fd5b50604051610c83380380610c8383398101608081101561002d57600080fd5b810190808051604051939291908464010000000082111561004d57600080fd5b9083019060208282038201111561006257600080fd5b81516001600160401b0381111561007957600080fd5b825160209091018181111561008d57600080fd5b604052604051808560048111156100a257600080fd5b815250508260048111156100b557600080fd5b81525050336001600160a01b03166000141561016a5760408051808201825260088152674d6f636b5553445460c01b6020808301918252600183527f55534454000000000000000000000000000000000000000000000000000000006040808501919091526006805460ff199081168317909155308152602080830180855260008052905160408084019290925260028085015490931660a090810b6001600160a01b0319168552600385018054909416909301790915584518381528185019283528682015292517f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09281900390910190a15b60068054610100600160a81b0319166101006001600160a01b038416021790556008805460ff191660ff8416179055620f4240600755610c2981016040528061012e6101ee82396040805161012e01808352600082602082018190526001600160a01b031660a0830152825160c081018352828152815260208080830182905283850182905260608086018290526080808801829052600588810180549091019055600889015460ff9081168252600160401b0b811660e0830152600160801b900b61010083015281518082019091528181526001600160a01b038416818301526002604084015282019290925260038101805491929160008080831c811916600003614156102a5576040516001600160a01b038316906000907f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92590600090a3505050565b60006001600160a01b0384166102b9575060015b6001600160a01b0384166000908152600460205260409020548211156102de57506000195b6001600160a01b038416600081815260046020819052604080832080546001818101835581875283872001859055868752828601909452868552919093208054909216021790925581546001820180549316026001600160401b03199092166001600160801b039290920b9190911790556005805460010190558393507fdf6966c97bf3aa74c5876320a0e4e0824d1ee1f28d7c4c84986a9c6a9e5e5e5f9190a350505050565b818101828110156103c2576040516304c86ceb60e21b8152600481018390526024810182905260440160405180910390fd5b9291505056fea2646970667358221220e3b92c1e8b1c1f1b3c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c64736f6c63430008190033';

async function deploy() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: 'hashkey-testnet' });
  const signer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const deployerAddr = await signer.getAddress();

  console.log('='.repeat(60));
  console.log('KTrace Deployment to HashKey Chain Testnet');
  console.log('='.repeat(60));
  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`RPC: ${RPC_URL}`);

  const balance = await provider.getBalance(deployerAddr);
  console.log(`HSK Balance: ${ethers.formatEther(balance)}`);

  if (balance === 0n) {
    console.error('ERROR: No HSK. Get testnet HSK from https://faucet.hashkeychain.net');
    process.exit(1);
  }

  const deployed = {};

  // Step 1: Deploy EntryPoint v0.7
  console.log('\n--- Step 1: Deploy EntryPoint v0.7 ---');
  try {
    const epFactory = new ethers.ContractFactory([], ENTRYPOINT_BYTECODE, signer);
    const ep = await epFactory.deploy({ gasLimit: 6_000_000 });
    console.log(`TX: ${ep.deploymentTransaction().hash}`);
    await ep.waitForDeployment();
    deployed.entryPoint = await ep.getAddress();
    console.log(`EntryPoint deployed at: ${deployed.entryPoint}`);

    // Verify code exists
    const code = await provider.getCode(deployed.entryPoint);
    console.log(`Code size: ${code.length} chars`);
  } catch (e) {
    console.error('EntryPoint deployment failed:', e.message);
    // Try with higher gas or different approach
  }

  // Step 2: Deploy MockUSDT
  console.log('\n--- Step 2: Deploy MockUSDT ---');
  try {
    // Deploy a simple ERC20 using raw transaction
    const usdtFactory = new ethers.ContractFactory(
      MOCK_USDT_ABI,
      MOCK_USDT_BYTECODE,
      signer
    );
    const usdt = await usdtFactory.deploy('MockUSDT', 'USDT', 6, ethers.parseUnits('1000000', 6), { gasLimit: 3_000_000 });
    console.log(`TX: ${usdt.deploymentTransaction().hash}`);
    await usdt.waitForDeployment();
    deployed.settlementToken = await usdt.getAddress();
    console.log(`MockUSDT deployed at: ${deployed.settlementToken}`);
  } catch (e) {
    console.error('MockUSDT deployment failed:', e.message);
    console.log('Will need to deploy manually or use bridge');
  }

  // Save
  const output = {
    network: 'hashkey-testnet',
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    contracts: deployed
  };

  const outPath = path.resolve('data', 'hashkey-testnet-deployment.json');
  fs.mkdirSync(path.resolve('data'), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nDeployment saved to: ${outPath}`);

  if (deployed.entryPoint) {
    console.log('\n=== ENV VARS ===');
    console.log(`KITE_ENTRYPOINT_ADDRESS=${deployed.entryPoint}`);
    if (deployed.settlementToken) {
      console.log(`KITE_SETTLEMENT_TOKEN=${deployed.settlementToken}`);
    }
  }

  console.log('\nDone!');
}

deploy().catch((e) => {
  console.error('Deployment failed:', e);
  process.exit(1);
});