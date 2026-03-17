import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const TOKEN_ADDRESS = process.env.KITE_SETTLEMENT_TOKEN || '';
const ESCROW_ADDRESS = process.env.ERC8183_ESCROW_ADDRESS || '';
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

function isRetryableOnchainError(error = null) {
  const message = [
    error?.message,
    error?.shortMessage,
    error?.code,
    error?.cause?.message,
    error?.cause?.code
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase();
  if (!message) return false;
  return (
    message.includes('tls') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('before secure tls connection') ||
    message.includes('timeout') ||
    message.includes('network')
  );
}

async function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function runWithRetry(operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= 5 || !isRetryableOnchainError(error)) {
        throw error;
      }
      await wait(1000 * attempt);
    }
  }
  throw lastError || new Error('erc8183 approve failed');
}

function buildRoleWalletSpecs() {
  return [
    {
      role: 'requester',
      privateKey:
        process.env.ERC8183_REQUESTER_PRIVATE_KEY ||
        process.env.ERC8004_REGISTRAR_PRIVATE_KEY ||
        process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY ||
        ''
    },
    {
      role: 'executor',
      privateKey: process.env.ERC8183_EXECUTOR_PRIVATE_KEY || ''
    }
  ];
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

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const uniqueWallets = new Map();

  for (const spec of buildRoleWalletSpecs()) {
    const privateKey = String(spec?.privateKey || '').trim();
    if (!privateKey) continue;
    const wallet = new ethers.Wallet(privateKey, provider);
    const key = wallet.address.toLowerCase();
    const existing = uniqueWallets.get(key);
    if (existing) {
      existing.roles.push(spec.role);
      continue;
    }
    uniqueWallets.set(key, {
      wallet,
      roles: [spec.role]
    });
  }

  if (!uniqueWallets.size) {
    throw new Error(
      'Missing escrow signer envs: set ERC8183_REQUESTER_PRIVATE_KEY and, when staking is enabled, ERC8183_EXECUTOR_PRIVATE_KEY.'
    );
  }

  const approvals = [];
  for (const { wallet, roles } of uniqueWallets.values()) {
    const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, wallet);
    const currentAllowance = await runWithRetry(() => token.allowance(wallet.address, ESCROW_ADDRESS));
    if (currentAllowance === ethers.MaxUint256) {
      approvals.push({
        roles,
        owner: wallet.address,
        approved: false,
        skipped: true,
        allowance: currentAllowance.toString(),
        txHash: ''
      });
      continue;
    }

    const tx = await runWithRetry(() => token.approve(ESCROW_ADDRESS, ethers.MaxUint256));
    await runWithRetry(() => tx.wait());
    approvals.push({
      roles,
      owner: wallet.address,
      approved: true,
      skipped: false,
      allowance: ethers.MaxUint256.toString(),
      txHash: tx.hash || ''
    });
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
  console.error('ERC-8183 escrow approval failed:', error.message);
  process.exit(1);
});
