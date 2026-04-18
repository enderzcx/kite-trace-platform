/** Central chain configuration — single source of truth for HashKey Chain */

export const CHAIN_ID_DEC = 133;
export const CHAIN_ID_HEX = "0x85";
export const CHAIN_NAME = "HashKey Testnet";
export const NATIVE_TOKEN = { name: "HSK", symbol: "HSK", decimals: 18 } as const;

export const RPC_URL =
  (process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz").replace(/\/+$/, "");

export const BLOCK_EXPLORER_URL =
  (process.env.NEXT_PUBLIC_EXPLORER_URL || "https://testnet-explorer.hsk.xyz").replace(/\/+$/, "");

export const BACKEND_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:3399").replace(/\/+$/, "");

export const CONTRACTS = {
  entryPoint:            "0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598",
  identityRegistry:     "0x901A2b1c67daB5AC09A4e02bE9c1c8D52Cce650B",
  accountFactory:       "0xF43E94E2163F14c4D62242D8DD45AbAacaa6DB5a",
  ktraceAccountV3Proxy: "0xFeDa86D7eEF86aCd127F2f517C064CF1eDdFdE8b",
} as const;

export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN_NAME,
  nativeCurrency: NATIVE_TOKEN,
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [BLOCK_EXPLORER_URL],
} as const;

/** Switch or add HashKey chain in the connected wallet */
export async function ensureChain(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [ADD_CHAIN_PARAMS],
    });
  }
}

/** Helper: build explorer URL for a transaction */
export function txUrl(hash: string): string {
  return `${BLOCK_EXPLORER_URL}/tx/${hash}`;
}

/** Helper: build explorer URL for an address */
export function addressUrl(addr: string): string {
  return `${BLOCK_EXPLORER_URL}/address/${addr}`;
}