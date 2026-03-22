/**
 * Deploy V3 AA wallet + create session for a service agent.
 * Usage:
 *   node scripts/aa-deploy-agent-v3.js --ownerKey <hex> [--label <name>] [--agentId <num>]
 *
 * If --agentId is provided, also updates identity registry wallet.
 */
import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';
import {
  resolveAaAccountImplementation,
  resolveAaFactoryAddress,
  DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION
} from '../lib/aaConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
loadEnv({ path: path.resolve(backendDir, '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const BUNDLER_URL = process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/';
const ENTRYPOINT = process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const ACCOUNT_FACTORY = resolveAaFactoryAddress();
const ACCOUNT_IMPL = resolveAaAccountImplementation();
const REQUIRED_VERSION = DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION || 'GokiteAccountV3-session-execute';
const SETTLEMENT_TOKEN = String(process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63').trim();
const IDENTITY_REGISTRY = String(process.env.ERC8004_IDENTITY_REGISTRY || '').trim();
const BACKEND_SIGNER_KEY = String(process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '').trim();
const SESSION_RUNTIMES_PATH = path.resolve(backendDir, 'data', 'session_runtimes.json');

function parseArg(name) {
  const idx = process.argv.findIndex((item) => item === `--${name}`);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function normalizeKey(k) {
  const raw = String(k || '').trim();
  return raw && !raw.startsWith('0x') ? `0x${raw}` : raw;
}

function readJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeJsonFile(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

async function main() {
  const ownerKey = normalizeKey(parseArg('ownerKey'));
  const label = parseArg('label') || 'service-agent';
  const agentId = parseInt(parseArg('agentId') || '0', 10);
  if (!ownerKey) throw new Error('Missing --ownerKey');

  const rpcReq = new ethers.FetchRequest(RPC_URL);
  rpcReq.timeout = 45000;
  const provider = new ethers.JsonRpcProvider(rpcReq);
  const ownerWallet = new ethers.Wallet(ownerKey, provider);
  const ownerAddress = ownerWallet.address;
  console.log(`[${label}] Owner EOA: ${ownerAddress}`);

  // 1. Compute AA address
  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT,
    accountFactoryAddress: ACCOUNT_FACTORY,
    accountImplementationAddress: ACCOUNT_IMPL
  });
  const salt = 0n;
  let aaWallet;
  try {
    aaWallet = await sdk.resolveAccountAddress(ownerAddress, salt);
  } catch {
    aaWallet = sdk.ensureAccountAddress(ownerAddress, salt);
  }
  console.log(`[${label}] AA wallet: ${aaWallet}`);

  // 2. Deploy if not deployed (use backendSigner to call factory.createAccount)
  let code = await provider.getCode(aaWallet);
  if (!code || code === '0x') {
    console.log(`[${label}] AA not deployed, deploying via factory...`);
    const backendSigner = new ethers.Wallet(normalizeKey(BACKEND_SIGNER_KEY), provider);
    const factoryAbi = ['function createAccount(address owner, uint256 salt) returns (address)'];
    const factory = new ethers.Contract(ACCOUNT_FACTORY, factoryAbi, backendSigner);
    const deployTx = await factory.createAccount(ownerAddress, salt);
    await deployTx.wait();
    console.log(`[${label}] Deploy tx: ${deployTx.hash}`);
    code = await provider.getCode(aaWallet);
    if (!code || code === '0x') throw new Error('AA deployment failed');
  }

  // 3. Check version
  const versionAbi = ['function version() view returns (string)'];
  let version = '';
  try {
    const vc = new ethers.Contract(aaWallet, versionAbi, provider);
    version = String(await vc.version()).trim();
  } catch { version = ''; }
  console.log(`[${label}] AA version: ${version || 'unknown'}`);

  if (version !== REQUIRED_VERSION) {
    console.log(`[${label}] Version mismatch, need ${REQUIRED_VERSION}. Attempting upgrade...`);
    const upgradeAbi = ['function upgradeToAndCall(address newImplementation, bytes calldata data) external'];
    const aaContract = new ethers.Contract(aaWallet, upgradeAbi, ownerWallet);
    try {
      const upgradeTx = await aaContract.upgradeToAndCall(ACCOUNT_IMPL, '0x');
      await upgradeTx.wait();
      const vc2 = new ethers.Contract(aaWallet, versionAbi, provider);
      version = String(await vc2.version()).trim();
      console.log(`[${label}] Upgraded to: ${version}`);
    } catch (e) {
      console.log(`[${label}] Upgrade failed: ${e.message?.slice(0, 100)}`);
    }
  }

  // 4. Create session
  const accountAbi = [
    'function addSupportedToken(address token) external',
    'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
    'function sessionExists(bytes32 sessionId) view returns (bool)',
    'function getSessionAgent(bytes32 sessionId) view returns (address)'
  ];
  const account = new ethers.Contract(aaWallet, accountAbi, ownerWallet);

  try {
    const tokenTx = await account.addSupportedToken(SETTLEMENT_TOKEN);
    await tokenTx.wait();
    console.log(`[${label}] addSupportedToken: ${tokenTx.hash}`);
  } catch (e) {
    console.log(`[${label}] addSupportedToken skipped: ${e.message?.slice(0, 60)}`);
  }

  const latestBlock = await provider.getBlock('latest');
  const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
  const expiresAt = nowTs + 168 * 3600; // 168 hours from now
  const rules = [
    { timeWindow: 0n, budget: ethers.parseUnits('5', 18), initialWindowStartTime: 0, targetProviders: [] },
    { timeWindow: BigInt(168 * 3600), budget: ethers.parseUnits('50', 18), initialWindowStartTime: Math.max(0, nowTs - 1), targetProviders: [] }
  ];

  const sessionWallet = ethers.Wallet.createRandom();
  const sessionId = ethers.keccak256(ethers.toUtf8Bytes(`${label}:${sessionWallet.address}:${Date.now()}`));
  console.log(`[${label}] Creating session...`);
  const sessionTx = await account.createSession(sessionId, sessionWallet.address, rules);
  await sessionTx.wait();
  console.log(`[${label}] Session tx: ${sessionTx.hash}`);

  const [exists, onchainAgent] = await Promise.all([
    account.sessionExists(sessionId),
    account.getSessionAgent(sessionId)
  ]);
  if (!exists || onchainAgent.toLowerCase() !== sessionWallet.address.toLowerCase()) {
    throw new Error('Session verification failed');
  }
  console.log(`[${label}] Session verified on-chain ✅`);

  // 5. Save to session_runtimes.json
  const runtimesData = readJsonFile(SESSION_RUNTIMES_PATH);
  if (!runtimesData.runtimes) runtimesData.runtimes = {};
  runtimesData.runtimes[ownerAddress.toLowerCase()] = {
    aaWallet: aaWallet.toLowerCase(),
    owner: ownerAddress.toLowerCase(),
    sessionAddress: sessionWallet.address,
    sessionPrivateKey: sessionWallet.privateKey,
    sessionId,
    sessionTxHash: sessionTx.hash,
    tokenAddress: SETTLEMENT_TOKEN,
    expiresAt,
    maxPerTx: 5,
    dailyLimit: 50,
    gatewayRecipient: process.env.KITE_MERCHANT_ADDRESS || '',
    accountFactoryAddress: ACCOUNT_FACTORY,
    accountImplementationAddress: ACCOUNT_IMPL,
    accountVersion: version || REQUIRED_VERSION,
    accountVersionTag: version || REQUIRED_VERSION,
    accountCapabilities: { sessionPayment: true, sessionGenericExecute: true },
    requiredForJobLane: 'sessionGenericExecute',
    source: `cli-agent-v3-${label}`,
    updatedAt: Date.now()
  };
  writeJsonFile(SESSION_RUNTIMES_PATH, runtimesData);
  console.log(`[${label}] Runtime saved to session_runtimes.json`);

  // 6. Update identity registry if agentId provided
  if (agentId > 0 && IDENTITY_REGISTRY && ethers.isAddress(IDENTITY_REGISTRY) && BACKEND_SIGNER_KEY) {
    const registryAbi = [
      'function setAgentWallet(uint256 agentId, address newWallet) external payable',
      'function getAgentWallet(uint256 agentId) view returns (address)',
      'function metadataUpdateFee() view returns (uint256)'
    ];
    const backendSigner = new ethers.Wallet(normalizeKey(BACKEND_SIGNER_KEY), provider);
    const registry = new ethers.Contract(IDENTITY_REGISTRY, registryAbi, backendSigner);
    const fee = await registry.metadataUpdateFee();
    const regTx = await registry.setAgentWallet(agentId, aaWallet, { value: fee });
    await regTx.wait();
    console.log(`[${label}] Identity registry agent ${agentId} → ${aaWallet} (tx: ${regTx.hash})`);
  }

  console.log(JSON.stringify({
    ok: true,
    label,
    ownerAddress,
    aaWallet,
    version,
    sessionId,
    sessionAddress: sessionWallet.address,
    sessionTxHash: sessionTx.hash,
    agentId: agentId || null,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  }, null, 2));
}

main().catch((e) => {
  console.error(`[FAILED] ${e.message}`);
  process.exit(1);
});
