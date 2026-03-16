export function consumeFlagValue(argv, index) {
  const current = argv[index] || '';
  const [flag, inlineValue] = current.split('=', 2);
  if (inlineValue !== undefined) {
    return { flag, value: inlineValue, consumed: 1 };
  }
  return { flag: current, value: argv[index + 1] || '', consumed: 2 };
}
