import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEFAULT_CONFIG = Object.freeze({
  profile: 'default',
  baseUrl: 'http://127.0.0.1:3001',
  chain: 'kite-testnet',
  wallet: '',
  outputMode: 'text',
  authMode: 'aa-wallet',
  sessionMode: 'aa-session',
  sessionStrategy: 'managed',
  timeoutMs: 60000,
  apiKey: ''
});

function normalizeText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeUrl(value, fallback = DEFAULT_CONFIG.baseUrl) {
  const normalized = normalizeText(value, fallback);
  return normalized.replace(/\/+$/, '') || fallback;
}

export function resolveConfigPath(cliOptions = {}) {
  const explicit = normalizeText(cliOptions.configPath || process.env.KTRACE_CONFIG_PATH || '');
  if (explicit) return explicit;
  return path.join(os.homedir(), '.ktrace', 'config.json');
}

async function readLocalConfig(configPath) {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.name === 'SyntaxError')) {
      return {};
    }
    throw error;
  }
}

function buildEnvConfig() {
  const timeoutMsRaw = Number(process.env.KTRACE_TIMEOUT_MS || NaN);
  return {
    profile: normalizeText(process.env.KTRACE_PROFILE || ''),
    baseUrl: normalizeUrl(process.env.KTRACE_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '', ''),
    chain: normalizeText(process.env.KTRACE_CHAIN || ''),
    wallet: normalizeText(process.env.KTRACE_WALLET || ''),
    outputMode: normalizeText(process.env.KTRACE_OUTPUT || ''),
    sessionStrategy: normalizeText(process.env.KTRACE_SESSION_STRATEGY || ''),
    timeoutMs: Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : undefined,
    apiKey: normalizeText(
      process.env.KTRACE_API_KEY ||
        process.env.KITECLAW_API_KEY_VIEWER ||
        process.env.KITECLAW_API_KEY_AGENT ||
        process.env.KITECLAW_API_KEY_ADMIN ||
        ''
    )
  };
}

function buildCliConfig(cliOptions = {}) {
  return {
    profile: normalizeText(cliOptions.profile || ''),
    baseUrl: normalizeUrl(cliOptions.baseUrl || '', ''),
    chain: normalizeText(cliOptions.chain || ''),
    wallet: normalizeText(cliOptions.wallet || ''),
    outputMode: cliOptions.json ? 'json' : normalizeText(cliOptions.outputMode || ''),
    sessionStrategy: normalizeText(cliOptions.sessionStrategy || ''),
    apiKey: normalizeText(cliOptions.apiKey || '')
  };
}

function pruneEmptyValues(input = {}) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      return true;
    })
  );
}

export async function writeLocalProfileConfig({
  configPath = '',
  profile = DEFAULT_CONFIG.profile,
  patch = {},
  setDefaultProfile = true
} = {}) {
  const targetPath = normalizeText(configPath || resolveConfigPath({}));
  const profileName = normalizeText(profile, DEFAULT_CONFIG.profile);
  const current = await readLocalConfig(targetPath);
  const currentProfiles =
    current?.profiles && typeof current.profiles === 'object' && !Array.isArray(current.profiles)
      ? current.profiles
      : {};
  const previous =
    currentProfiles?.[profileName] &&
    typeof currentProfiles[profileName] === 'object' &&
    !Array.isArray(currentProfiles[profileName])
      ? currentProfiles[profileName]
      : {};

  const nextProfile = {
    ...previous,
    ...pruneEmptyValues(patch)
  };
  const next = {
    ...current,
    profiles: {
      ...currentProfiles,
      [profileName]: nextProfile
    }
  };
  if (setDefaultProfile) {
    next.defaultProfile = profileName;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function resolveRuntimeConfig(cliOptions = {}) {
  const configPath = resolveConfigPath(cliOptions);
  const localConfig = await readLocalConfig(configPath);
  const envConfig = buildEnvConfig();
  const requestedProfile =
    normalizeText(cliOptions.profile || envConfig.profile || localConfig.defaultProfile || '') || DEFAULT_CONFIG.profile;
  const profileConfig =
    localConfig?.profiles && typeof localConfig.profiles === 'object'
      ? localConfig.profiles[requestedProfile] || {}
      : {};
  const cliConfig = buildCliConfig(cliOptions);

  const resolved = {
    ...DEFAULT_CONFIG,
    ...pruneEmptyValues(profileConfig),
    ...pruneEmptyValues(envConfig),
    ...pruneEmptyValues(cliConfig),
    profile: requestedProfile
  };

  resolved.baseUrl = normalizeUrl(resolved.baseUrl, DEFAULT_CONFIG.baseUrl);
  resolved.chain = normalizeText(resolved.chain, DEFAULT_CONFIG.chain);
  resolved.wallet = normalizeText(resolved.wallet, '');
  resolved.outputMode =
    normalizeText(resolved.outputMode, DEFAULT_CONFIG.outputMode).toLowerCase() === 'json' ? 'json' : 'text';
  resolved.authMode = DEFAULT_CONFIG.authMode;
  resolved.sessionMode = DEFAULT_CONFIG.sessionMode;
  resolved.sessionStrategy =
    normalizeText(resolved.sessionStrategy, DEFAULT_CONFIG.sessionStrategy).toLowerCase() === 'external'
      ? 'external'
      : DEFAULT_CONFIG.sessionStrategy;
  resolved.timeoutMs =
    Number.isFinite(Number(resolved.timeoutMs)) && Number(resolved.timeoutMs) > 0
      ? Number(resolved.timeoutMs)
      : DEFAULT_CONFIG.timeoutMs;
  resolved.apiKey = normalizeText(resolved.apiKey, '');
  resolved.apiKeyConfigured = Boolean(resolved.apiKey);
  resolved.localSessionRuntime =
    profileConfig?.sessionRuntime && typeof profileConfig.sessionRuntime === 'object' && !Array.isArray(profileConfig.sessionRuntime)
      ? profileConfig.sessionRuntime
      : null;
  resolved.localApprovalRequests =
    profileConfig?.approvalRequests &&
    typeof profileConfig.approvalRequests === 'object' &&
    !Array.isArray(profileConfig.approvalRequests)
      ? profileConfig.approvalRequests
      : {};

  return {
    config: resolved,
    meta: {
      configPath,
      profileExists: Boolean(profileConfig && Object.keys(profileConfig).length > 0),
      localConfigFound: Boolean(Object.keys(localConfig).length > 0),
      sources: {
        defaults: Object.keys(DEFAULT_CONFIG),
        profile: Object.keys(profileConfig || {}),
        env: Object.keys(pruneEmptyValues(envConfig)),
        cli: Object.keys(pruneEmptyValues(cliConfig))
      }
    }
  };
}
