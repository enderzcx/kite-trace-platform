import { compileJobLifecycleAnchorV2 } from '../lib/contracts/compileJobLifecycleAnchorV2.js';

try {
  const compiled = compileJobLifecycleAnchorV2();
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
  console.error('ERC-8183 job anchor V2 compile failed:', error.message);
  process.exit(1);
}
