import { compileIdentityRegistry } from '../lib/contracts/compileIdentityRegistry.js';

function main() {
  const compiled = compileIdentityRegistry();
  const payload = {
    contractName: compiled.contractName,
    sourcePath: compiled.sourcePath,
    abiLength: compiled.abi.length,
    bytecodeBytes: Math.floor((compiled.bytecode.length - 2) / 2),
    deployedBytecodeBytes: Math.floor((compiled.deployedBytecode.length - 2) / 2),
    warnings: compiled.warnings
  };

  console.log(JSON.stringify(payload, null, 2));
}

try {
  main();
} catch (error) {
  console.error('ERC-8004 compile failed:', error.message);
  process.exit(1);
}
