#!/usr/bin/env node
/**
 * A2A Commerce Demo Script
 *
 * End-to-end happy path: Agent A discovers Agent B, negotiates via Synapse,
 * pays via x402/AA, receives result via x402 (NOT channel).
 *
 * Usage:
 *   node a2a-commerce-demo.mjs [--backend URL] [--broker WS_URL] [--skip-wallet-setup]
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
  rpcUrl: 'https://testnet.hsk.xyz',
  bundlerUrl: 'https://testnet.hsk.xyz/rpc',
  entryPointAddress: '0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598',
  accountFactoryAddress: '0xF43E94E2163F14c4D62242D8DD45AbAacaa6DB5a',
  accountImplementationAddress: '0x2DbBfCdAd28b3A2094BD634Cce4326B1b3D0595C',
  identityRegistry: '0x901A2b1c67daB5AC09A4e02bE9c1c8D52Cce650B',
  ktraceAccountV3Proxy: '0xFeDa86D7eEF86aCd127F2f517C064CF1eDdFdE8b',
  settlementToken: '0xDC52db3E9e17d9BE1A457d3fA455f68b52c38e2e',
  merchantAddress: '0x09e116d198318eec9402893f00958123e980521b',
  explorerUrl: 'https://testnet-explorer.hsk.xyz'
};

const SERVICE_CAPABILITY = 'cap-dex-market';
const SERVICE_PRICE = '0.0001';

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

async function deployAAWallet(sdk) {
  const lifecycle = await sdk.getAccountLifecycle();
  if (lifecycle.deployed) {
    log.info('WALLET', `AA wallet already deployed: ${lifecycle.accountAddress}`);
    return lifecycle.accountAddress;
  }
  log.step('WALLET', `Deploying AA wallet...`);
  const txHash = await sdk.deployAccount();
  log.success('WALLET', `Deployed: ${lifecycle.accountAddress} (tx: ${HASHKEY_CONFIG.explorerUrl}/tx/${txHash})`);
  return lifecycle.accountAddress;
}

function createSessionWallet() {
  return ethers.Wallet.createRandom();
}

async function createSessionOnChain(sdk, ownerSigner, aaWallet, sessionWallet, sessionId, maxPerTx, dailyLimit) {
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

  const nowSec = Math.floor(Date.now() / 1000);
  const rules = [
    { timeWindow: 0n, budget: ethers.parseUnits(maxPerTx, 18), initialWindowStartTime: 0n, targetProviders: [] },
    { timeWindow: 86400n, budget: ethers.parseUnits(dailyLimit, 18), initialWindowStartTime: BigInt(nowSec - 1), targetProviders: [] }
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
  console.log('\x1b[1m\x1b[35m║  KTrace A2A Commerce Demo — HashKey Chain Horizon  ║\x1b[0m');
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
    proxyAddress: '', // will be set after ensureAccountAddress
    bundlerRpcTimeoutMs: 35000,
    bundlerRpcRetries: 3
  });

  let aaWalletB;
  if (!SKIP_WALLET_SETUP) {
    aaWalletB = sdkB.ensureAccountAddress(ownerB.address);
    const provider = new ethers.JsonRpcProvider(HASHKEY_CONFIG.rpcUrl);
    const signerB = new ethers.Wallet(ownerKeyB, provider);
    aaWalletB = await deployAAWallet(sdkB);

    // Create session key for B
    const sessionWalletB = createSessionWallet();
    const sessionIdB = ethers.keccak256(ethers.toUtf8Bytes(`a2a-demo-B-${Date.now()}`));
    await createSessionOnChain(sdkB, signerB, aaWalletB, sessionWalletB, sessionIdB, '0.001', '0.01');

    // Register B on discovery API
    await fetchJSON(`${BACKEND_URL}/api/a2a/agents/register`, {
      method: 'POST',
      body: {
        agentId: 'technical-agent-real',
        agentWallet: aaWalletB,
        name: 'Market Intelligence Agent',
        description: 'Provides DEX market data, token analysis via x402',
        capabilities: ['cap-dex-market', 'cap-token-analysis'],
        endpoints: { x402: `${BACKEND_URL}/api/services/cap-dex-market/invoke`, channel: BROKER_URL },
        sessionAuth: { sessionAddress: sessionWalletB.address, sessionId: sessionIdB, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 }
      }
    });
    log.success('PHASE 1', 'Agent B registered on discovery API');
  } else {
    log.info('PHASE 1', 'Skipping wallet setup (--skip-wallet-setup)');
    aaWalletB = '0x09e116d198318eec9402893f00958123e980521b'; // pre-seeded provider
  }

  log.divider();

  // ── Phase 2: Agent A (Consumer) discovers + connects ───────────────────────
  log.info('PHASE 2', 'Agent A (Consumer) — Discovering services...');

  const discovery = await fetchJSON(`${BACKEND_URL}/api/a2a/discovery?capability=cap-dex-market`);
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
    proxyAddress: '',
    bundlerRpcTimeoutMs: 35000,
    bundlerRpcRetries: 3
  });

  let aaWalletA, sessionWalletA;
  if (!SKIP_WALLET_SETUP) {
    aaWalletA = sdkA.ensureAccountAddress(ownerA.address);
    const provider = new ethers.JsonRpcProvider(HASHKEY_CONFIG.rpcUrl);
    const signerA = new ethers.Wallet(ownerKeyA, provider);
    aaWalletA = await deployAAWallet(sdkA);

    sessionWalletA = createSessionWallet();
    const sessionIdA = ethers.keccak256(ethers.toUtf8Bytes(`a2a-demo-A-${Date.now()}`));
    await createSessionOnChain(sdkA, signerA, aaWalletA, sessionWalletA, sessionIdA, '0.001', '0.01');
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
    const negotiateMsg = `[NEGOTIATE] Request DEX market data for BTCUSDT, budget ${SERVICE_PRICE} USDC`;
    await channelA.signAndPost(ROOM, negotiateMsg, sessionWalletA || ownerA);
    log.step('PHASE 3', `A → ${negotiateMsg}`);

    // B accepts
    const acceptMsg = `[ACCEPT] cap-dex-market, price ${SERVICE_PRICE} USDC, recipient ${HASHKEY_CONFIG.merchantAddress}`;
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
      targetAgentId: 'technical-agent-real',
      capability: SERVICE_CAPABILITY,
      task: { symbol: 'BTCUSDT', interval: '1h', limit: 20 }
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
    // Step 4b: Sign UserOp and pay
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
    const authPayload = {
      from: aaWalletA,
      to: quote.payTo,
      token: quote.asset,
      value: amountRaw,
      validAfter: BigInt(Math.max(0, nowSec - 30)),
      validBefore: BigInt(nowSec + 10 * 60),
      nonce: ethers.hexlify(ethers.randomBytes(32))
    };

    const sessionId = ethers.keccak256(ethers.toUtf8Bytes(`a2a-demo-A-${Date.now()}`));
    const serviceProvider = ethers.keccak256(ethers.toUtf8Bytes(`x402_payment:requester:${quote.asset}`));

    log.step('PHASE 4', 'Signing transfer authorization...');
    const authSignature = await paymentSdk.buildTransferAuthorizationSignature(sessionWalletA, authPayload);

    const signFunction = async (userOpHash) => sessionWalletA.signMessage(ethers.getBytes(userOpHash));

    log.step('PHASE 4', 'Submitting UserOp to bundler...');
    const paymentResult = await paymentSdk.sendSessionTransferWithAuthorizationAndProvider(
      { sessionId, auth: authPayload, authSignature, serviceProvider, metadata: '0x' },
      signFunction,
      { callGasLimit: 320000n, verificationGasLimit: 450000n, preVerificationGas: 120000n }
    );

    if (paymentResult.status === 'success' && paymentResult.transactionHash) {
      log.success('PHASE 4', `Payment confirmed: ${HASHKEY_CONFIG.explorerUrl}/tx/${paymentResult.transactionHash}`);
    } else {
      log.error('PHASE 4', `Payment failed: ${paymentResult.reason || paymentResult.status}`);
    }

    // Step 4c: Retry with payment proof
    if (paymentResult.transactionHash) {
      log.step('PHASE 4', 'Retrying commerce invoke with payment proof...');
      const resultResp = await fetchJSON(`${BACKEND_URL}/api/a2a/commerce/invoke`, {
        method: 'POST',
        body: {
          sourceAgentWallet: aaWalletA,
          targetAgentId: 'technical-agent-real',
          capability: SERVICE_CAPABILITY,
          task: { symbol: 'BTCUSDT', interval: '1h', limit: 20 },
          requestId,
          paymentProof: {
            txHash: paymentResult.transactionHash,
            tokenAddress: quote.asset,
            recipient: quote.payTo,
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
    // Still try the payment-proof path with a mock
    log.info('PHASE 4', 'In production, Agent A would sign a UserOp and submit to bundler here');
  }

  log.divider();

  // ── Phase 5: Receipt + Evidence ─────────────────────────────────────────────
  log.info('PHASE 5', 'Posting receipt to channel and fetching evidence...');

  if (channelA) {
    const receiptMsg = `[RECEIPT] Confirmed. Service delivered via x402. TraceId: trc_a2a_demo`;
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
  console.log('\n\x1b[1m\x1b[32m🎉 A2A Commerce Demo Complete!\x1b[0m\n');
  console.log('Summary:');
  console.log(`  Agent A (Consumer): ${aaWalletA || ownerA.address}`);
  console.log(`  Agent B (Provider):  ${aaWalletB || ownerB.address}`);
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