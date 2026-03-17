import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { loadJsonArrayFromFile, writeJsonArrayToFile } from '../lib/persistence.js';
import { seedRealAgentCapabilities } from '../routes/v1/capabilitiesV1Routes.js';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const backendRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(backendRoot, '..');
const dataDir = path.resolve(backendRoot, 'data');
const envPath = path.resolve(backendRoot, '.env');

dotenv.config({ path: envPath });

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipErc8004Read = args.has('--skip-erc8004-read');

const settlementToken = normalizeText(process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63');
const merchantAddress = normalizeText(process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29');
const technicalAaAddress = normalizeText(process.env.KITE_AGENT2_AA_ADDRESS || merchantAddress);
const fundamentalAaAddress = normalizeText(process.env.KITE_AGENT3_AA_ADDRESS || merchantAddress);
const routerAaAddress = normalizeText(process.env.XMTP_ROUTER_AGENT_AA_ADDRESS || merchantAddress);
const ownerWallet = normalizeText(process.env.BACKEND_SIGNER_ADDRESS || process.env.XMTP_ROUTER_AGENT_ADDRESS || merchantAddress);
const identityRegistry = normalizeText(process.env.ERC8004_IDENTITY_REGISTRY || '');
const x402Price = normalizeAmount(process.env.X402_UNIFIED_SERVICE_PRICE || process.env.X402_PRICE || '0.00015');

const paths = {
  networkAgents: path.resolve(dataDir, 'network_agents.json'),
  services: path.resolve(dataDir, 'services.json')
};
const dryRunState = {
  networkAgents: null,
  services: null
};

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function normalizeAmount(value = '0.00015') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '0.00015';
  return String(Number(parsed.toFixed(6)));
}

function printStep(name = '', ok = false, detail = '') {
  const label = ok ? 'ok' : 'fail';
  const suffix = normalizeText(detail);
  console.log(`[${label}] ${name}${suffix ? ` :: ${suffix}` : ''}`);
}

function writeArray(targetPath, rows) {
  if (dryRun) {
    if (targetPath === paths.networkAgents) dryRunState.networkAgents = Array.isArray(rows) ? structuredClone(rows) : [];
    if (targetPath === paths.services) dryRunState.services = Array.isArray(rows) ? structuredClone(rows) : [];
    return;
  }
  writeJsonArrayToFile(targetPath, rows);
}

function readArray(targetPath) {
  if (dryRun) {
    if (targetPath === paths.networkAgents && Array.isArray(dryRunState.networkAgents)) {
      return structuredClone(dryRunState.networkAgents);
    }
    if (targetPath === paths.services && Array.isArray(dryRunState.services)) {
      return structuredClone(dryRunState.services);
    }
  }
  return loadJsonArrayFromFile(targetPath);
}

function nowIso() {
  return new Date().toISOString();
}

function buildSeedNetworkAgents() {
  const now = nowIso();
  return [
    {
      id: 'kite-trace-platform',
      name: 'Kite Trace Platform',
      role: 'router',
      mode: 'a2a',
      xmtpAddress: '',
      aaAddress: routerAaAddress,
      inboxId: '',
      ownerWallet,
      identityRegistry,
      identityAgentId: '1',
      identityVerifyMode: 'signature',
      identityVerifiedAt: now,
      identitySignerType: 'owner',
      importedFromIdentityAt: now,
      onboardingSource: 'system',
      approvalStatus: 'approved',
      approvedAt: now,
      suspendedAt: '',
      description: 'Primary Kite Trace public platform/router identity.',
      capabilities: ['route-task', 'dispatch-a2a'],
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'technical-agent-real',
      name: 'Technical Agent Real',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: '',
      aaAddress: technicalAaAddress,
      inboxId: '',
      ownerWallet,
      identityRegistry,
      identityAgentId: '2',
      identityVerifyMode: 'signature',
      identityVerifiedAt: now,
      identitySignerType: 'agent_wallet',
      importedFromIdentityAt: now,
      onboardingSource: 'identity-self-registered',
      approvalStatus: 'approved',
      approvedAt: now,
      suspendedAt: '',
      description: 'Real technical/onchain market data provider.',
      capabilities: ['btc-price-feed', 'smart-money-signal', 'trenches-scan', 'token-analysis', 'wallet-pnl', 'dex-market'],
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'fundamental-agent-real',
      name: 'Fundamental Agent Real',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: '',
      aaAddress: fundamentalAaAddress,
      inboxId: '',
      ownerWallet,
      identityRegistry,
      identityAgentId: '3',
      identityVerifyMode: 'signature',
      identityVerifiedAt: now,
      identitySignerType: 'agent_wallet',
      importedFromIdentityAt: now,
      onboardingSource: 'identity-self-registered',
      approvalStatus: 'approved',
      approvedAt: now,
      suspendedAt: '',
      description: 'Real fundamental/news/social alpha provider.',
      capabilities: ['btc-price-feed', 'listing-alert', 'news-signal', 'meme-sentiment', 'kol-monitor'],
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function buildBaseServiceSeeds() {
  const now = nowIso();
  const common = {
    pair: 'BTCUSDT',
    source: 'hyperliquid',
    sourceRequested: 'hyperliquid',
    horizonMin: null,
    resourceUrl: '',
    maxChars: null,
    recipient: merchantAddress,
    tokenAddress: settlementToken,
    price: x402Price,
    pricing: {
      model: 'per_call',
      amount: x402Price,
      currency: 'USDC'
    },
    slaMs: 15000,
    rateLimitPerMinute: 12,
    budgetPerDay: 0,
    allowlistPayers: [],
    exampleInput: { pair: 'BTCUSDT', source: 'hyperliquid' },
    active: true,
    createdAt: now,
    updatedAt: now,
    publishedBy: 'system'
  };

  return [
    {
      id: 'svc_btcusd_fundamental',
      name: 'BTCUSD Quote (Fundamental Real)',
      description: 'Seed base service used to attach settlement/source defaults for fundamental-agent-real.',
      action: 'btc-price-feed',
      providerAgentId: 'fundamental-agent-real',
      providerKey: 'fundamental-agent-real',
      tags: ['fundamental', 'btc', 'price-feed', 'seed'],
      ...common
    },
    {
      id: 'svc_btcusd_technical',
      name: 'BTCUSD Quote (Technical Real)',
      description: 'Seed base service used to attach settlement/source defaults for technical-agent-real.',
      action: 'btc-price-feed',
      providerAgentId: 'technical-agent-real',
      providerKey: 'technical-agent-real',
      tags: ['technical', 'btc', 'price-feed', 'seed'],
      ...common
    }
  ];
}

function runErc8004Read() {
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npmExecutable, ['run', 'erc8004:read'], {
    cwd: backendRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe'
  });
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  const seededAgents = buildSeedNetworkAgents();
  writeArray(paths.networkAgents, seededAgents);
  const agentIds = seededAgents.map((item) => `${item.id}:${item.identityAgentId}`).join(', ');
  printStep('write network_agents.json', true, `${seededAgents.length} rows (${agentIds})${dryRun ? ' [dry-run]' : ''}`);

  const baseServices = buildBaseServiceSeeds();
  writeArray(paths.services, baseServices);
  const baseServiceIds = baseServices.map((item) => item.id).join(', ');
  printStep('write services.json', true, `${baseServices.length} base rows (${baseServiceIds})${dryRun ? ' [dry-run]' : ''}`);

  const ensureServiceCatalog = () => readArray(paths.services);
  const ensureNetworkAgents = () => readArray(paths.networkAgents);
  const writePublishedServices = (rows) => writeArray(paths.services, rows);
  const writeNetworkAgents = (rows) => writeArray(paths.networkAgents, rows);

  const seededCatalog = seedRealAgentCapabilities({
    ensureServiceCatalog,
    ensureNetworkAgents,
    writePublishedServices,
    writeNetworkAgents,
    normalizeText,
    normalizeLower
  });
  const capabilityCount = seededCatalog.filter((item) => normalizeLower(item?.id).startsWith('cap-')).length;
  printStep('seed cap-* capabilities', capabilityCount >= 10, `${capabilityCount} capability rows present${dryRun ? ' [dry-run]' : ''}`);

  if (skipErc8004Read) {
    printStep('npm run erc8004:read', true, 'skipped by flag');
  } else {
    const ercRead = runErc8004Read();
    const ok = Number(ercRead.status || 0) === 0;
    const detail = ok
      ? 'contract read succeeded'
      : normalizeText(ercRead.stderr || ercRead.stdout || `exit ${ercRead.status ?? 'unknown'}`).slice(0, 220);
    printStep('npm run erc8004:read', ok, detail);
    if (!ok) {
      process.exitCode = 1;
    }
  }

  const finalAgents = dryRun ? seededAgents : readArray(paths.networkAgents);
  const finalServices = dryRun ? seededCatalog : readArray(paths.services);
  const finalCapabilities = finalServices.filter((item) => normalizeLower(item?.id).startsWith('cap-'));
  console.log(
    JSON.stringify(
      {
        ok: process.exitCode ? false : true,
        dryRun,
        repoRoot,
        backendRoot,
        networkAgents: finalAgents.length,
        services: finalServices.length,
        capabilities: finalCapabilities.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  printStep('seed-server-data', false, error?.message || String(error || 'unknown_error'));
  process.exitCode = 1;
});
