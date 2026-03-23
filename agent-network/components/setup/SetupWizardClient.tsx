"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, Wallet, getAddress, getBytes, isAddress, keccak256, parseUnits, toBeHex, toUtf8Bytes, zeroPadValue } from "ethers";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Droplets,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  Unlink,
  Wallet as WalletIcon,
  Zap,
} from "lucide-react";

// 鈹€鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type Step = 0 | 1 | 2 | 3 | 4;
// 0 = Connect Wallet
// 1 = Fund AA Wallet
// 2 = Register Agent Identity
// 3 = Authorize Session
// 4 = Setup Complete / Choose Access Method

type UserType = "new" | "returning";

interface SessionRuntime {
  aaWallet?: string;
  agentId?: string;
  agentWallet?: string;
  identityRegistry?: string;
  identityRegisterTxHash?: string;
  identityBindTxHash?: string;
  chainId?: string;
  payerAaWallet?: string;
  tokenAddress?: string;
  gatewayRecipient?: string;
  sessionId?: string;
  sessionAddress?: string;
  sessionTxHash?: string;
  owner?: string;
  aaDeployed?: boolean;
  lifecycleStage?: string;
  salt?: string;
  accountFactoryAddress?: string;
  accountImplementationAddress?: string;
  activeAccountFactoryAddress?: string;
  activeAccountImplementationAddress?: string;
  activeEscrowAddress?: string;
  activeSettlementTokenAddress?: string;
  isDefaultFactoryRuntime?: boolean;
  runtimeHealth?: string;
  entryPointAddress?: string;
  singleLimit?: string;
  dailyLimit?: string;
  currentBlockTimestamp?: number;
  expiresAt?: number;
  authorizationExpiresAt?: number;
  authorizationSignature?: string;
  authorizationPayloadHash?: string;
  sessionRules?: SessionRule[];
  runtimeSource?: string;
  accountVersion?: string;
  accountVersionTag?: string;
  accountCapabilities?: {
    sessionPayment?: boolean;
    sessionGenericExecute?: boolean;
  };
  requiredForJobLane?: boolean;
}

interface SessionRule {
  timeWindow: string;
  budget: string;
  initialWindowStartTime: number;
  targetProviders: string[];
}

interface IdentityProfileResponse {
  ok?: boolean;
  profile?: {
    agentId?: string;
    registry?: string;
    agentWallet?: string;
    ownerAddress?: string;
    configured?: {
      agentId?: string;
      registry?: string;
    };
  };
  reason?: string;
  error?: string;
}

interface AccountStatus {
  userType: UserType;
  sessionValid: boolean; // sessionId present 鈫?previously authorized
  aaBalance: number;     // native KITE in AA wallet
  eoaBalance: number;    // native KITE in EOA wallet
  aaTokenBalance: number;
  eoaTokenBalance: number;
  aaBalanceKnown?: boolean;
  eoaBalanceKnown?: boolean;
  aaTokenBalanceKnown?: boolean;
  eoaTokenBalanceKnown?: boolean;
}

interface SetupSnapshot {
  ownerEoa: string;
  aaWallet: string;
  aaDeployed: boolean;
  isDefaultFactoryRuntime: boolean;
  hasIdentity: boolean;
  agentId: string;
  identityRegistry: string;
  agentWalletMatchesAa: boolean;
  hasLocalSessionExport: boolean;
  sessionAuthorized: boolean;
  kiteBalanceReady: boolean;
  settlementBalanceReady: boolean;
  sessionRuntimeReady: boolean;
}

interface ApiKeyMeta {
  keyId: string;
  maskedPreview: string;
  role: string;
  createdAt: string;
  revokedAt?: string | null;
}

interface LocalSessionRuntimeExport {
  schema: "ktrace-local-session-runtime-v1";
  createdAt: number;
  runtime: {
    owner: string;
    aaWallet: string;
    sessionAddress: string;
    sessionPrivateKey: string;
    sessionId: string;
    sessionTxHash: string;
    tokenAddress: string;
    gatewayRecipient: string;
    maxPerTx: number;
    dailyLimit: number;
    agentId: string;
    agentWallet: string;
    identityRegistry: string;
    chainId: string;
    runtimePurpose: "consumer";
    source: string;
  };
}

interface Props {
  capabilities: Array<{ id: string; name: string; providerId: string }> | string[];
}

// 鈹€鈹€鈹€ Ethereum 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const KITE_TESTNET_CHAIN_ID = 2368;
const AA_SESSION_ABI = [
  "function addSupportedToken(address token) external",
  "function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external",
];
const AA_SESSION_PERMISSION_ABI = [
  "function getSessionSelectorPermission(bytes32 sessionId, address target, bytes4 selector) view returns (bool enabled, uint256 maxAmount)",
  "function setSessionSelectorPermissions(tuple(bytes32 sessionId,address target,bytes4 selector,bool enabled,uint256 maxAmount)[] updates) external",
];
const ACCOUNT_FACTORY_ABI = [
  "function createAccount(address owner, uint256 salt) returns (address)",
];
const ACCOUNT_VERSION_ABI = [
  "function version() view returns (string)",
];
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const IDENTITY_REGISTRY_ABI = [
  "function registerFee() view returns (uint256)",
  "function register(string tokenURI) payable returns (uint256)",
  "function setAgentWallet(uint256 agentId, address newWallet) payable",
  "function metadataUpdateFee() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];
const DEFAULT_IDENTITY_REGISTRY = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY?.trim() || "";
const SUGGEST_SETTLEMENT = "0.5";
const KTRACE_SETUP_MODE = process.env.NEXT_PUBLIC_KTRACE_SETUP_MODE?.trim().toLowerCase() === "remote"
  ? "remote"
  : "local";
const KITE_READ_RPC_URL = process.env.NEXT_PUBLIC_KITE_RPC_URL?.trim() || "";
const LOCAL_CONNECTOR_CLIENT = "inspector";
const LOCAL_CONNECTOR_CLIENT_ID = "local-setup";
const LOCAL_BACKEND_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://127.0.0.1:3217").replace(/\/+$/, "");
const LOCAL_SESSION_RUNTIME_STORAGE_KEY = "ktrace.localSessionRuntime.v1";

function getEthereum(): EthProvider | undefined {
  return (window as unknown as { ethereum?: EthProvider }).ethereum;
}

function getBrowserProvider() {
  const eth = getEthereum();
  if (!eth) return null;
  return new BrowserProvider(eth as never);
}

let cachedReadOnlyProvider: JsonRpcProvider | null = null;

function getReadOnlyProvider() {
  if (!KITE_READ_RPC_URL) return null;
  if (!cachedReadOnlyProvider) {
    cachedReadOnlyProvider = new JsonRpcProvider(KITE_READ_RPC_URL, "any");
  }
  return cachedReadOnlyProvider;
}

function normalizeAccountAddress(value = ""): string {
  return String(value || "").trim().toLowerCase();
}

function extractConnectorToken(value = ""): string {
  const match = String(value || "").match(/\/mcp\/connect\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function buildLocalConnectorUrl(connectorUrl = ""): string {
  const token = extractConnectorToken(connectorUrl);
  if (!token) return "";
  return `${LOCAL_BACKEND_BASE_URL}/mcp/connect/${encodeURIComponent(token)}`;
}

function formatWalletMismatchReason(reason = "", expected = ""): string {
  const normalizedReason = String(reason || "").trim();
  const requestedMatch = normalizedReason.match(/requested=([0-9a-fA-Fx]+)/);
  const signerMatch = normalizedReason.match(/signer=([0-9a-fA-Fx]+)/);
  const requested = requestedMatch?.[1] || expected;
  const signer = signerMatch?.[1] || "";
  if (requested || signer) {
    return `Wallet account mismatch. Connected ${requested || "address"} but signature came from ${signer || "another account"}. Switch your wallet to the same account and retry.`;
  }
  return "Wallet account mismatch. Switch your wallet to the same account you connected with, then retry.";
}

// 鈹€鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function shorten(value = "", head = 8, tail = 6): string {
  const v = String(value).trim();
  if (!v || v.length <= head + tail + 3) return v;
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

function toHex(str: string): string {
  return (
    "0x" +
    Array.from(new TextEncoder().encode(str))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return "0x" + Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readStoredLocalSessionRuntime(): LocalSessionRuntimeExport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LOCAL_SESSION_RUNTIME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSessionRuntimeExport;
    if (!parsed || parsed.schema !== "ktrace-local-session-runtime-v1" || !parsed.runtime) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistLocalSessionRuntime(value: LocalSessionRuntimeExport | null) {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.sessionStorage.removeItem(LOCAL_SESSION_RUNTIME_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(LOCAL_SESSION_RUNTIME_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage failures on locked-down browsers
  }
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildLocalSessionRuntimeExport(
  runtime: SessionRuntime,
  sessionPrivateKey: string,
  {
    owner,
    sessionAddress,
    sessionId,
    sessionTxHash,
    singleLimit,
    dailyLimit,
  }: {
    owner: string;
    sessionAddress: string;
    sessionId: string;
    sessionTxHash: string;
    singleLimit: string;
    dailyLimit: string;
  }
): LocalSessionRuntimeExport {
  return {
    schema: "ktrace-local-session-runtime-v1",
    createdAt: Date.now(),
    runtime: {
      owner,
      aaWallet: runtime.aaWallet ?? runtime.payerAaWallet ?? "",
      sessionAddress,
      sessionPrivateKey,
      sessionId,
      sessionTxHash,
      tokenAddress: runtime.tokenAddress ?? "",
      gatewayRecipient: runtime.gatewayRecipient ?? "",
      maxPerTx: Number(singleLimit || "0"),
      dailyLimit: Number(dailyLimit || "0"),
      agentId: runtime.agentId ?? "",
      agentWallet: runtime.agentWallet ?? "",
      identityRegistry: runtime.identityRegistry ?? "",
      chainId: runtime.chainId ?? "kite-testnet",
      runtimePurpose: "consumer",
      source: "browser_setup_local_only",
    },
  };
}

async function ensureKiteTestnet(eth: EthProvider) {
  const chainHex = `0x${KITE_TESTNET_CHAIN_ID.toString(16)}`;
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (String(current).toLowerCase() === chainHex.toLowerCase()) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch {
    throw new Error("Please switch your wallet to KiteAI Testnet before continuing.");
  }
}

async function getBalance(eth: EthProvider, address: string): Promise<number | null> {
  try {
    const readOnlyProvider = getReadOnlyProvider();
    if (readOnlyProvider && address) {
      const balance = await readOnlyProvider.getBalance(address);
      return Number(balance) / 1e18;
    }
    const hex = (await eth.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    })) as string;
    return parseInt(hex, 16) / 1e18;
  } catch {
    return null;
  }
}

function parseRuntime(json: Record<string, unknown>): SessionRuntime {
  const bootstrap =
    (json.bootstrap as Record<string, unknown> | undefined) ??
    {};
  const bootstrapRuntime =
    (bootstrap.runtime as Record<string, unknown> | undefined) ??
    {};
  const nested =
    (json.runtime as Record<string, unknown> | undefined) ??
    (json.session as Record<string, unknown> | undefined) ??
    bootstrapRuntime ??
    {};
  const authorizationPayload =
    (nested.authorizationPayload as Record<string, unknown> | undefined) ??
    (json.authorizationPayload as Record<string, unknown> | undefined) ??
    {};
  const pick = (k: string): string | undefined =>
    (json[k] as string | undefined) ??
    (nested[k] as string | undefined) ??
    (bootstrapRuntime[k] as string | undefined) ??
    (bootstrap[k] as string | undefined);
  const resolvedAaWallet = pick("aaWallet") ?? pick("payerAaWallet");
  const resolvedPayerAaWallet = pick("payerAaWallet") ?? resolvedAaWallet;
  const sessionRules = Array.isArray(bootstrap.sessionRules)
    ? (bootstrap.sessionRules as SessionRule[])
    : [];
  const inferredAaDeployed = Boolean(
    (bootstrap.deployed as boolean | undefined) ??
      (json.deployed as boolean | undefined) ??
      (nested.deployed as boolean | undefined) ??
      (resolvedAaWallet &&
        (
          pick("accountVersion") ||
          pick("sessionAddress") ||
          pick("sessionId") ||
          pick("runtimeHealth")
        ))
  );
  return {
    aaWallet: resolvedAaWallet,
    agentId:
      pick("agentId") ??
      pick("authorizedAgentId") ??
      (authorizationPayload.agentId as string | undefined),
    agentWallet:
      pick("agentWallet") ??
      pick("authorizedAgentWallet") ??
      (authorizationPayload.agentWallet as string | undefined),
      identityRegistry:
        pick("identityRegistry") ??
        (authorizationPayload.identityRegistry as string | undefined),
      identityRegisterTxHash: pick("identityRegisterTxHash"),
      identityBindTxHash: pick("identityBindTxHash"),
      chainId: pick("chainId") ?? "kite-testnet",
    payerAaWallet: resolvedPayerAaWallet,
    tokenAddress: pick("tokenAddress"),
    gatewayRecipient: pick("gatewayRecipient"),
    sessionId: pick("sessionId"),
    sessionAddress: pick("sessionAddress"),
    sessionTxHash: pick("sessionTxHash"),
    owner: pick("owner"),
    aaDeployed: inferredAaDeployed,
    lifecycleStage: pick("lifecycleStage"),
    salt: pick("salt"),
    accountFactoryAddress: pick("accountFactoryAddress"),
    accountImplementationAddress: pick("accountImplementationAddress"),
    activeAccountFactoryAddress: pick("activeAccountFactoryAddress"),
    activeAccountImplementationAddress: pick("activeAccountImplementationAddress"),
    activeEscrowAddress: pick("activeEscrowAddress"),
    activeSettlementTokenAddress: pick("activeSettlementTokenAddress"),
    isDefaultFactoryRuntime: Boolean(
      (json.isDefaultFactoryRuntime as boolean | undefined) ??
        (nested.isDefaultFactoryRuntime as boolean | undefined) ??
        (bootstrapRuntime.isDefaultFactoryRuntime as boolean | undefined) ??
        (bootstrap.isDefaultFactoryRuntime as boolean | undefined)
    ),
    runtimeHealth:
      (json.runtimeHealth as string | undefined) ??
      (nested.runtimeHealth as string | undefined) ??
      (bootstrapRuntime.runtimeHealth as string | undefined) ??
      (bootstrap.runtimeHealth as string | undefined),
    entryPointAddress: pick("entryPointAddress"),
    singleLimit: pick("singleLimit"),
    dailyLimit: pick("dailyLimit"),
    accountVersion: pick("accountVersion"),
    accountVersionTag: pick("accountVersionTag"),
    accountCapabilities: (
      (
        json.accountCapabilities ??
        nested.accountCapabilities ??
        bootstrapRuntime.accountCapabilities ??
        bootstrap.accountCapabilities
      ) as
        | { sessionPayment?: boolean; sessionGenericExecute?: boolean }
        | undefined
    ),
    requiredForJobLane: Boolean(
      (json.requiredForJobLane as boolean | undefined) ??
        (nested.requiredForJobLane as boolean | undefined) ??
        (bootstrapRuntime.requiredForJobLane as boolean | undefined) ??
        false
    ),
    currentBlockTimestamp: Number(
      (bootstrap.currentBlockTimestamp as number | undefined) ??
        (bootstrapRuntime.currentBlockTimestamp as number | undefined) ??
        (json.currentBlockTimestamp as number | undefined) ??
        0
    ),
    expiresAt: Number(
      (json.expiresAt as number | undefined) ??
        (nested.expiresAt as number | undefined) ??
        (bootstrap.expiresAt as number | undefined) ??
        0
    ),
    authorizationExpiresAt: Number(
      (json.authorizationExpiresAt as number | undefined) ??
        (nested.authorizationExpiresAt as number | undefined) ??
        (bootstrap.authorizationExpiresAt as number | undefined) ??
        0
    ),
    authorizationSignature: pick("authorizationSignature"),
    authorizationPayloadHash: pick("authorizationPayloadHash"),
    sessionRules,
    runtimeSource: pick("source"),
  };
}

function hasAuthorizedSessionRuntime(runtime: SessionRuntime | null | undefined): boolean {
  if (!runtime) return false;
  const sessionId = String(runtime.sessionId || "").trim();
  const sessionAddress = String(runtime.sessionAddress || "").trim();
  const authorizationSignature = String(
    (runtime as SessionRuntime & { authorizationSignature?: string }).authorizationSignature || ""
  ).trim();
  const authorizationPayloadHash = String(
    (runtime as SessionRuntime & { authorizationPayloadHash?: string }).authorizationPayloadHash || ""
  ).trim();
  return Boolean(sessionId && sessionAddress && authorizationSignature && authorizationPayloadHash);
}

function hasUsableLocalSessionRuntime(
  value: LocalSessionRuntimeExport | null | undefined,
  runtime: SessionRuntime | null | undefined,
  ownerEoa = ""
): boolean {
  if (!value?.runtime) return false;
  const localOwner = normalizeAccountAddress(value.runtime.owner || "");
  const requestedOwner = normalizeAccountAddress(ownerEoa || runtime?.owner || "");
  if (!localOwner || !requestedOwner || localOwner !== requestedOwner) return false;
  const localAaWallet = normalizeAccountAddress(value.runtime.aaWallet || "");
  const runtimeAaWallet = normalizeAccountAddress(runtime?.aaWallet || runtime?.payerAaWallet || "");
  if (runtimeAaWallet && localAaWallet && runtimeAaWallet !== localAaWallet) return false;
  return Boolean(
    value.runtime.sessionAddress &&
      value.runtime.sessionId &&
      value.runtime.sessionPrivateKey
  );
}

function buildSetupSnapshot({
  ownerEoa = "",
  runtime,
  accountStatus,
  localSessionRuntimeExport,
}: {
  ownerEoa?: string;
  runtime: SessionRuntime | null | undefined;
  accountStatus: AccountStatus | null | undefined;
  localSessionRuntimeExport: LocalSessionRuntimeExport | null | undefined;
}): SetupSnapshot {
  const normalizedOwner = normalizeAccountAddress(ownerEoa || runtime?.owner || "");
  const aaWallet = String(runtime?.aaWallet || runtime?.payerAaWallet || "").trim();
  const runtimeHealth = String(runtime?.runtimeHealth || "").trim().toLowerCase() || "active_default";
  const isDefaultFactoryRuntime =
    runtime?.isDefaultFactoryRuntime === true && runtimeHealth === "active_default";
  const hasIdentity = Boolean(runtime && hasRuntimeIdentity(runtime));
  const agentWalletMatchesAa =
    Boolean(
      runtime?.agentWallet &&
        aaWallet &&
        normalizeAccountAddress(runtime.agentWallet) === normalizeAccountAddress(aaWallet)
    );
  const sessionRuntimeReady = Boolean(
    aaWallet && runtime && supportsSessionGenericExecution(runtime) && isDefaultFactoryRuntime
  );

  return {
    ownerEoa: normalizedOwner,
    aaWallet,
    aaDeployed: Boolean(runtime?.aaDeployed),
    isDefaultFactoryRuntime,
    hasIdentity,
    agentId: String(runtime?.agentId || "").trim(),
    identityRegistry: String(runtime?.identityRegistry || "").trim(),
    agentWalletMatchesAa,
    hasLocalSessionExport: hasUsableLocalSessionRuntime(localSessionRuntimeExport, runtime, normalizedOwner),
    sessionAuthorized: hasAuthorizedSessionRuntime(runtime),
    kiteBalanceReady: Boolean((accountStatus?.aaBalance || 0) > 0),
    settlementBalanceReady: Boolean((accountStatus?.aaTokenBalance || 0) > 0),
    sessionRuntimeReady,
  };
}

function resolveInitialWizardStep(snapshot: SetupSnapshot): Step {
  if (!snapshot.ownerEoa) return 0;
  if (!snapshot.aaWallet || !snapshot.aaDeployed) return 1;
  if (!snapshot.hasIdentity || !snapshot.agentWalletMatchesAa) return 2;
  if (!snapshot.sessionRuntimeReady || !snapshot.sessionAuthorized || !snapshot.hasLocalSessionExport) return 3;
  return 4;
}

async function getTokenMeta(tokenAddress: string): Promise<{ symbol: string; decimals: number }> {
  const provider = getReadOnlyProvider() ?? getBrowserProvider();
  if (!provider || !tokenAddress) return { symbol: "USDT", decimals: 6 };
  try {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      token.symbol().catch(() => "USDT"),
      token.decimals().catch(() => 6),
    ]);
    return {
      symbol: String(symbol || "USDT"),
      decimals: Number(decimals || 6),
    };
  } catch {
    return { symbol: "USDT", decimals: 6 };
  }
}

async function getTokenBalance(tokenAddress: string, address: string): Promise<number | null> {
  const provider = getReadOnlyProvider() ?? getBrowserProvider();
  if (!provider || !tokenAddress || !address) return null;
  try {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const [rawBalance, decimals] = await Promise.all([
      token.balanceOf(address),
      token.decimals().catch(() => 6),
    ]);
    return Number(rawBalance) / 10 ** Number(decimals || 6);
  } catch {
    return null;
  }
}

async function fetchSetupRuntime(ownerEoa: string): Promise<SessionRuntime> {
  if (!ownerEoa || !isAddress(ownerEoa)) {
    throw new Error("Please connect a valid Ethereum wallet first.");
  }
  const runtimeRes = await fetch("/api/setup/session/runtime", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const runtimeJson = (await runtimeRes.json()) as Record<string, unknown>;
  const currentRuntime =
    runtimeRes.ok && runtimeJson.ok ? parseRuntime(runtimeJson) : ({} as SessionRuntime);
  const requestedOwner = normalizeAccountAddress(ownerEoa);
  const runtimeOwner = normalizeAccountAddress(currentRuntime.owner ?? "");
  if (runtimeOwner && runtimeOwner === requestedOwner) {
    return currentRuntime;
  }

  const prepareRes = await fetch("/api/setup/runtime/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerEoa }),
    credentials: "include",
  });
  const prepareJson = (await prepareRes.json()) as Record<string, unknown>;
  if (!prepareRes.ok || !prepareJson.ok) {
    throw new Error(
      ((prepareJson.reason ?? prepareJson.error) as string | undefined) ??
        "AA bootstrap prepare failed."
    );
  }
  return parseRuntime(prepareJson);
}

function buildSignMessage(
  runtime: SessionRuntime,
  opts: {
    singleLimit: string;
    dailyLimit: string;
    allowedCapabilities: string[];
    userEoa: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    audience: string;
  }
): string {
  const normalizeSigningAddress = (value: string | undefined) => {
    const raw = String(value ?? "").trim();
    return raw && isAddress(raw) ? getAddress(raw) : "";
  };
  const normalizedCapabilities = Array.from(
    new Set(opts.allowedCapabilities.map((cap) => String(cap || "").trim().toLowerCase()).filter(Boolean))
  ).sort();
  return [
    "KTRACE Session Authorization",
    "schema: kite-session-grant-v1",
    `agentId: ${runtime.agentId ?? ""}`,
    `agentWallet: ${normalizeSigningAddress(runtime.agentWallet)}`,
    `identityRegistry: ${normalizeSigningAddress(runtime.identityRegistry)}`,
    `chainId: ${runtime.chainId ?? ""}`,
    `payerAaWallet: ${normalizeSigningAddress(runtime.aaWallet ?? runtime.payerAaWallet)}`,
    `tokenAddress: ${normalizeSigningAddress(runtime.tokenAddress)}`,
    `gatewayRecipient: ${normalizeSigningAddress(runtime.gatewayRecipient)}`,
    `singleLimit: ${opts.singleLimit}`,
    `dailyLimit: ${opts.dailyLimit}`,
    `allowedCapabilities: ${normalizedCapabilities.join(",")}`,
    `audience: ${opts.audience}`,
    `nonce: ${opts.nonce}`,
    `issuedAt: ${opts.issuedAt}`,
    `expiresAt: ${opts.expiresAt}`,
    `userEoa: ${normalizeSigningAddress(opts.userEoa)}`,
  ].join("\n");
}

function mergeRuntimeIdentity(
  runtime: SessionRuntime,
  profile?: IdentityProfileResponse["profile"] | null
): SessionRuntime {
  const runtimeOwner = normalizeAccountAddress(runtime.owner ?? "");
  const profileOwner = normalizeAccountAddress(profile?.ownerAddress ?? "");
  const canMergeProfile =
    Boolean(profile) &&
    Boolean(runtimeOwner) &&
    Boolean(profileOwner) &&
    runtimeOwner === profileOwner;
  const configured = canMergeProfile ? profile?.configured ?? {} : {};
  const runtimeAgentId = String(runtime.agentId ?? "").trim();
  const runtimeAgentWallet = String(runtime.agentWallet ?? "").trim();
  const runtimeIdentityRegistry = String(runtime.identityRegistry ?? "").trim();
  const configuredAgentId = String(configured.agentId ?? "").trim();
  const configuredRegistry = String(configured.registry ?? "").trim();
  const profileAgentId = canMergeProfile ? String(profile?.agentId ?? "").trim() : "";
  const profileAgentWallet = canMergeProfile ? String(profile?.agentWallet ?? "").trim() : "";
  const profileRegistry = canMergeProfile ? String(profile?.registry ?? "").trim() : "";
  return {
    ...runtime,
    agentId: runtimeAgentId || configuredAgentId || profileAgentId || "",
    agentWallet: runtimeAgentWallet || profileAgentWallet || "",
    identityRegistry: runtimeIdentityRegistry || configuredRegistry || profileRegistry || "",
  };
}

function hasRuntimeIdentity(runtime: SessionRuntime): boolean {
  return Boolean(runtime.agentId && runtime.agentWallet && runtime.identityRegistry);
}

function deriveUserType(runtime: SessionRuntime | null | undefined): UserType {
  return runtime?.aaWallet || runtime?.sessionId || hasRuntimeIdentity(runtime || {}) ? "returning" : "new";
}

function supportsSessionGenericExecution(runtime: SessionRuntime): boolean {
  return (
    runtime.accountCapabilities?.sessionGenericExecute === true ||
    runtime.accountVersion === "GokiteAccountV3-session-execute" ||
    runtime.accountVersionTag === "GokiteAccountV3-session-execute"
  );
}

function selectorFromSignature(signature: string): string {
  return keccak256(toUtf8Bytes(signature)).slice(0, 10).toLowerCase();
}

const ERC20_APPROVE_SELECTOR = selectorFromSignature("approve(address,uint256)");
const KTRACE_ESCROW_SELECTORS = [
  selectorFromSignature("lockFunds(string,address,address,address,uint256,uint64,uint256)"),
  selectorFromSignature("acceptJob(string)"),
  selectorFromSignature("submitResult(string,bytes32)"),
  selectorFromSignature("validate(string,bool)"),
  selectorFromSignature("expireJob(string)"),
];

function buildRequiredSessionPermissionUpdates(runtime: SessionRuntime) {
  const sessionId = String(runtime.sessionId || "").trim();
  const settlementToken = String(runtime.activeSettlementTokenAddress || runtime.tokenAddress || "").trim();
  const escrowAddress = String(runtime.activeEscrowAddress || "").trim();
  const updates: Array<{ sessionId: string; target: string; selector: string; enabled: boolean; maxAmount: bigint }> = [];
  if (sessionId && settlementToken && isAddress(settlementToken) && escrowAddress && isAddress(escrowAddress)) {
    updates.push({
      sessionId,
      target: getAddress(settlementToken),
      selector: ERC20_APPROVE_SELECTOR,
      enabled: true,
      maxAmount: BigInt(0),
    });
    for (const selector of KTRACE_ESCROW_SELECTORS) {
      updates.push({
        sessionId,
        target: getAddress(escrowAddress),
        selector,
        enabled: true,
        maxAmount: BigInt(0),
      });
    }
  }
  return updates;
}

async function ensureSessionSelectorPermissions(
  runtime: SessionRuntime,
  signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>,
  provider?: BrowserProvider | JsonRpcProvider | null
) {
  if (!runtime.aaWallet || !runtime.sessionId || !supportsSessionGenericExecution(runtime)) {
    return { changed: false };
  }
  const requiredUpdates = buildRequiredSessionPermissionUpdates(runtime);
  if (requiredUpdates.length === 0) {
    return { changed: false };
  }
  const readRunner = provider ?? signer.provider ?? signer;
  const readAccount = new Contract(runtime.aaWallet, AA_SESSION_PERMISSION_ABI, readRunner);
  const missingUpdates: typeof requiredUpdates = [];
  for (const update of requiredUpdates) {
    const permission = await readAccount.getSessionSelectorPermission(update.sessionId, update.target, update.selector);
    const enabled = Boolean(Array.isArray(permission) ? permission[0] : permission?.enabled);
    if (!enabled) {
      missingUpdates.push(update);
    }
  }
  if (missingUpdates.length === 0) {
    return { changed: false };
  }
  const writeAccount = new Contract(runtime.aaWallet, AA_SESSION_PERMISSION_ABI, signer);
  const tx = await writeAccount.setSessionSelectorPermissions(missingUpdates);
  await tx.wait();
  return {
    changed: true,
    txHash: String(tx.hash || ""),
    updates: missingUpdates.length,
  };
}

const AA_SUPPORTED_TOKEN_MAPPING_SLOT = BigInt(2);

async function hasSupportedSettlementToken(
  aaWallet: string,
  tokenAddress: string,
  provider: BrowserProvider | JsonRpcProvider
): Promise<boolean> {
  if (!aaWallet || !tokenAddress || !isAddress(aaWallet) || !isAddress(tokenAddress)) {
    return false;
  }
  const slotKey = keccak256(
    new Uint8Array([
      ...getBytes(zeroPadValue(getAddress(tokenAddress), 32)),
      ...getBytes(zeroPadValue(toBeHex(AA_SUPPORTED_TOKEN_MAPPING_SLOT), 32)),
    ])
  );
  const raw = await provider.getStorage(getAddress(aaWallet), slotKey);
  return BigInt(raw || "0x0") !== BigInt(0);
}

async function ensureSupportedSettlementToken(
  runtime: SessionRuntime,
  signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>,
  provider: BrowserProvider | JsonRpcProvider
) {
  const aaWallet = String(runtime.aaWallet || runtime.payerAaWallet || "").trim();
  const tokenAddress = String(runtime.tokenAddress || runtime.activeSettlementTokenAddress || "").trim();
  if (!aaWallet || !tokenAddress || !isAddress(aaWallet) || !isAddress(tokenAddress)) {
    return { changed: false };
  }
  const alreadySupported = await hasSupportedSettlementToken(aaWallet, tokenAddress, provider).catch(() => false);
  if (alreadySupported) {
    return { changed: false };
  }
  const account = new Contract(getAddress(aaWallet), AA_SESSION_ABI, signer);
  const tx = await account.addSupportedToken(getAddress(tokenAddress));
  await tx.wait();
  return {
    changed: true,
    txHash: String(tx.hash || ""),
  };
}

async function fetchCurrentIdentity(): Promise<IdentityProfileResponse["profile"] | null> {
  const res = await fetch("/api/setup/identity/current", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const json = (await res.json()) as IdentityProfileResponse;
  if (!res.ok || !json.ok || !json.profile) {
    throw new Error(
      json.reason ??
        json.error ??
        "Failed to read current ERC-8004 identity configuration."
    );
  }
  return json.profile;
}

// 鈹€鈹€鈹€ Shared UI primitives 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <span
      className={[
        "flex size-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold transition-all",
        done
          ? "border-[#3a4220] bg-[#3a4220] text-[#faf7f1]"
          : active
            ? "border-[#3a4220] bg-[rgba(58,66,32,0.1)] text-[#3a4220]"
            : "border-[rgba(90,80,50,0.2)] bg-transparent text-[#9e8e76]",
      ].join(" ")}
    >
      {done ? <Check className="size-4" /> : n}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={[
        "overflow-hidden rounded-[28px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] shadow-[0_20px_60px_rgba(58,66,32,0.08)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-[rgba(90,80,50,0.08)] px-6 py-5">{children}</div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-6">{children}</div>;
}

function PrimaryBtn({
  onClick,
  disabled,
  loading,
  children,
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        "inline-flex h-10 items-center gap-2 rounded-full whitespace-nowrap bg-[#3a4220] px-5 text-[13px] font-semibold text-[#faf7f1] transition",
        "hover:bg-[#4d5a2a] hover:shadow-[0_4px_16px_rgba(58,66,32,0.3)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      ].join(" ")}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function GhostBtn({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 text-[12px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.07)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading && <Loader2 className="size-3 animate-spin" />}
      {children}
    </button>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[rgba(180,60,40,0.18)] bg-[rgba(180,60,40,0.06)] px-4 py-3">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#b43c28]" />
      <p className="text-[12px] leading-relaxed text-[#b43c28]">{msg}</p>
    </div>
  );
}

function SuccessBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-4 py-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#3a4220]" />
      <p className="text-[12px] leading-relaxed text-[#3a4220]">{msg}</p>
    </div>
  );
}

function InfoBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[rgba(90,80,50,0.18)] bg-[rgba(90,80,50,0.06)] px-4 py-3">
      <Zap className="mt-0.5 size-4 shrink-0 text-[#7a6e56]" />
      <p className="text-[12px] leading-relaxed text-[#7a6e56]">{msg}</p>
    </div>
  );
}

function MonoField({
  value,
  copyValue,
  hideCopyWhenUnavailable = false,
  wrap = false,
}: {
  value: string;
  copyValue?: string | null;
  hideCopyWhenUnavailable?: boolean;
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const effectiveCopyValue = copyValue ?? value;
  const canCopy = effectiveCopyValue.length > 0;
  function copy() {
    if (!canCopy) return;
    void navigator.clipboard.writeText(effectiveCopyValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] px-3 py-2">
      <code
        className={[
          "flex-1 text-[11px] text-[#3a4220]",
          wrap ? "break-all whitespace-normal" : "truncate",
        ].join(" ")}
        style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
      >
        {value}
      </code>
      {(!hideCopyWhenUnavailable || canCopy) && (
        <button
          type="button"
          onClick={copy}
          disabled={!canCopy}
          className="shrink-0 text-[#9e8e76] transition hover:text-[#3a4220] disabled:cursor-not-allowed disabled:opacity-40"
          title={canCopy ? "Copy" : "Copy unavailable"}
        >
          {copied ? <ClipboardCheck className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

function CodeBlock({ code, lang = "json" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(code.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[rgba(58,66,32,0.14)] bg-[#23271a]">
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#6a7a40]">
          {lang}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium text-[#8a9a60] transition hover:bg-[rgba(255,255,255,0.06)] hover:text-[#b0c070]"
        >
          {copied ? (
            <><ClipboardCheck className="size-3" /> Copied</>
          ) : (
            <><Copy className="size-3" /> Copy</>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[11.5px] leading-relaxed text-[#c8d8a0]">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

// 鈹€鈹€鈹€ Completed step row 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function DoneRow({
  n,
  title,
  sub,
  onClick,
  }: {
    n: number;
    title: string;
    sub?: string;
    onClick?: () => void;
  }) {
      const clickable = typeof onClick === "function";
      return (
        <button
          type="button"
          onClick={onClick}
          disabled={!clickable}
          className={[
            "flex w-full items-center gap-3 rounded-2xl border border-[rgba(58,66,32,0.14)] bg-[rgba(58,66,32,0.04)] px-5 py-3 text-left transition",
            clickable ? "hover:bg-[rgba(58,66,32,0.08)]" : "",
          ].join(" ")}
        >
          <StepBadge n={n} active={false} done />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-[#18180e]">{title}</p>
            {sub && <p className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#7a6e56]">{sub}</p>}
          </div>
          {clickable ? <ChevronDown className="size-4 text-[#3a4220]" /> : <CheckCircle2 className="size-4 text-[#3a4220]" />}
        </button>
    );
  }

// 鈹€鈹€鈹€ Step 0: Connect Wallet 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function ConnectStep({ onDone }: { onDone: (address: string) => void }) {
  const [state, setState] = useState<"idle" | "connecting" | "signing" | "verifying">("idle");
  const [error, setError] = useState("");

  async function connect() {
    setError("");
    const eth = getEthereum();
    if (!eth) {
      setError("No wallet detected. Please install MetaMask or another EIP-1193 wallet.");
      return;
    }
    try {
      setState("connecting");
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts[0];
      if (!addr) throw new Error("No account returned by wallet.");

      setState("signing");
      const challengeRes = await fetch("/api/setup/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEoa: addr }),
      });
      const challengeJson = (await challengeRes.json()) as {
        ok?: boolean;
        challenge?: {
          challengeId?: string;
          message?: string;
        };
        error?: string;
        reason?: string;
      };
      const challengeId = challengeJson.challenge?.challengeId ?? "";
      const challengeMessage = challengeJson.challenge?.message ?? "";
      if (!challengeRes.ok || !challengeId || !challengeMessage) {
        throw new Error(challengeJson.reason ?? challengeJson.error ?? "Challenge request failed.");
      }

      const currentAccounts = (await eth.request({ method: "eth_accounts" })) as string[];
      const activeSigner = currentAccounts[0] ?? "";
      if (
        !activeSigner ||
        normalizeAccountAddress(activeSigner) !== normalizeAccountAddress(addr)
      ) {
        throw new Error(
          `Wallet account changed before signing. Connected ${addr}, but active signer is ${activeSigner || "unknown"}. Switch back to the same account and retry.`
        );
      }

      const signature = (await eth.request({
        method: "personal_sign",
        params: [toHex(challengeMessage), addr],
      })) as string;

      setState("verifying");
      const verifyRes = await fetch("/api/setup/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, ownerEoa: addr, message: challengeMessage, signature }),
      });
      const verifyJson = (await verifyRes.json()) as {
        ok?: boolean;
        error?: string;
        reason?: string;
      };
      if (!verifyRes.ok || !verifyJson.ok) {
        const rawReason = verifyJson.reason ?? verifyJson.error ?? "Verification failed.";
        if (
          /owner key mismatch/i.test(rawReason) ||
          /Wallet signature does not match ownerEoa/i.test(rawReason)
        ) {
          throw new Error(formatWalletMismatchReason(rawReason, addr));
        }
        throw new Error(rawReason);
      }
      setState("idle");
      onDone(addr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed.");
      setState("idle");
    }
  }

  const loading = state !== "idle";
  const stateLabel =
    state === "connecting"
      ? "Requesting accounts..."
      : state === "signing"
        ? "Sign the login message in your wallet..."
        : state === "verifying"
          ? "Verifying signature..."
          : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <StepBadge n={1} active done={false} />
          <div>
            <h2 className="text-[15px] font-semibold text-[#18180e]">Connect Wallet</h2>
            <p className="mt-0.5 text-[12px] text-[#9e8e76]">
              Authenticate with a one-time wallet signature - no gas, no transaction.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col items-start gap-4">
          <div className="flex items-center gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(58,66,32,0.04)] px-4 py-3">
            <WalletIcon className="size-4 shrink-0 text-[#7a6e56]" />
            <p className="text-[12px] leading-relaxed text-[#7a6e56]">
              Kite Trace uses a challenge-response login. Your wallet signs a short
              human-readable message. No transaction is broadcast.
            </p>
          </div>
          <PrimaryBtn onClick={connect} loading={loading} disabled={loading}>
            <WalletIcon className="size-3.5" />
            {loading ? stateLabel : "Connect Wallet"}
          </PrimaryBtn>
          {error && <ErrorBanner msg={error} />}
        </div>
      </CardBody>
    </Card>
  );
}

// 鈹€鈹€鈹€ Step 1: Fund AA Wallet 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const SUGGEST_KITE = 0.05;

function FundStep({
  address,
  runtime,
  eoaBalance,
  reviewMode = false,
  onRuntimeUpdate,
  onDone,
}: {
  address: string;
  runtime: SessionRuntime;
  eoaBalance: number;
  reviewMode?: boolean;
  onRuntimeUpdate: (runtime: SessionRuntime) => void;
  onDone: () => void;
}) {
  const aaWallet = runtime.aaWallet ?? runtime.payerAaWallet ?? "";
  const tokenAddress = runtime.tokenAddress ?? "";
  const [aaBalance, setAaBalance] = useState(0);
  const [aaTokenBalance, setAaTokenBalance] = useState(0);
  const [eoaTokenBalance, setEoaTokenBalance] = useState(0);
  const [tokenMeta, setTokenMeta] = useState({ symbol: "USDT", decimals: 6 });
  const [runtimeRefreshState, setRuntimeRefreshState] = useState<"idle" | "refreshing">("idle");
  const [deployState, setDeployState] = useState<"idle" | "sending" | "waiting">("idle");
  const [transferState, setTransferState] = useState<"idle" | "sending" | "waiting">("idle");
  const [tokenTransferState, setTokenTransferState] = useState<"idle" | "sending" | "waiting">("idle");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);
  const [isDeployed, setIsDeployed] = useState(Boolean(runtime.aaDeployed));
  const [aaBalanceKnown, setAaBalanceKnown] = useState(false);

  useEffect(() => {
    setIsDeployed(Boolean(runtime.aaDeployed));
  }, [runtime.aaDeployed]);

  async function refreshRuntimeStatus() {
    setError("");
    setRuntimeRefreshState("refreshing");
    try {
      const refreshedRuntime = await fetchSetupRuntime(address);
      onRuntimeUpdate(refreshedRuntime);
      setIsDeployed(Boolean(refreshedRuntime.aaDeployed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runtime refresh failed.");
    } finally {
      setRuntimeRefreshState("idle");
    }
  }

  async function prepareFreshWallet() {
    setError("");
    setRuntimeRefreshState("refreshing");
    try {
      const prepareRes = await fetch("/api/setup/runtime/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ownerEoa: address }),
      });
      const prepareJson = (await prepareRes.json()) as Record<string, unknown>;
      if (!prepareRes.ok || !prepareJson.ok) {
        throw new Error(
          ((prepareJson.reason ?? prepareJson.error) as string | undefined) ??
            "Wallet preparation failed."
        );
      }
      const preparedRuntime = mergeRuntimeIdentity(
        parseRuntime(prepareJson),
        await fetchCurrentIdentity()
      );
      onRuntimeUpdate(preparedRuntime);
      setIsDeployed(Boolean(preparedRuntime.aaDeployed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet preparation failed.");
    } finally {
      setRuntimeRefreshState("idle");
    }
  }

  async function deployAaWallet() {
    const provider = getBrowserProvider();
    const factoryAddress = runtime.accountFactoryAddress ?? runtime.activeAccountFactoryAddress ?? "";
    const ownerAddress = runtime.owner ?? address;
    const saltValue = runtime.salt ?? "0";
    if (!provider || !factoryAddress || !ownerAddress) return;
    setError("");
    setDeployState("sending");
    try {
      await ensureKiteTestnet(getEthereum() as EthProvider);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (normalizeAccountAddress(signerAddress) !== normalizeAccountAddress(address)) {
        throw new Error(`Please switch wallet to ${address}.`);
      }
      const factory = new Contract(factoryAddress, ACCOUNT_FACTORY_ABI, signer);
      const tx = await factory.createAccount(ownerAddress, BigInt(saltValue || "0"));
      setDeployState("waiting");
      await tx.wait();
      await refreshRuntimeStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AA deployment failed.");
      setDeployState("idle");
      return;
    }
    setDeployState("idle");
  }

  useEffect(() => {
    if (!aaWallet) return;
    const eth = getEthereum();
    const readOnlyProvider = getReadOnlyProvider();
    if (!eth && !readOnlyProvider) return;

    const poll = async () => {
      const browserProvider = getBrowserProvider();
      const chainReader = readOnlyProvider ?? browserProvider;
      const [bal, tokenBal, eoaTokenBal, meta, codeHex] = await Promise.all([
        eth ? getBalance(eth, aaWallet) : Promise.resolve(null),
        tokenAddress ? getTokenBalance(tokenAddress, aaWallet) : Promise.resolve(null),
        tokenAddress ? getTokenBalance(tokenAddress, address) : Promise.resolve(null),
        tokenAddress ? getTokenMeta(tokenAddress) : Promise.resolve({ symbol: "USDT", decimals: 6 }),
        chainReader ? chainReader.getCode(aaWallet).catch(() => "0x") : Promise.resolve("0x"),
      ]);
      if (bal !== null) {
        setAaBalance(bal);
        setAaBalanceKnown(true);
      }
      if (tokenBal !== null) {
        setAaTokenBalance(tokenBal);
      }
      if (eoaTokenBal !== null) {
        setEoaTokenBalance(eoaTokenBal);
      }
      setTokenMeta(meta);
      const deployed = Boolean(codeHex && codeHex !== "0x");
      let detectedVersion = runtime.accountVersion ?? "";
      if (deployed) {
        try {
          if (chainReader) {
            const account = new Contract(aaWallet, ACCOUNT_VERSION_ABI, chainReader);
            detectedVersion = String(await account.version().catch(() => detectedVersion || "")).trim() || detectedVersion;
          }
        } catch {
          detectedVersion = runtime.accountVersion ?? "";
        }
      }
      if (deployed !== isDeployed) {
        setIsDeployed(deployed);
        onRuntimeUpdate({
          ...runtime,
          aaDeployed: deployed,
          accountVersion: detectedVersion || runtime.accountVersion,
        });
      } else if (detectedVersion && detectedVersion !== (runtime.accountVersion ?? "")) {
        onRuntimeUpdate({
          ...runtime,
          accountVersion: detectedVersion,
        });
      }
      const effectiveAaBalance = bal ?? aaBalance;
      const effectiveAaTokenBalance = tokenBal ?? aaTokenBalance;
      const ready =
        effectiveAaBalance > 0 &&
        effectiveAaTokenBalance > 0 &&
        deployed &&
        supportsSessionGenericExecution({
          ...runtime,
          accountVersion: detectedVersion || runtime.accountVersion,
        });
      if (ready && !doneRef.current) {
        doneRef.current = true;
        if (pollRef.current) clearInterval(pollRef.current);
        if (!reviewMode) {
          setTimeout(onDone, 900);
        }
      }
    };

    void poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [aaWallet, address, isDeployed, onDone, onRuntimeUpdate, reviewMode, runtime, tokenAddress]);

  async function sendToAA() {
    const eth = getEthereum();
    if (!eth || !aaWallet) return;
    setError("");
    setTransferState("sending");
    try {
      await ensureKiteTestnet(eth);
      const value = "0x" + Math.floor(SUGGEST_KITE * 1e18).toString(16);
      await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: aaWallet, value }],
      });
      setTransferState("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer cancelled or failed.");
      setTransferState("idle");
    }
  }

  async function sendSettlementToAA() {
    const provider = getBrowserProvider();
    if (!provider || !aaWallet || !tokenAddress) return;
    setError("");
    setTokenTransferState("sending");
    try {
      const signer = await provider.getSigner();
      await ensureKiteTestnet(getEthereum() as EthProvider);
      const token = new Contract(tokenAddress, ERC20_ABI, signer);
      const amount = parseUnits(SUGGEST_SETTLEMENT, tokenMeta.decimals);
      const tx = await token.transfer(aaWallet, amount);
      await tx.wait();
      setTokenTransferState("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settlement token transfer cancelled or failed.");
      setTokenTransferState("idle");
    }
  }

  const needsFaucet = eoaBalance < 0.005;
  const requiresNewWallet =
    isDeployed && runtime.accountCapabilities?.sessionGenericExecute !== true;
  const runtimeHealth = String(runtime.runtimeHealth || "").trim().toLowerCase() || "active_default";
  const isKnownBadFactoryRuntime = runtimeHealth === "known_bad_factory";
  const isHistoricalRuntime = runtimeHealth !== "active_default";
  const isDefaultFactoryRuntime = runtime.isDefaultFactoryRuntime === true && !isHistoricalRuntime;
  const missingBootstrap =
    !aaWallet || !runtime.accountFactoryAddress || !runtime.owner || !runtime.salt;
  const funded =
    aaBalance > 0 && aaTokenBalance > 0 && isDeployed && !requiresNewWallet && isDefaultFactoryRuntime;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <StepBadge n={2} active={!funded} done={funded} />
          <div>
            <h2 className="text-[15px] font-semibold text-[#18180e]">Prepare Your AA Wallet</h2>
            <p className="mt-0.5 text-[12px] text-[#9e8e76]">
              Deploy your AA wallet if needed, then send it KITE for gas and {tokenMeta.symbol} for paid calls.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {funded ? (
          <SuccessBanner msg={`AA wallet ready - ${aaBalance.toFixed(4)} KITE + ${aaTokenBalance.toFixed(2)} ${tokenMeta.symbol}`} />
        ) : (
          <div className="flex flex-col gap-5">
            {/* AA wallet address */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                Your AA Wallet
              </span>
              <p className="text-[11px] text-[#7a6e56]">
                Status: {isDeployed ? "deployed" : "not yet deployed"}
              </p>
              <p className="text-[11px] text-[#7a6e56]">
                Factory: {isDefaultFactoryRuntime ? "current KTrace factory" : "historical runtime"}
              </p>
              <MonoField value={aaWallet || "Preparing..."} wrap copyValue={aaWallet || null} />
              {isDeployed && runtime.accountCapabilities && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {runtime.accountCapabilities.sessionPayment && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(58,66,32,0.08)] px-2.5 py-0.5 text-[10px] font-medium text-[#3a4220] border border-[rgba(58,66,32,0.18)]">
                      <Check className="size-2.5" /> Payment Ready
                    </span>
                  )}
                  {runtime.accountCapabilities.sessionGenericExecute && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(58,66,32,0.08)] px-2.5 py-0.5 text-[10px] font-medium text-[#3a4220] border border-[rgba(58,66,32,0.18)]">
                      <Check className="size-2.5" /> Job Ready
                    </span>
                  )}
                </div>
              )}
              {aaBalance > 0 && (
                <p className="text-[11px] font-medium text-[#3a4220]">
                  Balance: {aaBalance.toFixed(4)} KITE
                </p>
              )}
              {aaTokenBalance > 0 && (
                <p className="text-[11px] font-medium text-[#3a4220]">
                  Settlement balance: {aaTokenBalance.toFixed(2)} {tokenMeta.symbol}
                </p>
              )}
              {!aaBalanceKnown && (
                <div className="flex items-center gap-1.5 text-[11px] text-[#9e8e76]">
                  <Loader2 className="size-3 animate-spin" />
                  Checking current balance...
                </div>
              )}
              {aaBalanceKnown && aaBalance === 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-[#9e8e76]">
                  <Loader2 className="size-3 animate-spin" />
                  Watching for incoming balance...
                </div>
              )}
              {requiresNewWallet && (
                <ErrorBanner msg="This wallet is not supported. Create a new wallet below." />
              )}
              {!requiresNewWallet && isDeployed && !isDefaultFactoryRuntime && (
                <InfoBanner
                  msg={
                    isKnownBadFactoryRuntime
                      ? "This wallet came from a known historical KTrace factory. Prepare a new wallet from the current factory before authorizing."
                      : "This wallet is not from the current KTrace factory. You can keep it for history, or prepare a new wallet below."
                  }
                />
              )}
            </div>

            {/* Faucet, only when EOA is also low */}
            {(!isDeployed || !isDefaultFactoryRuntime || requiresNewWallet) && (
              <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-[#3a4220]" />
                  <span className="text-[13px] font-semibold text-[#18180e]">
                    Step A - Prepare your AA wallet
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-[#7a6e56]">
                  {isDeployed && !isDefaultFactoryRuntime
                    ? isKnownBadFactoryRuntime
                      ? "Your current linked wallet came from a known historical KTrace factory. Prepare a new wallet from the current factory before authorizing."
                      : "Your current linked wallet is not from the current KTrace factory. Prepare a new wallet below."
                    : "Deploy your AA wallet from the current KTrace factory, then continue with funding."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {missingBootstrap || (isDeployed && !isDefaultFactoryRuntime) || requiresNewWallet ? (
                    <PrimaryBtn
                      onClick={prepareFreshWallet}
                      disabled={runtimeRefreshState !== "idle"}
                      loading={runtimeRefreshState === "refreshing"}
                    >
                      <RefreshCw className="size-3.5" />
                      {runtimeRefreshState === "refreshing"
                        ? missingBootstrap
                          ? "Preparing wallet..."
                          : "Preparing new wallet..."
                        : missingBootstrap
                          ? "Prepare wallet"
                          : "Prepare new wallet"}
                    </PrimaryBtn>
                  ) : (
                  <PrimaryBtn
                    onClick={deployAaWallet}
                    disabled={deployState !== "idle" || !runtime.accountFactoryAddress || !runtime.owner || !runtime.salt}
                    loading={deployState === "sending" || deployState === "waiting"}
                  >
                    <Zap className="size-3.5" />
                    {deployState === "waiting" ? "Waiting for deployment..." : "Deploy wallet"}
                  </PrimaryBtn>
                  )}
                  <GhostBtn onClick={refreshRuntimeStatus} disabled={runtimeRefreshState !== "idle"} loading={runtimeRefreshState === "refreshing"}>
                    <RefreshCw className="size-3.5" />
                    {runtimeRefreshState === "refreshing" ? "Refreshing runtime..." : "Refresh runtime status"}
                  </GhostBtn>
                </div>
              </div>
            )}

            {needsFaucet && (
              <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
                <div className="flex items-center gap-2">
                  <Droplets className="size-4 text-[#3a4220]" />
                  <span className="text-[13px] font-semibold text-[#18180e]">
                    Step B - Get KITE from the faucet
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-[#7a6e56]">
                  Your wallet has low KITE balance. Claim free testnet KITE and USDT from
                  the faucet, then transfer some to your AA wallet below.
                </p>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                    Your EOA - paste into faucet
                  </span>
                  <MonoField value={address} wrap copyValue={address} />
                </div>
                <a
                  href="https://faucet.gokite.ai/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 self-start rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.06)] px-4 py-2 text-[12px] font-semibold text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.1)]"
                >
                  <ExternalLink className="size-3.5" />
                  Open faucet.gokite.ai
                </a>
              </div>
            )}

            {/* Native gas transfer */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
              <div className="flex items-center gap-2">
                <Send className="size-4 text-[#3a4220]" />
                <span className="text-[13px] font-semibold text-[#18180e]">
                  {needsFaucet ? "Step C - " : "Step B - "}Transfer KITE to AA Wallet
                </span>
              </div>
              {!needsFaucet && (
                <p className="text-[12px] text-[#7a6e56]">
                  Your EOA has {eoaBalance.toFixed(4)} KITE. Send a small amount to your
                  AA wallet for gas.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryBtn
                  onClick={sendToAA}
                  disabled={transferState !== "idle" || !aaWallet || !isDeployed}
                  loading={transferState === "sending"}
                >
                  <Send className="size-3.5" />
                  {transferState === "sending"
                    ? "Confirm in wallet..."
                    : transferState === "waiting"
                      ? "Waiting for confirmation..."
                      : `Send ${SUGGEST_KITE} KITE`}
                </PrimaryBtn>
                <p className="text-[11px] text-[#9e8e76]">
                  Suggested {SUGGEST_KITE} KITE - you can adjust in your wallet
                </p>
              </div>
              {transferState === "waiting" && (
                <div className="flex items-center gap-2 text-[12px] text-[#7a6e56]">
                  <Loader2 className="size-3.5 animate-spin" />
                  Transaction sent - waiting for balance update...
                </div>
              )}
            </div>

            {/* Settlement token transfer */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
              <div className="flex items-center gap-2">
                <Send className="size-4 text-[#3a4220]" />
                <span className="text-[13px] font-semibold text-[#18180e]">
                  {needsFaucet ? "Step D - " : "Step C - "}Transfer {tokenMeta.symbol} to AA Wallet
                </span>
              </div>
              <p className="text-[12px] text-[#7a6e56]">
                Your AA wallet needs {tokenMeta.symbol} to pay for ktrace capabilities. Your EOA currently has {eoaTokenBalance.toFixed(2)} {tokenMeta.symbol}.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryBtn
                  onClick={sendSettlementToAA}
                  disabled={tokenTransferState !== "idle" || !aaWallet || !isDeployed || !tokenAddress}
                  loading={tokenTransferState === "sending"}
                >
                  <Send className="size-3.5" />
                  {tokenTransferState === "sending"
                    ? "Confirm in wallet..."
                    : tokenTransferState === "waiting"
                      ? "Waiting for confirmation..."
                      : `Send ${SUGGEST_SETTLEMENT} ${tokenMeta.symbol}`}
                </PrimaryBtn>
                <p className="text-[11px] text-[#9e8e76]">
                  Suggested {SUGGEST_SETTLEMENT} {tokenMeta.symbol} - you can adjust in your wallet
                </p>
              </div>
            </div>

            {error && <ErrorBanner msg={error} />}

            <button
              type="button"
              onClick={onDone}
              className="self-start text-[11px] text-[#9e8e76] underline transition hover:text-[#3a4220]"
            >
              Skip - I&apos;ve already deployed and funded my AA wallet
            </button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// 鈹€鈹€鈹€ Step 2: Authorize / Renew Session 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const DEFAULT_CAPS = ["cap-dex-market", "cap-news-signal", "cap-kol-monitor", "cap-market-price-feed"];

function AuthorizeStep({
  address,
  runtime,
  accountStatus,
  availableCaps,
  mode = "new",
  onRuntimeUpdate,
  hasLocalSessionRuntime = false,
  onLocalSessionRuntimeReady,
  onDone,
}: {
  address: string;
  runtime: SessionRuntime;
  accountStatus?: AccountStatus | null;
  availableCaps: Array<{ id: string; name: string; providerId: string }> | string[];
  mode?: "new" | "renew";
  onRuntimeUpdate: (runtime: SessionRuntime) => void;
  hasLocalSessionRuntime?: boolean;
  onLocalSessionRuntimeReady?: (runtimeExport: LocalSessionRuntimeExport) => void;
  onDone: () => void;
}) {
  // Normalize: support both CapabilityInfo[] and string[]
  const normalizedCaps: Array<{ id: string; name: string; group: string }> =
    (availableCaps as Array<{ id: string; name: string; providerId: string } | string>).map((c) =>
      typeof c === "string"
        ? { id: c, name: c, group: "" }
        : {
            id: c.id,
            name: c.name || c.id,
            group:
              c.providerId === "fundamental-agent-real"
                ? "基本面 Agent"
                : c.providerId === "technical-agent-real"
                  ? "技术面 Agent"
                  : c.providerId === "data-node-real"
                    ? "DATA Agent"
                    : "",
          }
    );
  const capList = normalizedCaps.length > 0 ? normalizedCaps : DEFAULT_CAPS.map((id) => ({ id, name: id, group: "" }));
  const [selected, setSelected] = useState<Set<string>>(new Set(capList.slice(0, 3).map((c) => c.id)));
  const [singleLimit, setSingleLimit] = useState("0.01");
  const [dailyLimit, setDailyLimit] = useState("0.10");
  const [sessionValidityHours, setSessionValidityHours] = useState("24");
  const [state, setState] = useState<
    "idle" | "checkingWallet" | "preparingToken" | "creatingSession" | "updatingPermissions" | "signing" | "submitting" | "done"
  >("idle");
  const [error, setError] = useState("");

  function toggleCap(cap: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  async function authorize() {
    setError("");
    if (selected.size === 0) {
      setError("Select at least one allowed capability.");
      return;
    }
    const eth = getEthereum();
    if (!eth) { setError("Wallet not available."); return; }

    try {
      setState("checkingWallet");
      await withTimeout(
        ensureKiteTestnet(eth),
        15000,
        "Wallet network check timed out. If your wallet has a pending popup, finish or cancel it and retry."
      );
      const provider = getBrowserProvider();
      if (!provider) throw new Error("Wallet provider unavailable.");
      const signer = await withTimeout(
        provider.getSigner(),
        15000,
        "Wallet signer request timed out. Open your wallet extension and finish any pending approval."
      );
      const activeUserEoa = await withTimeout(
        signer.getAddress(),
        15000,
        "Wallet account check timed out. Open your wallet extension and finish any pending approval."
      );
      if (
        !activeUserEoa ||
        normalizeAccountAddress(activeUserEoa) !== normalizeAccountAddress(address)
      ) {
        throw new Error(
          `Wallet account changed before authorization. Connected ${address}, but active signer is ${activeUserEoa || "unknown"}. Switch back to the same account and retry.`
        );
      }
      const identityProfile = hasRuntimeIdentity(runtime)
        ? null
        : await fetchCurrentIdentity().catch(() => null);
      let effectiveRuntime = hasRuntimeIdentity(runtime)
        ? runtime
        : mergeRuntimeIdentity(runtime, identityProfile);
      if (!hasRuntimeIdentity(effectiveRuntime)) {
        throw new Error("Agent identity is not ready yet. Complete the Register Identity step first.");
      }
      if (!effectiveRuntime.aaWallet) {
        throw new Error("AA wallet is missing from this runtime.");
      }
      const runtimeHealth = String(effectiveRuntime.runtimeHealth || "").trim().toLowerCase();
      if (runtimeHealth && runtimeHealth !== "active_default") {
        throw new Error(
          "This AA wallet is historical and can no longer be used for new session authorization."
        );
      }
      if (effectiveRuntime.isDefaultFactoryRuntime !== true) {
        throw new Error("This AA wallet is not from the current KTrace factory.");
      }
      const runtimeImpliesDeployed = Boolean(
        effectiveRuntime.aaDeployed ||
        supportsSessionGenericExecution(effectiveRuntime) ||
        (effectiveRuntime.aaWallet && runtimeHealth === "active_default")
      );
      if (!runtimeImpliesDeployed) {
        const providerForCodeCheck = getReadOnlyProvider() ?? provider;
        const codeHex = effectiveRuntime.aaWallet
          ? String(await providerForCodeCheck.getCode(effectiveRuntime.aaWallet).catch(() => "0x"))
          : "0x";
        if (codeHex && codeHex !== "0x") {
          effectiveRuntime = {
            ...effectiveRuntime,
            aaDeployed: true,
          };
          onRuntimeUpdate(effectiveRuntime);
        } else {
          throw new Error("AA wallet is not deployed yet.");
        }
      }
      if (!supportsSessionGenericExecution(effectiveRuntime)) {
        throw new Error(
          `AA wallet is not ready for session-based task execution. current=${effectiveRuntime.accountVersion || effectiveRuntime.accountVersionTag || "unknown_or_legacy"}`
        );
      }
      const chainReader = getReadOnlyProvider() ?? provider;
      const preparedAaWallet = String(effectiveRuntime.aaWallet || effectiveRuntime.payerAaWallet || "").trim();
      const knownAaBalance =
        accountStatus?.aaBalanceKnown && preparedAaWallet ? Number(accountStatus?.aaBalance ?? 0) : null;
      const knownTokenBalance =
        accountStatus?.aaTokenBalanceKnown && effectiveRuntime.tokenAddress
          ? Number(accountStatus?.aaTokenBalance ?? 0)
          : null;
      const currentAaBalance =
        knownAaBalance !== null
          ? knownAaBalance
          : preparedAaWallet
            ? await getBalance(eth, preparedAaWallet).catch(() => null)
            : null;
      const currentTokenBalance =
        knownTokenBalance !== null
          ? knownTokenBalance
          : effectiveRuntime.tokenAddress
            ? await getTokenBalance(effectiveRuntime.tokenAddress, preparedAaWallet).catch(() => null)
            : null;
      if (currentAaBalance === null) {
        throw new Error("AA balance is temporarily unavailable. Go back to Prepare AA Wallet once to refresh, then retry.");
      }
      if (currentAaBalance <= 0) {
        throw new Error("AA has no KITE balance for gas.");
      }
      if (effectiveRuntime.tokenAddress && currentTokenBalance === null) {
        throw new Error("Settlement balance is temporarily unavailable. Go back to Prepare AA Wallet once to refresh, then retry.");
      }
      const checkedTokenBalance = currentTokenBalance ?? 0;
      if (effectiveRuntime.tokenAddress && checkedTokenBalance <= 0) {
        throw new Error("AA has no settlement balance.");
      }
      // Sign the authorization message first (off-chain, no gas) so the user
      // confirms intent before the on-chain transactions start.
      setState("signing");
      const now = Date.now();
      const validityHours = Number(sessionValidityHours || "0");
      if (!Number.isFinite(validityHours) || validityHours <= 0) {
        throw new Error("Session key validity must be greater than 0 hours.");
      }
      const nonce = randomHex(16);
      const issuedAt = new Date(now).toISOString();
      const expiresAtMs = now + Math.round(validityHours * 60 * 60 * 1000);
      const expiresAt = new Date(expiresAtMs).toISOString();
      const audience =
        (process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://api.kitetrace.xyz").replace(/\/+$/, "");
      const signMessage = buildSignMessage(effectiveRuntime, {
        singleLimit,
        dailyLimit,
        allowedCapabilities: Array.from(selected),
        userEoa: activeUserEoa,
        nonce,
        issuedAt,
        expiresAt,
        audience,
      });
      const signature = await signer.signMessage(signMessage);

      setState("preparingToken");
      const supportedTokenSync = await ensureSupportedSettlementToken(effectiveRuntime, signer, chainReader).catch((error) => {
        const message = error instanceof Error ? error.message : "Settlement token setup failed.";
        throw new Error(`Unable to prepare the settlement token automatically. ${message}`);
      });
      if (supportedTokenSync.changed) {
        onRuntimeUpdate({
          ...effectiveRuntime,
          aaDeployed: true,
        });
      }

      if (!effectiveRuntime.sessionId || !effectiveRuntime.sessionAddress || !hasLocalSessionRuntime) {
        if (!effectiveRuntime.aaWallet) {
          throw new Error("AA wallet is missing from the prepared runtime.");
        }
        setState("creatingSession");
        const sessionWallet = Wallet.createRandom();
        const sessionId = keccak256(toUtf8Bytes(`${sessionWallet.address}-${Date.now()}`));
        const account = new Contract(effectiveRuntime.aaWallet, AA_SESSION_ABI, signer);
        const sessionRules =
          Array.isArray(effectiveRuntime.sessionRules) && effectiveRuntime.sessionRules.length > 0
            ? effectiveRuntime.sessionRules
            : [
                {
                  timeWindow: "0",
                  budget: String(parseUnits(singleLimit || "0", 18)),
                  initialWindowStartTime: 0,
                  targetProviders: [],
                },
                {
                  timeWindow: "86400",
                  budget: String(parseUnits(dailyLimit || "0", 18)),
                  initialWindowStartTime:
                    effectiveRuntime.currentBlockTimestamp && effectiveRuntime.currentBlockTimestamp > 0
                      ? Math.max(0, effectiveRuntime.currentBlockTimestamp - 1)
                      : Math.max(0, Math.floor(Date.now() / 1000) - 1),
                  targetProviders: [],
                },
              ];
        const createTx = await account.createSession(
          sessionId,
          sessionWallet.address,
          sessionRules.map((rule) => ({
            timeWindow: BigInt(rule.timeWindow || "0"),
            budget: BigInt(rule.budget || "0"),
            initialWindowStartTime: Number(rule.initialWindowStartTime || 0),
            targetProviders: Array.isArray(rule.targetProviders) ? rule.targetProviders : [],
          }))
        );
        await createTx.wait();

        const localRuntimeExport = buildLocalSessionRuntimeExport(
          effectiveRuntime,
          sessionWallet.privateKey,
          {
            owner: activeUserEoa,
            sessionAddress: sessionWallet.address,
            sessionId,
            sessionTxHash: createTx.hash,
            singleLimit,
            dailyLimit,
          }
        );

        const finalizeRes = await fetch("/api/setup/runtime/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ownerEoa: activeUserEoa,
            userEoa: activeUserEoa,
              singleLimit,
              dailyLimit,
              tokenAddress: effectiveRuntime.tokenAddress ?? "",
              gatewayRecipient: effectiveRuntime.gatewayRecipient ?? "",
              runtime: {
                owner: activeUserEoa,
                aaWallet: effectiveRuntime.aaWallet,
                sessionAddress: sessionWallet.address,
                sessionId,
                sessionTxHash: createTx.hash,
                source: "self_serve_wallet",
                runtimePurpose: "consumer",
              },
          }),
        });
        const finalizeJson = (await finalizeRes.json()) as { ok?: boolean; error?: string; reason?: string; runtime?: Record<string, unknown> };
        if (!finalizeRes.ok || !finalizeJson.ok) {
          throw new Error(finalizeJson.reason ?? finalizeJson.error ?? "Session import failed.");
        }
        effectiveRuntime = mergeRuntimeIdentity(
          parseRuntime(finalizeJson),
          identityProfile
        );
        onLocalSessionRuntimeReady?.(localRuntimeExport);
        onRuntimeUpdate(effectiveRuntime);
      }

      effectiveRuntime = mergeRuntimeIdentity(effectiveRuntime, identityProfile);
      if (!hasRuntimeIdentity(effectiveRuntime)) {
        throw new Error("Agent identity is not ready yet. Complete the Register Identity step first.");
      }

      setState("updatingPermissions");
      const permissionSync = await ensureSessionSelectorPermissions(effectiveRuntime, signer, chainReader);
      if (permissionSync.changed) {
        effectiveRuntime = {
          ...effectiveRuntime,
        };
        onRuntimeUpdate(effectiveRuntime);
      }

      setState("submitting");
      const res = await fetch("/api/setup/session/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionMode: "external",
          payload: {
            agentId: effectiveRuntime.agentId ?? "",
            agentWallet: effectiveRuntime.agentWallet ?? "",
            identityRegistry: effectiveRuntime.identityRegistry ?? "",
            chainId: effectiveRuntime.chainId ?? "kite-testnet",
            payerAaWallet: effectiveRuntime.aaWallet ?? effectiveRuntime.payerAaWallet ?? "",
            tokenAddress: effectiveRuntime.tokenAddress ?? "",
            gatewayRecipient: effectiveRuntime.gatewayRecipient ?? "",
            singleLimit,
            dailyLimit,
            allowedCapabilities: Array.from(selected),
            audience,
            nonce,
            issuedAt: new Date(issuedAt).getTime(),
            expiresAt: expiresAtMs,
          },
          userEoa: activeUserEoa,
          userSignature: signature,
          runtime: {
            owner: activeUserEoa,
            aaWallet: effectiveRuntime.aaWallet ?? effectiveRuntime.payerAaWallet ?? "",
            sessionAddress: effectiveRuntime.sessionAddress ?? "",
            sessionId: effectiveRuntime.sessionId ?? "",
            sessionTxHash: effectiveRuntime.sessionTxHash ?? "",
            source: "self_serve_wallet",
            runtimePurpose: "consumer",
            expiresAt: expiresAtMs,
          },
        }),
        credentials: "include",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        traceId?: string;
        runtime?: Record<string, unknown>;
      };
      if (!res.ok || !json.ok) {
        const baseReason = json.reason ?? json.error ?? "Authorization failed.";
        throw new Error(json.traceId ? `${baseReason} [traceId=${json.traceId}]` : baseReason);
      }
      if (json.runtime) {
        effectiveRuntime = mergeRuntimeIdentity(
          parseRuntime(json),
          identityProfile
        );
        onRuntimeUpdate(effectiveRuntime);
      }

      const policyRes = await fetch("/api/setup/session/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ownerEoa: activeUserEoa,
          aaWallet: effectiveRuntime.aaWallet ?? effectiveRuntime.payerAaWallet ?? "",
          sessionId: effectiveRuntime.sessionId ?? "",
          singleLimit,
          dailyLimit,
          allowedCapabilities: Array.from(selected),
          expiresAt: expiresAtMs,
        }),
      });
      const policyJson = (await policyRes.json()) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        runtime?: Record<string, unknown>;
      };
      if (!policyRes.ok || !policyJson.ok) {
        throw new Error(policyJson.reason ?? policyJson.error ?? "Authority policy setup failed.");
      }
      if (policyJson.runtime) {
        effectiveRuntime = mergeRuntimeIdentity(
          parseRuntime(policyJson),
          await fetchCurrentIdentity().catch(() => null)
        );
        onRuntimeUpdate(effectiveRuntime);
      }
      setState("done");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed.");
      setState("idle");
    }
  }

  const loading =
    state === "checkingWallet" ||
    state === "preparingToken" ||
    state === "creatingSession" ||
    state === "updatingPermissions" ||
    state === "signing" ||
    state === "submitting";
  const done = state === "done";
  const isRenew = mode === "renew";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <StepBadge n={3} active={!done} done={done} />
          <div>
            <h2 className="text-[15px] font-semibold text-[#18180e]">
              {isRenew ? "Renew Session Key" : "Configure & Authorize Session"}
            </h2>
            <p className="mt-0.5 text-[12px] text-[#9e8e76]">
              {isRenew
                ? "Your previous session has expired. Sign a new authorization to restore agent access."
                : "Create a session on-chain if needed, then sign the authority grant with your wallet."}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {done ? (
          <SuccessBanner
            msg={
              isRenew
                ? "Session key renewed - your agent is back online."
                : "Session authorization recorded on-chain."
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            {isRenew && (
              <InfoBanner msg="Your account and funds are intact. You only need to re-sign the session key - no new deposit required." />
            )}
              <InfoBanner msg="Sign & Renew is the only action in this step. KTrace will quietly prepare any missing settlement-token or session permissions first, then ask for the final session authorization signature." />
            {String(runtime.runtimeHealth || "").trim().toLowerCase() !== "active_default" && (
              <ErrorBanner msg="This runtime points to a historical AA wallet. Prepare a replacement wallet in step 2 before creating or renewing a session key." />
            )}

            {/* Limits */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                  Single-job limit (USDT)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={singleLimit}
                  onChange={(e) => setSingleLimit(e.target.value)}
                  className="h-9 rounded-xl border border-[rgba(90,80,50,0.2)] bg-[rgba(58,66,32,0.04)] px-3 text-[13px] text-[#18180e] outline-none focus:border-[#3a4220] focus:ring-2 focus:ring-[rgba(58,66,32,0.12)]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                  Daily limit (USDT)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  className="h-9 rounded-xl border border-[rgba(90,80,50,0.2)] bg-[rgba(58,66,32,0.04)] px-3 text-[13px] text-[#18180e] outline-none focus:border-[#3a4220] focus:ring-2 focus:ring-[rgba(58,66,32,0.12)]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                Session key validity (hours)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={sessionValidityHours}
                onChange={(e) => setSessionValidityHours(e.target.value)}
                className="h-9 rounded-xl border border-[rgba(90,80,50,0.2)] bg-[rgba(58,66,32,0.04)] px-3 text-[13px] text-[#18180e] outline-none focus:border-[#3a4220] focus:ring-2 focus:ring-[rgba(58,66,32,0.12)]"
              />
              <p className="text-[11px] text-[#9e8e76]">
                Authorization expires at{" "}
                {new Date(
                  Date.now() + Math.max(1, Number(sessionValidityHours || "0")) * 60 * 60 * 1000
                ).toLocaleString()}
              </p>
            </div>

            {/* Capabilities */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                Allowed capabilities ({selected.size} selected)
              </span>
              <div className="flex flex-col gap-3">
                {(["基本面 Agent", "技术面 Agent", "DATA Agent", ""] as const).map((group) => {
                  const groupCaps = capList.filter((c) => c.group === group);
                  if (groupCaps.length === 0) return null;
                  return (
                    <div key={group || "other"} className="flex flex-col gap-1.5">
                      {group && (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9e8e76]">
                          {group}
                        </span>
                      )}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {groupCaps.map((cap) => {
                          const checked = selected.has(cap.id);
                          return (
                            <button
                              key={cap.id}
                              type="button"
                              onClick={() => toggleCap(cap.id)}
                              className={[
                                "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-medium transition",
                                checked
                                  ? "border-[#3a4220] bg-[rgba(58,66,32,0.1)] text-[#3a4220]"
                                  : "border-[rgba(90,80,50,0.18)] bg-transparent text-[#7a6e56] hover:border-[rgba(58,66,32,0.3)]",
                              ].join(" ")}
                              title={cap.id}
                            >
                              <span
                                className={[
                                  "flex size-3.5 shrink-0 items-center justify-center rounded border",
                                  checked ? "border-[#3a4220] bg-[#3a4220]" : "border-[rgba(90,80,50,0.3)]",
                                ].join(" ")}
                              >
                                {checked && <Check className="size-2.5 text-[#faf7f1]" />}
                              </span>
                              <span className="truncate">{cap.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <PrimaryBtn
                onClick={authorize}
                loading={loading}
                disabled={loading || String(runtime.runtimeHealth || "").trim().toLowerCase() === "known_bad_factory" || runtime.isDefaultFactoryRuntime !== true}
              >
                  <ShieldCheck className="size-3.5" />
                  {state === "checkingWallet"
                    ? "Checking wallet..."
                    : state === "preparingToken"
                    ? "Preparing settlement token..."
                    : state === "creatingSession"
                      ? "Creating session..."
                    : state === "updatingPermissions"
                      ? "Updating permissions..."
                      : state === "signing"
                        ? "Waiting for wallet signature..."
                        : state === "submitting"
                          ? "Submitting..."
                          : isRenew
                            ? "Sign & Renew"
                            : "Sign & Authorize"}
              </PrimaryBtn>
              {!loading && (
                <p className="text-[11px] text-[#9e8e76]">
                  First authorization: 1 message sign + up to 3 on-chain confirmations. Renewals: 1 sign + 2 confirmations.
                </p>
              )}
            </div>

            {error && <ErrorBanner msg={error} />}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Step 3: Connect to Claude ───────────────────────────────────────────────

interface ConnectorStatus {
  state: "not_ready" | "not_connected" | "install_code_issued" | "connected";
  pendingInstallCode?: {
    installCodeId?: string;
    maskedPreview?: string;
    expiresAt?: number;
  } | null;
  activeGrant?: {
    grantId?: string;
    maskedPreview?: string;
    createdAt?: number;
    lastUsedAt?: number;
  } | null;
}

function extractUiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const reason = (value as { reason?: unknown }).reason;
    const error = (value as { error?: unknown }).error;
    if (typeof reason === "string" && reason.trim()) return reason;
    if (typeof error === "string" && error.trim()) return error;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function LocalInspectorPanel({
  address,
  runtime,
}: {
  address: string;
  runtime: SessionRuntime;
}) {
  const [connector, setConnector] = useState<ConnectorStatus | null>(null);
  const [connectorUrl, setConnectorUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);
  const canAutoFinishSetup = Boolean(
    (runtime.aaWallet || runtime.payerAaWallet) &&
      runtime.sessionId &&
      (runtime.owner || address)
  );

  const fetchStatus = useCallback(async () => {
    try {
      const search = new URLSearchParams({
        client: LOCAL_CONNECTOR_CLIENT,
        clientId: LOCAL_CONNECTOR_CLIENT_ID,
      });
      const res = await fetch(`/api/setup/connector/agent/status?${search.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        ok?: boolean;
        connector?: ConnectorStatus;
      };
      if (json.ok && json.connector) {
        setConnector(json.connector);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void fetchStatus();
  }, [fetchStatus]);

  async function ensureAuthorityPolicy() {
    const policyRes = await fetch("/api/setup/session/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        ownerEoa: runtime.owner || address,
        aaWallet: runtime.aaWallet || runtime.payerAaWallet || "",
        sessionId: runtime.sessionId || "",
        singleLimit: runtime.singleLimit || "0.01",
        dailyLimit: runtime.dailyLimit || "0.10",
        // Local MCP validation should not be blocked by placeholder UI capability buckets.
        allowedCapabilities: [],
        expiresAt:
          runtime.authorizationExpiresAt ||
          runtime.expiresAt ||
          Date.now() + 24 * 60 * 60 * 1000,
      }),
    });
    const policyJson = (await policyRes.json()) as { ok?: boolean; error?: string; reason?: string };
    if (!policyRes.ok || !policyJson.ok) {
      throw new Error(
        extractUiErrorMessage(
          policyJson.reason ?? policyJson.error ?? policyJson,
          "Authority policy setup failed."
        )
      );
    }
  }

  async function bootstrapConnector() {
    setError("");
    setLoading(true);
    try {
      if (canAutoFinishSetup) {
        await ensureAuthorityPolicy();
      }

      const res = await fetch("/api/setup/connector/agent/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ownerEoa: runtime.owner || address,
          client: LOCAL_CONNECTOR_CLIENT,
          clientId: LOCAL_CONNECTOR_CLIENT_ID,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        connector?: {
          state?: string;
          connectorUrl?: string;
          installCodeId?: string;
          maskedPreview?: string;
          expiresAt?: number;
          activeGrant?: ConnectorStatus["activeGrant"];
        };
        error?: string;
        reason?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(
          extractUiErrorMessage(
            json.reason ?? json.error ?? json,
            "Failed to generate a local MCP connector."
          )
        );
      }
      const localConnectorUrl = buildLocalConnectorUrl(json.connector?.connectorUrl ?? "");
      setConnectorUrl(localConnectorUrl);
      if (json.connector?.state === "connected" && json.connector.activeGrant) {
        setConnector({
          state: "connected",
          pendingInstallCode: null,
          activeGrant: json.connector.activeGrant,
        });
      } else {
        setConnector({
          state: "install_code_issued",
          pendingInstallCode: {
            installCodeId: json.connector?.installCodeId,
            maskedPreview: json.connector?.maskedPreview,
            expiresAt: json.connector?.expiresAt,
          },
          activeGrant: null,
        });
      }
      await fetchStatus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : extractUiErrorMessage(err, "Failed to generate a local MCP connector.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function revokeConnector() {
    if (!confirm("Revoke this local MCP connector? Inspector or other local MCP clients will lose access immediately.")) {
      return;
    }
    setRevoking(true);
    setError("");
    try {
      const res = await fetch("/api/setup/connector/agent/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ownerEoa: runtime.owner || address,
          client: LOCAL_CONNECTOR_CLIENT,
          clientId: LOCAL_CONNECTOR_CLIENT_ID,
          reason: "local-setup-reset",
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; reason?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.reason ?? json.error ?? "Reset failed.");
      }
      setConnector({ state: "not_connected", pendingInstallCode: null, activeGrant: null });
      setConnectorUrl("");
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setRevoking(false);
    }
  }

  const state = connector?.state ?? "not_connected";
  const isConnected = state === "connected";
  const isPending = state === "install_code_issued";
  const expiresAt = connector?.pendingInstallCode?.expiresAt;
  const expiresLabel = expiresAt
    ? `Expires ${new Date(expiresAt).toLocaleTimeString()}`
    : "";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#3a4220] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#faf7f1]">
          Recommended
        </span>
      </div>

      {isConnected && (
        <div className="flex flex-col gap-4">
          <SuccessBanner msg="Local MCP connector is active. You can now use MCP Inspector or any local streamable HTTP client against KTrace." />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
              Active Grant
            </span>
            <div className="flex items-center gap-2 text-[11px] text-[#7a6e56]">
              <span className="font-mono">{connector?.activeGrant?.maskedPreview ?? "—"}</span>
              {connector?.activeGrant?.lastUsedAt ? (
                <span>
                  Last used {new Date(connector.activeGrant.lastUsedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
            <p className="text-[12px] font-medium text-[#18180e]">Local validation checklist</p>
            <ol className="flex flex-col gap-2 text-[11px] text-[#7a6e56]">
              <li>1. Open MCP Inspector or another local MCP client.</li>
              <li>2. Use the streamable HTTP transport against your local KTrace backend.</li>
              <li>3. Confirm `tools/list` succeeds and KTrace tools appear.</li>
              <li>4. Run one `tools/call` invocation through the connector.</li>
              <li>5. If the tool is paid, confirm receipt and evidence artifacts are generated.</li>
            </ol>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GhostBtn onClick={revokeConnector} disabled={revoking} loading={revoking}>
              <Unlink className="size-3" />
              Revoke & Reset
            </GhostBtn>
            <a
              href="/mcp"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] px-4 text-[12px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.07)]"
            >
              <ExternalLink className="size-3" /> MCP Guide
            </a>
          </div>
        </div>
      )}

      {isPending && connectorUrl && (
        <div className="flex flex-col gap-4">
          <InfoBanner msg="Local MCP connector generated. Use this URL with MCP Inspector or another streamable HTTP client while the token is still valid." />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
              Local MCP Connector URL
            </span>
            <MonoField value={connectorUrl} wrap />
            {expiresLabel && (
              <p className="text-[10px] text-[#9e8e76]">{expiresLabel}</p>
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
            <p className="text-[12px] font-medium text-[#18180e]">How to validate locally</p>
            <ol className="flex flex-col gap-2 text-[11px] text-[#7a6e56]">
              <li>1. Open MCP Inspector and choose the streamable HTTP transport.</li>
              <li>2. Paste the connector URL above as the server endpoint.</li>
              <li>3. Confirm `tools/list` returns KTrace tools.</li>
              <li>4. Run a sample `tools/call` and confirm the connector claims successfully.</li>
              <li>5. Use `receipt` and `evidence` endpoints if you test a paid capability.</li>
            </ol>
            <p className="text-[10px] text-[#9e8e76]">
              The first successful claim upgrades this one-time token into a persistent local grant.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GhostBtn onClick={revokeConnector} disabled={revoking} loading={revoking}>
              <Unlink className="size-3" />
              Revoke & Reset
            </GhostBtn>
            <a
              href="/mcp"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] px-4 text-[12px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.07)]"
            >
              <ExternalLink className="size-3" /> MCP Guide
            </a>
          </div>
        </div>
      )}

      {!isConnected && !(isPending && connectorUrl) && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(58,66,32,0.04)] px-4 py-3">
            <Link2 className="mt-0.5 size-4 shrink-0 text-[#7a6e56]" />
            <p className="text-[12px] leading-relaxed text-[#7a6e56]">
              Generate a local MCP connector for KTrace. This is the primary local-development path and uses your current backend at <code className="font-mono">{LOCAL_BACKEND_BASE_URL}</code>.
            </p>
          </div>
          {state === "not_ready" && (
            <ErrorBanner
              msg={
                canAutoFinishSetup
                  ? "Local MCP access still needs a consumer authority policy. Start MCP Inspector will finish that setup automatically."
                  : "Setup is not complete. Finish wallet connection, AA wallet funding, and session authorization before generating a local MCP connector."
              }
            />
          )}
          {isPending && !connectorUrl && (
            <InfoBanner msg="A pending local connector token already exists, but its one-time URL is not shown again after refresh. Revoke and generate a new one to continue local validation." />
          )}
          <PrimaryBtn
            onClick={bootstrapConnector}
            loading={loading}
            disabled={loading || (state === "not_ready" && !canAutoFinishSetup)}
          >
            <Link2 className="size-3.5" />
            {loading ? "Generating..." : "Start MCP Inspector"}
          </PrimaryBtn>
          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
            <p className="text-[12px] font-medium text-[#18180e]">Local verification checklist</p>
            <ol className="flex flex-col gap-2 text-[11px] text-[#7a6e56]">
              <li>1. Bootstrap a local MCP connector.</li>
              <li>2. Open MCP Inspector with the streamable HTTP transport.</li>
              <li>3. Hit `/mcp/connect/:token` through the generated local URL.</li>
              <li>4. Confirm `tools/list` and one `tools/call` work.</li>
              <li>5. Confirm receipt/evidence if you test a paid capability.</li>
            </ol>
          </div>
        </div>
      )}

      {error && <ErrorBanner msg={error} />}
    </div>
  );
}

function LocalClaudeComingSoonPanel() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[rgba(58,66,32,0.22)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#3a4220]">
          Coming Soon
        </span>
      </div>
      <InfoBanner msg="Claude Remote MCP requires a publicly reachable HTTPS endpoint. Local development should use MCP Inspector against your current backend instead." />
      <PrimaryBtn disabled>
        <Link2 className="size-3.5" />
        Connect to Claude
      </PrimaryBtn>
      <p className="text-[11px] leading-relaxed text-[#9e8e76]">
        Once KTrace is deployed behind a public <code className="font-mono">https://...</code> MCP endpoint, this card will generate a one-time Claude install link again.
      </p>
    </div>
  );
}

function ClaudeConnectorPanel({
  address,
  runtime,
}: {
  address: string;
  runtime: SessionRuntime;
}) {
  const [connector, setConnector] = useState<ConnectorStatus | null>(null);
  const [connectorUrl, setConnectorUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);
  const canAutoFinishSetup = Boolean(
    (runtime.aaWallet || runtime.payerAaWallet) &&
      runtime.sessionId &&
      (runtime.owner || address)
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/connector/claude/status", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        ok?: boolean;
        connector?: ConnectorStatus;
      };
      if (json.ok && json.connector) {
        setConnector(json.connector);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void fetchStatus();
  }, [fetchStatus]);

  async function generateInstallLink() {
    setError("");
    setLoading(true);
    try {
      if (state === "not_ready" && canAutoFinishSetup) {
        const policyRes = await fetch("/api/setup/session/policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ownerEoa: runtime.owner || address,
            aaWallet: runtime.aaWallet || runtime.payerAaWallet || "",
            sessionId: runtime.sessionId || "",
            singleLimit: runtime.singleLimit || "0.01",
            dailyLimit: runtime.dailyLimit || "0.10",
            allowedCapabilities: DEFAULT_CAPS,
            expiresAt:
              runtime.authorizationExpiresAt ||
              runtime.expiresAt ||
              Date.now() + 24 * 60 * 60 * 1000,
          }),
        });
        const policyJson = (await policyRes.json()) as { ok?: boolean; error?: string; reason?: string };
        if (!policyRes.ok || !policyJson.ok) {
          throw new Error(
            extractUiErrorMessage(
              policyJson.reason ?? policyJson.error ?? policyJson,
              "Authority policy setup failed."
            )
          );
        }
        await fetchStatus();
      }

      const res = await fetch("/api/setup/connector/claude/install-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        connector?: {
          state?: string;
          connectorUrl?: string;
          installCodeId?: string;
          maskedPreview?: string;
          expiresAt?: number;
        };
        error?: string;
        reason?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(
          extractUiErrorMessage(
            json.reason ?? json.error ?? json,
            "Failed to generate install link."
          )
        );
      }
      setConnectorUrl(json.connector?.connectorUrl ?? "");
      setConnector({
        state: "install_code_issued",
        pendingInstallCode: {
          installCodeId: json.connector?.installCodeId,
          maskedPreview: json.connector?.maskedPreview,
          expiresAt: json.connector?.expiresAt,
        },
        activeGrant: null,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : extractUiErrorMessage(err, "Failed to generate install link.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function revokeConnector() {
    if (!confirm("Revoke this Claude connector? Claude will lose access immediately.")) return;
    setRevoking(true);
    setError("");
    try {
      const res = await fetch("/api/setup/connector/claude/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; reason?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.reason ?? json.error ?? "Revoke failed.");
      }
      setConnector({ state: "not_connected", pendingInstallCode: null, activeGrant: null });
      setConnectorUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setRevoking(false);
    }
  }

  const state = connector?.state ?? "not_connected";
  const isConnected = state === "connected";
  const isPending = state === "install_code_issued";
  const expiresAt = connector?.pendingInstallCode?.expiresAt;
  const expiresLabel = expiresAt
    ? `Expires ${new Date(expiresAt).toLocaleTimeString()}`
    : "";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#3a4220] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#faf7f1]">
          Recommended
        </span>
      </div>

      {/* Connected state */}
      {isConnected && (
        <div className="flex flex-col gap-4">
          <SuccessBanner msg="Claude connector is active. Your Claude Desktop can list and call ktrace tools." />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
              Active Grant
            </span>
            <div className="flex items-center gap-2 text-[11px] text-[#7a6e56]">
              <span className="font-mono">{connector?.activeGrant?.maskedPreview ?? "—"}</span>
              {connector?.activeGrant?.lastUsedAt ? (
                <span>
                  Last used {new Date(connector.activeGrant.lastUsedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GhostBtn onClick={revokeConnector} disabled={revoking} loading={revoking}>
              <Unlink className="size-3" />
              Revoke & Disconnect
            </GhostBtn>
          </div>
        </div>
      )}

      {/* Pending install code state */}
      {isPending && connectorUrl && (
        <div className="flex flex-col gap-4">
          <InfoBanner msg="Install link generated. Add this URL as a Remote MCP server in Claude Desktop. The link is short-lived and used only for first-time binding." />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
              Claude Connector URL
            </span>
            <MonoField value={connectorUrl} />
            {expiresLabel && (
              <p className="text-[10px] text-[#9e8e76]">{expiresLabel}</p>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
            <p className="text-[12px] font-medium text-[#18180e]">How to connect</p>
            <ol className="flex flex-col gap-2 text-[11px] text-[#7a6e56]">
              <li>1. Open Claude Desktop Settings</li>
              <li>2. Go to the MCP / Remote Servers section</li>
              <li>3. Add a new Remote MCP Server with the URL above</li>
              <li>4. Claude will connect and bind automatically on first use</li>
            </ol>
            <p className="text-[10px] text-[#9e8e76]">
              After the first successful connection, the install link expires and a persistent grant takes over. You do not need to keep this link.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <GhostBtn onClick={revokeConnector} disabled={revoking} loading={revoking}>
              <Unlink className="size-3" />
              Cancel & Revoke
            </GhostBtn>
            <GhostBtn onClick={fetchStatus}>
              <RefreshCw className="size-3" />
              Refresh Status
            </GhostBtn>
          </div>
        </div>
      )}

      {/* Not connected / not ready / pending without URL */}
      {!isConnected && !(isPending && connectorUrl) && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(58,66,32,0.04)] px-4 py-3">
            <Link2 className="mt-0.5 size-4 shrink-0 text-[#7a6e56]" />
            <p className="text-[12px] leading-relaxed text-[#7a6e56]">
              Generate a one-time install link for Claude. No config files to edit. Claude connects as a Remote MCP server and binds automatically on first use.
            </p>
          </div>
          {state === "not_ready" && (
            <ErrorBanner
              msg={
                canAutoFinishSetup
                  ? "Claude access still needs a consumer authority policy. Connect to Claude will finish that setup automatically."
                  : "Setup is not complete. Finish wallet connection, AA wallet funding, and session authorization before connecting Claude."
              }
            />
          )}
          <PrimaryBtn
            onClick={generateInstallLink}
            loading={loading}
            disabled={loading || (state === "not_ready" && !canAutoFinishSetup)}
          >
            <Link2 className="size-3.5" />
            {loading ? "Generating..." : "Connect to Claude"}
          </PrimaryBtn>
        </div>
      )}

      {error && <ErrorBanner msg={error} />}
    </div>
  );
}

function DeveloperSetupPanel({
  localSessionRuntimeExport,
  onOpenSessionStep,
}: {
  localSessionRuntimeExport: LocalSessionRuntimeExport | null;
  onOpenSessionStep?: () => void;
}) {
  const [state, setState] = useState<"idle" | "generating" | "done">("idle");
  const [revoking, setRevoking] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyMeta, setKeyMeta] = useState<ApiKeyMeta | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/setup/api-key", { credentials: "include" });
        if (res.ok) {
          const json = (await res.json()) as {
            ok?: boolean;
            key?: ApiKeyMeta;
            meta?: ApiKeyMeta;
            apiKey?: ApiKeyMeta;
          };
          const meta = json.apiKey ?? json.key ?? json.meta ?? null;
          if (meta && !meta.revokedAt) {
            setKeyMeta(meta);
            setState("done");
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  async function generate() {
    setError("");
    setState("generating");
    try {
      const res = await fetch("/api/setup/api-key/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        key?: string;
        secret?: string;
        meta?: ApiKeyMeta;
        keyMeta?: ApiKeyMeta;
        apiKey?: (ApiKeyMeta & { key?: string });
        error?: string;
        reason?: string;
      };
      const secret = json.apiKey?.key ?? json.key ?? json.secret ?? "";
      if (!res.ok || !secret) {
        throw new Error(json.reason ?? json.error ?? "Key generation failed.");
      }
      setApiKey(secret);
      const meta = json.apiKey ?? json.meta ?? json.keyMeta ?? null;
      if (meta) setKeyMeta(meta);
      setState("done");
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key generation failed.");
      setState("idle");
    }
  }

  async function revoke() {
    if (!confirm("Revoke this key? It will stop working immediately.")) return;
    setRevoking(true);
    try {
      await fetch("/api/setup/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      setApiKey("");
      setKeyMeta(null);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setRevoking(false);
    }
  }

  const hasFullKey = Boolean(apiKey);
  const keyDisplay = hasFullKey ? apiKey : "<generate_a_new_ktrace_sk_key>";
  const sessionRuntimePath = "<path-to-ktrace-session-runtime.json>";
  const claudeCodeCommands = [
    `claude mcp add --transport stdio ktrace "ktrace" "mcp" "bridge" --base-url ${LOCAL_BACKEND_BASE_URL} --api-key "${keyDisplay}" --session-runtime "${sessionRuntimePath}"`,
    "claude mcp list",
    "claude mcp get ktrace",
  ].join("\n");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(58,66,32,0.04)] px-4 py-3">
        <Terminal className="mt-0.5 size-4 shrink-0 text-[#7a6e56]" />
        <p className="text-[12px] leading-relaxed text-[#7a6e56]">
          Run the local <strong>ktrace mcp bridge</strong> on your machine. It signs x402 payments with your local session key and forwards requests to the KTrace server — your private key never leaves this device.
        </p>
      </div>

      {(state === "idle" || state === "generating") && (
        <div className="flex flex-col gap-4">
          {state === "generating" ? (
            <div className="flex items-center gap-2 text-[12px] text-[#7a6e56]">
              <Loader2 className="size-3.5 animate-spin" /> Generating key...
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(58,66,32,0.04)] px-4 py-3">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-[#7a6e56]" />
                <p className="text-[12px] leading-relaxed text-[#7a6e56]">
                  Generate an account-scoped MCP API key. It starts with <code className="font-mono">ktrace_sk_</code> and is shown <strong>once</strong>.
                </p>
              </div>
              <PrimaryBtn onClick={generate}>
                <KeyRound className="size-3.5" />
                Generate API Key
              </PrimaryBtn>
            </>
          )}
        </div>
      )}

      {state === "done" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9e8e76]">
                {apiKey ? "Your API Key (shown once)" : "Active Key"}
              </span>
              {apiKey && (
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-[#9e8e76] transition hover:text-[#3a4220]"
                >
                  {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  {revealed ? "Hide" : "Reveal"}
                </button>
              )}
            </div>
            <MonoField
              value={
                apiKey
                  ? revealed
                    ? apiKey
                    : "ktrace_sk_****************"
                  : (keyMeta?.maskedPreview ?? "No key generated yet")
              }
              copyValue={apiKey || null}
              hideCopyWhenUnavailable={!apiKey}
            />
            {apiKey && (
              <p className="text-[11px] text-[#b43c28]">
                Copy this key now - it will not be shown again.
              </p>
            )}
            {!apiKey && keyMeta && (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-[#9e8e76]">
                  Key ID: <code className="font-mono">{keyMeta.keyId}</code> - Role: {keyMeta.role} - Created {new Date(keyMeta.createdAt).toLocaleDateString()}
                </p>
                <p className="text-[11px] text-[#b43c28]">
                  This is only a masked preview. The full secret cannot be recovered. Revoke or generate a new key before using these commands.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 border-t border-[rgba(90,80,50,0.1)] pt-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-[#7a6e56]" />
                <span className="text-[13px] font-semibold text-[#18180e]">Local Session Runtime</span>
              </div>
              {localSessionRuntimeExport ? (
                <>
                  <p className="text-[12px] leading-relaxed text-[#7a6e56]">
                    Download this JSON and keep it on your machine. It contains your session key and is required for paid MCP replay through the local bridge.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <PrimaryBtn
                      onClick={() => downloadJsonFile("ktrace-session-runtime.json", localSessionRuntimeExport)}
                    >
                      <ShieldCheck className="size-3.5" />
                      Download Local Session Runtime
                    </PrimaryBtn>
                    <p className="text-[11px] text-[#9e8e76]">
                      Suggested filename: <code className="font-mono">ktrace-session-runtime.json</code>
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <ErrorBanner msg="Paid MCP needs a local session runtime file. Open the Session step on this device, authorize or renew once, then return here to download it." />
                  {onOpenSessionStep && (
                    <GhostBtn onClick={onOpenSessionStep}>
                      <RefreshCw className="size-3.5" />
                      Open Session Step
                    </GhostBtn>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-[#7a6e56]" />
              <span className="text-[13px] font-semibold text-[#18180e]">Claude Code Example</span>
            </div>
            {!hasFullKey && (
              <p className="text-[11px] text-[#b43c28]">
                The commands below use a placeholder because only a masked key is available right now. Generate or rotate a key to get the full secret.
              </p>
            )}
            <CodeBlock lang="bash" code={claudeCodeCommands} />
            <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[rgba(58,66,32,0.04)] p-4">
              <p className="text-[12px] font-medium text-[#18180e]">What to run next</p>
              <ol className="flex flex-col gap-2 text-[11px] text-[#7a6e56]">
                <li>1. Download your local session runtime JSON and keep it private.</li>
                <li>2. Add `ktrace mcp bridge` as a stdio MCP server in Claude Code.</li>
                <li>3. Check that Claude Code lists the `ktrace` server and saved the command arguments correctly.</li>
                <li>4. Use the bridge for all tools — it signs payments locally and forwards to the KTrace server.</li>
              </ol>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <GhostBtn onClick={revoke} disabled={revoking} loading={revoking}>
              Revoke Key
            </GhostBtn>
          </div>
        </div>
      )}

      {error && <ErrorBanner msg={error} />}
    </div>
  );
}

function ConnectStep4({
  address: _address,
  runtime: _runtime,
  localSessionRuntimeExport,
  sessionValid: _sessionValid,
  onOpenSessionStep,
}: {
  address: string;
  runtime: SessionRuntime;
  localSessionRuntimeExport: LocalSessionRuntimeExport | null;
  sessionValid: boolean;
  onOpenSessionStep?: () => void;
}) {
  return (
      <Card>
      <CardHeader>
          <div className="flex items-center gap-3">
            <StepBadge n={5} active done={false} />
            <div>
              <h2 className="text-[15px] font-semibold text-[#18180e]">Connect via MCP</h2>
              <p className="mt-0.5 text-[12px] text-[#9e8e76]">
                Generate an API key, download your local session runtime, then connect Claude Code to the local KTrace bridge.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          <DeveloperSetupPanel
            localSessionRuntimeExport={localSessionRuntimeExport}
            onOpenSessionStep={onOpenSessionStep}
          />
        </CardBody>
      </Card>
  );
}

// 鈹€鈹€鈹€ Register Identity Step 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function RegisterIdentityStep({
  address,
  runtime,
  reviewMode = false,
  onRuntimeUpdate,
  onDone,
}: {
  address: string;
  runtime: SessionRuntime;
  reviewMode?: boolean;
  onRuntimeUpdate: (r: SessionRuntime) => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<
    "idle" | "checking" | "registering" | "settingWallet" | "done"
  >("idle");
  const [error, setError] = useState("");
  const [registerTxHash, setRegisterTxHash] = useState("");
  const [walletTxHash, setWalletTxHash] = useState("");
  const [agentId, setAgentId] = useState("");
  const [existingAgentId, setExistingAgentId] = useState("");
  const [registerFee, setRegisterFee] = useState("");
  const [walletFee, setWalletFee] = useState("");

  const registryAddress = runtime.identityRegistry || DEFAULT_IDENTITY_REGISTRY;
  const aaWallet = runtime.aaWallet || "";

  useEffect(() => {
    if (!hasRuntimeIdentity(runtime)) return;
    setExistingAgentId(runtime.agentId || "");
    setAgentId(runtime.agentId || "");
    setRegisterTxHash(runtime.identityRegisterTxHash || "");
    setWalletTxHash(runtime.identityBindTxHash || "");
    if (
      runtime.aaWallet &&
      runtime.agentWallet &&
      normalizeAccountAddress(runtime.agentWallet) === normalizeAccountAddress(runtime.aaWallet)
    ) {
      setState("done");
      return;
    }
    setState("idle");
  }, [
    runtime.aaWallet,
    runtime.agentId,
    runtime.agentWallet,
    runtime.identityBindTxHash,
    runtime.identityRegisterTxHash,
    runtime.identityRegistry,
  ]);

  async function checkExistingIdentity() {
    setState("checking");
    setError("");
    try {
      // Try fetching current identity from backend
      const identityProfile = await withTimeout(
        fetchCurrentIdentity().catch(() => null),
        4000,
        "Identity lookup timed out."
      );
      if (identityProfile && hasRuntimeIdentity(mergeRuntimeIdentity(runtime, identityProfile))) {
        const merged = mergeRuntimeIdentity(runtime, identityProfile);
        // Verify on-chain that the current EOA actually owns this agentId.
        // If the runtime has a stale agentId from a different wallet, ownerOf will
        // not match and we must treat it as "no identity" so the user registers fresh.
        if (merged.agentId && registryAddress) {
          const roProvider = getReadOnlyProvider() ?? getBrowserProvider();
          if (roProvider) {
            const roRegistry = new Contract(registryAddress, IDENTITY_REGISTRY_ABI, roProvider);
            const onChainOwner = await roRegistry.ownerOf(BigInt(merged.agentId)).catch(() => "");
            if (onChainOwner && normalizeAccountAddress(onChainOwner) !== normalizeAccountAddress(address)) {
              // Token belongs to a different EOA — clear stale identity from runtime
              // and fall through to fresh registration flow.
              const cleared = { ...merged, agentId: undefined, agentWallet: undefined,
                identityRegisterTxHash: undefined, identityBindTxHash: undefined };
              onRuntimeUpdate(cleared);
              setExistingAgentId("");
              // Fall through to fee-fetch / fresh registration
            } else {
              setExistingAgentId(merged.agentId || "");
              if (
                merged.aaWallet &&
                merged.agentWallet &&
                normalizeAccountAddress(merged.agentWallet) === normalizeAccountAddress(merged.aaWallet)
              ) {
                onRuntimeUpdate(merged);
                setState("done");
                return;
              }
              onRuntimeUpdate(merged);
              setState("idle");
              return;
            }
          } else {
            setExistingAgentId(merged.agentId || "");
            onRuntimeUpdate(merged);
            setState("idle");
            return;
          }
        } else {
          setExistingAgentId(merged.agentId || "");
          if (
            merged.aaWallet &&
            merged.agentWallet &&
            normalizeAccountAddress(merged.agentWallet) === normalizeAccountAddress(merged.aaWallet)
          ) {
            onRuntimeUpdate(merged);
            setState("done");
            return;
          }
          onRuntimeUpdate(merged);
          setState("idle");
          return;
        }
      }
      // No identity — read fees
      const provider = getReadOnlyProvider() ?? getBrowserProvider();
      if (provider && registryAddress) {
        const registry = new Contract(registryAddress, IDENTITY_REGISTRY_ABI, provider);
        const [regFee, metaFee] = await withTimeout(
          Promise.all([
            registry.registerFee().catch(() => BigInt(0)),
            registry.metadataUpdateFee().catch(() => BigInt(0)),
          ]),
          4000,
          "Identity fee lookup timed out."
        );
        setRegisterFee(regFee.toString());
        setWalletFee(metaFee.toString());
      }
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check identity.");
      setState("idle");
    }
  }

  async function registerIdentity() {
    setError("");
    const eth = getEthereum();
    if (!eth) { setError("Wallet not available."); return; }
    try {
      await ensureKiteTestnet(eth);
      const provider = getBrowserProvider();
      if (!provider) throw new Error("Wallet provider unavailable.");
      const signer = await provider.getSigner();
      if (!registryAddress || !isAddress(registryAddress)) {
        throw new Error("Identity registry address not configured.");
      }
      const registry = new Contract(registryAddress, IDENTITY_REGISTRY_ABI, signer);

      let resolvedAgentId = existingAgentId || agentId;
      let resolvedRegisterTxHash = registerTxHash;
      let resolvedWalletTxHash = walletTxHash;

      // Guard: verify the current EOA actually owns this agentId on-chain.
      // Prevents NotAgentAdmin() revert when runtime has a stale agentId from a
      // different wallet (e.g. user switched MetaMask accounts).
      if (resolvedAgentId) {
        const onChainOwner = await registry.ownerOf(BigInt(resolvedAgentId)).catch(() => "");
        if (onChainOwner && normalizeAccountAddress(onChainOwner) !== normalizeAccountAddress(address)) {
          // Stale agentId — force fresh registration
          resolvedAgentId = "";
          setExistingAgentId("");
          setAgentId("");
        }
      }

      // Step 1: Register (mint agent identity)
      if (!resolvedAgentId) {
        setState("registering");
        const tokenURI = JSON.stringify({
          name: `KTrace Agent ${shorten(address)}`,
          description: "KTrace MCP Agent Identity",
          owner: address,
          aaWallet,
          createdAt: new Date().toISOString(),
        });
        const fee = registerFee ? BigInt(registerFee) : BigInt(0);
        const tx = await registry.register(tokenURI, { value: fee });
        setRegisterTxHash(tx.hash);
        const receipt = await tx.wait();
        // Extract agentId from Transfer event
        const transferEvent = receipt.logs.find(
          (log: { topics: string[] }) => log.topics[0] === keccak256(toUtf8Bytes("Transfer(address,address,uint256)"))
        );
        const newAgentId = transferEvent ? BigInt(transferEvent.topics[3]).toString() : "";
        if (!newAgentId) throw new Error("Could not extract agentId from transaction receipt.");
        setAgentId(newAgentId);
        setExistingAgentId(newAgentId);
        resolvedAgentId = newAgentId;
        resolvedRegisterTxHash = tx.hash;
      }

      // Step 2: Set agent wallet to AA wallet
      if (resolvedAgentId && aaWallet) {
        // Check if wallet already set correctly
        const currentWallet = await registry.getAgentWallet(BigInt(resolvedAgentId)).catch(() => "");
        if (normalizeAccountAddress(currentWallet) !== normalizeAccountAddress(aaWallet)) {
          setState("settingWallet");
          // Always read metadataUpdateFee fresh from chain — walletFee state may be
          // unset when the user already has an existing identity (fee-fetch is skipped
          // in that code path), causing a FeeTooLow revert with value: 0.
          const metaFee = await registry.metadataUpdateFee().catch(
            () => walletFee ? BigInt(walletFee) : BigInt(0)
          );
          const walletTx = await registry.setAgentWallet(BigInt(resolvedAgentId), aaWallet, { value: metaFee });
          setWalletTxHash(walletTx.hash);
          await walletTx.wait();
          resolvedWalletTxHash = walletTx.hash;
        }
      }

      // Update runtime with identity info
      const updatedRuntime = {
        ...runtime,
        agentId: resolvedAgentId,
        identityRegistry: registryAddress,
        agentWallet: aaWallet,
        identityRegisterTxHash: resolvedRegisterTxHash,
        identityBindTxHash: resolvedWalletTxHash,
      };
      onRuntimeUpdate(updatedRuntime);

      // Sync with backend
      const syncRes = await fetch("/api/setup/runtime/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ownerEoa: address,
          aaWallet,
          agentId: resolvedAgentId,
          identityRegistry: registryAddress,
          agentWallet: aaWallet,
          identityRegisterTxHash: resolvedRegisterTxHash,
          identityBindTxHash: resolvedWalletTxHash,
        }),
      });
      const syncJson = (await syncRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (syncRes.ok && syncJson.ok) {
        onRuntimeUpdate(parseRuntime(syncJson));
      } else if (!syncRes.ok) {
        // Surface backend sync errors so the user knows the data wasn't persisted.
        // Common cause: 409 "setup_runtime_identity_missing_runtime" when the AA
        // wallet prepare step didn't create a backend runtime entry first.
        const reason = (syncJson.reason as string) || (syncJson.error as string) || `HTTP ${syncRes.status}`;
        console.warn("[RegisterIdentity] backend sync failed:", reason, syncJson);
        // Non-fatal: on-chain registration succeeded; user can re-sync later.
      }

      setState("done");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
      setState("idle");
    }
  }

  const effectiveAgentId = existingAgentId || agentId;
  const isDone = state === "done";

  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.12)] bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-xl bg-[rgba(58,66,32,0.08)] text-[#3a4220]">
          <ShieldCheck className="size-4" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-[#18180e]">
            Register Agent Identity
          </h2>
          <p className="text-[12px] text-[#9e8e76]">
            Create your on-chain identity on the ERC-8004 registry
          </p>
        </div>
      </div>

      {/* Registry info */}
      {registryAddress && (
        <div className="mb-4 rounded-xl bg-[rgba(58,66,32,0.04)] p-4 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-[#7a6e56]">Registry</span>
            <span className="font-mono text-[11px] text-[#18180e]">{shorten(registryAddress, 10, 6)}</span>
          </div>
          {aaWallet && (
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[#7a6e56]">Agent Wallet (AA)</span>
              <span className="font-mono text-[11px] text-[#18180e]">{shorten(aaWallet, 10, 6)}</span>
            </div>
          )}
        </div>
      )}

      {/* Already registered */}
      {effectiveAgentId && isDone && (
        <div className="mb-4 rounded-xl border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.06)] p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#3a4220]">
            <CheckCircle2 className="size-4" />
            Identity Registered
          </div>
          <div className="mt-3 space-y-2 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-[#7a6e56]">Agent ID</span>
              <span className="font-mono font-semibold text-[#18180e]">#{effectiveAgentId}</span>
            </div>
            {registerTxHash && (
              <div className="flex items-center justify-between">
                <span className="text-[#7a6e56]">Register Tx</span>
                <a
                  href={`https://testnet.kitescan.ai/tx/${registerTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-mono text-[11px] text-[#3a4220] hover:underline"
                >
                  {shorten(registerTxHash, 10, 6)} <ExternalLink className="size-3" />
                </a>
              </div>
            )}
            {walletTxHash && (
              <div className="flex items-center justify-between">
                <span className="text-[#7a6e56]">Bind Wallet Tx</span>
                <a
                  href={`https://testnet.kitescan.ai/tx/${walletTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-mono text-[11px] text-[#3a4220] hover:underline"
                >
                  {shorten(walletTxHash, 10, 6)} <ExternalLink className="size-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Not yet registered — action */}
      {!isDone && state !== "checking" && (
        <>
          {registerFee && BigInt(registerFee) > BigInt(0) && (
            <p className="mb-3 text-[11px] text-[#9e8e76]">
              Registration fee: {(Number(BigInt(registerFee)) / 1e18).toFixed(6)} KITE
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={registerIdentity}
              disabled={state === "registering" || state === "settingWallet" || !registryAddress}
              className="flex min-w-[240px] items-center justify-center gap-2 rounded-xl bg-[#3a4220] px-5 py-3 text-[13px] font-semibold text-[#faf7f1] transition hover:bg-[#4a5530] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "registering" ? (
                <><Loader2 className="size-4 animate-spin" /> Registering on-chain...</>
              ) : state === "settingWallet" ? (
                <><Loader2 className="size-4 animate-spin" /> Binding AA wallet...</>
              ) : existingAgentId ? (
                <><Link2 className="size-4" /> Bind AA Wallet to Agent #{existingAgentId}</>
              ) : (
                <><ShieldCheck className="size-4" /> Register Agent Identity</>
              )}
            </button>
            <GhostBtn onClick={() => void checkExistingIdentity()} disabled={state !== "idle" || !registryAddress}>
              <RefreshCw className="size-3.5" />
              Re-sync from chain
            </GhostBtn>
          </div>
        </>
      )}

      {/* Checking spinner */}
      {state === "checking" && (
        <div className="flex items-center gap-2 text-[12px] text-[#7a6e56]">
          <Loader2 className="size-3.5 animate-spin" /> Checking identity...
        </div>
      )}

      {error && <ErrorBanner msg={error} />}

      {!registryAddress && (
        <ErrorBanner msg="Identity registry address not configured. Set NEXT_PUBLIC_IDENTITY_REGISTRY in your environment." />
      )}
    </div>
  );
}

// 鈹€鈹€鈹€ Progress bar 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const STEP_LABELS = ["Connect Wallet", "Prepare AA Wallet", "Register Identity", "Authorize", "MCP"];

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-0">
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full items-center">
              {i > 0 && (
                <div
                  className={[
                    "h-px flex-1 transition-colors",
                    done || active ? "bg-[#3a4220]" : "bg-[rgba(90,80,50,0.18)]",
                  ].join(" ")}
                />
              )}
              <span
                className={[
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-all",
                  done
                    ? "border-[#3a4220] bg-[#3a4220] text-[#faf7f1]"
                    : active
                      ? "border-[#3a4220] bg-[rgba(58,66,32,0.12)] text-[#3a4220]"
                      : "border-[rgba(90,80,50,0.2)] bg-transparent text-[#9e8e76]",
                ].join(" ")}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={[
                    "h-px flex-1 transition-colors",
                    done ? "bg-[#3a4220]" : "bg-[rgba(90,80,50,0.18)]",
                  ].join(" ")}
                />
              )}
            </div>
            <span
              className={[
                "text-[10px] font-medium",
                done ? "text-[#3a4220]" : active ? "text-[#18180e]" : "text-[#9e8e76]",
              ].join(" ")}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 鈹€鈹€鈹€ Root Wizard 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export default function SetupWizardClient({ capabilities }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [manualStep, setManualStep] = useState<Step | null>(null);
  const [address, setAddress] = useState("");
  const [runtime, setRuntime] = useState<SessionRuntime>({});
  const [localSessionRuntimeExport, setLocalSessionRuntimeExport] = useState<LocalSessionRuntimeExport | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [sessionStepCompleted, setSessionStepCompleted] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [switchingWallet, setSwitchingWallet] = useState(false);

  const resetWizardState = useCallback(() => {
    setStep(0);
    setManualStep(null);
    setAddress("");
    setRuntime({});
    setLocalSessionRuntimeExport(null);
    setAccountStatus(null);
    setSessionStepCompleted(false);
    setDetecting(false);
    setDetectError("");
    persistLocalSessionRuntime(null);
  }, []);

  useEffect(() => {
    setLocalSessionRuntimeExport(readStoredLocalSessionRuntime());
  }, []);

  const handleLocalSessionRuntimeReady = useCallback((value: LocalSessionRuntimeExport) => {
    setLocalSessionRuntimeExport(value);
    persistLocalSessionRuntime(value);
  }, []);

  const setupSnapshot = useMemo(
    () =>
      buildSetupSnapshot({
        ownerEoa: address,
        runtime,
        accountStatus,
        localSessionRuntimeExport,
      }),
    [accountStatus, address, localSessionRuntimeExport, runtime]
  );

  const refreshAccountStatus = useCallback(async (addr: string, rt: SessionRuntime) => {
    const eth = getEthereum();
    try {
      const [aaBalance, eoaBalance, aaTokenBalance, eoaTokenBalance] = await Promise.all([
        rt.aaWallet && eth ? getBalance(eth, rt.aaWallet) : Promise.resolve(null),
        eth ? getBalance(eth, addr) : Promise.resolve(null),
        rt.aaWallet && rt.tokenAddress ? getTokenBalance(rt.tokenAddress, rt.aaWallet) : Promise.resolve(null),
        rt.tokenAddress ? getTokenBalance(rt.tokenAddress, addr) : Promise.resolve(null),
      ]);
      setAccountStatus((current) => {
        const userType = deriveUserType(rt);
        const sessionValid = hasAuthorizedSessionRuntime(rt);
        return {
          userType,
          sessionValid,
          aaBalance: aaBalance ?? current?.aaBalance ?? 0,
          eoaBalance: eoaBalance ?? current?.eoaBalance ?? 0,
          aaTokenBalance: aaTokenBalance ?? current?.aaTokenBalance ?? 0,
          eoaTokenBalance: eoaTokenBalance ?? current?.eoaTokenBalance ?? 0,
          aaBalanceKnown: aaBalance !== null || current?.aaBalanceKnown === true,
          eoaBalanceKnown: eoaBalance !== null || current?.eoaBalanceKnown === true,
          aaTokenBalanceKnown: aaTokenBalance !== null || current?.aaTokenBalanceKnown === true,
          eoaTokenBalanceKnown: eoaTokenBalance !== null || current?.eoaTokenBalanceKnown === true,
        };
      });
    } catch {
      const userType = deriveUserType(rt);
      const sessionValid = hasAuthorizedSessionRuntime(rt);
      setAccountStatus((current) => ({
        userType,
        sessionValid,
        aaBalance: current?.aaBalance ?? 0,
        eoaBalance: current?.eoaBalance ?? 0,
        aaTokenBalance: current?.aaTokenBalance ?? 0,
        eoaTokenBalance: current?.eoaTokenBalance ?? 0,
        aaBalanceKnown: current?.aaBalanceKnown ?? false,
        eoaBalanceKnown: current?.eoaBalanceKnown ?? false,
        aaTokenBalanceKnown: current?.aaTokenBalanceKnown ?? false,
        eoaTokenBalanceKnown: current?.eoaTokenBalanceKnown ?? false,
      }));
    }
  }, []);

  // 鈹€鈹€ Post-wallet detection: get runtime, route immediately, refresh balances in background 鈹€鈹€鈹€鈹€鈹€
  const detectAndRoute = useCallback(async (addr: string) => {
    setDetecting(true);
    setDetectError("");
    setManualStep(null);
    try {
      const rt = await fetchSetupRuntime(addr);
      setRuntime(rt);
      const userType = deriveUserType(rt);
      const sessionValid = hasAuthorizedSessionRuntime(rt);
      setAccountStatus((current) => ({
        userType,
        sessionValid,
        aaBalance: current?.aaBalance ?? 0,
        eoaBalance: current?.eoaBalance ?? 0,
        aaTokenBalance: current?.aaTokenBalance ?? 0,
        eoaTokenBalance: current?.eoaTokenBalance ?? 0,
        aaBalanceKnown: current?.aaBalanceKnown ?? false,
        eoaBalanceKnown: current?.eoaBalanceKnown ?? false,
        aaTokenBalanceKnown: current?.aaTokenBalanceKnown ?? false,
        eoaTokenBalanceKnown: current?.eoaTokenBalanceKnown ?? false,
      }));
      setSessionStepCompleted(false);
      const snapshot = buildSetupSnapshot({
        ownerEoa: addr,
        runtime: rt,
        accountStatus: null,
        localSessionRuntimeExport,
      });
      setStep(resolveInitialWizardStep(snapshot));
      void refreshAccountStatus(addr, rt);
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : "Account detection failed.");
    } finally {
      setDetecting(false);
    }
  }, [localSessionRuntimeExport, refreshAccountStatus]);

  function onWalletDone(addr: string) {
    setAddress(addr);
    void detectAndRoute(addr);
  }

  function openStep(target: Step) {
    setManualStep(target);
    setStep(target);
  }

  async function switchWallet() {
    setSwitchingWallet(true);
    try {
      await fetch("/api/setup/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best effort logout; local reset is enough to restart setup.
    } finally {
      resetWizardState();
      setSwitchingWallet(false);
    }
  }

  const authorizeMode =
    accountStatus?.userType === "returning" && !setupSnapshot.sessionAuthorized
      ? "renew"
      : accountStatus?.userType === "returning"
        ? "renew"
        : "new";

  return (
    <div className="min-h-screen bg-[#faf7f1] text-[#18180e] antialiased">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(90,80,50,0.1)] bg-[#faf7f1]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#3a4220] text-[9px] font-bold text-[#faf7f1] leading-none select-none">
              KT
            </span>
            <span className="text-[13px] font-semibold tracking-tight text-[#18180e] transition-colors group-hover:text-[#3a4220]">
              Kite Trace
            </span>
          </Link>
          <div className="flex items-center gap-1.5 text-[12px] text-[#9e8e76]">
            {address && (
              <>
                <WalletIcon className="size-3 text-[#7a6e56]" />
                <span className="font-mono">{shorten(address, 6, 4)}</span>
              </>
            )}
            {accountStatus?.userType === "returning" && (
              <span className="ml-1 rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.07)] px-2 py-0.5 text-[10px] font-semibold text-[#3a4220]">
                returning
              </span>
            )}
            {address && (
              <button
                type="button"
                onClick={switchWallet}
                disabled={switchingWallet}
                className="ml-2 rounded-full border border-[rgba(90,80,50,0.18)] px-2.5 py-1 text-[11px] font-medium text-[#7a6e56] transition hover:border-[rgba(58,66,32,0.28)] hover:text-[#3a4220] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {switchingWallet ? "Switching..." : "Switch wallet"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-20 pt-24">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#3a4220]">
            <Zap className="size-6 text-[#faf7f1]" />
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#18180e]">
            Set Up Kite Trace MCP
          </h1>
          <p className="mt-2 text-[14px] text-[#7a6e56]">
            Connect your wallet, fund your AA wallet, and authorize access to 5 specialized AI agents via MCP.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <ProgressBar step={step} />
        </div>

        {/* Returning user welcome banner */}
        {accountStatus?.userType === "returning" && step >= 3 && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-5 py-3">
            <CheckCircle2 className="size-4 shrink-0 text-[#3a4220]" />
            <div>
              <p className="text-[13px] font-semibold text-[#3a4220]">Welcome back</p>
                <p className="text-[11px] text-[#7a6e56]">
                  AA wallet and funds detected - skipped straight to{" "}
                  {step === 4 ? "MCP setup" : step === 3 ? "session renewal" : "identity registration"}.
                </p>
              </div>
            </div>
          )}

        <div className="flex flex-col gap-4">
          {/* 鈹€鈹€ Step 0 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
          {step === 0 && <ConnectStep onDone={onWalletDone} />}

            {step > 0 && (
              <DoneRow
                n={1}
                title="Wallet Connected"
                sub={address}
                onClick={() => setStep(0)}
              />
            )}

          {/* Detection in-progress */}
          {detecting && (
            <div className="flex items-center gap-2 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(58,66,32,0.04)] px-5 py-3 text-[12px] text-[#7a6e56]">
              <Loader2 className="size-3.5 animate-spin" />
              Detecting your account...
            </div>
          )}
          {detectError && !detecting && (
            <div className="flex flex-col gap-2">
              <ErrorBanner msg={detectError} />
              <GhostBtn onClick={() => void detectAndRoute(address)}>
                <RefreshCw className="size-3" /> Retry
              </GhostBtn>
            </div>
          )}

          {/* 鈹€鈹€ Step 1 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
          {step === 1 && (
            <FundStep
              address={address}
              runtime={runtime}
              eoaBalance={accountStatus?.eoaBalance ?? 0}
              reviewMode={manualStep === 1}
              onRuntimeUpdate={setRuntime}
              onDone={() => {
                setManualStep(null);
                setStep(2);
              }}
            />
          )}

          {step > 1 && (
            <DoneRow
              n={2}
              title={
                accountStatus?.userType === "returning" && (accountStatus.aaBalance > 0)
                  ? `AA Wallet Ready - ${accountStatus.aaBalance.toFixed(4)} KITE + ${accountStatus.aaTokenBalance.toFixed(2)} USDT`
                  : "AA Wallet Funded"
              }
              sub={runtime.aaWallet ?? runtime.payerAaWallet ?? ""}
              onClick={() => openStep(1)}
            />
          )}

          {/* 鈹€鈹€ Step 2 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
          {step === 2 && (
            <RegisterIdentityStep
              address={address}
              runtime={runtime}
              reviewMode={manualStep === 2}
              onRuntimeUpdate={setRuntime}
              onDone={() => {
                setManualStep(null);
                setStep(3);
              }}
            />
          )}

            {step > 2 && (
              <DoneRow
                n={3}
                title={`Agent Identity #${runtime.agentId || "?"}`}
                sub={[
                  runtime.identityRegisterTxHash ? `Register Tx ${runtime.identityRegisterTxHash}` : "",
                  runtime.identityBindTxHash ? `Bind Tx ${runtime.identityBindTxHash}` : "",
                ].filter(Boolean).join("\n")}
                onClick={() => openStep(2)}
              />
            )}

          {/* 鈹€鈹€ Step 3 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
            {step === 3 && (
              <AuthorizeStep
                address={address}
                runtime={runtime}
                accountStatus={accountStatus}
                availableCaps={capabilities}
                mode={authorizeMode}
                onRuntimeUpdate={setRuntime}
                hasLocalSessionRuntime={setupSnapshot.hasLocalSessionExport}
                onLocalSessionRuntimeReady={handleLocalSessionRuntimeReady}
                onDone={() => {
                  setManualStep(null);
                  setSessionStepCompleted(true);
                  setStep(4);
                }}
              />
            )}

            {step > 2 && (
              <DoneRow
                n={4}
                title={
                  sessionStepCompleted
                    ? authorizeMode === "renew"
                      ? "Session Key Renewed"
                      : "Session Authorized"
                    : setupSnapshot.sessionAuthorized && setupSnapshot.hasLocalSessionExport
                      ? "Session Ready"
                      : "Session Authorization Needed"
                }
                sub={
                  sessionStepCompleted
                    ? "Authority recorded on Kite Testnet"
                    : setupSnapshot.sessionAuthorized && setupSnapshot.hasLocalSessionExport
                      ? "Authorized session and local runtime already available."
                      : "Click to expand this step and authorize a fresh local session runtime."
                }
                onClick={() => openStep(3)}
              />
            )}

          {/* 鈹€鈹€ Step 4 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
          {step === 4 && (
            <ConnectStep4
              address={address}
              runtime={runtime}
              localSessionRuntimeExport={localSessionRuntimeExport}
              sessionValid={setupSnapshot.sessionAuthorized}
              onOpenSessionStep={() => openStep(3)}
            />
          )}
        </div>

        {/* Footer links */}
        <div className="mt-10 flex justify-center gap-6 text-[12px] text-[#9e8e76]">
          <Link href="/" className="flex items-center gap-1 transition hover:text-[#3a4220]">
            <ChevronRight className="size-3 rotate-180" /> Back to Home
          </Link>
          <Link href="/mcp" className="transition hover:text-[#3a4220]">
            MCP Guide
          </Link>
          <Link href="/authority" className="transition hover:text-[#3a4220]">
            Manage Authority
          </Link>
        </div>
      </main>
    </div>
  );
}
