import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createSelfCustodialSession,
  sendLocalSessionPayment
} from '../cli/lib/sessionRuntime.js';
import { getEnvProxyDiagnostics } from '../lib/envProxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

loadEnv({ path: path.resolve(backendDir, '.env') });

const REQUESTER_OWNER = String(process.env.ERC8183_REQUESTER_ADDRESS || '').trim();
const REQUESTER_OWNER_KEY = String(process.env.ERC8183_REQUESTER_PRIVATE_KEY || '').trim();
const SETTLEMENT_TOKEN = String(
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63'
).trim();
const GATEWAY_RECIPIENT = String(
  process.env.KITE_MERCHANT_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8'
).trim();
const EXPECTED_RUNTIME_CODE_HASH = String(
  process.env.KITE_AA_EXPECTED_RUNTIME_CODE_HASH ||
    '0x49b8c5f68bbefb26985e4ec3db657e06164b272e62ecb52018815450805362ca'
).trim()
  .toLowerCase();
const SINGLE_LIMIT = String(process.env.KITE_AA_SMOKE_SINGLE_LIMIT || '0.01').trim();
const DAILY_LIMIT = String(process.env.KITE_AA_SMOKE_DAILY_LIMIT || '0.10').trim();
const PAYMENT_AMOUNT = String(process.env.KITE_AA_SMOKE_PAYMENT_AMOUNT || '0.0001').trim();
const PAYMENT_RETRY_ATTEMPTS = Math.max(
  1,
  Math.min(Number(process.env.KITE_AA_SMOKE_PAYMENT_RETRIES || 3), 5)
);

function waitMs(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTransportError(error = null) {
  const text = String(error?.message || error?.reason || error || '')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return (
    text.includes('timeout waiting for useroperation') ||
    text.includes('eth_getuseroperationreceipt timeout') ||
    text.includes('socket hang up') ||
    text.includes('econnreset') ||
    text.includes('connect timeout') ||
    text.includes('fetch failed')
  );
}

function readJsonObject(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getRequesterLegacyRuntime() {
  const sessionRuntimePath = path.resolve(backendDir, 'data', 'session_runtime.json');
  const sessionRuntimesPath = path.resolve(backendDir, 'data', 'session_runtimes.json');
  const current = readJsonObject(sessionRuntimePath);
  if (
    current &&
    typeof current === 'object' &&
    String(current.owner || '').trim().toLowerCase() === REQUESTER_OWNER.toLowerCase()
  ) {
    return current;
  }
  const indexed = readJsonObject(sessionRuntimesPath);
  const runtimes =
    indexed && typeof indexed.runtimes === 'object' && indexed.runtimes ? indexed.runtimes : {};
  return runtimes[REQUESTER_OWNER.toLowerCase()] || {};
}

async function readAccountSummary(provider, aaWallet) {
  const code = await provider.getCode(aaWallet);
  const codeBytes = code && code !== '0x' ? (code.length - 2) / 2 : 0;
  const codeHash = code && code !== '0x' ? ethers.keccak256(code).toLowerCase() : '';
  const account = new ethers.Contract(
    aaWallet,
    ['function version() view returns (string)', 'function owner() view returns (address)'],
    provider
  );
  const token = new ethers.Contract(
    SETTLEMENT_TOKEN,
    ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
    provider
  );
  const decimals = Number(await token.decimals().catch(() => 18));
  const [version, owner, nativeBalance, tokenBalance] = await Promise.all([
    account.version().catch(() => ''),
    account.owner().catch(() => ''),
    provider.getBalance(aaWallet),
    token.balanceOf(aaWallet)
  ]);
  return {
    aaWallet,
    codeBytes,
    codeHash,
    owner: String(owner || '').trim(),
    version: String(version || '').trim(),
    nativeBalance: ethers.formatEther(nativeBalance),
    tokenBalance: ethers.formatUnits(tokenBalance, decimals)
  };
}

async function sendPaymentWithRetry(runtime, requestPrefix) {
  let lastError = null;
  for (let attempt = 1; attempt <= PAYMENT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const payment = await sendLocalSessionPayment(
        { localSessionRuntime: runtime },
        {
          tokenAddress: SETTLEMENT_TOKEN,
          recipient: GATEWAY_RECIPIENT,
          amount: PAYMENT_AMOUNT,
          requestId: `${requestPrefix}-${Date.now()}-${attempt}`,
          action: 'market-price-feed',
          query: `${requestPrefix} payment smoke`
        }
      );
      return {
        payment,
        attemptsUsed: attempt
      };
    } catch (error) {
      lastError = error;
      if (attempt >= PAYMENT_RETRY_ATTEMPTS || !isRetryableTransportError(error)) {
        throw error;
      }
      await waitMs(1500 * attempt);
    }
  }
  throw lastError || new Error('payment_smoke_failed');
}

async function main() {
  if (!REQUESTER_OWNER || !REQUESTER_OWNER_KEY) {
    throw new Error('Missing ERC8183_REQUESTER_ADDRESS / ERC8183_REQUESTER_PRIVATE_KEY in backend/.env');
  }
  if (!ethers.isAddress(SETTLEMENT_TOKEN)) {
    throw new Error(`Invalid KITE_SETTLEMENT_TOKEN: ${SETTLEMENT_TOKEN}`);
  }
  if (!ethers.isAddress(GATEWAY_RECIPIENT)) {
    throw new Error(`Invalid gateway recipient: ${GATEWAY_RECIPIENT}`);
  }

  const provider = new ethers.JsonRpcProvider(
    String(process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/').trim(),
    ethers.Network.from({ chainId: 2368, name: 'kite_testnet' }),
    { staticNetwork: true }
  );

  const legacyRuntime = getRequesterLegacyRuntime();
  if (!legacyRuntime?.aaWallet || !legacyRuntime?.sessionPrivateKey || !legacyRuntime?.sessionId) {
    throw new Error(
      `Requester legacy runtime not found in local data for owner ${REQUESTER_OWNER}.`
    );
  }

  const legacySummary = await readAccountSummary(provider, legacyRuntime.aaWallet);
  const legacyPayment = await sendPaymentWithRetry(legacyRuntime, 'legacy-aa-smoke');

  const compatRuntime = await createSelfCustodialSession(
    {},
    {
      ownerPrivateKey: REQUESTER_OWNER_KEY,
      sessionPrivateKey: ethers.Wallet.createRandom().privateKey,
      singleLimit: SINGLE_LIMIT,
      dailyLimit: DAILY_LIMIT,
      tokenAddress: SETTLEMENT_TOKEN,
      gatewayRecipient: GATEWAY_RECIPIENT
    }
  );
  const compatSummary = await readAccountSummary(provider, compatRuntime.aaWallet);
  const compatPayment = await sendPaymentWithRetry(compatRuntime, 'compat-aa-smoke');

  const output = {
    ok: true,
    proxyDiagnostics: getEnvProxyDiagnostics(),
    expectedRuntimeCodeHash: EXPECTED_RUNTIME_CODE_HASH,
    legacy: {
      runtime: {
        aaWallet: legacyRuntime.aaWallet,
        sessionAddress: legacyRuntime.sessionAddress,
        sessionId: legacyRuntime.sessionId
      },
      account: legacySummary,
      payment: legacyPayment.payment.payment,
      paymentAttemptsUsed: legacyPayment.attemptsUsed
    },
    compat: {
      runtime: {
        aaWallet: compatRuntime.aaWallet,
        sessionAddress: compatRuntime.sessionAddress,
        sessionId: compatRuntime.sessionId,
        sessionTxHash: compatRuntime.sessionTxHash,
        singleLimit: compatRuntime.maxPerTx,
        dailyLimit: compatRuntime.dailyLimit
      },
      account: compatSummary,
      payment: compatPayment.payment.payment,
      paymentAttemptsUsed: compatPayment.attemptsUsed
    },
    compatibility: {
      codeHashMatch: legacySummary.codeHash === compatSummary.codeHash,
      expectedCodeHashMatch:
        legacySummary.codeHash === EXPECTED_RUNTIME_CODE_HASH &&
        compatSummary.codeHash === EXPECTED_RUNTIME_CODE_HASH,
      codeBytesMatch: legacySummary.codeBytes === compatSummary.codeBytes,
      versionMatch: legacySummary.version === compatSummary.version
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error?.message || String(error || 'verify_aa_compat_smoke_failed'),
        stack: error?.stack || ''
      },
      null,
      2
    )
  );
  process.exit(1);
});
