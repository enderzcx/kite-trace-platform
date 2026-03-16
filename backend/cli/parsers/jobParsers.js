import { consumeFlagValue } from './shared.js';

const JOB_CREATE_VALUE_FLAGS = new Set(['--provider', '--capability', '--input', '--budget', '--trace-id', '--template', '--evaluator', '--expires-at']);
const JOB_SUBMIT_VALUE_FLAGS = new Set(['--input']);
const JOB_COMPLETE_VALUE_FLAGS = new Set(['--input']);
const JOB_REJECT_VALUE_FLAGS = new Set(['--input']);

export function parseJobCreateArgs(argv = []) {
  const options = {
    provider: '',
    capability: '',
    input: '',
    budget: '',
    traceId: '',
    templateId: '',
    evaluator: '',
    expiresAt: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!JOB_CREATE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--input') options.input = String(value || '').trim();
    if (flag === '--budget') options.budget = String(value || '').trim();
    if (flag === '--trace-id') options.traceId = String(value || '').trim();
    if (flag === '--template') options.templateId = String(value || '').trim();
    if (flag === '--evaluator') options.evaluator = String(value || '').trim();
    if (flag === '--expires-at') options.expiresAt = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseJobSubmitArgs(argv = []) {
  const options = { input: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!JOB_SUBMIT_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseJobCompleteArgs(argv = []) {
  const options = { input: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!JOB_COMPLETE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseJobRejectArgs(argv = []) {
  const options = { input: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!JOB_REJECT_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}
