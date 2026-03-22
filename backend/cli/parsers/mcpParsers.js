import { consumeFlagValue } from './shared.js';

const MCP_BRIDGE_VALUE_FLAGS = new Set(['--session-runtime']);

export function parseMcpBridgeArgs(argv = []) {
  const options = {
    sessionRuntime: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const normalizedFlag = token.includes('=') ? token.split('=', 1)[0] : token;
    if (!MCP_BRIDGE_VALUE_FLAGS.has(normalizedFlag)) continue;
    const { flag, value, consumed } = consumeFlagValue(argv, index);
    if (flag === '--session-runtime') options.sessionRuntime = String(value || '').trim();
    index += consumed - 1;
  }

  return options;
}
