import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACT_PATH = path.resolve(__dirname, '..', '..', 'contracts', 'JobLifecycleAnchorV1.sol');

export function compileJobLifecycleAnchor() {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'JobLifecycleAnchorV1.sol': {
        content: source
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

  const contract = output?.contracts?.['JobLifecycleAnchorV1.sol']?.JobLifecycleAnchorV1;
  if (!contract?.evm?.bytecode?.object) {
    throw new Error('JobLifecycleAnchorV1 compilation did not produce bytecode.');
  }

  return {
    sourcePath: CONTRACT_PATH,
    contractName: 'JobLifecycleAnchorV1',
    abi: contract.abi || [],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object || ''}`,
    warnings: messages
      .filter((item) => item?.severity !== 'error')
      .map((item) => item.formattedMessage || item.message || String(item))
  };
}
