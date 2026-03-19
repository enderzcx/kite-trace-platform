import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ethers } from 'ethers';

import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';
import { resolveAaAccountImplementation, resolveAaFactoryAddress } from '../lib/aaConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.BACKEND_RPC_URL || process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const BUNDLER_URL =
  process.env.BACKEND_BUNDLER_URL || process.env.KITEAI_BUNDLER_URL || process.env.KITEAA_BUNDLER_URL || '';
const ENTRYPOINT_ADDRESS =
  process.env.KITEAA_ENTRYPOINT_ADDRESS ||
  process.env.BACKEND_ENTRYPOINT_ADDRESS ||
  '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const ACCOUNT_FACTORY_ADDRESS = resolveAaFactoryAddress();
const ACCOUNT_IMPLEMENTATION_ADDRESS = resolveAaAccountImplementation();
const TOKEN_ADDRESS = process.env.KITE_SETTLEMENT_TOKEN || '';
const ESCROW_ADDRESS = process.env.ERC8183_ESCROW_ADDRESS || '';
const SESSION_RUNTIME_PATH = path.resolve(__dirname, '..', 'data', 'session_runtime.json');
const SESSION_RUNTIME_INDEX_PATH = path.resolve(__dirname, '..', 'data', 'session_runtimes.json');

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeAddress(value = '') {
  const normalized = normalizeText(value);
  if (!normalized || !ethers.isAddress(normalized)) return '';
  return ethers.getAddress(normalized);
}

function normalizePrivateKey(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) return normalized;
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) return `0x${normalized}`;
  return '';
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
  if (current && typeof current === 'object') {
    runtimes.push(current);
  }
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
      sessionPrivateKey: normalizeText(runtime?.sessionPrivateKey || ''),
      sessionId: normalizeText(runtime?.sessionId || '')
    });
  }
  return Array.from(unique.values());
}

function findRuntimeByAaWallet(aaWallet = '') {
  const normalizedAaWallet = normalizeAddress(aaWallet);
  if (!normalizedAaWallet) return null;
  return readRuntimes().find((runtime) => runtime.aaWallet === normalizedAaWallet) || null;
}

function buildRoleSpecs() {
  return [
    {
      role: 'requester',
      aaWallet: normalizeAddress(process.env.ERC8183_REQUESTER_AA_ADDRESS || ''),
      ownerPrivateKey: normalizePrivateKey(
        process.env.ERC8183_REQUESTER_PRIVATE_KEY ||
          process.env.ERC8004_REGISTRAR_PRIVATE_KEY ||
          process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY ||
          ''
      )
    },
    {
      role: 'executor',
      aaWallet: normalizeAddress(process.env.ERC8183_EXECUTOR_AA_ADDRESS || ''),
      ownerPrivateKey: normalizePrivateKey(process.env.ERC8183_EXECUTOR_PRIVATE_KEY || '')
    }
  ].filter((spec) => spec.aaWallet);
}

async function ensureAllowance({ role, runtime, provider, ownerPrivateKey }) {
  const tokenAbi = [
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ];
  const token = new ethers.Contract(TOKEN_ADDRESS, tokenAbi, provider);
  const currentAllowance = await token.allowance(runtime.aaWallet, ESCROW_ADDRESS);
  if (currentAllowance === ethers.MaxUint256) {
    return {
      role,
      owner: runtime.owner,
      aaWallet: runtime.aaWallet,
      approved: false,
      skipped: true,
      allowance: currentAllowance.toString(),
      txHash: ''
    };
  }

  if (!ownerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(ownerPrivateKey)) {
    throw new Error(`Missing owner private key for ${role} AA setup approval.`);
  }
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT_ADDRESS,
    accountFactoryAddress: ACCOUNT_FACTORY_ADDRESS,
    accountImplementationAddress: ACCOUNT_IMPLEMENTATION_ADDRESS,
    proxyAddress: runtime.aaWallet,
    ownerAddress: runtime.owner,
    bundlerRpcTimeoutMs: Number(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS || 15000),
    bundlerRpcRetries: Number(process.env.KITE_BUNDLER_RPC_RETRIES || 3),
    bundlerReceiptPollIntervalMs: Number(process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS || 3000)
  });
  const signFunction = async (userOpHash) => ownerWallet.signMessage(ethers.getBytes(userOpHash));
  const approval = await sdk.approveERC20(
    {
      tokenAddress: TOKEN_ADDRESS,
      spender: ESCROW_ADDRESS,
      amount: ethers.MaxUint256
    },
    signFunction
  );
  if (!approval || approval.status !== 'success' || !normalizeText(approval.transactionHash)) {
    throw new Error(`${role} AA approval failed: ${normalizeText(approval?.reason || approval?.error?.message || '')}`);
  }
  return {
    role,
    owner: runtime.owner,
    aaWallet: runtime.aaWallet,
    approved: true,
    skipped: false,
    allowance: ethers.MaxUint256.toString(),
    txHash: normalizeText(approval.transactionHash),
    userOpHash: normalizeText(approval.userOpHash || '')
  };
}

async function main() {
  requireEnv('KITE_SETTLEMENT_TOKEN', TOKEN_ADDRESS);
  requireEnv('ERC8183_ESCROW_ADDRESS', ESCROW_ADDRESS);
  if (!ethers.isAddress(TOKEN_ADDRESS)) {
    throw new Error(`Invalid KITE_SETTLEMENT_TOKEN: ${TOKEN_ADDRESS}`);
  }
  if (!ethers.isAddress(ESCROW_ADDRESS)) {
    throw new Error(`Invalid ERC8183_ESCROW_ADDRESS: ${ESCROW_ADDRESS}`);
  }

  const rpcRequest = new ethers.FetchRequest(RPC_URL);
  rpcRequest.timeout = 60_000;
  const staticNetwork = ethers.Network.from({
    chainId: 2368,
    name: 'kite_testnet'
  });
  const provider = new ethers.JsonRpcProvider(
    rpcRequest,
    staticNetwork,
    {
      staticNetwork
    }
  );
  const approvals = [];
  for (const spec of buildRoleSpecs()) {
    const runtime = findRuntimeByAaWallet(spec.aaWallet);
    if (!runtime || !runtime.sessionPrivateKey || !runtime.sessionId) {
      throw new Error(`Missing AA runtime for ${spec.role}: ${spec.aaWallet}`);
    }
    approvals.push(
      await ensureAllowance({
        role: spec.role,
        runtime,
        provider,
        ownerPrivateKey: spec.ownerPrivateKey
      })
    );
  }

  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        settlementToken: TOKEN_ADDRESS,
        escrow: ESCROW_ADDRESS,
        approvals
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERC-8183 AA escrow approval failed:', error.message);
  process.exit(1);
});
