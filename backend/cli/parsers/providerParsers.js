import { consumeFlagValue } from './shared.js';

const PROVIDER_LIST_VALUE_FLAGS = new Set([
  '--role',
  '--mode',
  '--capability',
  '--active',
  '--verified',
  '--identity-linked',
  '--approval-status',
  '--discoverable',
  '--q',
  '--limit'
]);
const PROVIDER_REGISTER_VALUE_FLAGS = new Set(['--input']);
const CAPABILITY_LIST_VALUE_FLAGS = new Set([
  '--provider',
  '--action',
  '--lane',
  '--provider-verified',
  '--provider-discoverable',
  '--active',
  '--q',
  '--limit'
]);
const CAPABILITY_PUBLISH_VALUE_FLAGS = new Set(['--input']);

export function parseProviderListArgs(argv = []) {
  const options = {
    role: '',
    mode: '',
    capability: '',
    active: '',
    verified: '',
    identityLinked: '',
    approvalStatus: '',
    discoverable: '',
    q: '',
    limit: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!PROVIDER_LIST_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--role') options.role = String(value || '').trim();
    if (flag === '--mode') options.mode = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--active') options.active = String(value || '').trim();
    if (flag === '--verified') options.verified = String(value || '').trim();
    if (flag === '--identity-linked') options.identityLinked = String(value || '').trim();
    if (flag === '--approval-status') options.approvalStatus = String(value || '').trim();
    if (flag === '--discoverable') options.discoverable = String(value || '').trim();
    if (flag === '--q') options.q = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseProviderRegisterArgs(argv = []) {
  const options = {
    input: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!PROVIDER_REGISTER_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseCapabilityListArgs(argv = []) {
  const options = {
    provider: '',
    action: '',
    lane: '',
    providerVerified: '',
    providerDiscoverable: '',
    active: '',
    q: '',
    limit: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!CAPABILITY_LIST_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--action') options.action = String(value || '').trim();
    if (flag === '--lane') options.lane = String(value || '').trim();
    if (flag === '--provider-verified') options.providerVerified = String(value || '').trim();
    if (flag === '--provider-discoverable') options.providerDiscoverable = String(value || '').trim();
    if (flag === '--active') options.active = String(value || '').trim();
    if (flag === '--q') options.q = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseCapabilityPublishArgs(argv = []) {
  const options = {
    input: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!CAPABILITY_PUBLISH_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
