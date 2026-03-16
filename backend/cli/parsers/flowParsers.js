import { consumeFlagValue } from './shared.js';

const FLOW_HISTORY_VALUE_FLAGS = new Set(['--status', '--provider', '--capability', '--limit']);
const TRUST_REPUTATION_VALUE_FLAGS = new Set(['--agent', '--lane', '--reference', '--limit']);
const TRUST_VALIDATIONS_VALUE_FLAGS = new Set(['--agent', '--reference', '--status', '--limit']);
const TRUST_PUBLICATIONS_VALUE_FLAGS = new Set(['--agent', '--type', '--status', '--limit']);
const TRUST_PUBLISH_VALUE_FLAGS = new Set(['--input']);
const SYSTEM_START_FRESH_VALUE_FLAGS = new Set(['--port', '--token-file']);

export function parseFlowHistoryArgs(argv = []) {
  const options = {
    status: '',
    provider: '',
    capability: '',
    limit: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!FLOW_HISTORY_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--status') options.status = String(value || '').trim();
    if (flag === '--provider') options.provider = String(value || '').trim();
    if (flag === '--capability') options.capability = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}

export function parseTrustReputationArgs(argv = []) {
  const options = {
    agentId: '',
    lane: '',
    referenceId: '',
    limit: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TRUST_REPUTATION_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--agent') options.agentId = String(value || '').trim();
    if (flag === '--lane') options.lane = String(value || '').trim();
    if (flag === '--reference') options.referenceId = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseTrustValidationsArgs(argv = []) {
  const options = {
    agentId: '',
    referenceId: '',
    status: '',
    limit: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TRUST_VALIDATIONS_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--agent') options.agentId = String(value || '').trim();
    if (flag === '--reference') options.referenceId = String(value || '').trim();
    if (flag === '--status') options.status = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseTrustPublicationsArgs(argv = []) {
  const options = {
    agentId: '',
    publicationType: '',
    status: '',
    limit: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TRUST_PUBLICATIONS_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--agent') options.agentId = String(value || '').trim();
    if (flag === '--type') options.publicationType = String(value || '').trim();
    if (flag === '--status') options.status = String(value || '').trim();
    if (flag === '--limit') options.limit = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseTrustPublishArgs(argv = []) {
  const options = { input: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!TRUST_PUBLISH_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--input') options.input = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseSystemStartFreshArgs(argv = []) {
  const options = {
    port: '',
    tokenFile: '',
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!SYSTEM_START_FRESH_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--port') options.port = String(value || '').trim();
    if (flag === '--token-file') options.tokenFile = String(value || '').trim();
    index += consumed - 1;
  }
  return options;
}

export function parseArtifactArgs(argv = []) {
  return {
    download: argv.some((token) => token === '--download')
  };
}

export function parseEvidenceGetArgs(argv = []) {
  return {
    download: argv.some((token) => token === '--download'),
    public: argv.some((token) => token === '--public')
  };
}
