import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(backendDir, '..');

const DEFAULT_OFFICIAL_BASE_DIR = path.resolve(repoRoot, '..', 'base-contracts-main');
const BACKEND_NODE_MODULES_DIR = path.resolve(backendDir, 'node_modules');

function normalizePath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/');
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function resolveImportFactory({
  officialBaseDir,
  officialContractsDir,
  officialNodeModulesDir
} = {}) {
  return function resolveImport(importPath = '') {
    const normalized = normalizePath(importPath);
    const candidates = [];

    if (normalized === './IACPHook.sol' || normalized === 'IACPHook.sol') {
      candidates.push(path.resolve(officialContractsDir, 'IACPHook.sol'));
    }
    if (normalized.startsWith('contracts/')) {
      candidates.push(path.resolve(officialBaseDir, normalized));
    }
    if (normalized.startsWith('@openzeppelin/')) {
      candidates.push(path.resolve(officialNodeModulesDir, normalized));
      candidates.push(path.resolve(BACKEND_NODE_MODULES_DIR, normalized));
    }
    if (normalized.startsWith('./') || normalized.startsWith('../')) {
      candidates.push(path.resolve(officialContractsDir, normalized));
      candidates.push(path.resolve(officialNodeModulesDir, normalized));
      candidates.push(path.resolve(BACKEND_NODE_MODULES_DIR, normalized));
    }
    candidates.push(path.resolve(officialBaseDir, normalized));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { contents: readUtf8(candidate) };
      }
    }
    return { error: `File not found: ${normalized}` };
  };
}

export function compileOfficialAgenticCommerce({
  officialBaseDir = process.env.ERC8183_OFFICIAL_BASE_DIR || DEFAULT_OFFICIAL_BASE_DIR
} = {}) {
  const resolvedOfficialBaseDir = path.resolve(String(officialBaseDir || '').trim() || DEFAULT_OFFICIAL_BASE_DIR);
  const officialContractsDir = path.resolve(resolvedOfficialBaseDir, 'contracts');
  const officialNodeModulesDir = path.resolve(resolvedOfficialBaseDir, 'node_modules');
  const sourceKey = 'contracts/AgenticCommerce.sol';
  const hookKey = 'contracts/IACPHook.sol';
  const proxyImportKey = 'ProxyImports.sol';

  if (!fs.existsSync(path.resolve(officialContractsDir, 'AgenticCommerce.sol'))) {
    throw new Error(`Official AgenticCommerce source not found under: ${resolvedOfficialBaseDir}`);
  }

  const input = {
    language: 'Solidity',
    sources: {
      [sourceKey]: {
        content: readUtf8(path.resolve(officialContractsDir, 'AgenticCommerce.sol'))
      },
      [hookKey]: {
        content: readUtf8(path.resolve(officialContractsDir, 'IACPHook.sol'))
      },
      [proxyImportKey]: {
        content: 'import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";'
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: 'cancun',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']
        }
      }
    }
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: resolveImportFactory({
        officialBaseDir: resolvedOfficialBaseDir,
        officialContractsDir,
        officialNodeModulesDir
      })
    })
  );
  const messages = Array.isArray(output?.errors) ? output.errors : [];
  const errors = messages.filter((item) => item?.severity === 'error');
  if (errors.length) {
    const errorText = errors
      .map((item) => item.formattedMessage || item.message || String(item))
      .join('\n\n');
    throw new Error(errorText);
  }

  const core = output?.contracts?.[sourceKey]?.AgenticCommerce;
  const proxy =
    output?.contracts?.['@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol']?.ERC1967Proxy;
  if (!core?.evm?.bytecode?.object) {
    throw new Error('Official AgenticCommerce compilation did not produce bytecode.');
  }
  if (!proxy?.evm?.bytecode?.object) {
    throw new Error('ERC1967Proxy compilation did not produce bytecode.');
  }

  return {
    officialBaseDir: resolvedOfficialBaseDir,
    sourcePath: path.resolve(officialContractsDir, 'AgenticCommerce.sol'),
    contractName: 'AgenticCommerce',
    abi: core.abi || [],
    bytecode: `0x${core.evm.bytecode.object}`,
    deployedBytecode: `0x${core.evm.deployedBytecode.object || ''}`,
    proxyAbi: proxy.abi || [],
    proxyBytecode: `0x${proxy.evm.bytecode.object}`,
    proxyDeployedBytecode: `0x${proxy.evm.deployedBytecode.object || ''}`,
    warnings: messages
      .filter((item) => item?.severity !== 'error')
      .map((item) => item.formattedMessage || item.message || String(item))
  };
}
