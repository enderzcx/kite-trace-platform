function isDisabledFlag(value = '') {
  return /^(0|false|no|off)$/i.test(String(value || '').trim());
}

function isEnabledFlag(value = '') {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

export function shouldRouteKiteRpcViaProxy(flagValue = process.env.KITE_RPC_USE_PROXY ?? '0') {
  return isEnabledFlag(flagValue);
}

export function shouldRouteKiteBundlerViaProxy(flagValue = process.env.KITE_BUNDLER_USE_PROXY ?? '0') {
  return isEnabledFlag(flagValue);
}

export function shouldUseEnvProxy(flagValue = process.env.KITE_USE_ENV_PROXY ?? '1') {
  return !isDisabledFlag(flagValue);
}

function extractHost(url = '') {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function applyNodeEnvProxyPreference() {
  const useEnvProxy = shouldUseEnvProxy();
  const existingNodeFlag = String(process.env.NODE_USE_ENV_PROXY || '').trim();
  if (!useEnvProxy) {
    return isEnabledFlag(existingNodeFlag);
  }

  const hasProxyEnv = Boolean(
    String(process.env.HTTP_PROXY || '').trim() ||
      String(process.env.HTTPS_PROXY || '').trim() ||
      String(process.env.ALL_PROXY || '').trim()
  );

  if (!existingNodeFlag && hasProxyEnv) {
    process.env.NODE_USE_ENV_PROXY = '1';
  }

  const proxyActive = isEnabledFlag(process.env.NODE_USE_ENV_PROXY || '') && hasProxyEnv;
  if (proxyActive) {
    const noProxy = String(process.env.NO_PROXY || '').trim();
    const noProxyEntries = noProxy
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const rpcHost = extractHost(
      process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/'
    );
    const bundlerHost = extractHost(
      process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/'
    );
    const extraHosts = [
      shouldRouteKiteRpcViaProxy() ? '' : rpcHost,
      shouldRouteKiteBundlerViaProxy() ? '' : bundlerHost
    ]
      .filter(Boolean)
      .filter((host) => !noProxyEntries.includes(host.toLowerCase()));

    if (extraHosts.length > 0) {
      process.env.NO_PROXY = [noProxy, ...extraHosts].filter(Boolean).join(',');
    }
  }

  return proxyActive;
}

export function getEnvProxyDiagnostics() {
  return Object.freeze({
    kiteUseEnvProxy: shouldUseEnvProxy(),
    kiteRpcUseProxy: shouldRouteKiteRpcViaProxy(),
    kiteBundlerUseProxy: shouldRouteKiteBundlerViaProxy(),
    nodeUseEnvProxy: isEnabledFlag(process.env.NODE_USE_ENV_PROXY || ''),
    hasHttpProxy: Boolean(String(process.env.HTTP_PROXY || '').trim()),
    hasHttpsProxy: Boolean(String(process.env.HTTPS_PROXY || '').trim()),
    hasAllProxy: Boolean(String(process.env.ALL_PROXY || '').trim())
  });
}
