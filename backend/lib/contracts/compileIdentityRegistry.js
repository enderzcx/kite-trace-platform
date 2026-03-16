import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACT_PATH = path.resolve(__dirname, '..', '..', 'contracts', 'IdentityRegistryV1.sol');

function resolveImport(importPath) {
  const candidates = [
    path.resolve(path.dirname(CONTRACT_PATH), importPath),
    path.resolve(__dirname, '..', '..', 'node_modules', importPath)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }

  return null;
}

function findImports(importPath) {
  const contents = resolveImport(importPath);
  if (contents !== null) {
    return { contents };
  }
  return { error: `File not found: ${importPath}` };
}

export function compileIdentityRegistry() {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'IdentityRegistryV1.sol': {
        content: source
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const messages = Array.isArray(output?.errors) ? output.errors : [];
  const errors = messages.filter((item) => item?.severity === 'error');
  if (errors.length) {
    const errorText = errors.map((item) => item.formattedMessage || item.message || String(item)).join('\n\n');
    throw new Error(errorText);
  }

  const contract = output?.contracts?.['IdentityRegistryV1.sol']?.IdentityRegistryV1;
  if (!contract?.evm?.bytecode?.object) {
    throw new Error('IdentityRegistryV1 compilation did not produce bytecode.');
  }

  return {
    sourcePath: CONTRACT_PATH,
    contractName: 'IdentityRegistryV1',
    abi: contract.abi || [],
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object || ''}`,
    warnings: messages
      .filter((item) => item?.severity !== 'error')
      .map((item) => item.formattedMessage || item.message || String(item))
  };
}
