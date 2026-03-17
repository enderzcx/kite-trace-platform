import { consumeFlagValue } from './shared.js';

const APPROVAL_LIST_VALUE_FLAGS = new Set(['--kind', '--state', '--owner', '--limit']);
const APPROVAL_SHOW_VALUE_FLAGS = new Set(['--token']);
const APPROVAL_DECISION_VALUE_FLAGS = new Set(['--token', '--note', '--reason', '--decided-by']);

export function parseApprovalListArgs(argv = []) {
  const options = {
    approvalKind: '',
    state: '',
    owner: '',
    limit: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!APPROVAL_LIST_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--kind') options.approvalKind = String(value || '').trim();
    if (flag === '--state') options.state = String(value || '').trim();
    if (flag === '--owner') options.owner = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseApprovalShowArgs(argv = []) {
  const options = { token: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!APPROVAL_SHOW_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--token') options.token = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseApprovalDecisionArgs(argv = []) {
  const options = {
    token: '',
    note: '',
    decidedBy: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!APPROVAL_DECISION_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--token') options.token = String(value || '').trim();
    if (flag === '--note' || flag === '--reason') options.note = String(value || '').trim();
    if (flag === '--decided-by') options.decidedBy = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
