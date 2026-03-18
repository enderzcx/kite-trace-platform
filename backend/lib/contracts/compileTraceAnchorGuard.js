import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACT_DIR = path.resolve(__dirname, '..', '..', 'contracts');
const GUARD_PATH = path.resolve(CONTRACT_DIR, 'TraceAnchorGuard.sol');
const INTERFACE_PATH = path.resolve(CONTRACT_DIR, 'ITraceAnchorGuard.sol');

export function compileTraceAnchorGuard() {
  const input = {
    language: 'Solidity',
    sources: {
      'TraceAnchorGuard.sol': {
        content: fs.readFileSync(GUARD_PATH, 'utf8')
      },
      'ITraceAnchorGuard.sol': {
        content: fs.readFileSync(INTERFACE_PATH, 'utf8')
      },
      './ITraceAnchorGuard.sol': {
        content: fs.readFileSync(INTERFACE_PATH, 'utf8')
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true,
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const messages = Array.isArray(output?.errors) ? output.errors : [];
  const errors = messages.filter((item) => item?.severity === 'error');
  if (errors.length) {
    const errorText = errors.map((item) => item.formattedMessage || item.message || String(item)).join('\n\n');
    throw new Error(errorText);
  }

  const contract = output?.contracts?.['TraceAnchorGuard.sol']?.TraceAnchorGuard;
  if (!contract?.evm?.bytecode?.object) {
    throw new Error('TraceAnchorGuard compilation did not produce bytecode.');
  }

  return {
    sourcePath: GUARD_PATH,
    contractName: 'TraceAnchorGuard',
    abi: contract.abi || [],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object || ''}`,
    warnings: messages
      .filter((item) => item?.severity !== 'error')
      .map((item) => item.formattedMessage || item.message || String(item))
  };
}
