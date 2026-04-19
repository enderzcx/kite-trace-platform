#!/usr/bin/env node
/**
 * Minimal test: single-rule session + direct executeTransferWithAuthorizationAndProvider
 * on HashKey testnet (chain 133).
 */
import { ethers } from 'ethers';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';

const RPC_URL = 'https://testnet.hsk.xyz';
const CHAIN_ID = 133;
const ENTRYPOINT = '0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598';
const IMPL = '0x2DbBfCdAd28b3A2094BD634Cce4326B1b3D0595C';
const USDT = '0xDC52db3E9e17d9BE1A457d3fA455f68b52c38e2e';
const AA_A = '0xf9D24F2D1679564aCF289ab2D71C491658145e09';
const MERCHANT = '0x09e116d198318eec9402893f00958123e980521b';

const OWNER_KEY_A = process.env.AGENT_A_OWNER_KEY;
if (!OWNER_KEY_A) { console.error('AGENT_A_OWNER_KEY required'); process.exit(1); }

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: 'hashkey' });
  const ownerA = new ethers.Wallet(OWNER_KEY_A, provider);
  console.log('Owner A:', ownerA.address);

  // Check AA wallet USDT balance
  const usdt = new ethers.Contract(USDT, ['function balanceOf(address) view returns (uint256)'], provider);
  const bal = await usdt.balanceOf(AA_A);
  console.log('AA USDT balance:', ethers.formatUnits(bal, 6));

  // Create session wallet
  const sessionWallet = ethers.Wallet.createRandom();
  console.log('Session wallet:', sessionWallet.address);

  // Create session on-chain: single rule, timeWindow=0, budget=1000 USDT (6 decimals)
  const aaContract = new ethers.Contract(AA_A, [
    'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
    'function addSupportedToken(address token) external',
    'function executeTransferWithAuthorizationAndProvider(bytes32 sessionId, (address from,address to,address token,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce) auth, bytes signature, bytes32 serviceProvider, bytes metadata) external'
  ], ownerA);

  const sessionId = ethers.keccak256(ethers.toUtf8Bytes(`test-session-${Date.now()}`));
  console.log('Session ID:', sessionId.slice(0, 18) + '...');

  // Budget: 1000 USDT raw units = 1000 * 1e6 = 1e9. This is within uint160.
  const budgetRaw = ethers.parseUnits('1000', 6); // 6 decimals matching MockUSDT
  console.log('Budget raw:', budgetRaw.toString(), '(1000 USDT)');

  const rules = [
    { timeWindow: 0n, budget: budgetRaw, initialWindowStartTime: 0n, targetProviders: [] }
  ];

  console.log('Creating session...');
  try {
    const tx = await aaContract.createSession(sessionId, sessionWallet.address, rules);
    const receipt = await tx.wait(1, 60000);
    console.log('Session created, tx:', receipt.status === 1 ? 'SUCCESS' : 'FAILED', receipt.hash);
  } catch (e) {
    console.error('Session creation failed:', e.message?.slice(0, 300));
    process.exit(1);
  }

  // Build transfer authorization
  const amountRaw = ethers.parseUnits('0.0001', 6); // 100 raw units
  const nowSec = Math.floor(Date.now() / 1000);
  const serviceProvider = ethers.keccak256(ethers.toUtf8Bytes('x402_payment:test'));

  const authPayload = {
    from: AA_A,
    to: MERCHANT,
    token: USDT,
    value: amountRaw,
    validAfter: BigInt(Math.max(0, nowSec - 60)),
    validBefore: BigInt(nowSec + 600),
    nonce: ethers.hexlify(ethers.randomBytes(32))
  };

  // Sign with session wallet using EIP-712
  const sdk = new GokiteAASDK({
    network: 'hashkey_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: RPC_URL,
    entryPointAddress: ENTRYPOINT,
    accountImplementationAddress: IMPL,
    proxyAddress: AA_A,
    bundlerRpcTimeoutMs: 35000
  });

  console.log('Signing transfer authorization...');
  const authSignature = await sdk.buildTransferAuthorizationSignature(sessionWallet, authPayload);
  console.log('Auth signature:', authSignature.slice(0, 20) + '...');

  // Direct call
  console.log('Calling executeTransferWithAuthorizationAndProvider directly...');
  try {
    const tx = await aaContract.executeTransferWithAuthorizationAndProvider(
      sessionId,
      [authPayload.from, authPayload.to, authPayload.token, authPayload.value, authPayload.validAfter, authPayload.validBefore, authPayload.nonce],
      authSignature,
      serviceProvider,
      '0x',
      { gasLimit: 500000n }
    );
    console.log('TX sent:', tx.hash);
    const receipt = await tx.wait(1, 120000);
    console.log('TX result:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');
    if (receipt.status === 1) {
      console.log('Block:', receipt.blockNumber);
      console.log('Gas used:', receipt.gasUsed.toString());
      console.log(`Explorer: https://testnet-explorer.hsk.xyz/tx/${tx.hash}`);
    }
  } catch (e) {
    console.error('Payment failed:', e.message?.slice(0, 500));
    if (e.data) console.error('Revert data:', e.data);
  }

  // Check final USDT balance
  const balAfter = await usdt.balanceOf(AA_A);
  console.log('AA USDT balance after:', ethers.formatUnits(balAfter, 6));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });