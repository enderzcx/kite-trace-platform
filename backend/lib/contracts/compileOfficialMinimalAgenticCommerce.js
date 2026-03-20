import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACT_DIR = path.resolve(__dirname, '..', '..', 'contracts');
const CONTRACT_PATH = path.resolve(CONTRACT_DIR, 'AgenticCommerceOfficialMinimal.sol');

function resolveImport(importPath = '') {
  const normalized = String(importPath || '').trim();
  const localCandidate = path.resolve(CONTRACT_DIR, normalized.replace(/^\.\//, ''));
  if (fs.existsSync(localCandidate)) {
    return { contents: fs.readFileSync(localCandidate, 'utf8') };
  }
  const nodeModuleCandidate = path.resolve(CONTRACT_DIR, '..', 'node_modules', normalized);
  if (fs.existsSync(nodeModuleCandidate)) {
    return { contents: fs.readFileSync(nodeModuleCandidate, 'utf8') };
  }
  return { error: `File not found: ${normalized}` };
}

export function compileOfficialMinimalAgenticCommerce() {
  const input = {
    language: 'Solidity',
    sources: {
      'AgenticCommerceOfficialMinimal.sol': {
        content: fs.readFileSync(CONTRACT_PATH, 'utf8')
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const messages = Array.isArray(output?.errors) ? output.errors : [];
  const errors = messages.filter((item) => item?.severity === 'error');
  if (errors.length) {
    const errorText = errors.map((item) => item.formattedMessage || item.message || String(item)).join('\n\n');
    throw new Error(errorText);
  }

  const contract =
    output?.contracts?.['AgenticCommerceOfficialMinimal.sol']?.AgenticCommerceOfficialMinimal;
  if (!contract?.evm?.bytecode?.object) {
    throw new Error('AgenticCommerceOfficialMinimal compilation did not produce bytecode.');
  }

  return {
    sourcePath: CONTRACT_PATH,
    contractName: 'AgenticCommerceOfficialMinimal',
    abi: contract.abi || [],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object || ''}`,
    warnings: messages
      .filter((item) => item?.severity !== 'error')
      .map((item) => item.formattedMessage || item.message || String(item))
  };
}
