import { compileKTraceAccountV3SessionExecute } from '../lib/contracts/compileKTraceAccountV3SessionExecute.js';

try {
  const compiled = compileKTraceAccountV3SessionExecute();
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
  console.error('AA V3 compile failed:', error.message);
  process.exit(1);
}
