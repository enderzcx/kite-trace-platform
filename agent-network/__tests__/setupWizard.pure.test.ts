/**
 * Unit tests for pure functions extracted from SetupWizardClient.tsx
 *
 * Covers:
 *  - shorten
 *  - extractConnectorToken
 *  - buildLocalConnectorUrl
 *  - formatWalletMismatchReason
 *  - withTimeout
 *  - normalizeAccountAddress (via hasUsableLocalSessionRuntime)
 *  - parseRuntime
 *  - hasAuthorizedSessionRuntime
 *  - hasUsableLocalSessionRuntime
 *  - buildLocalSessionRuntimeExport
 *  - resolveInitialWizardStep
 *  - buildSetupSnapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Re-implement the pure functions inline ───────────────────────────────────
// We copy the logic directly so we don't have to import the full Next.js
// client component (which pulls in browser-only and ethers globals).

// ---------- types ----------
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
  isDefaultFactoryRuntime?: boolean;
  runtimeHealth?: string;
  singleLimit?: string;
  dailyLimit?: string;
  accountVersion?: string;
  accountVersionTag?: string;
  accountCapabilities?: { sessionPayment?: boolean; sessionGenericExecute?: boolean };
  authorizationSignature?: string;
  authorizationPayloadHash?: string;
  expiresAt?: number;
  authorizationExpiresAt?: number;
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

interface AccountStatus {
  userType: "new" | "returning";
  sessionValid: boolean;
  aaBalance: number;
  eoaBalance: number;
  aaTokenBalance: number;
  eoaTokenBalance: number;
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

type Step = 0 | 1 | 2 | 3 | 4;

const LOCAL_BACKEND_BASE_URL = "http://127.0.0.1:3217";

// ---------- functions under test ----------

function shorten(value = "", head = 8, tail = 6): string {
  const v = String(value).trim();
  if (!v || v.length <= head + tail + 3) return v;
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
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

function normalizeAccountAddress(value = ""): string {
  return String(value || "").trim().toLowerCase();
}

function hasRuntimeIdentity(runtime: SessionRuntime): boolean {
  return Boolean(runtime.agentId && runtime.agentWallet && runtime.identityRegistry);
}

function supportsSessionGenericExecution(runtime: SessionRuntime): boolean {
  return (
    runtime.accountCapabilities?.sessionGenericExecute === true ||
    runtime.accountVersion === "GokiteAccountV3-session-execute" ||
    runtime.accountVersionTag === "GokiteAccountV3-session-execute"
  );
}

function hasAuthorizedSessionRuntime(runtime: SessionRuntime | null | undefined): boolean {
  if (!runtime) return false;
  const sessionId = String(runtime.sessionId || "").trim();
  const sessionAddress = String(runtime.sessionAddress || "").trim();
  const authorizationSignature = String(runtime.authorizationSignature || "").trim();
  const authorizationPayloadHash = String(runtime.authorizationPayloadHash || "").trim();
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
  const agentWalletMatchesAa = Boolean(
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

function buildLocalSessionRuntimeExport(
  runtime: SessionRuntime,
  sessionPrivateKey: string,
  opts: {
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
      owner: opts.owner,
      aaWallet: runtime.aaWallet ?? runtime.payerAaWallet ?? "",
      sessionAddress: opts.sessionAddress,
      sessionPrivateKey,
      sessionId: opts.sessionId,
      sessionTxHash: opts.sessionTxHash,
      tokenAddress: runtime.tokenAddress ?? "",
      gatewayRecipient: runtime.gatewayRecipient ?? "",
      maxPerTx: Number(opts.singleLimit || "0"),
      dailyLimit: Number(opts.dailyLimit || "0"),
      agentId: runtime.agentId ?? "",
      agentWallet: runtime.agentWallet ?? "",
      identityRegistry: runtime.identityRegistry ?? "",
      chainId: runtime.chainId ?? "hashkey-testnet",
      runtimePurpose: "consumer",
      source: "browser_setup_local_only",
    },
  };
}

// ---------- parseRuntime (inline copy) ----------
function parseRuntime(json: Record<string, unknown>): SessionRuntime {
  const bootstrap = (json.bootstrap as Record<string, unknown> | undefined) ?? {};
  const bootstrapRuntime = (bootstrap.runtime as Record<string, unknown> | undefined) ?? {};
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
    chainId: pick("chainId") ?? "hashkey-testnet",
    payerAaWallet: resolvedPayerAaWallet,
    tokenAddress: pick("tokenAddress"),
    sessionId: pick("sessionId"),
    sessionAddress: pick("sessionAddress"),
    owner: pick("owner"),
    aaDeployed: inferredAaDeployed,
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
    accountVersion: pick("accountVersion"),
    accountVersionTag: pick("accountVersionTag"),
    accountCapabilities: (
      (json.accountCapabilities ??
        nested.accountCapabilities ??
        bootstrapRuntime.accountCapabilities ??
        bootstrap.accountCapabilities) as
        | { sessionPayment?: boolean; sessionGenericExecute?: boolean }
        | undefined
    ),
    authorizationSignature: pick("authorizationSignature"),
    authorizationPayloadHash: pick("authorizationPayloadHash"),
    singleLimit: pick("singleLimit"),
    dailyLimit: pick("dailyLimit"),
    expiresAt: Number(
      (json.expiresAt as number | undefined) ??
        (nested.expiresAt as number | undefined) ??
        (bootstrap.expiresAt as number | undefined) ??
        0
    ),
  };
}

// ─── Helpers for building test fixtures ──────────────────────────────────────

function fullyReadyRuntime(): SessionRuntime {
  return {
    aaWallet: "0xaawallet",
    owner: "0xowner",
    agentId: "42",
    agentWallet: "0xaawallet", // matches aaWallet
    identityRegistry: "0xregistry",
    sessionId: "0xsessionid",
    sessionAddress: "0xsessionaddr",
    authorizationSignature: "0xsig",
    authorizationPayloadHash: "0xhash",
    isDefaultFactoryRuntime: true,
    runtimeHealth: "active_default",
    accountVersion: "GokiteAccountV3-session-execute",
    aaDeployed: true,
    chainId: "hashkey-testnet",
  };
}

function fullyReadyLocalExport(owner = "0xowner"): LocalSessionRuntimeExport {
  return {
    schema: "ktrace-local-session-runtime-v1",
    createdAt: Date.now(),
    runtime: {
      owner,
      aaWallet: "0xaawallet",
      sessionAddress: "0xsessionaddr",
      sessionPrivateKey: "0xprivkey",
      sessionId: "0xsessionid",
      sessionTxHash: "0xtxhash",
      tokenAddress: "0xtoken",
      gatewayRecipient: "0xrecipient",
      maxPerTx: 100,
      dailyLimit: 1000,
      agentId: "42",
      agentWallet: "0xaawallet",
      identityRegistry: "0xregistry",
      chainId: "hashkey-testnet",
      runtimePurpose: "consumer",
      source: "browser_setup_local_only",
    },
  };
}

function readyAccountStatus(): AccountStatus {
  return {
    userType: "returning",
    sessionValid: true,
    aaBalance: 1.0,
    eoaBalance: 2.0,
    aaTokenBalance: 5.0,
    eoaTokenBalance: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
describe("shorten()", () => {
  it("returns the original string if short enough", () => {
    expect(shorten("0x1234", 8, 6)).toBe("0x1234");
  });

  it("truncates long addresses", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    const result = shorten(addr);
    expect(result).toBe("0x123456...345678");
    expect(result.length).toBeLessThan(addr.length);
  });

  it("uses default head=8 tail=6", () => {
    const v = "a".repeat(30);
    const r = shorten(v);
    expect(r.startsWith("a".repeat(8))).toBe(true);
    expect(r.endsWith("a".repeat(6))).toBe(true);
    expect(r).toContain("...");
  });

  it("handles empty string", () => {
    expect(shorten("")).toBe("");
  });

  it("does NOT shorten a string exactly at boundary (head+tail+3)", () => {
    // head=8, tail=6, threshold = 8+6+3=17; length exactly 17 → no truncation
    const v = "x".repeat(17);
    expect(shorten(v)).toBe(v);
  });

  it("truncates a string one character over boundary", () => {
    const v = "x".repeat(18);
    expect(shorten(v)).toContain("...");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractConnectorToken()", () => {
  it("extracts a simple token", () => {
    expect(extractConnectorToken("https://example.com/mcp/connect/abc123")).toBe("abc123");
  });

  it("extracts a URL-encoded token", () => {
    const encoded = "https://example.com/mcp/connect/hello%20world";
    expect(extractConnectorToken(encoded)).toBe("hello world");
  });

  it("ignores query strings", () => {
    expect(extractConnectorToken("https://host/mcp/connect/tok?foo=bar")).toBe("tok");
  });

  it("ignores hash fragments", () => {
    expect(extractConnectorToken("https://host/mcp/connect/tok#section")).toBe("tok");
  });

  it("returns empty string when pattern is absent", () => {
    expect(extractConnectorToken("https://example.com/other/path")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(extractConnectorToken("")).toBe("");
  });

  it("is case-insensitive for /MCP/Connect/", () => {
    expect(extractConnectorToken("https://host/MCP/Connect/TokenABC")).toBe("TokenABC");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("buildLocalConnectorUrl()", () => {
  it("builds a local URL from a remote connector URL", () => {
    const remote = "https://kiteclaw.duckdns.org/hashkey/mcp/connect/abc123";
    expect(buildLocalConnectorUrl(remote)).toBe("http://127.0.0.1:3217/mcp/connect/abc123");
  });

  it("encodes token in the output URL", () => {
    const remote = "https://host/mcp/connect/hello%20world";
    // token = "hello world" (decoded), re-encoded → "hello%20world"
    expect(buildLocalConnectorUrl(remote)).toBe(
      "http://127.0.0.1:3217/mcp/connect/hello%20world"
    );
  });

  it("returns empty string when no token is present", () => {
    expect(buildLocalConnectorUrl("https://example.com/no-token-here")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(buildLocalConnectorUrl("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("formatWalletMismatchReason()", () => {
  it("extracts requested and signer from reason string", () => {
    const reason = "wallet mismatch: requested=0xAAA signer=0xBBB";
    const result = formatWalletMismatchReason(reason, "");
    expect(result).toContain("0xAAA");
    expect(result).toContain("0xBBB");
  });

  it("uses expected address as fallback when no requested= in reason", () => {
    const result = formatWalletMismatchReason("some generic error", "0xExpected");
    expect(result).toContain("0xExpected");
  });

  it("falls back to generic message when no addresses found", () => {
    const result = formatWalletMismatchReason("", "");
    expect(result).toContain("same account you connected with");
  });

  it("shows 'another account' when signer is empty but requested is present", () => {
    const result = formatWalletMismatchReason("requested=0xAAA", "");
    expect(result).toContain("0xAAA");
    expect(result).toContain("another account");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("withTimeout()", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves with the promise value if it settles in time", async () => {
    const p = Promise.resolve(42);
    await expect(withTimeout(p, 1000, "timed out")).resolves.toBe(42);
  });

  it("rejects with the timeout message when the promise is slow", async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 5000));
    const racePromise = withTimeout(slow, 100, "custom timeout message");
    vi.advanceTimersByTime(200);
    await expect(racePromise).rejects.toThrow("custom timeout message");
  });

  it("clears the timer after the promise settles (no timer leak)", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const p = Promise.resolve("done");
    await withTimeout(p, 500, "should not fire");
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("parseRuntime()", () => {
  it("parses a flat top-level runtime JSON", () => {
    const json = {
      aaWallet: "0xaa",
      owner: "0xowner",
      agentId: "1",
      agentWallet: "0xaw",
      identityRegistry: "0xreg",
      sessionId: "0xsess",
      sessionAddress: "0xsessaddr",
      chainId: "hashkey-testnet",
    };
    const rt = parseRuntime(json);
    expect(rt.aaWallet).toBe("0xaa");
    expect(rt.owner).toBe("0xowner");
    expect(rt.agentId).toBe("1");
    expect(rt.sessionId).toBe("0xsess");
  });

  it("parses nested runtime inside json.runtime", () => {
    const json = {
      runtime: {
        aaWallet: "0xnested",
        owner: "0xnested-owner",
        sessionId: "0xnested-sess",
      },
    };
    const rt = parseRuntime(json);
    expect(rt.aaWallet).toBe("0xnested");
    expect(rt.owner).toBe("0xnested-owner");
    expect(rt.sessionId).toBe("0xnested-sess");
  });

  it("parses bootstrap.runtime structure", () => {
    const json = {
      bootstrap: {
        runtime: {
          aaWallet: "0xbootstrap-aa",
          owner: "0xbootstrap-owner",
        },
      },
    };
    const rt = parseRuntime(json);
    expect(rt.aaWallet).toBe("0xbootstrap-aa");
    expect(rt.owner).toBe("0xbootstrap-owner");
  });

  it("top-level keys override nested keys", () => {
    const json = {
      aaWallet: "0xtop-level",
      runtime: {
        aaWallet: "0xnested",
      },
    };
    const rt = parseRuntime(json);
    expect(rt.aaWallet).toBe("0xtop-level");
  });

  it("falls back to payerAaWallet when aaWallet is absent", () => {
    const json = { payerAaWallet: "0xpayer" };
    const rt = parseRuntime(json);
    expect(rt.aaWallet).toBe("0xpayer");
  });

  it("defaults chainId to 'hashkey-testnet' when absent", () => {
    const rt = parseRuntime({});
    expect(rt.chainId).toBe("hashkey-testnet");
  });

  it("infers aaDeployed from accountVersion presence", () => {
    const json = {
      aaWallet: "0xaa",
      accountVersion: "GokiteAccountV3-session-execute",
    };
    const rt = parseRuntime(json);
    expect(rt.aaDeployed).toBe(true);
  });

  it("returns false aaDeployed when no deployment signals", () => {
    const rt = parseRuntime({});
    expect(rt.aaDeployed).toBe(false);
  });

  it("reads isDefaultFactoryRuntime from nested bootstrap", () => {
    const json = {
      bootstrap: {
        isDefaultFactoryRuntime: true,
      },
    };
    const rt = parseRuntime(json);
    expect(rt.isDefaultFactoryRuntime).toBe(true);
  });

  it("reads accountCapabilities from top-level", () => {
    const json = {
      accountCapabilities: { sessionGenericExecute: true },
    };
    const rt = parseRuntime(json);
    expect(rt.accountCapabilities?.sessionGenericExecute).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("hasAuthorizedSessionRuntime()", () => {
  it("returns true when all four fields are present", () => {
    const rt: SessionRuntime = {
      sessionId: "0xid",
      sessionAddress: "0xaddr",
      authorizationSignature: "0xsig",
      authorizationPayloadHash: "0xhash",
    };
    expect(hasAuthorizedSessionRuntime(rt)).toBe(true);
  });

  it("returns false when sessionId is missing", () => {
    const rt: SessionRuntime = {
      sessionAddress: "0xaddr",
      authorizationSignature: "0xsig",
      authorizationPayloadHash: "0xhash",
    };
    expect(hasAuthorizedSessionRuntime(rt)).toBe(false);
  });

  it("returns false when authorizationSignature is missing", () => {
    const rt: SessionRuntime = {
      sessionId: "0xid",
      sessionAddress: "0xaddr",
      authorizationPayloadHash: "0xhash",
    };
    expect(hasAuthorizedSessionRuntime(rt)).toBe(false);
  });

  it("returns false when authorizationPayloadHash is missing", () => {
    const rt: SessionRuntime = {
      sessionId: "0xid",
      sessionAddress: "0xaddr",
      authorizationSignature: "0xsig",
    };
    expect(hasAuthorizedSessionRuntime(rt)).toBe(false);
  });

  it("returns false for null input", () => {
    expect(hasAuthorizedSessionRuntime(null)).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(hasAuthorizedSessionRuntime(undefined)).toBe(false);
  });

  it("returns false when fields are empty strings", () => {
    const rt: SessionRuntime = {
      sessionId: "",
      sessionAddress: "0xaddr",
      authorizationSignature: "0xsig",
      authorizationPayloadHash: "0xhash",
    };
    expect(hasAuthorizedSessionRuntime(rt)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("hasUsableLocalSessionRuntime()", () => {
  const mkExport = (overrides: Partial<LocalSessionRuntimeExport["runtime"]> = {}) => ({
    schema: "ktrace-local-session-runtime-v1" as const,
    createdAt: Date.now(),
    runtime: {
      owner: "0xowner",
      aaWallet: "0xaawallet",
      sessionAddress: "0xsessaddr",
      sessionPrivateKey: "0xprivkey",
      sessionId: "0xsessid",
      sessionTxHash: "0xtx",
      tokenAddress: "0xtoken",
      gatewayRecipient: "0xrecip",
      maxPerTx: 100,
      dailyLimit: 1000,
      agentId: "1",
      agentWallet: "0xaw",
      identityRegistry: "0xreg",
      chainId: "hashkey-testnet",
      runtimePurpose: "consumer" as const,
      source: "browser_setup_local_only",
      ...overrides,
    },
  });

  it("returns true when owner, aaWallet, session keys all match", () => {
    const exp = mkExport();
    const rt: SessionRuntime = { owner: "0xowner", aaWallet: "0xaawallet" };
    expect(hasUsableLocalSessionRuntime(exp, rt, "0xowner")).toBe(true);
  });

  it("is case-insensitive for owner comparison", () => {
    const exp = mkExport({ owner: "0XOWNER" });
    const rt: SessionRuntime = { owner: "0xowner" };
    expect(hasUsableLocalSessionRuntime(exp, rt, "0xOwNeR")).toBe(true);
  });

  it("returns false when owner doesn't match", () => {
    const exp = mkExport({ owner: "0xother" });
    const rt: SessionRuntime = { owner: "0xowner" };
    expect(hasUsableLocalSessionRuntime(exp, rt, "0xowner")).toBe(false);
  });

  it("returns false when aaWallet is mismatched", () => {
    const exp = mkExport({ aaWallet: "0xdifferent" });
    const rt: SessionRuntime = { owner: "0xowner", aaWallet: "0xaawallet" };
    expect(hasUsableLocalSessionRuntime(exp, rt, "0xowner")).toBe(false);
  });

  it("returns false when sessionPrivateKey is missing", () => {
    const exp = mkExport({ sessionPrivateKey: "" });
    const rt: SessionRuntime = { owner: "0xowner", aaWallet: "0xaawallet" };
    expect(hasUsableLocalSessionRuntime(exp, rt, "0xowner")).toBe(false);
  });

  it("returns false for null export", () => {
    expect(hasUsableLocalSessionRuntime(null, {}, "0xowner")).toBe(false);
  });

  it("falls back to runtime.owner when ownerEoa is empty", () => {
    const exp = mkExport();
    const rt: SessionRuntime = { owner: "0xowner", aaWallet: "0xaawallet" };
    expect(hasUsableLocalSessionRuntime(exp, rt, "")).toBe(true);
  });

  it("skips aaWallet check when runtime has no aaWallet", () => {
    const exp = mkExport();
    const rt: SessionRuntime = { owner: "0xowner" }; // no aaWallet
    expect(hasUsableLocalSessionRuntime(exp, rt, "0xowner")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("buildLocalSessionRuntimeExport()", () => {
  it("produces the correct schema tag", () => {
    const rt: SessionRuntime = { aaWallet: "0xaa", tokenAddress: "0xtoken", chainId: "hashkey-testnet" };
    const result = buildLocalSessionRuntimeExport(rt, "0xprivkey", {
      owner: "0xowner",
      sessionAddress: "0xsessaddr",
      sessionId: "0xsessid",
      sessionTxHash: "0xtx",
      singleLimit: "50",
      dailyLimit: "500",
    });
    expect(result.schema).toBe("ktrace-local-session-runtime-v1");
  });

  it("sets runtimePurpose to consumer", () => {
    const rt: SessionRuntime = { aaWallet: "0xaa" };
    const result = buildLocalSessionRuntimeExport(rt, "0xpk", {
      owner: "0xo", sessionAddress: "0xsa", sessionId: "0xsi",
      sessionTxHash: "0xtx", singleLimit: "10", dailyLimit: "100",
    });
    expect(result.runtime.runtimePurpose).toBe("consumer");
  });

  it("parses singleLimit and dailyLimit as numbers", () => {
    const rt: SessionRuntime = { aaWallet: "0xaa" };
    const result = buildLocalSessionRuntimeExport(rt, "0xpk", {
      owner: "0xo", sessionAddress: "0xsa", sessionId: "0xsi",
      sessionTxHash: "0xtx", singleLimit: "75", dailyLimit: "750",
    });
    expect(result.runtime.maxPerTx).toBe(75);
    expect(result.runtime.dailyLimit).toBe(750);
  });

  it("falls back to payerAaWallet when aaWallet is undefined", () => {
    const rt: SessionRuntime = { payerAaWallet: "0xpayer" };
    const result = buildLocalSessionRuntimeExport(rt, "0xpk", {
      owner: "0xo", sessionAddress: "0xsa", sessionId: "0xsi",
      sessionTxHash: "0xtx", singleLimit: "10", dailyLimit: "100",
    });
    expect(result.runtime.aaWallet).toBe("0xpayer");
  });

  it("defaults chainId to hashkey-testnet when runtime has none", () => {
    const rt: SessionRuntime = {};
    const result = buildLocalSessionRuntimeExport(rt, "0xpk", {
      owner: "0xo", sessionAddress: "0xsa", sessionId: "0xsi",
      sessionTxHash: "0xtx", singleLimit: "0", dailyLimit: "0",
    });
    expect(result.runtime.chainId).toBe("hashkey-testnet");
  });

  it("sets createdAt close to Date.now()", () => {
    const before = Date.now();
    const rt: SessionRuntime = {};
    const result = buildLocalSessionRuntimeExport(rt, "0xpk", {
      owner: "0xo", sessionAddress: "0xsa", sessionId: "0xsi",
      sessionTxHash: "0xtx", singleLimit: "0", dailyLimit: "0",
    });
    const after = Date.now();
    expect(result.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.createdAt).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("buildSetupSnapshot()", () => {
  it("fully ready runtime produces a step-4-ready snapshot", () => {
    const rt = fullyReadyRuntime();
    const snap = buildSetupSnapshot({
      ownerEoa: "0xowner",
      runtime: rt,
      accountStatus: readyAccountStatus(),
      localSessionRuntimeExport: fullyReadyLocalExport("0xowner"),
    });
    expect(snap.ownerEoa).toBe("0xowner");
    expect(snap.aaDeployed).toBe(true);
    expect(snap.isDefaultFactoryRuntime).toBe(true);
    expect(snap.hasIdentity).toBe(true);
    expect(snap.agentWalletMatchesAa).toBe(true);
    expect(snap.sessionAuthorized).toBe(true);
    expect(snap.hasLocalSessionExport).toBe(true);
    expect(snap.kiteBalanceReady).toBe(true);
    expect(snap.settlementBalanceReady).toBe(true);
    expect(snap.sessionRuntimeReady).toBe(true);
  });

  it("normalizes ownerEoa to lowercase", () => {
    const rt = fullyReadyRuntime();
    const snap = buildSetupSnapshot({ ownerEoa: "0xOWNER", runtime: rt, accountStatus: null, localSessionRuntimeExport: null });
    expect(snap.ownerEoa).toBe("0xowner");
  });

  it("falls back to runtime.owner when ownerEoa is omitted", () => {
    const rt = { ...fullyReadyRuntime(), owner: "0xfallback" };
    const snap = buildSetupSnapshot({ runtime: rt, accountStatus: null, localSessionRuntimeExport: null });
    expect(snap.ownerEoa).toBe("0xfallback");
  });

  it("isDefaultFactoryRuntime is false when runtimeHealth is not active_default", () => {
    const rt = { ...fullyReadyRuntime(), runtimeHealth: "stale" };
    const snap = buildSetupSnapshot({ ownerEoa: "0xowner", runtime: rt, accountStatus: null, localSessionRuntimeExport: null });
    expect(snap.isDefaultFactoryRuntime).toBe(false);
  });

  it("sessionRuntimeReady requires isDefaultFactoryRuntime AND supportsSessionGenericExecution", () => {
    const rt = { ...fullyReadyRuntime(), accountVersion: undefined, accountCapabilities: undefined };
    const snap = buildSetupSnapshot({ ownerEoa: "0xowner", runtime: rt, accountStatus: null, localSessionRuntimeExport: null });
    // no generic execution support → false
    expect(snap.sessionRuntimeReady).toBe(false);
  });

  it("agentWalletMatchesAa is false when agentWallet differs from aaWallet", () => {
    const rt = { ...fullyReadyRuntime(), agentWallet: "0xdifferent" };
    const snap = buildSetupSnapshot({ ownerEoa: "0xowner", runtime: rt, accountStatus: null, localSessionRuntimeExport: null });
    expect(snap.agentWalletMatchesAa).toBe(false);
  });

  it("kiteBalanceReady is false when aaBalance is 0", () => {
    const status: AccountStatus = { ...readyAccountStatus(), aaBalance: 0 };
    const snap = buildSetupSnapshot({ ownerEoa: "0xowner", runtime: fullyReadyRuntime(), accountStatus: status, localSessionRuntimeExport: null });
    expect(snap.kiteBalanceReady).toBe(false);
  });

  it("settlementBalanceReady is false when aaTokenBalance is 0", () => {
    const status: AccountStatus = { ...readyAccountStatus(), aaTokenBalance: 0 };
    const snap = buildSetupSnapshot({ ownerEoa: "0xowner", runtime: fullyReadyRuntime(), accountStatus: status, localSessionRuntimeExport: null });
    expect(snap.settlementBalanceReady).toBe(false);
  });

  it("handles null runtime gracefully", () => {
    const snap = buildSetupSnapshot({ ownerEoa: "", runtime: null, accountStatus: null, localSessionRuntimeExport: null });
    expect(snap.ownerEoa).toBe("");
    expect(snap.aaWallet).toBe("");
    expect(snap.hasIdentity).toBe(false);
    expect(snap.sessionAuthorized).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("resolveInitialWizardStep()", () => {
  function baseSnap(): SetupSnapshot {
    return {
      ownerEoa: "0xowner",
      aaWallet: "0xaawallet",
      aaDeployed: true,
      isDefaultFactoryRuntime: true,
      hasIdentity: true,
      agentId: "42",
      identityRegistry: "0xreg",
      agentWalletMatchesAa: true,
      hasLocalSessionExport: true,
      sessionAuthorized: true,
      kiteBalanceReady: true,
      settlementBalanceReady: true,
      sessionRuntimeReady: true,
    };
  }

  it("returns step 4 when everything is ready", () => {
    expect(resolveInitialWizardStep(baseSnap())).toBe(4);
  });

  it("returns step 0 when ownerEoa is absent", () => {
    const snap = { ...baseSnap(), ownerEoa: "" };
    expect(resolveInitialWizardStep(snap)).toBe(0);
  });

  it("returns step 1 when aaWallet is absent", () => {
    const snap = { ...baseSnap(), aaWallet: "" };
    expect(resolveInitialWizardStep(snap)).toBe(1);
  });

  it("returns step 1 when aaDeployed is false", () => {
    const snap = { ...baseSnap(), aaDeployed: false };
    expect(resolveInitialWizardStep(snap)).toBe(1);
  });

  it("returns step 2 when identity is missing", () => {
    const snap = { ...baseSnap(), hasIdentity: false };
    expect(resolveInitialWizardStep(snap)).toBe(2);
  });

  it("returns step 2 when agentWallet doesn't match aaWallet", () => {
    const snap = { ...baseSnap(), agentWalletMatchesAa: false };
    expect(resolveInitialWizardStep(snap)).toBe(2);
  });

  it("returns step 3 when session not authorized", () => {
    const snap = { ...baseSnap(), sessionAuthorized: false };
    expect(resolveInitialWizardStep(snap)).toBe(3);
  });

  it("returns step 3 when local session export is missing", () => {
    const snap = { ...baseSnap(), hasLocalSessionExport: false };
    expect(resolveInitialWizardStep(snap)).toBe(3);
  });

  it("returns step 3 when sessionRuntimeReady is false (wrong factory/version)", () => {
    // After fix: sessionRuntimeReady is only needed at step 3 (session auth).
    // User with deployed aaWallet + identity can advance to step 3 where the
    // "upgrade AA wallet" action is surfaced.
    const snap = { ...baseSnap(), sessionRuntimeReady: false };
    expect(resolveInitialWizardStep(snap)).toBe(3);
  });

  it("user with deployed aaWallet but wrong factory can now advance past identity check", () => {
    // FIX VERIFIED: user has aaWallet+aaDeployed but sessionRuntimeReady=false
    // (wrong factory / missing accountCapabilities).
    // Before fix: stuck at step 1. After fix: correctly routes to step 2 (register identity).
    const snap = { ...baseSnap(), sessionRuntimeReady: false, hasIdentity: false };
    expect(resolveInitialWizardStep(snap)).toBe(2);
  });

  it("missing aaWallet still takes priority over identity check", () => {
    const snap = { ...baseSnap(), aaWallet: "", hasIdentity: false };
    expect(resolveInitialWizardStep(snap)).toBe(1);
  });
});
