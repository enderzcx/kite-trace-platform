import { consumeFlagValue } from './shared.js';

const AUTH_SESSION_VALUE_FLAGS = new Set(['--single-limit', '--daily-limit', '--token', '--gateway-recipient']);
const SESSION_AUTHORIZE_VALUE_FLAGS = new Set([
  '--eoa',
  '--private-key',
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
    issuedAt: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!SESSION_AUTHORIZE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--eoa') options.userEoa = String(value || '').trim();
    if (flag === '--private-key') options.privateKey = String(value || '').trim();
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
