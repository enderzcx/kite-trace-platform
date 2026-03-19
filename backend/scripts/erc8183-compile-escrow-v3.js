import { compileJobEscrowV3 } from '../lib/contracts/compileJobEscrowV3.js';

try {
  const compiled = compileJobEscrowV3();
  console.log(
    JSON.stringify(
      {
        contractName: compiled.contractName,
        sourcePath: compiled.sourcePath,
        bytecodeBytes: Math.max(0, (compiled.bytecode.length - 2) / 2),
        abiItems: compiled.abi.length,
        warnings: compiled.warnings
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('ERC-8183 escrow V3 compile failed:', error.message);
  process.exit(1);
}
