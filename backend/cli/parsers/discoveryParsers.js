import { consumeFlagValue } from './shared.js';

const DISCOVERY_SELECT_VALUE_FLAGS = new Set(['--capability', '--provider', '--lane', '--verified', '--discoverable', '--limit']);
const DISCOVERY_RECOMMEND_VALUE_FLAGS = new Set(['--capability', '--provider', '--verified', '--discoverable']);

export function parseDiscoverySelectArgs(argv = []) {
  const options = {
    capability: '',
    provider: '',
    lane: '',
    verified: '',
    discoverable: '',
    limit: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!DISCOVERY_SELECT_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--lane') options.lane = String(value || '').trim();
    if (flag === '--verified') options.verified = String(value || '').trim();
    if (flag === '--discoverable') options.discoverable = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseDiscoveryRecommendArgs(argv = []) {
  const options = {
    capability: '',
    provider: '',
    verified: '',
    discoverable: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!DISCOVERY_RECOMMEND_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--verified') options.verified = String(value || '').trim();
    if (flag === '--discoverable') options.discoverable = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
