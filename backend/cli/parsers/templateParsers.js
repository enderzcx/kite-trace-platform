import { consumeFlagValue } from './shared.js';

const TEMPLATE_LIST_VALUE_FLAGS = new Set(['--provider', '--capability', '--active', '--limit']);
const TEMPLATE_RESOLVE_VALUE_FLAGS = new Set(['--provider', '--capability']);
const TEMPLATE_PUBLISH_VALUE_FLAGS = new Set(['--input']);

export function parseTemplateListArgs(argv = []) {
  const options = {
    provider: '',
    capability: '',
    active: '',
    limit: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TEMPLATE_LIST_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--active') options.active = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseTemplateResolveArgs(argv = []) {
  const options = {
    provider: '',
    capability: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TEMPLATE_RESOLVE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseTemplatePublishArgs(argv = []) {
  const options = {
    input: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TEMPLATE_PUBLISH_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
