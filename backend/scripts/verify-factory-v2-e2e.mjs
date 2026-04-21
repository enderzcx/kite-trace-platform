#!/usr/bin/env node
/**
 * Factory V2 End-to-End Validator
 *
 * Proves the full session-key payment flow works with fresh AA wallets
 * deployed through KTraceAccountFactoryV2:
 *
 *   1. Fresh owner EOA (random)
 *   2. factory.createAccount(owner, salt) -> UUPS proxy deployed + initialized
 *   3. Owner registers session key + spending rule on the AA
 *   4. Fund the AA with MockUSDT
 *   5. Session key signs EIP-712 TransferAuthorization
 *   6. Relayer submits executeTransferWithAuthorizationAndProvider directly
 *   7. Verify SessionPaymentExecuted event + MockUSDT moved
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... node scripts/verify-factory-v2-e2e.mjs
 *
 * The deployer key pays gas for factory.createAccount, owner tx for
 * session setup, and the relayer direct-call. Owner key is reused as deployer
 * to keep the test self-contained.
 */

import { ethers } from 'ethers';

const RPC_URL = process.env.KITE_RPC_URL || 'https://testnet.hsk.xyz';
const FACTORY_V2 = process.env.HASHKEY_AA_FACTORY_ADDRESS || '0x452bf276B9c93DeF81B6087D78228E2980425D86';
const ENTRY_POINT = '0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598';
const SETTLEMENT_TOKEN = '0xDC52db3E9e17d9BE1A457d3fA455f68b52c38e2e';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_PRIVATE_KEY env var required');
  process.exit(1);
}

const FACTORY_ABI = [
  'function createAccount(address owner, uint256 salt) returns (address)',
  'function getAddress(address owner, uint256 salt) view returns (address)',
  'function entryPoint() view returns (address)'
];

const AA_ABI = [
  'function owner() view returns (address)',
  'function entryPoint() view returns (address)',
  'function addSupportedToken(address token)',
  'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)[] rules)',
  'function sessionExists(bytes32 sessionId) view returns (bool)',
  'function getSessionAgent(bytes32 sessionId) view returns (address)',
  'function executeTransferWithAuthorizationAndProvider(bytes32 sessionId, tuple(address from, address to, address token, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce) auth, bytes signature, bytes32 serviceProvider, bytes metadata)',
  'function DOMAIN_NAME() pure returns (string)',
  'function DOMAIN_VERSION() pure returns (string)',
  'event SessionCreated(bytes32 indexed sessionId, address indexed agent, uint256 ruleCount)',
  'event SessionPaymentExecuted(bytes32 indexed sessionId, address indexed token, address indexed recipient, uint256 amount, bytes32 serviceProvider, bytes32 authorizationNonce)'
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const log = {
  step: (n, m) => console.log(`\n\x1b[36m[Step ${n}]\x1b[0m ${m}`),
  ok: (m) => console.log(`  \x1b[32m✅\x1b[0m ${m}`),
  info: (m) => console.log(`  \x1b[90m→\x1b[0m ${m}`),
  fail: (m) => { console.error(`  \x1b[31m❌\x1b[0m ${m}`); process.exit(1); }
};

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 133, name: 'hashkey-testnet' });
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);

  console.log('='.repeat(70));
  console.log('Factory V2 E2E Validator');
  console.log('='.repeat(70));
  console.log(`Factory V2:    ${FACTORY_V2}`);
  console.log(`EntryPoint:    ${ENTRY_POINT}`);
  console.log(`Token:         ${SETTLEMENT_TOKEN}`);
  console.log(`Deployer:      ${deployer.address}`);
  console.log(`Balance:       ${ethers.formatEther(await provider.getBalance(deployer.address))} HSK`);

  // ── Step 1: Create fresh session wallet (agent's signing key) ──────────────
  log.step(1, 'Create fresh session key (simulates agent B signing key)');
  const sessionWallet = ethers.Wallet.createRandom().connect(provider);
  log.info(`session agent address: ${sessionWallet.address}`);

  // ── Step 2: Deploy fresh AA wallet via factory V2 ──────────────────────────
  log.step(2, 'Deploy fresh AA wallet via factory.createAccount');
  const factory = new ethers.Contract(FACTORY_V2, FACTORY_ABI, deployer);
  const saltHex = ethers.id(`e2e-${Date.now()}-${Math.random()}`);
  const salt = BigInt(saltHex);
  const predictedAA = await factory['getAddress(address,uint256)'](deployer.address, salt);
  log.info(`salt: ${saltHex.slice(0, 20)}...`);
  log.info(`predicted AA: ${predictedAA}`);

  const createTx = await factory.createAccount(deployer.address, salt, { gasLimit: 2_000_000n });
  const createReceipt = await createTx.wait();
  if (createReceipt.status !== 1) log.fail(`createAccount reverted: ${createTx.hash}`);
  const aaCode = await provider.getCode(predictedAA);
  if (aaCode === '0x') log.fail(`No code at ${predictedAA}`);
  log.ok(`AA deployed at ${predictedAA} (${(aaCode.length - 2) / 2} bytes)`);
  log.info(`tx: ${createTx.hash}`);

  // ── Step 3: Verify AA initialization ───────────────────────────────────────
  log.step(3, 'Verify AA initialization (owner + entryPoint)');
  const aa = new ethers.Contract(predictedAA, AA_ABI, deployer);
  const aaOwner = await aa.owner();
  const aaEp = await aa.entryPoint();
  log.info(`AA.owner(): ${aaOwner}`);
  log.info(`AA.entryPoint(): ${aaEp}`);
  if (aaOwner.toLowerCase() !== deployer.address.toLowerCase()) log.fail(`owner mismatch`);
  if (aaEp.toLowerCase() !== ENTRY_POINT.toLowerCase()) log.fail(`entryPoint mismatch`);
  log.ok('AA correctly initialized');

  // ── Step 4: Register settlement token as supported ─────────────────────────
  log.step(4, 'Register MockUSDT as supported token on AA');
  const tokenRegTx = await aa.addSupportedToken(SETTLEMENT_TOKEN, { gasLimit: 200_000n });
  await tokenRegTx.wait();
  log.ok(`supported token registered: tx ${tokenRegTx.hash}`);

  // ── Step 5: Create session with spending rule ──────────────────────────────
  log.step(5, 'Create session on AA with spending rule');
  const sessionId = ethers.id(`session-${Date.now()}`);
  // Rule: timeWindow=0 (per-tx cap), budget=0.01 USDT (6 decimals = 10000), any provider
  const rules = [{
    timeWindow: 0,
    budget: 10000n,
    initialWindowStartTime: 0,
    targetProviders: []
  }];
  const createSessionTx = await aa.createSession(sessionId, sessionWallet.address, rules, { gasLimit: 500_000n });
  await createSessionTx.wait();
  const sessionActive = await aa.sessionExists(sessionId);
  if (!sessionActive) log.fail('session not registered');
  log.ok(`session ${sessionId.slice(0, 20)}... registered, agent=${sessionWallet.address}`);

  // ── Step 6: Fund the AA with MockUSDT ──────────────────────────────────────
  log.step(6, 'Fund AA with MockUSDT (transfer from deployer)');
  const token = new ethers.Contract(SETTLEMENT_TOKEN, ERC20_ABI, deployer);
  const decimals = await token.decimals();
  const deployerTokenBal = await token.balanceOf(deployer.address);
  log.info(`deployer token balance: ${ethers.formatUnits(deployerTokenBal, decimals)} USDT`);
  const fundAmount = 5000n; // 0.005 USDT
  if (deployerTokenBal < fundAmount) {
    log.info(`deployer has insufficient MockUSDT (${deployerTokenBal}), trying to mint or skip funding step`);
    log.fail('deployer needs MockUSDT to run this test — mint some first');
  }
  const fundTx = await token.transfer(predictedAA, fundAmount, { gasLimit: 200_000n });
  await fundTx.wait();
  const aaTokenBal = await token.balanceOf(predictedAA);
  log.ok(`AA funded: ${ethers.formatUnits(aaTokenBal, decimals)} USDT`);

  // ── Step 7: Session key signs EIP-712 TransferAuthorization ────────────────
  log.step(7, 'Session key signs EIP-712 TransferAuthorization');
  const merchant = deployer.address; // use deployer as merchant for this test (any address works)
  const transferValue = 1000n; // 0.001 USDT
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: predictedAA,
    to: merchant,
    token: SETTLEMENT_TOKEN,
    value: transferValue,
    validAfter: now - 60,
    validBefore: now + 600,
    nonce: ethers.id(`auth-${Date.now()}`)
  };

  const domain = {
    name: 'KTraceAccount',
    version: '3',
    chainId: 133,
    verifyingContract: predictedAA
  };
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  };
  const signature = await sessionWallet.signTypedData(domain, types, auth);
  log.ok(`signed by session key (sig len ${signature.length} chars)`);

  // ── Step 8: Relayer (deployer) submits direct-call payment ─────────────────
  log.step(8, 'Relayer submits executeTransferWithAuthorizationAndProvider');
  const serviceProvider = ethers.id('hotel-booking');
  const metadata = ethers.toUtf8Bytes('e2e-test-booking');
  const merchantBalBefore = await token.balanceOf(merchant);
  const payTx = await aa.executeTransferWithAuthorizationAndProvider(
    sessionId,
    auth,
    signature,
    serviceProvider,
    metadata,
    { gasLimit: 800_000n }
  );
  const payReceipt = await payTx.wait();
  if (payReceipt.status !== 1) log.fail(`payment reverted: ${payTx.hash}`);
  log.ok(`payment tx: ${payTx.hash} (gas ${payReceipt.gasUsed})`);

  // ── Step 9: Verify SessionPaymentExecuted event + on-chain balance delta ──
  log.step(9, 'Verify on-chain result');
  const sessionPaymentTopic = ethers.id('SessionPaymentExecuted(bytes32,address,address,uint256,bytes32,bytes32)');
  const evt = payReceipt.logs.find(l =>
    l.address.toLowerCase() === predictedAA.toLowerCase() && l.topics[0] === sessionPaymentTopic
  );
  if (!evt) log.fail('SessionPaymentExecuted event not found');
  log.ok('SessionPaymentExecuted event emitted');

  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const transferEvt = payReceipt.logs.find(l =>
    l.address.toLowerCase() === SETTLEMENT_TOKEN.toLowerCase() && l.topics[0] === transferTopic
  );
  if (transferEvt) {
    log.ok('ERC20 Transfer event emitted');
  } else {
    log.info('(HashKey testnet sometimes omits internal ERC20 Transfer log; SessionPaymentExecuted is our primary proof)');
  }

  const merchantBalAfter = await token.balanceOf(merchant);
  const delta = merchantBalAfter - merchantBalBefore;
  log.info(`merchant balance delta: ${ethers.formatUnits(delta, decimals)} USDT (expected ${ethers.formatUnits(transferValue, decimals)})`);
  if (delta !== transferValue) log.fail(`balance delta mismatch`);
  log.ok('balance delta confirmed');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('\x1b[32m🎉 E2E VALIDATION PASSED\x1b[0m');
  console.log('='.repeat(70));
  console.log(`New AA (factory V2):      ${predictedAA}`);
  console.log(`Session key:              ${sessionWallet.address}`);
  console.log(`Session id:               ${sessionId}`);
  console.log(`Payment tx:               ${payTx.hash}`);
  console.log(`Amount transferred:       ${ethers.formatUnits(transferValue, decimals)} USDT`);
  console.log(`\nExplorer: https://testnet-explorer.hsk.xyz/tx/${payTx.hash}`);
}

main().catch((err) => {
  console.error('\n\x1b[31mFATAL:\x1b[0m', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
