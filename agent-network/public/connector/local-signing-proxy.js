#!/usr/bin/env node
/**
 * KTrace Local Signing Proxy
 *
 * Sits between Claude Code and the KTrace backend MCP server.
 * Intercepts x402 payment-required responses, signs the ERC20 transfer
 * UserOp locally using the user's session private key, submits it to the
 * bundler, then retries the original tool call with payment proof.
 *
 * Usage:
 *   SESSION_PRIVATE_KEY=0x... CONNECTOR_TOKEN=ktrace_cc_... node local-signing-proxy.js
 *
 * Config (~/.ktrace-connector/config.json):
 *   {
 *     "backendUrl":    "https://your-ktrace-backend.com",
 *     "connectorToken": "ktrace_cc_...",
 *     "aaWallet":      "0x...",
 *     "sessionId":     "0x<64 hex>",
 *     "ownerEoa":      "0x..."
 *   }
 */

import { createServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const configDir = join(homedir(), '.ktrace-connector');
  const configPath = join(configDir, 'config.json');
  const envPath = join(configDir, '.env');

  let cfg = {};

  // 1. File config
  if (existsSync(configPath)) {
    try {
      cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[ktrace-proxy] Failed to parse config.json:', e.message);
    }
  }

  // 2. .env file (simple KEY=VALUE)
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  // 3. Env vars override config file
  const resolved = {
    backendUrl: process.env.KTRACE_BACKEND_URL || cfg.backendUrl || 'http://localhost:3001',
    aaWallet: process.env.KTRACE_AA_WALLET || cfg.aaWallet || '',
    sessionId: process.env.KTRACE_SESSION_ID || cfg.sessionId || '',
    ownerEoa: process.env.KTRACE_OWNER_EOA || cfg.ownerEoa || '',
    sessionPrivateKey: process.env.SESSION_PRIVATE_KEY || cfg.sessionPrivateKey || ''
  };

  return resolved;
}

const config = loadConfig();

if (!config.sessionPrivateKey) {
  console.error('[ktrace-proxy] SESSION_PRIVATE_KEY is required. Set it in env or ~/.ktrace-connector/config.json');
  process.exit(1);
}
const sessionWallet = new ethers.Wallet(config.sessionPrivateKey);
console.error(`[ktrace-proxy] Session signer: ${sessionWallet.address}`);
console.error(`[ktrace-proxy] AA wallet: ${config.aaWallet || '(not set)'}`);
console.error(`[ktrace-proxy] Backend: ${config.backendUrl}`);

// ── AA UserOp helpers ─────────────────────────────────────────────────────────

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];
const ERC20_INTERFACE = new ethers.Interface(ERC20_TRANSFER_ABI);

const EXECUTE_WITH_SESSION_ABI = [
  'function executeWithSession(bytes32 sessionId, address target, uint256 value, bytes calldata data, bytes32 actionId, bytes calldata extraData) external returns (bytes memory)'
];

function normalizeBytes32(input = '') {
  const s = String(input || '').trim().toLowerCase();
  if (/^0x[0-9a-f]{64}$/.test(s)) return s;
  const hex = ethers.keccak256(ethers.toUtf8Bytes(s));
  return hex;
}

async function buildAndSignTransferUserOp({
  sessionPrivateKey,
  sessionId,
  aaWallet,
  ownerEoa,
  tokenAddress,
  recipient,
  amount,
  decimals = 18,
  signingContext
}) {
  const signer = new ethers.Wallet(sessionPrivateKey);

  const {
    bundlerUrl,
    entryPointAddress,
    accountFactoryAddress,
    accountImplementationAddress,
    chainId = 2368
  } = signingContext;

  const provider = new ethers.JsonRpcProvider(
    signingContext.rpcUrl || bundlerUrl,
    { chainId: Number(chainId), name: signingContext.networkName || 'kite_testnet' }
  );

  // Build callData: ERC20 transfer(recipient, amount)
  const amountBig = typeof amount === 'string' && amount.includes('.')
    ? ethers.parseUnits(amount, decimals)
    : ethers.getBigInt(amount);

  const transferCallData = ERC20_INTERFACE.encodeFunctionData('transfer', [recipient, amountBig]);

  // Wrap in executeWithSession
  const accountInterface = new ethers.Interface(EXECUTE_WITH_SESSION_ABI);
  const actionId = normalizeBytes32(`x402_payment:requester:${tokenAddress}`);
  const executeCallData = accountInterface.encodeFunctionData('executeWithSession', [
    sessionId,
    tokenAddress,
    0n,
    transferCallData,
    actionId,
    '0x'
  ]);

  // Fetch nonce from AA account via entry point
  const entryPointAbi = [
    'function getNonce(address sender, uint192 key) view returns (uint256 nonce)'
  ];
  const entryPoint = new ethers.Contract(entryPointAddress, entryPointAbi, provider);
  const nonce = await entryPoint.getNonce(aaWallet, 0n);

  // Check if account is deployed
  const code = await provider.getCode(aaWallet);
  const isDeployed = code !== '0x';

  // Build initCode (if not deployed)
  let initCode = '0x';
  if (!isDeployed && accountFactoryAddress && ownerEoa) {
    const factoryAbi = ['function createAccount(address owner, uint256 salt) returns (address)'];
    const factoryInterface = new ethers.Interface(factoryAbi);
    const createCallData = factoryInterface.encodeFunctionData('createAccount', [ownerEoa, 0n]);
    initCode = ethers.concat([accountFactoryAddress, createCallData]);
  }

  // Get gas fees
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits('1', 'gwei');
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits('1', 'gwei');

  const userOp = {
    sender: aaWallet,
    nonce: nonce.toString(),
    initCode,
    callData: executeCallData,
    callGasLimit: 220000n,
    verificationGasLimit: 500000n,
    preVerificationGas: 105000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData: '0x',
    signature: '0x'
  };

  // Compute userOpHash via entry point
  const getUserOpHashAbi = [
    'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)'
  ];
  const entryPointReader = new ethers.Contract(entryPointAddress, getUserOpHashAbi, provider);
  const userOpHash = await entryPointReader.getUserOpHash(userOp);

  // Sign
  const signature = await signer.signMessage(ethers.getBytes(userOpHash));
  userOp.signature = signature;

  return { userOp, userOpHash };
}

async function submitToBundler(bundlerUrl, userOp) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendUserOperation',
    params: [
      {
        sender: userOp.sender,
        nonce: ethers.toBeHex(userOp.nonce),
        initCode: userOp.initCode,
        callData: userOp.callData,
        callGasLimit: ethers.toBeHex(userOp.callGasLimit),
        verificationGasLimit: ethers.toBeHex(userOp.verificationGasLimit),
        preVerificationGas: ethers.toBeHex(userOp.preVerificationGas),
        maxFeePerGas: ethers.toBeHex(userOp.maxFeePerGas),
        maxPriorityFeePerGas: ethers.toBeHex(userOp.maxPriorityFeePerGas),
        paymasterAndData: userOp.paymasterAndData,
        signature: userOp.signature
      },
      // entryPoint address is set by the bundlerUrl's server config, or pass explicitly
    ]
  });

  const resp = await fetch(bundlerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const json = await resp.json();
  if (json.error) throw new Error(`Bundler error: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result; // userOpHash from bundler
}

async function waitForUserOpReceipt(bundlerUrl, userOpHash, timeoutMs = 120_000, pollMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getUserOperationReceipt',
        params: [userOpHash]
      })
    });
    const json = await resp.json();
    if (json.result && json.result.receipt) {
      return json.result;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`UserOp ${userOpHash} not confirmed within ${timeoutMs}ms`);
}

// ── Backend MCP proxy call ────────────────────────────────────────────────────

async function buildSessionAuthHeaders() {
  const ts = String(Date.now());
  const message = `ktrace-session:${ts}`;
  const signature = await sessionWallet.signMessage(message);
  return {
    'x-ktrace-session-address': sessionWallet.address,
    'x-ktrace-session-timestamp': ts,
    'x-ktrace-session-signature': signature,
    'x-ktrace-aa-wallet': config.aaWallet,
    'x-ktrace-session-id': config.sessionId,
    'x-ktrace-owner-eoa': config.ownerEoa
  };
}

async function callBackendTool(toolName, args) {
  const url = `${config.backendUrl}/mcp`;
  const authHeaders = await buildSessionAuthHeaders();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  const json = await resp.json();
  return json.result || json;
}

// ── Payment handling ─────────────────────────────────────────────────────────

async function handlePaymentAndRetry(toolName, originalArgs, paymentData) {
  const { x402, signingContext, requestId } = paymentData;
  const accepts = Array.isArray(x402?.accepts) ? x402.accepts : [];
  const quote = accepts[0];

  if (!quote) throw new Error('No payment quote in 402 response');

  const { tokenAddress, amount, recipient, decimals = 18 } = quote;
  const ctx = quote.signingContext || signingContext || {};

  if (!ctx.bundlerUrl || !ctx.entryPointAddress) {
    throw new Error('signingContext missing bundlerUrl/entryPointAddress — cannot sign UserOp');
  }

  const sessionId = config.sessionId;
  const aaWallet = config.aaWallet;
  if (!sessionId) throw new Error('KTRACE_SESSION_ID not configured in proxy');
  if (!aaWallet) throw new Error('KTRACE_AA_WALLET not configured in proxy');

  console.error(`[ktrace-proxy] Signing x402 payment: ${amount} ${tokenAddress} → ${recipient}`);

  // Build + sign UserOp for ERC20 transfer
  const { userOp, userOpHash } = await buildAndSignTransferUserOp({
    sessionPrivateKey: config.sessionPrivateKey,
    sessionId,
    aaWallet,
    ownerEoa: config.ownerEoa,
    tokenAddress,
    recipient,
    amount,
    decimals,
    signingContext: ctx
  });

  console.error(`[ktrace-proxy] Submitting UserOp ${userOpHash} to bundler...`);
  const bundlerOpHash = await submitToBundler(ctx.bundlerUrl, userOp);
  console.error(`[ktrace-proxy] UserOp submitted: ${bundlerOpHash}`);

  // Wait for receipt
  const receipt = await waitForUserOpReceipt(ctx.bundlerUrl, bundlerOpHash);
  const txHash = receipt?.receipt?.transactionHash || receipt?.transactionHash || bundlerOpHash;
  console.error(`[ktrace-proxy] Payment confirmed: ${txHash}`);

  // Retry tool call with payment proof
  const retryArgs = {
    ...originalArgs,
    x402Mode: 'agent',
    requestId: x402?.requestId || requestId || '',
    paymentProof: {
      txHash,
      requestId: x402?.requestId || requestId || '',
      tokenAddress,
      recipient,
      amount: String(amount)
    }
  };

  console.error(`[ktrace-proxy] Retrying ${toolName} with payment proof...`);
  return callBackendTool(toolName, retryArgs);
}

// ── MCP Server ────────────────────────────────────────────────────────────────

// First, fetch tool list from backend to proxy them
async function fetchBackendTools() {
  try {
    const authHeaders = await buildSessionAuthHeaders();
    const resp = await fetch(`${config.backendUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    });
    const json = await resp.json();
    return json.result?.tools || [];
  } catch (e) {
    console.error('[ktrace-proxy] Failed to fetch tools from backend:', e.message);
    return [];
  }
}

async function main() {
  const tools = await fetchBackendTools();
  console.error(`[ktrace-proxy] Proxying ${tools.length} tools from backend`);

  const server = createServer(
    { name: 'ktrace-signing-proxy', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Register tools/list handler
  server.setRequestHandler({ method: 'tools/list' }, async () => ({ tools }));

  // Register tools/call handler — intercepts 402 responses
  server.setRequestHandler({ method: 'tools/call' }, async (request) => {
    const { name: toolName, arguments: args = {} } = request.params;

    const result = await callBackendTool(toolName, args);

    // Check if this is a payment_required_preview response
    const sc = result?.structuredContent || result?.content?.[0];
    if (
      sc?.paymentStatus === 'payment_required_preview' ||
      sc?.error === 'payment_required_preview'
    ) {
      try {
        const retryResult = await handlePaymentAndRetry(toolName, args, sc);
        return retryResult;
      } catch (payErr) {
        console.error('[ktrace-proxy] Payment/retry failed:', payErr.message);
        // Return original 402 result so user sees what happened
        return {
          ...result,
          content: [
            {
              type: 'text',
              text: `Payment signing failed: ${payErr.message}\n\n${result?.content?.[0]?.text || ''}`
            }
          ]
        };
      }
    }

    return result;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ktrace-proxy] Ready — listening on stdio');
}

main().catch((e) => {
  console.error('[ktrace-proxy] Fatal:', e.message);
  process.exit(1);
});
