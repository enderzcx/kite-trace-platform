export function createCliError(message, extras = {}) {
  const error = new Error(message);
  Object.assign(error, extras);
  return error;
}
