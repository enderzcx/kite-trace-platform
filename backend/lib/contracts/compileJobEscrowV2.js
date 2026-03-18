import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACT_DIR = path.resolve(__dirname, '..', '..', 'contracts');
const ESCROW_PATH = path.resolve(CONTRACT_DIR, 'JobEscrowV2.sol');
const INTERFACE_PATH = path.resolve(CONTRACT_DIR, 'ITraceAnchorGuard.sol');

export function compileJobEscrowV2() {
  const input = {
    language: 'Solidity',
    sources: {
      'JobEscrowV2.sol': {
        content: fs.readFileSync(ESCROW_PATH, 'utf8')
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

  const contract = output?.contracts?.['JobEscrowV2.sol']?.JobEscrowV2;
  if (!contract?.evm?.bytecode?.object) {
    throw new Error('JobEscrowV2 compilation did not produce bytecode.');
  }

  return {
    sourcePath: ESCROW_PATH,
    contractName: 'JobEscrowV2',
    abi: contract.abi || [],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object || ''}`,
    warnings: messages
      .filter((item) => item?.severity !== 'error')
      .map((item) => item.formattedMessage || item.message || String(item))
  };
}
