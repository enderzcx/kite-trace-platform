import { consumeFlagValue } from './shared.js';

const AUTH_SESSION_VALUE_FLAGS = new Set(['--single-limit', '--daily-limit', '--token', '--gateway-recipient']);
const SESSION_REQUEST_VALUE_FLAGS = new Set([
  '--eoa',
  '--session-key',
  '--single-limit',
  '--daily-limit',
  '--token',
  '--gateway-recipient',
  '--expires-at',
  '--allowed-capabilities',
  '--agent-id',
  '--agent-wallet',
  '--identity-registry',
  '--payer-aa-wallet',
  '--audience',
  '--nonce',
  '--issued-at'
]);
const SESSION_AUTHORIZE_VALUE_FLAGS = new Set([
  '--eoa',
  '--private-key',
  '--owner-key',
  '--session-key',
  '--single-limit',
  '--daily-limit',
  '--token',
  '--gateway-recipient',
  '--expires-at',
  '--allowed-capabilities',
  '--agent-id',
  '--agent-wallet',
  '--identity-registry',
  '--payer-aa-wallet',
  '--audience',
  '--nonce',
  '--issued-at'
]);
const SESSION_WAIT_VALUE_FLAGS = new Set(['--token', '--interval-ms', '--timeout-ms']);
const SESSION_APPROVE_VALUE_FLAGS = new Set(['--token', '--eoa', '--private-key', '--owner-key']);

export function parseAuthSessionArgs(argv = []) {
  const options = {
    singleLimit: '',
    dailyLimit: '',
    tokenAddress: '',
    gatewayRecipient: '',
    forceNewSession: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--force-new') {
      options.forceNewSession = true;
      continue;
    }
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!AUTH_SESSION_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--single-limit') options.singleLimit = String(value || '').trim();
    if (flag === '--daily-limit') options.dailyLimit = String(value || '').trim();
    if (flag === '--token') options.tokenAddress = String(value || '').trim();
    if (flag === '--gateway-recipient') options.gatewayRecipient = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseSessionAuthorizeArgs(argv = []) {
  const options = {
    userEoa: '',
    privateKey: '',
    ownerPrivateKey: '',
    sessionPrivateKey: '',
    singleLimit: '',
    dailyLimit: '',
    tokenAddress: '',
    gatewayRecipient: '',
    expiresAt: '',
    allowedCapabilities: '',
    agentId: '',
    agentWallet: '',
    identityRegistry: '',
    payerAaWallet: '',
    audience: '',
    nonce: '',
    issuedAt: '',
    external: false,
    forceNewSession: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--external') {
      options.external = true;
      continue;
    }
    if (token === '--force-new') {
      options.forceNewSession = true;
      continue;
    }
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!SESSION_AUTHORIZE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--eoa') options.userEoa = String(value || '').trim();
    if (flag === '--private-key') options.privateKey = String(value || '').trim();
    if (flag === '--owner-key') options.ownerPrivateKey = String(value || '').trim();
    if (flag === '--session-key') options.sessionPrivateKey = String(value || '').trim();
    if (flag === '--single-limit') options.singleLimit = String(value || '').trim();
    if (flag === '--daily-limit') options.dailyLimit = String(value || '').trim();
    if (flag === '--token') options.tokenAddress = String(value || '').trim();
    if (flag === '--gateway-recipient') options.gatewayRecipient = String(value || '').trim();
    if (flag === '--expires-at') options.expiresAt = String(value || '').trim();
    if (flag === '--allowed-capabilities') options.allowedCapabilities = String(value || '').trim();
    if (flag === '--agent-id') options.agentId = String(value || '').trim();
    if (flag === '--agent-wallet') options.agentWallet = String(value || '').trim();
    if (flag === '--identity-registry') options.identityRegistry = String(value || '').trim();
    if (flag === '--payer-aa-wallet') options.payerAaWallet = String(value || '').trim();
    if (flag === '--audience') options.audience = String(value || '').trim();
    if (flag === '--nonce') options.nonce = String(value || '').trim();
    if (flag === '--issued-at') options.issuedAt = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseSessionRequestArgs(argv = []) {
  const options = {
    userEoa: '',
    sessionPrivateKey: '',
    singleLimit: '',
    dailyLimit: '',
    tokenAddress: '',
    gatewayRecipient: '',
    expiresAt: '',
    allowedCapabilities: '',
    agentId: '',
    agentWallet: '',
    identityRegistry: '',
    payerAaWallet: '',
    audience: '',
    nonce: '',
    issuedAt: '',
    forceNewSession: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--force-new') {
      options.forceNewSession = true;
      continue;
    }
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!SESSION_REQUEST_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--eoa') options.userEoa = String(value || '').trim();
    if (flag === '--session-key') options.sessionPrivateKey = String(value || '').trim();
    if (flag === '--single-limit') options.singleLimit = String(value || '').trim();
    if (flag === '--daily-limit') options.dailyLimit = String(value || '').trim();
    if (flag === '--token') options.tokenAddress = String(value || '').trim();
    if (flag === '--gateway-recipient') options.gatewayRecipient = String(value || '').trim();
    if (flag === '--expires-at') options.expiresAt = String(value || '').trim();
    if (flag === '--allowed-capabilities') options.allowedCapabilities = String(value || '').trim();
    if (flag === '--agent-id') options.agentId = String(value || '').trim();
    if (flag === '--agent-wallet') options.agentWallet = String(value || '').trim();
    if (flag === '--identity-registry') options.identityRegistry = String(value || '').trim();
    if (flag === '--payer-aa-wallet') options.payerAaWallet = String(value || '').trim();
    if (flag === '--audience') options.audience = String(value || '').trim();
    if (flag === '--nonce') options.nonce = String(value || '').trim();
    if (flag === '--issued-at') options.issuedAt = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseSessionWaitArgs(argv = []) {
  const options = {
    token: '',
    intervalMs: '',
    timeoutMs: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!SESSION_WAIT_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--token') options.token = String(value || '').trim();
    if (flag === '--interval-ms') options.intervalMs = String(value || '').trim();
    if (flag === '--timeout-ms') options.timeoutMs = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseSessionApproveArgs(argv = []) {
  const options = {
    token: '',
    userEoa: '',
    privateKey: '',
    ownerPrivateKey: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!SESSION_APPROVE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--token') options.token = String(value || '').trim();
    if (flag === '--eoa') options.userEoa = String(value || '').trim();
    if (flag === '--private-key') options.privateKey = String(value || '').trim();
    if (flag === '--owner-key') options.ownerPrivateKey = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
