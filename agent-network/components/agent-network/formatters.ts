import { txUrl as txUrlFromConfig } from "@/lib/chain-config";

export function shortHash(v: string): string {
  if (!v) return "-";
  if (v.length < 18) return v;
  return `${v.slice(0, 10)}...${v.slice(-6)}`;
}

export function normalizeRequestId(input: unknown): string {
  return String(input ?? "").trim();
}

export function receiptRefToRequestId(receiptRef: unknown): string {
  const raw = String(receiptRef ?? "").trim();
  if (!raw) return "";
  const [requestId] = raw.split(":");
  return normalizeRequestId(requestId);
}

export function parseTimestampMs(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return input;
  if (typeof input !== "string") return 0;
  const raw = input.trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const asNum = Number(raw);
    return Number.isFinite(asNum) && asNum > 0 ? asNum : 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toIsoFromMs(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : "";
}

export function sanitizeMojibakeDisplay(input: unknown): string {
  let text = String(input || "").trim();
  if (!text) return "";
  text = text.replace(/\uFFFD/g, "");
  const summaryLike = /(opennews:|opentwitter:|long=|short=|neutral=|top=)/i.test(text);
  if (summaryLike && /[^\x00-\x7F]/.test(text)) {
    text = text.replace(/[^\x20-\x7E]/g, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function toCleanStringArray(input: unknown, limit = 4): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => sanitizeMojibakeDisplay(item))
    .filter(Boolean)
    .slice(0, Math.max(1, limit));
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function toNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function hasObjectPayload(value: unknown): value is Record<string, unknown> {
  const row = toRecord(value);
  return Boolean(row && Object.keys(row).length > 0);
}

export function pickFirstObject(...candidates: unknown[]): Record<string, unknown> {
  for (const item of candidates) {
    if (hasObjectPayload(item)) return item;
  }
  return {};
}

export function buildInfoPreviewLines(raw: Record<string, unknown> | null): string[] {
  const row = toRecord(raw) || {};
  const info = pickFirstObject(
    row,
    toRecord(row["info"]),
    toRecord(row["analysis"]),
    toRecord(toRecord(row["reader"])?.["analysis"])
  );
  const lines: string[] = [];
  const provider = sanitizeMojibakeDisplay(info["provider"] || row["provider"]);
  if (provider) lines.push(`provider: ${provider}`);
  const topic = sanitizeMojibakeDisplay(info["topic"] || row["topic"]);
  if (topic) lines.push(`topic: ${topic}`);
  const factors = toCleanStringArray(info["keyFactors"], 2);
  for (const factor of factors) lines.push(`factor: ${factor}`);
  const headlines = toCleanStringArray(info["headlines"], 2);
  for (const headline of headlines) lines.push(`headline: ${headline}`);
  const asOf = sanitizeMojibakeDisplay(info["asOf"] || row["asOf"]);
  if (asOf) lines.push(`asOf: ${asOf}`);
  return lines.slice(0, 6);
}

export function buildTechnicalPreviewLines(raw: Record<string, unknown> | null): string[] {
  const row = toRecord(raw) || {};
  const technical = pickFirstObject(
    row,
    toRecord(row["analysis"]),
    toRecord(row["technical"]),
    toRecord(row["risk"])
  );
  const lines: string[] = [];
  const symbol = sanitizeMojibakeDisplay(technical["symbol"] || row["symbol"]);
  if (symbol) lines.push(`symbol: ${symbol}`);
  const timeframe = sanitizeMojibakeDisplay(technical["timeframe"] || row["timeframe"]);
  if (timeframe) lines.push(`timeframe: ${timeframe}`);
  const signals = toRecord(technical["signals"]) || {};
  const trend = sanitizeMojibakeDisplay(signals["trend"]);
  const momentum = sanitizeMojibakeDisplay(signals["momentum"]);
  const bias = sanitizeMojibakeDisplay(signals["bias"]);
  if (trend || momentum || bias) {
    lines.push(`signals: trend=${trend || "-"} momentum=${momentum || "-"} bias=${bias || "-"}`);
  }
  const indicators = toRecord(technical["indicators"]) || {};
  const rsi = toNumberOrNull(indicators["rsi"]);
  const macd = toNumberOrNull(indicators["macd"]);
  if (rsi !== null || macd !== null) {
    const rsiText = rsi !== null ? rsi.toFixed(2) : "-";
    const macdText = macd !== null ? macd.toFixed(2) : "-";
    lines.push(`indicators: rsi=${rsiText} macd=${macdText}`);
  }
  const riskScoreRaw = toNumberOrNull(technical["riskScore"] ?? row["score"]);
  if (riskScoreRaw !== null) lines.push(`riskScore: ${riskScoreRaw.toFixed(2)}`);
  return lines.slice(0, 6);
}

export function summarizeHttpErrorText(input: unknown): string {
  const raw = String(input || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (/<!doctype html/i.test(raw) || /<html/i.test(raw)) {
    const title = raw.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || "";
    const h1 = raw.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]?.trim() || "";
    const parts = [title, h1].filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
    return "HTML error page returned from endpoint";
  }
  if (raw.length > 260) return `${raw.slice(0, 260)}...`;
  return raw;
}

export function resolveBackendBaseUrl(backendBaseUrl?: string): string {
  const explicit = String(backendBaseUrl || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const envUrl = String(process.env.NEXT_PUBLIC_BACKEND_URL || "").trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  if (typeof window === "undefined") return "";
  const { protocol, hostname, port, origin } = window.location;
  const isLocal = hostname === "127.0.0.1" || hostname === "localhost";
  if (isLocal && port === "3000") {
    return `${protocol}//${hostname}:3001`;
  }
  return origin.replace(/\/+$/, "");
}

export function friendlyErrorMessage(error: unknown): string {
  const msg = String((error as Error)?.message || error || "unknown_error").trim();
  if (/HTTP 404/i.test(msg)) {
    return "Endpoint 404. Check backend URL (NEXT_PUBLIC_BACKEND_URL or auto localhost:3001).";
  }
  if (/Failed to fetch/i.test(msg) || /fetch failed/i.test(msg)) {
    return "Network request failed. Confirm backend server is running.";
  }
  return msg.length > 260 ? `${msg.slice(0, 260)}...` : msg;
}

export function txExplorerUrl(txHash: string): string {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || "").trim())) return "";
  return txUrlFromConfig(txHash);
}

export function formatTxTime(iso = ""): string {
  if (!iso) return "n/a";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "n/a";
  return new Date(t).toLocaleString("en-US", { hour12: false });
}

export function formatTxAge(iso = ""): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const delta = Math.max(0, Date.now() - t);
  const hours = Math.floor(delta / 3600000);
  const mins = Math.floor((delta % 3600000) / 60000);
  if (hours <= 0 && mins <= 0) return "just now";
  if (hours <= 0) return `${mins}m ago`;
  return `${hours}h ${mins}m ago`;
}

export function randomHex(n = 64): string {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n)}`;
}

export function createWorkflowRunId(prefix = "run"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchJSON<T>(url: string, init: RequestInit = {}, timeout = 7000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      let details = "";
      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const reason = summarizeHttpErrorText(body["reason"] || body["error"] || body["message"] || "");
        const requestId = String(body["requestId"] || "").trim();
        const workflowTraceId = String(body["workflowTraceId"] || body["traceId"] || "").trim();
        const failedStep = String(body["failedStep"] || "").trim();
        const extras = [reason];
        if (requestId) extras.push(`requestId=${requestId}`);
        if (workflowTraceId) extras.push(`workflowTraceId=${workflowTraceId}`);
        if (failedStep) extras.push(`failedStep=${failedStep}`);
        details = extras.filter(Boolean).join(" | ");
      } else {
        details = summarizeHttpErrorText(await res.text().catch(() => ""));
      }
      throw new Error(details ? `HTTP ${res.status}: ${details}` : `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}
