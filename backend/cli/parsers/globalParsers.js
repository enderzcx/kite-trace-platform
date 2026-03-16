import { consumeFlagValue } from './shared.js';

const GLOBAL_VALUE_FLAGS = new Set(['--profile', '--base-url', '--wallet', '--chain', '--api-key', '--config', '--session-strategy']);

export function parseGlobalArgs(argv = []) {
  const options = {
    json: false,
    help: false,
    version: false,
    profile: '',
    baseUrl: '',
    wallet: '',
    chain: '',
    apiKey: '',
    configPath: '',
    sessionStrategy: '',
    outputMode: ''
  };
  const passthrough = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--version' || token === '-v') {
      options.version = true;
      continue;
    }
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (GLOBAL_VALUE_FLAGS.has(normalizedFlag)) {
      const { flag, value, consumed } = consumeFlagValue(argv, index);
      if (flag === '--profile') options.profile = value;
      if (flag === '--base-url') options.baseUrl = value;
      if (flag === '--wallet') options.wallet = value;
      if (flag === '--chain') options.chain = value;
      if (flag === '--api-key') options.apiKey = value;
      if (flag === '--config') options.configPath = value;
      if (flag === '--session-strategy') options.sessionStrategy = value;
      index += consumed - 1;
      continue;
    }
    passthrough.push(token);
  }

  return {
    options,
    passthrough
  };
}
