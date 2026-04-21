#!/usr/bin/env node
/**
 * A2A Hotel Booking Demo Script
 *
 * End-to-end happy path: Agent A (traveler) discovers Agent B (hotel),
 * negotiates via Synapse, pays via x402/AA, receives booking confirmation.
 *
 * Usage:
 *   node a2a-hotel-demo.mjs [--backend URL] [--broker WS_URL] [--skip-wallet-setup]
 *
 * Environment:
 *   AGENT_A_OWNER_KEY  — Agent A owner private key (hex)
 *   AGENT_B_OWNER_KEY  — Agent B owner private key (hex)
 *   KTRACE_BACKEND_URL — Backend URL (default http://127.0.0.1:3399)
 *   SYNAPSE_BROKER_URL — Synapse broker WS URL (default ws://127.0.0.1:9100)
 */

import { ethers } from 'ethers';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createHmac } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.KTRACE_BACKEND_URL || 'http://127.0.0.1:3399';
const BACKEND_API_KEY = process.env.KTRACE_API_KEY || 'viewer-local-dev-key';
const BROKER_URL = process.env.SYNAPSE_BROKER_URL || 'ws://127.0.0.1:9100';
const ROOM = 'a2a-demo';
const SKIP_WALLET_SETUP = process.argv.includes('--skip-wallet-setup');

const HASHKEY_CONFIG = {
  chainId: 133,
  rpcUrl: process.env.KITE_RPC_URL || 'https://testnet.hsk.xyz',
  bundlerUrl: process.env.KITE_BUNDLER_URL || 'https://testnet.hsk.xyz/rpc',
  entryPointAddress: '0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598',
  accountFactoryAddress: '0xF43E94E2163F14c4D62242D8DD45AbAacaa6DB5a',
  accountImplementationAddress: '0x2DbBfCdAd28b3A2094BD634Cce4326B1b3D0595C',
  identityRegistry: '0x901A2b1c67daB5AC09A4e02bE9c1c8D52Cce650B',
  ktraceAccountV3Proxy: '0xFeDa86D7eEF86aCd127F2f517C064CF1eDdFdE8b',
  settlementToken: '0xDC52db3E9e17d9BE1A457d3fA455f68b52c38e2e',
  merchantAddress: '0x09e116d198318eec9402893f00958123e980521b',
  explorerUrl: 'https://testnet-explorer.hsk.xyz',
  // Pre-deployed AA wallets (factory has init signature mismatch, deployed directly)
  preDeployedAA_A: '0xf9D24F2D1679564aCF289ab2D71C491658145e09',
  preDeployedAA_B: '0xd16434844c215DcDDD653A11060D429f4Bd87661'
};

const SERVICE_CAPABILITY = 'hotel-booking';
const SERVICE_PRICE = '0.001';

// ── Logging ──────────────────────────────────────────────────────────────────

const log = {
  info: (phase, msg) => console.log(`\x1b[36m[${phase}]\x1b[0m ${msg}`),
  success: (phase, msg) => console.log(`\x1b[32m[${phase}]\x1b[0m ✅ ${msg}`),
  error: (phase, msg) => console.log(`\x1b[31m[${phase}]\x1b[0m ❌ ${msg}`),
  step: (phase, msg) => console.log(`\x1b[33m[${phase}]\x1b[0m → ${msg}`),
  divider: () => console.log('\x1b[90m' + '─'.repeat(60) + '\x1b[0m')
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (opts.auth !== false) headers['X-API-Key'] = BACKEND_API_KEY;
  const res = await fetch(url, {
    headers,
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

async function deployAAWallet(sdk, signer) {
  if (!sdk.config.proxyAddress) {
    throw new Error('AA wallet address not set. Call ensureAccountAddress(owner) first.');
  }
  const deployed = await sdk.isAccountDeployed(sdk.config.proxyAddress);
  if (deployed) {
    log.info('WALLET', `AA wallet already deployed: ${sdk.config.proxyAddress}`);
    return sdk.config.proxyAddress;
  }
  log.step('WALLET', `Deploying AA wallet via UserOp with initCode...`);
  const signFunction = async (userOpHash) => signer.signMessage(ethers.getBytes(userOpHash));
  const result = await sdk.sendRawCallDataUserOperationAndWait('0x', signFunction, {
    callGasLimit: 420000n,
    verificationGasLimit: 1800000n,
    preVerificationGas: 350000n
  });
  if (result?.transactionHash) {
    log.success('WALLET', `Deployed: ${sdk.config.proxyAddress} (tx: ${HASHKEY_CONFIG.explorerUrl}/tx/${result.transactionHash})`);
  } else {
    log.error('WALLET', `Deploy failed: ${result?.reason || result?.status || 'unknown'}`);
  }
  return sdk.config.proxyAddress;
}

function createSessionWallet() {
  return ethers.Wallet.createRandom();
}

async function createSessionOnChain(sdk, ownerSigner, aaWallet, sessionWallet, sessionId, maxPerTx, _dailyLimit) {
  log.step('SESSION', `Creating session ${sessionId.slice(0, 10)}... for ${sessionWallet.address}`);
  const account = new ethers.Contract(aaWallet, [
    'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
    'function addSupportedToken(address token) external'
  ], ownerSigner);

  // Ensure settlement token is supported
  try {
    const tx = await account.addSupportedToken(HASHKEY_CONFIG.settlementToken);
    await tx.wait();
    log.success('SESSION', 'Settlement token added');
  } catch (e) {
    if (!e.message?.includes('already supported')) log.info('SESSION', `Token add skipped: ${e.message?.slice(0, 50)}`);
  }

  // Single rule: timeWindow=0 (per-tx cap, no time-window bug), large budget, empty targetProviders = match all
  // Two-rule sessions hit a contract bug in checkSpendingRules where timeWindow>0 rule
  // with initialWindowStartTime > block.timestamp causes early return false, vetoing rule 0.
  // Budget uses 6 decimals to match MockUSDT (raw units comparison in contract)
  const rules = [
    { timeWindow: 0n, budget: ethers.parseUnits(maxPerTx, 6), initialWindowStartTime: 0n, targetProviders: [] }
  ];

  const tx = await account.createSession(sessionId, sessionWallet.address, rules);
  await tx.wait();
  log.success('SESSION', `Session created: ${sessionId.slice(0, 16)}`);
}

// ── Synapse Channel Client ────────────────────────────────────────────────────

class SynapseClient {
  constructor(brokerUrl, actor) {
    this.brokerUrl = brokerUrl;
    this.actor = actor;
    this.clientId = crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}`;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.broadcasts = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.brokerUrl);
      this.ws.on('open', () => {
        log.success('CHANNEL', `Connected to ${this.brokerUrl}`);
        resolve();
      });
      this.ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString());
          if (frame.reply_to_req_id && this.pending.has(frame.reply_to_req_id)) {
            this.pending.get(frame.reply_to_req_id)(frame);
            this.pending.delete(frame.reply_to_req_id);
          }
          if (frame.op === 'broadcast' && frame.msg) {
            this.broadcasts.push(frame.msg);
          }
        } catch {}
      });
      this.ws.on('error', (err) => reject(err));
    });
  }

  async sendFrame(frame) {
    const reqId = `req-${++this.msgId}`;
    frame.req_id = reqId;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      this.ws.send(JSON.stringify(frame));
      setTimeout(() => { this.pending.delete(reqId); resolve(null); }, 10000);
    });
  }

  async join(room) {
    const resp = await this.sendFrame({ op: 'join', room, actor: this.actor, client_id: this.clientId });
    return resp;
  }

  async post(room, content, parts) {
    const frame = { op: 'post', room, content };
    if (parts) frame.parts = parts;
    const resp = await this.sendFrame(frame);
    return resp;
  }

  async waitForBroadcast(fromActor, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const msg = this.broadcasts.find(m => m.actor !== this.actor && (!fromActor || m.actor === fromActor));
      if (msg) {
        this.broadcasts = this.broadcasts.filter(m => m !== msg);
        return msg;
      }
      await sleep(500);
    }
    return null;
  }

  async signAndPost(room, content, wallet) {
    const signature = await wallet.signMessage(content);
    const parts = [
      { kind: 'text', text: content },
      { kind: 'data', data: { signature, signer: wallet.address, signerType: 'aa-wallet' }, metadata: { mimeType: 'application/ethereum-signature' } }
    ];
    return this.post(room, content, parts);
  }

  close() { if (this.ws) this.ws.close(); }
}

// ── Main Demo Flow ───────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m\x1b[35m╔══════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m\x1b[35m║  KTrace A2A Hotel Booking — HashKey Chain Horizon  ║\x1b[0m');
  console.log('\x1b[1m\x1b[35m╚══════════════════════════════════════════════════╝\x1b[0m\n');
  log.divider();

  // ── Phase 0: Pre-flight ────────────────────────────────────────────────────
  log.info('PREFLIGHT', 'Checking backend and infrastructure...');

  const healthResp = await fetchJSON(`${BACKEND_URL}/health`);
  if (!healthResp.ok && !healthResp.status) {
    log.error('PREFLIGHT', 'Backend not healthy');
    process.exit(1);
  }
  log.success('PREFLIGHT', `Backend healthy: ${JSON.stringify(healthResp).slice(0, 80)}`);

  // ── Agent wallets ──────────────────────────────────────────────────────────
  // Generate or load owner keys
  const ownerKeyA = process.env.AGENT_A_OWNER_KEY || ethers.Wallet.createRandom().privateKey;
  const ownerKeyB = process.env.AGENT_B_OWNER_KEY || ethers.Wallet.createRandom().privateKey;
  const ownerA = new ethers.Wallet(ownerKeyA);
  const ownerB = new ethers.Wallet(ownerKeyB);

  log.info('SETUP', `Agent A (Consumer): ${ownerA.address}`);
  log.info('SETUP', `Agent B (Provider):  ${ownerB.address}`);
  log.divider();

  // ── Phase 1: Agent B (Provider) goes online ────────────────────────────────
  log.info('PHASE 1', 'Agent B (Provider) — Deploying & registering...');

  const sdkB = new GokiteAASDK({
    network: 'hashkey_testnet',
    rpcUrl: HASHKEY_CONFIG.rpcUrl,
    bundlerUrl: HASHKEY_CONFIG.bundlerUrl,
    entryPointAddress: HASHKEY_CONFIG.entryPointAddress,
    accountFactoryAddress: HASHKEY_CONFIG.accountFactoryAddress,
    accountImplementationAddress: HASHKEY_CONFIG.accountImplementationAddress,
    proxyAddress: HASHKEY_CONFIG.preDeployedAA_B,
    bundlerRpcTimeoutMs: 35000,
    bundlerRpcRetries: 3
  });

  let aaWalletB, sessionWalletB;
  if (!SKIP_WALLET_SETUP) {
    aaWalletB = HASHKEY_CONFIG.preDeployedAA_B;
    log.success('PHASE 1', `Agent B AA wallet (pre-deployed): ${aaWalletB}`);

    const provider = new ethers.JsonRpcProvider(HASHKEY_CONFIG.rpcUrl);
    const signerB = new ethers.Wallet(ownerKeyB, provider);

    sessionWalletB = createSessionWallet();
    const sessionIdB = ethers.keccak256(ethers.toUtf8Bytes(`a2a-demo-B-${Date.now()}`));
    await createSessionOnChain(sdkB, signerB, aaWalletB, sessionWalletB, sessionIdB, '0.001', '0.01');

    // Register B on discovery API
    await fetchJSON(`${BACKEND_URL}/api/a2a/agents/register`, {
      method: 'POST',
      body: {
        agentId: 'hotel-agent-real',
        agentWallet: aaWalletB,
        name: 'Hilton Beijing Hotel Agent',
        description: 'Provides hotel room booking via agent-to-agent commerce. No platform sign-up needed.',
        capabilities: ['hotel-booking'],
        endpoints: { x402: `${BACKEND_URL}/api/services/hotel-booking/invoke`, channel: BROKER_URL },
        sessionAuth: { sessionAddress: sessionWalletB.address, sessionId: sessionIdB, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 }
      }
    });
    log.success('PHASE 1', 'Agent B (Hotel) registered on discovery API');
  } else {
    log.info('PHASE 1', 'Skipping wallet setup (--skip-wallet-setup)');
    aaWalletB = '0x09e116d198318eec9402893f00958123e980521b'; // pre-seeded provider
    sessionWalletB = ownerB;
  }

  log.divider();

  // ── Phase 2: Agent A (Consumer) discovers + connects ───────────────────────
  log.info('PHASE 2', 'Agent A (Consumer) — Discovering services...');

  const discovery = await fetchJSON(`${BACKEND_URL}/api/a2a/discovery?capability=hotel-booking`);
  if (!discovery.agents?.length) {
    log.error('PHASE 2', 'No agents found in discovery');
    process.exit(1);
  }
  const providerAgent = discovery.agents[0];
  log.success('PHASE 2', `Discovered: ${providerAgent.name} (${providerAgent.agentId}) with ${providerAgent.services?.length || 0} services`);

  const sdkA = new GokiteAASDK({
    network: 'hashkey_testnet',
    rpcUrl: HASHKEY_CONFIG.rpcUrl,
    bundlerUrl: HASHKEY_CONFIG.bundlerUrl,
    entryPointAddress: HASHKEY_CONFIG.entryPointAddress,
    accountFactoryAddress: HASHKEY_CONFIG.accountFactoryAddress,
    accountImplementationAddress: HASHKEY_CONFIG.accountImplementationAddress,
    proxyAddress: HASHKEY_CONFIG.preDeployedAA_A,
    bundlerRpcTimeoutMs: 35000,
    bundlerRpcRetries: 3
  });

  let aaWalletA, sessionWalletA, sessionIdA;
  if (!SKIP_WALLET_SETUP) {
    aaWalletA = HASHKEY_CONFIG.preDeployedAA_A;
    log.success('PHASE 2', `Agent A AA wallet (pre-deployed): ${aaWalletA}`);

    const provider = new ethers.JsonRpcProvider(HASHKEY_CONFIG.rpcUrl);
    const signerA = new ethers.Wallet(ownerKeyA, provider);

    sessionWalletA = createSessionWallet();
    sessionIdA = ethers.keccak256(ethers.toUtf8Bytes(`a2a-demo-A-${Date.now()}`));
    await createSessionOnChain(sdkA, signerA, aaWalletA, sessionWalletA, sessionIdA, '1000', '0.01');  // 1000 USDT per-tx cap
  } else {
    aaWalletA = ownerA.address;
    sessionWalletA = ownerA; // use owner as session wallet for demo simplicity
  }

  log.divider();

  // ── Phase 3: Negotiation via Synapse ────────────────────────────────────────
  log.info('PHASE 3', 'Connecting to Synapse channel for negotiation...');

  let channelA, channelB;
  try {
    channelB = new SynapseClient(BROKER_URL, aaWalletB || ownerB.address);
    await channelB.connect();
    await channelB.join(ROOM);
    log.success('PHASE 3', `Agent B joined room "${ROOM}" as ${channelB.actor}`);

    channelA = new SynapseClient(BROKER_URL, aaWalletA || ownerA.address);
    await channelA.connect();
    await channelA.join(ROOM);
    log.success('PHASE 3', `Agent A joined room "${ROOM}" as ${channelA.actor}`);

    // A sends negotiation message
    const negotiateMsg = `[NEGOTIATE] Need a king room in Beijing for 2026-04-22, 1 night. Budget ${SERVICE_PRICE} USDC.`;
    await channelA.signAndPost(ROOM, negotiateMsg, sessionWalletA || ownerA);
    log.step('PHASE 3', `A → ${negotiateMsg}`);

    // B accepts
    const acceptMsg = `[ACCEPT] hotel-booking, price ${SERVICE_PRICE} USDC, recipient ${HASHKEY_CONFIG.merchantAddress}`;
    await channelB.signAndPost(ROOM, acceptMsg, sessionWalletB || ownerB);
    log.step('PHASE 3', `B → ${acceptMsg}`);
  } catch (err) {
    log.error('PHASE 3', `Channel error: ${err.message}`);
    log.info('PHASE 3', 'Continuing without Synapse channel (broker may not be running)');
  }

  log.divider();

  // ── Phase 4: Payment via x402 ──────────────────────────────────────────────
  log.info('PHASE 4', 'Initiating x402 payment...');

  // Step 4a: Invoke without payment proof → get 402
  const invokeResp = await fetchJSON(`${BACKEND_URL}/api/a2a/commerce/invoke`, {
    method: 'POST',
    body: {
      sourceAgentWallet: aaWalletA || ownerA.address,
      targetAgentId: 'hotel-agent-real',
      capability: SERVICE_CAPABILITY,
      task: { city: 'Beijing', checkIn: '2026-04-22', nights: 1, roomType: 'king' }
    }
  });

  if (!invokeResp.x402 && invokeResp.error !== 'payment_required') {
    log.error('PHASE 4', `Unexpected response: ${JSON.stringify(invokeResp).slice(0, 200)}`);
    if (channelA) channelA.close();
    if (channelB) channelB.close();
    process.exit(1);
  }

  const x402Data = invokeResp.x402;
  const requestId = x402Data?.requestId || invokeResp.requestId || '';
  const quote = x402Data?.accepts?.[0];
  log.success('PHASE 4', `Got 402 payment_required: requestId=${requestId?.slice(0, 20)}...`);
  log.info('PHASE 4', `Amount: ${quote?.amount} ${quote?.tokenAddress?.slice(0, 10)}... → ${quote?.recipient?.slice(0, 10)}...`);

  if (!SKIP_WALLET_SETUP && sessionWalletA && quote?.signingContext) {
    // Step 4b: Direct on-chain call (bypass EntryPoint — handleOps reverts on HashKey testnet)
    const ctx = quote.signingContext;
    const paymentSdk = new GokiteAASDK({
      network: ctx.network || 'hashkey_testnet',
      rpcUrl: ctx.rpcUrl || HASHKEY_CONFIG.rpcUrl,
      bundlerUrl: ctx.bundlerUrl,
      entryPointAddress: ctx.entryPointAddress,
      accountFactoryAddress: ctx.accountFactoryAddress || HASHKEY_CONFIG.accountFactoryAddress,
      accountImplementationAddress: ctx.accountImplementationAddress || HASHKEY_CONFIG.accountImplementationAddress,
      proxyAddress: aaWalletA,
      bundlerRpcTimeoutMs: 35000,
      bundlerRpcRetries: 3
    });

    const amountRaw = ethers.parseUnits(quote.amount, quote.decimals || 6);
    const nowSec = Math.floor(Date.now() / 1000);
    const quoteToken = quote.tokenAddress || quote.asset;
    const quoteRecipient = quote.recipient || quote.payTo;
    const authPayload = {
      from: aaWalletA,
      to: quoteRecipient,
      token: quoteToken,
      value: amountRaw,
      validAfter: BigInt(Math.max(0, nowSec - 30)),
      validBefore: BigInt(nowSec + 10 * 60),
      nonce: ethers.hexlify(ethers.randomBytes(32))
    };

    const serviceProvider = ethers.keccak256(ethers.toUtf8Bytes(`x402_payment:requester:${quoteToken}`));

    log.step('PHASE 4', 'Signing transfer authorization...');
    const authSignature = await paymentSdk.buildTransferAuthorizationSignature(sessionWalletA, authPayload);

    // Direct call: executeTransferWithAuthorizationAndProvider is external nonReentrant
    // (no onlyEntryPoint check) — can be called directly by anyone with valid auth signature
    log.step('PHASE 4', 'Submitting direct on-chain transfer (bypassing EntryPoint)...');
    let paymentTxHash = null;
    try {
      const provider = new ethers.JsonRpcProvider(HASHKEY_CONFIG.rpcUrl);
      // Any wallet can call this — the auth is the session wallet's signature
      // Use a random funded wallet or the owner wallet as the caller
      const callerSigner = new ethers.Wallet(ownerKeyA, provider);
      const aaContract = new ethers.Contract(aaWalletA, [
        'function executeTransferWithAuthorizationAndProvider(bytes32 sessionId, (address from,address to,address token,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce) auth, bytes signature, bytes32 serviceProvider, bytes metadata) external'
      ], callerSigner);

      const tx = await aaContract.executeTransferWithAuthorizationAndProvider(
        sessionIdA,
        [authPayload.from, authPayload.to, authPayload.token, authPayload.value, authPayload.validAfter, authPayload.validBefore, authPayload.nonce],
        authSignature,
        serviceProvider,
        '0x',
        { gasLimit: 500000n }
      );
      log.step('PHASE 4', `TX sent: ${tx.hash}, waiting for confirmation...`);
      const receipt = await tx.wait(1, 120000);
      if (receipt.status === 1) {
        paymentTxHash = tx.hash;
        log.success('PHASE 4', `Payment confirmed: ${HASHKEY_CONFIG.explorerUrl}/tx/${tx.hash}`);
      } else {
        log.error('PHASE 4', `Payment TX reverted in block ${receipt.blockNumber}`);
      }
    } catch (err) {
      log.error('PHASE 4', `Direct call failed: ${err.message?.slice(0, 200)}`);
    }

    // Step 4c: Retry with payment proof
    if (paymentTxHash) {
      log.step('PHASE 4', 'Retrying commerce invoke with payment proof...');
      const resultResp = await fetchJSON(`${BACKEND_URL}/api/a2a/commerce/invoke`, {
        method: 'POST',
        body: {
          sourceAgentWallet: aaWalletA,
          targetAgentId: 'hotel-agent-real',
          capability: SERVICE_CAPABILITY,
          task: { city: 'Beijing', checkIn: '2026-04-22', nights: 1, roomType: 'king' },
          requestId,
          paymentProof: {
            txHash: paymentTxHash,
            requestId,
            tokenAddress: quoteToken,
            recipient: quoteRecipient,
            amount: quote.amount
          }
        }
      });

      if (resultResp.ok && resultResp.result) {
        log.success('PHASE 4', 'Service result received via x402 (payment + delivery atomic):');
        console.log(JSON.stringify(resultResp.result, null, 2));
      } else {
        log.error('PHASE 4', `Result failed: ${JSON.stringify(resultResp).slice(0, 200)}`);
      }
    }
  } else {
    log.info('PHASE 4', 'Skipping on-chain payment (--skip-wallet-setup or no signing context)');
    log.info('PHASE 4', 'In production, Agent A would sign a UserOp and submit to bundler here');
  }

  log.divider();

  // ── Phase 5: Receipt + Evidence ─────────────────────────────────────────────
  log.info('PHASE 5', 'Posting receipt to channel and fetching evidence...');

  if (channelA) {
    const receiptMsg = `[RECEIPT] Hotel booking confirmed via x402. TraceId: trc_a2a_hotel`;
    await channelA.signAndPost(ROOM, receiptMsg, sessionWalletA || ownerA);
    log.success('PHASE 5', `A → ${receiptMsg}`);
  }

  // Fetch evidence
  if (requestId) {
    const evidence = await fetchJSON(`${BACKEND_URL}/api/a2a/commerce/${requestId}/evidence`);
    log.info('PHASE 5', `Evidence: ${JSON.stringify(evidence).slice(0, 200)}...`);
  }

  // Cleanup
  if (channelA) channelA.close();
  if (channelB) channelB.close();

  log.divider();
  console.log('\n\x1b[1m\x1b[32m🎉 A2A Hotel Booking Demo Complete!\x1b[0m\n');
  console.log('Summary:');
  console.log(`  Agent A (Traveler): ${aaWalletA || ownerA.address}`);
  console.log(`  Agent B (Hotel):    ${aaWalletB || ownerB.address}`);
  console.log(`  Capability: ${SERVICE_CAPABILITY}`);
  console.log(`  Amount: ${SERVICE_PRICE} USDC`);
  console.log(`  Channel: ${ROOM}`);
  console.log(`  Explorer: ${HASHKEY_CONFIG.explorerUrl}`);
  console.log();
}

main().catch(err => {
  log.error('FATAL', err.message);
  console.error(err);
  process.exit(1);
});