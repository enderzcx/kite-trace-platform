import { consumeFlagValue } from './shared.js';

const AGENT_INVOKE_VALUE_FLAGS = new Set([
  '--provider',
  '--capability',
  '--input',
  '--trace-id',
  '--verified',
  '--discoverable'
]);

export function parseAgentInvokeArgs(argv = []) {
  const options = {
    provider: '',
    capability: '',
    input: '',
    traceId: '',
    verified: '',
    discoverable: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!AGENT_INVOKE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--input') options.input = String(value || '').trim();
    if (flag === '--trace-id') options.traceId = String(value || '').trim();
    if (flag === '--verified') options.verified = String(value || '').trim();
    if (flag === '--discoverable') options.discoverable = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
