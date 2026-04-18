import { applyNodeEnvProxyPreference, shouldRouteKiteRpcViaProxy } from './envProxy.js';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';

const DEFAULT_CHAIN_ID = Number(process.env.KITE_CHAIN_ID) || 2368;
const DEFAULT_NETWORK_NAME = process.env.KITE_NETWORK_NAME || 'kite_testnet';
const directDispatcher = new Agent();
let rpcProxyDispatcher = null;

function resolveRpcDispatcher() {
  if (!shouldRouteKiteRpcViaProxy()) return directDispatcher;
  const proxyUrl =
    String(process.env.HTTPS_PROXY || '').trim() ||
    String(process.env.HTTP_PROXY || '').trim() ||
    String(process.env.ALL_PROXY || '').trim();
  if (!proxyUrl) return directDispatcher;
  if (!rpcProxyDispatcher) {
    rpcProxyDispatcher = new ProxyAgent(proxyUrl);
  }
  return rpcProxyDispatcher;
}

function toBoundedInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(Math.round(num), max));
}

export function resolveKiteRpcTimeoutMs(value = process.env.KITE_RPC_TIMEOUT_MS) {
  return toBoundedInt(value, 60_000, 5_000, 300_000);
}

function isRetryableDirectRpcError(error = null) {
  const text = [
    String(error?.message || ''),
    String(error?.code || ''),
    String(error?.cause?.message || ''),
    String(error?.cause?.code || '')
  ]
    .join(' ')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return (
    text.includes('econnreset') ||
    text.includes('timeout') ||
    text.includes('tls') ||
    text.includes('socket') ||
    text.includes('fetch failed') ||
    text.includes('und_err_connect_timeout')
  );
}

export function createKiteRpcProvider(
  ethers,
  rpcUrl = '',
  {
    timeoutMs = process.env.KITE_RPC_TIMEOUT_MS,
    chainId = DEFAULT_CHAIN_ID,
    networkName = DEFAULT_NETWORK_NAME
  } = {}
) {
  applyNodeEnvProxyPreference();
  const request = new ethers.FetchRequest(String(rpcUrl || '').trim());
  request.timeout = resolveKiteRpcTimeoutMs(timeoutMs);
  request.getUrlFunc = async (req, signal) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      signal?.addListener?.(() => controller.abort());
      try {
        const response = await undiciFetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body || undefined,
          dispatcher: resolveRpcDispatcher(),
          signal: controller.signal
        });
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[String(key || '').toLowerCase()] = value;
        });
        return {
          statusCode: response.status,
          statusMessage: response.statusText,
          headers,
          body: response.body ? new Uint8Array(await response.arrayBuffer()) : null
        };
      } catch (error) {
        lastError = error;
        if (attempt >= 3 || !isRetryableDirectRpcError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      } finally {
        controller.abort();
      }
    }
    throw lastError || new Error('direct rpc fetch failed');
  };
  const staticNetwork = ethers.Network.from({
    chainId: Number(chainId || DEFAULT_CHAIN_ID),
    name: String(networkName || DEFAULT_NETWORK_NAME).trim() || DEFAULT_NETWORK_NAME
  });
  return new ethers.JsonRpcProvider(request, staticNetwork, { staticNetwork });
}
