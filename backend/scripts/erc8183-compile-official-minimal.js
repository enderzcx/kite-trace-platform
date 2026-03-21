import { compileOfficialMinimalAgenticCommerce } from '../lib/contracts/compileOfficialMinimalAgenticCommerce.js';

try {
  const compiled = compileOfficialMinimalAgenticCommerce();
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
  console.error('Official minimal ERC-8183 compile failed:', error.message);
  process.exit(1);
}
