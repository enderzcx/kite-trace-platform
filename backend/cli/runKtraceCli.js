import { parseGlobalArgs } from './parsers/globalParsers.js';
import { runParsedKtraceCli } from './runKtraceCliRuntime.js';

export async function runKtraceCli(argv = []) {
  const { options, passthrough } = parseGlobalArgs(argv);
  return runParsedKtraceCli({ options, passthrough });
}
