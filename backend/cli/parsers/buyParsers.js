import { consumeFlagValue } from './shared.js';

const BUY_REQUEST_VALUE_FLAGS = new Set(['--provider', '--capability', '--input', '--trace-id']);
const BUY_DIRECT_VALUE_FLAGS = new Set(['--template', '--provider', '--capability', '--input', '--trace-id']);

export function parseBuyRequestArgs(argv = []) {
  const options = {
    provider: '',
    capability: '',
    input: '',
    traceId: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!BUY_REQUEST_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--input') options.input = String(value || '').trim();
    if (flag === '--trace-id') options.traceId = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseBuyDirectArgs(argv = []) {
  const options = {
    templateId: '',
    provider: '',
    capability: '',
    input: '',
    traceId: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!BUY_DIRECT_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--template') options.templateId = String(value || '').trim();
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--input') options.input = String(value || '').trim();
    if (flag === '--trace-id') options.traceId = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
