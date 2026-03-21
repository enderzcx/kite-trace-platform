function isDisabledFlag(value = '') {
  return /^(0|false|no|off)$/i.test(String(value || '').trim());
}

function isEnabledFlag(value = '') {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

export function shouldUseEnvProxy(flagValue = process.env.KITE_USE_ENV_PROXY ?? '1') {
  return !isDisabledFlag(flagValue);
}

export function applyNodeEnvProxyPreference() {
  const useEnvProxy = shouldUseEnvProxy();
  const existingNodeFlag = String(process.env.NODE_USE_ENV_PROXY || '').trim();
  if (!useEnvProxy) {
    return isEnabledFlag(existingNodeFlag);
  }
  if (existingNodeFlag) {
    return isEnabledFlag(existingNodeFlag);
  }
  const hasProxyEnv = Boolean(
    String(process.env.HTTP_PROXY || '').trim() ||
      String(process.env.HTTPS_PROXY || '').trim() ||
      String(process.env.ALL_PROXY || '').trim()
  );
  if (hasProxyEnv) {
    process.env.NODE_USE_ENV_PROXY = '1';
    return true;
  }
  return false;
}

export function getEnvProxyDiagnostics() {
  return Object.freeze({
    kiteUseEnvProxy: shouldUseEnvProxy(),
    nodeUseEnvProxy: isEnabledFlag(process.env.NODE_USE_ENV_PROXY || ''),
    hasHttpProxy: Boolean(String(process.env.HTTP_PROXY || '').trim()),
    hasHttpsProxy: Boolean(String(process.env.HTTPS_PROXY || '').trim()),
    hasAllProxy: Boolean(String(process.env.ALL_PROXY || '').trim())
  });
}
