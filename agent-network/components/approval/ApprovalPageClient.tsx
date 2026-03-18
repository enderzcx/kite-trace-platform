"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ethers } from "ethers";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, QrCode, ShieldCheck, Wallet } from "lucide-react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
    };
  }
}

type RequestCapableProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

type WalletConnectProviderLike = RequestCapableProvider & {
  connect?: () => Promise<void>;
  disconnect?: () => Promise<void>;
};

type ApprovalPayload = {
  schema?: string;
  agentId?: string;
  agentWallet?: string;
  identityRegistry?: string;
  chainId?: string;
  payerAaWallet?: string;
  tokenAddress?: string;
  gatewayRecipient?: string;
  audience?: string;
  singleLimit?: string;
  dailyLimit?: string;
  allowedCapabilities?: string[];
  nonce?: string;
  issuedAt?: number;
  expiresAt?: number;
};

type JobApprovalSummary = {
  jobId?: string;
  traceId?: string;
  state?: string;
  provider?: string;
  capability?: string;
  budget?: string;
  escrowAmount?: string;
  payer?: string;
  executor?: string;
  validator?: string;
};

type JobApprovalReviewSummary = {
  reasonCode?: string;
  threshold?: number;
  amount?: number;
  currency?: string;
  exceeded?: boolean;
  expiresAt?: number;
  requestedByOwnerEoa?: string;
  requestedByAaWallet?: string;
};

type JobApprovalLinks = {
  approvalUrl?: string;
  jobAuditUrl?: string;
  publicJobAuditUrl?: string;
  publicJobAuditByTraceUrl?: string;
};

type ApprovalRequest = {
  approvalRequestId: string;
  approvalKind?: "session" | "job";
  status: string;
  state?: string;
  approvalState?: string;
  executionMode: string;
  userEoa: string;
  sessionAddress: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
  approvalUrl: string;
  qrText: string;
  payload: ApprovalPayload;
  jobId?: string;
  traceId?: string;
  reasonCode?: string;
  requestedByAaWallet?: string;
  requestedByOwnerEoa?: string;
  requestedAction?: string;
  decidedAt?: number;
  decidedBy?: string;
  decisionNote?: string;
  jobSummary?: JobApprovalSummary;
  reviewSummary?: JobApprovalReviewSummary;
  links?: JobApprovalLinks;
  authorizationId?: string;
  expiresAt?: number;
};

type ApprovalResponse = {
  approvalRequest: ApprovalRequest;
  authorization?: Record<string, unknown> | null;
  runtime?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
};

type StepState = {
  label: string;
  status: "idle" | "working" | "done";
  detail: string;
};

const DEFAULT_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ||
  process.env.BACKEND_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:3399";
const KITE_CHAIN_ID_DEC = 2368;
const KITE_CHAIN_HEX = "0x940";
const KITE_FACTORY_ADDRESS =
  process.env.NEXT_PUBLIC_KITE_ACCOUNT_FACTORY || "0xAba80c4c8748c114Ba8b61cda3b0112333C3b96E";
const KITE_RPC_URL = process.env.NEXT_PUBLIC_KITE_RPC_URL || "https://rpc-testnet.gokite.ai/";
const KITE_BLOCK_EXPLORER = process.env.NEXT_PUBLIC_KITE_EXPLORER || "https://testnet.kitescan.ai";
const KITE_SALT = BigInt(process.env.NEXT_PUBLIC_KITE_AA_SALT || "0");
const WALLETCONNECT_PROJECT_ID = String(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

const FACTORY_ABI = ["function createAccount(address owner, uint256 salt) returns (address)"];
const ACCOUNT_ABI = [
  "function addSupportedToken(address token) external",
  "function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external",
  "function owner() view returns (address)",
];

function normalizeAddress(value: string | undefined | null) {
  const text = String(value || "").trim();
  if (!text || !ethers.isAddress(text)) return "";
  return ethers.getAddress(text);
}

function normalizeAllowedCapabilities(input: unknown) {
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))).sort();
  }
  return Array.from(
    new Set(
      String(input || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
}

function normalizePayload(input: ApprovalPayload | null | undefined) {
  const payload = input || {};
  return {
    schema: String(payload.schema || "kite-session-grant-v1").trim(),
    agentId: String(payload.agentId || "").trim(),
    agentWallet: normalizeAddress(payload.agentWallet),
    identityRegistry: normalizeAddress(payload.identityRegistry),
    chainId: String(payload.chainId || "").trim(),
    payerAaWallet: normalizeAddress(payload.payerAaWallet),
    tokenAddress: normalizeAddress(payload.tokenAddress),
    gatewayRecipient: normalizeAddress(payload.gatewayRecipient),
    audience: String(payload.audience || "").trim(),
    singleLimit: String(payload.singleLimit || "").trim(),
    dailyLimit: String(payload.dailyLimit || "").trim(),
    allowedCapabilities: normalizeAllowedCapabilities(payload.allowedCapabilities),
    nonce: String(payload.nonce || "").trim(),
    issuedAt: Number(payload.issuedAt || 0),
    expiresAt: Number(payload.expiresAt || 0),
  };
}

function buildSessionGrantMessage(payloadInput: ApprovalPayload) {
  const payload = normalizePayload(payloadInput);
  return [
    "KTRACE Session Authorization",
    `schema: ${payload.schema}`,
    `agentId: ${payload.agentId}`,
    `agentWallet: ${payload.agentWallet}`,
    `identityRegistry: ${payload.identityRegistry}`,
    `chainId: ${payload.chainId}`,
    `payerAaWallet: ${payload.payerAaWallet}`,
    `tokenAddress: ${payload.tokenAddress}`,
    `gatewayRecipient: ${payload.gatewayRecipient}`,
    `singleLimit: ${payload.singleLimit}`,
    `dailyLimit: ${payload.dailyLimit}`,
    `allowedCapabilities: ${payload.allowedCapabilities.join(",")}`,
    `audience: ${payload.audience}`,
    `nonce: ${payload.nonce}`,
    `issuedAt: ${new Date(payload.issuedAt || 0).toISOString()}`,
    `expiresAt: ${new Date(payload.expiresAt || 0).toISOString()}`,
  ].join("\n");
}

function createSessionAuthorizationMessage(payload: ApprovalPayload, userEoa: string) {
  return [buildSessionGrantMessage(payload), `userEoa: ${normalizeAddress(userEoa)}`].join("\n");
}

async function ensureKiteChain(walletProvider: RequestCapableProvider) {
  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: KITE_CHAIN_HEX }],
    });
  } catch {
    await walletProvider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: KITE_CHAIN_HEX,
          chainName: "Kite Testnet",
          nativeCurrency: {
            name: "KITE",
            symbol: "KITE",
            decimals: 18,
          },
          rpcUrls: [KITE_RPC_URL],
          blockExplorerUrls: [KITE_BLOCK_EXPLORER],
        },
      ],
    });
  }
}

async function fetchApproval(backendUrl: string, approvalRequestId: string, token: string) {
  const response = await fetch(
    `${backendUrl}/api/approvals/${encodeURIComponent(approvalRequestId)}?token=${encodeURIComponent(token)}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const payload = (await response.json()) as { ok?: boolean; reason?: string } & ApprovalResponse;
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.reason || "Failed to load approval request."));
  }
  return payload;
}

function formatTime(value: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function shorten(value: string) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.length <= 16) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}

/* ── Small reusable primitives ───────────────────────────── */
function MonoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">{label}</p>
      <p
        className="mt-1.5 break-all text-[12.5px] text-[#2f351a]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      >
        {value || "—"}
      </p>
    </div>
  );
}

function OliveBtn({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full bg-[#3a4220] px-5 py-2.5 text-[13px] font-semibold text-[#faf7f1] transition hover:bg-[#4a5a28] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostBtn({
  onClick,
  disabled,
  href,
  target,
  rel,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  children: React.ReactNode;
}) {
  const cls =
    "inline-flex items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-5 py-2.5 text-[13px] font-semibold text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)] disabled:cursor-not-allowed disabled:opacity-50";
  if (href) {
    return (
      <a href={href} target={target} rel={rel} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/* ── Job approval panel (control-plane only, no wallet) ─────── */
function JobApprovalPanel({
  approvalRequestId,
  approvalToken,
  resolvedBackendUrl,
  approval,
  onRefresh,
}: {
  approvalRequestId: string;
  approvalToken: string;
  resolvedBackendUrl: string;
  approval: ApprovalResponse;
  onRefresh: () => void;
}) {
  const [working, setWorking] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const req = approval.approvalRequest;
  const jobSummary = req.jobSummary || {};
  const reviewSummary = req.reviewSummary || {};
  const links = req.links || {};
  const isSettled = ["approved", "rejected", "expired", "completed"].includes(
    String(req.approvalState || req.state || req.status || "").toLowerCase()
  );
  const displayState = String(req.approvalState || req.state || req.status || "").toLowerCase();

  async function submitDecision(decision: "approve" | "reject") {
    setWorking(decision);
    setError("");
    try {
      const body: Record<string, string> = {};
      if (decision === "reject" && rejectReason.trim()) {
        body.reason = rejectReason.trim();
      }
      const res = await fetch(
        `${resolvedBackendUrl}/api/approvals/${encodeURIComponent(approvalRequestId)}/${decision}?token=${encodeURIComponent(approvalToken)}`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const payload = (await res.json()) as { ok?: boolean; reason?: string };
      if (!res.ok || payload?.ok === false) {
        throw new Error(String(payload?.reason || `Failed to ${decision} job.`));
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${decision} job.`);
    } finally {
      setWorking(null);
    }
  }

  const stateColor =
    displayState === "approved" || displayState === "completed"
      ? { border: "rgba(58,66,32,0.22)", bg: "rgba(58,66,32,0.07)", text: "#3a4220" }
      : displayState === "rejected"
        ? { border: "rgba(180,60,40,0.22)", bg: "rgba(180,60,40,0.06)", text: "#9a4332" }
        : displayState === "expired"
          ? { border: "rgba(90,80,50,0.18)", bg: "#f2ebe0", text: "#7a6e56" }
          : { border: "rgba(138,96,32,0.22)", bg: "rgba(138,96,32,0.05)", text: "#8a6020" };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
          <ShieldCheck className="size-3" />
          ktrace job approval
        </span>
        <h1 className="font-display text-[2.6rem] font-normal leading-tight tracking-tight text-[#18180e] md:text-[3.2rem]">
          Approve a <em className="not-italic text-[#3a4220]">job request</em>
        </h1>
        <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
          An agent has submitted a job that exceeds the auto-approval threshold.
          Review the details and decide whether to proceed.
        </p>
        <div
          className="inline-flex w-fit flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[rgba(90,80,50,0.12)] bg-[#f2ebe0] px-4 py-2.5 text-[12px] text-[#7a6e56]"
          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
        >
          <span><span className="text-[#9e8e76]">id </span>{shorten(approvalRequestId)}</span>
          <span className="h-3 w-px bg-[rgba(90,80,50,0.2)]" />
          <span
            style={{ color: stateColor.text }}
          >
            <span className="text-[#9e8e76]">state </span>{displayState || "pending"}
          </span>
          {(req.jobId || jobSummary.jobId) ? (
            <>
              <span className="h-3 w-px bg-[rgba(90,80,50,0.2)]" />
              <span><span className="text-[#9e8e76]">job </span>{shorten(req.jobId || jobSummary.jobId || "")}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        {/* Left: job details + actions */}
        <div className="flex flex-col gap-5">

          {/* Settled banner */}
          {isSettled ? (
            <div
              className="flex items-center gap-3 rounded-2xl border px-5 py-4"
              style={{ borderColor: stateColor.border, background: stateColor.bg }}
            >
              {displayState === "approved" || displayState === "completed" ? (
                <CheckCircle2 className="size-5 shrink-0" style={{ color: stateColor.text }} />
              ) : (
                <AlertCircle className="size-5 shrink-0" style={{ color: stateColor.text }} />
              )}
              <div>
                <p className="text-[13px] font-semibold capitalize" style={{ color: stateColor.text }}>
                  {displayState === "completed" ? "Approved and resuming" : displayState.charAt(0).toUpperCase() + displayState.slice(1)}
                </p>
                <p className="text-[11px]" style={{ color: stateColor.text, opacity: 0.75 }}>
                  {displayState === "approved" || displayState === "completed"
                    ? "The job has been approved. Escrow will proceed automatically."
                    : displayState === "rejected"
                      ? "This paused funding path was rejected and will not continue."
                      : "This approval request has expired."}
                </p>
              </div>
            </div>
          ) : null}

          {/* Error banner */}
          {error ? (
            <div className="flex items-start gap-3 rounded-xl border border-[rgba(180,60,40,0.22)] bg-[rgba(180,60,40,0.06)] px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
              <div>
                <p className="text-[12px] font-semibold text-[#9a4332]">Error</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#9a4332]/80">{error}</p>
              </div>
            </div>
          ) : null}

          {/* Job detail card */}
          <div className="overflow-hidden rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0]">
            <div className="border-b border-[rgba(90,80,50,0.08)] px-6 py-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Job Details</p>
              <p className="mt-1 text-[13px] text-[#7a6e56]">
                Review the paused over-limit funding request before allowing the job to continue.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 py-5">
              {jobSummary.jobId ? <MonoField label="Job ID" value={jobSummary.jobId} /> : null}
              {jobSummary.traceId ? <MonoField label="Trace ID" value={jobSummary.traceId} /> : null}
              {jobSummary.capability ? <MonoField label="Capability" value={jobSummary.capability} /> : null}
              {jobSummary.budget ? (
                <div className="rounded-xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Budget</p>
                  <p className="mt-1.5 text-[13px] font-semibold text-[#3a4220]"
                    style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    {jobSummary.budget}
                    {jobSummary.escrowAmount && jobSummary.escrowAmount !== jobSummary.budget ? (
                      <span className="ml-2 text-[11px] font-normal text-[#9e8e76]">
                        escrow {jobSummary.escrowAmount}
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : null}
              {jobSummary.provider ? <MonoField label="Provider" value={jobSummary.provider} /> : null}
              {jobSummary.state ? <MonoField label="Job State" value={jobSummary.state} /> : null}
              {jobSummary.payer ? <MonoField label="Payer" value={jobSummary.payer} /> : null}
              {jobSummary.executor ? <MonoField label="Executor" value={jobSummary.executor} /> : null}
              {jobSummary.validator ? <MonoField label="Validator" value={jobSummary.validator} /> : null}
              {reviewSummary.requestedByOwnerEoa ? <MonoField label="Requested by owner" value={reviewSummary.requestedByOwnerEoa} /> : null}
              {reviewSummary.requestedByAaWallet ? <MonoField label="Requested by AA wallet" value={reviewSummary.requestedByAaWallet} /> : null}
            </div>
            {(reviewSummary.reasonCode || reviewSummary.threshold !== undefined || reviewSummary.amount !== undefined) ? (
              <div className="border-t border-[rgba(90,80,50,0.08)] px-6 py-5">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Policy Review</p>
                <div className="grid grid-cols-2 gap-3">
                  {reviewSummary.reasonCode ? <MonoField label="Reason code" value={reviewSummary.reasonCode} /> : null}
                  {reviewSummary.currency ? <MonoField label="Currency" value={reviewSummary.currency} /> : null}
                  {reviewSummary.threshold !== undefined ? <MonoField label="Threshold" value={String(reviewSummary.threshold)} /> : null}
                  {reviewSummary.amount !== undefined ? <MonoField label="Requested amount" value={String(reviewSummary.amount)} /> : null}
                  {reviewSummary.exceeded !== undefined ? <MonoField label="Exceeded threshold" value={reviewSummary.exceeded ? "yes" : "no"} /> : null}
                  {reviewSummary.expiresAt ? <MonoField label="Approval expires" value={formatTime(reviewSummary.expiresAt)} /> : null}
                </div>
              </div>
            ) : null}
            {!isSettled ? (
              <div className="flex flex-col gap-4 border-t border-[rgba(90,80,50,0.08)] px-6 py-5">
                {showRejectInput ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Rejection reason (optional)</p>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      placeholder="Explain why you are rejecting this job…"
                      className="w-full resize-none rounded-xl border border-[rgba(90,80,50,0.2)] bg-[#faf7f1] px-4 py-3 text-[12.5px] text-[#2f351a] outline-none placeholder:text-[#c4b89e] focus:border-[rgba(58,66,32,0.4)]"
                      style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <OliveBtn onClick={() => void submitDecision("approve")} disabled={working !== null}>
                    {working === "approve" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    Approve Job
                  </OliveBtn>
                  {showRejectInput ? (
                    <GhostBtn onClick={() => void submitDecision("reject")} disabled={working !== null}>
                      {working === "reject" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Confirm Reject
                    </GhostBtn>
                  ) : (
                    <GhostBtn onClick={() => setShowRejectInput(true)} disabled={working !== null}>
                      Reject Job
                    </GhostBtn>
                  )}
                  {showRejectInput ? (
                    <GhostBtn onClick={() => { setShowRejectInput(false); setRejectReason(""); }} disabled={working !== null}>
                      Cancel
                    </GhostBtn>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Request meta */}
          <div
            className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-4 text-[11.5px] leading-[1.9] text-[#5a4e3a]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Timestamps</p>
            <div><span className="text-[#9e8e76]">created  </span>{formatTime(req.createdAt || 0)}</div>
            <div><span className="text-[#9e8e76]">updated  </span>{formatTime(req.updatedAt || 0)}</div>
            {req.expiresAt ? <div><span className="text-[#9e8e76]">expires  </span>{formatTime(req.expiresAt)}</div> : null}
            {req.decidedAt ? <div><span className="text-[#9e8e76]">decided  </span>{formatTime(req.decidedAt)}</div> : null}
          </div>
        </div>

        {/* Right: what happens next */}
        <div className="flex flex-col gap-5">
          <div className="overflow-hidden rounded-2xl border border-[rgba(20,22,14,0.18)]">
            <div className="flex items-center gap-1.5 border-b border-[rgba(255,255,255,0.06)] bg-[#1c1e12] px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-[11px] text-white/30" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                what happens next
              </span>
            </div>
            <div className="bg-[#141608] px-5 py-5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgba(200,194,168,0.4)]">
                If you approve
              </p>
              {[
                "The paused fund operation resumes automatically on the backend.",
                "The same jobId and traceId continue without resubmission.",
                "Validator approval and final settlement still happen later in the lifecycle.",
              ].map((line, i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "rgba(74,90,32,0.35)", color: "#a8b87a" }}>
                    {i + 1}
                  </span>
                  <p className="text-[12.5px] leading-relaxed text-[#c8c2a8]">{line}</p>
                </div>
              ))}
              <p className="mb-3 mt-5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgba(200,194,168,0.4)]">
                If you reject
              </p>
              {[
                "The job transitions into approval_rejected.",
                "The interrupted funding path stops but remains auditable.",
              ].map((line, i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "rgba(138,60,40,0.28)", color: "#d48a78" }}>
                    {i + 1}
                  </span>
                  <p className="text-[12.5px] leading-relaxed text-[#c8c2a8]">{line}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">No wallet needed</p>
            <p className="text-[12.5px] leading-relaxed text-[#7a6e56]">
              Job approvals are control-plane decisions. No blockchain transaction
              is required from you on this page.
            </p>
          </div>

          {(links.publicJobAuditUrl || links.publicJobAuditByTraceUrl || links.jobAuditUrl) ? (
            <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Audit links</p>
              <div className="flex flex-col gap-2">
                {links.publicJobAuditUrl ? (
                  <GhostBtn href={links.publicJobAuditUrl} target="_blank" rel="noreferrer">
                    Public audit
                    <ExternalLink className="size-3.5" />
                  </GhostBtn>
                ) : null}
                {links.publicJobAuditByTraceUrl ? (
                  <GhostBtn href={links.publicJobAuditByTraceUrl} target="_blank" rel="noreferrer">
                    Public audit by trace
                    <ExternalLink className="size-3.5" />
                  </GhostBtn>
                ) : null}
                {links.jobAuditUrl ? (
                  <GhostBtn href={links.jobAuditUrl} target="_blank" rel="noreferrer">
                    Protected audit
                    <ExternalLink className="size-3.5" />
                  </GhostBtn>
                ) : null}
                {(req.jobId || jobSummary.jobId) ? (
                  <GhostBtn
                    href={`/?jobId=${encodeURIComponent(req.jobId || jobSummary.jobId || "")}#audit-explorer`}
                  >
                    Inspect in Audit Explorer
                    <ExternalLink className="size-3.5" />
                  </GhostBtn>
                ) : null}
                <GhostBtn
                  href={`${resolvedBackendUrl}/api/approvals/${encodeURIComponent(approvalRequestId)}?token=${encodeURIComponent(approvalToken)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Raw approval JSON
                  <ExternalLink className="size-3.5" />
                </GhostBtn>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ApprovalPageClient({
  approvalRequestId,
  approvalToken,
  backendUrl,
}: {
  approvalRequestId: string;
  approvalToken: string;
  backendUrl?: string;
}) {
  const resolvedBackendUrl = useMemo(
    () => String(backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, ""),
    [backendUrl]
  );
  const [approval, setApproval] = useState<ApprovalResponse | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletProvider, setWalletProvider] = useState<RequestCapableProvider | null>(null);
  const [walletProviderKind, setWalletProviderKind] = useState<"injected" | "walletconnect" | "">("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [hasInjectedWallet, setHasInjectedWallet] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([
    { label: "Load approval", status: "idle", detail: "" },
    { label: "Connect wallet", status: "idle", detail: "" },
    { label: "Ensure AA", status: "idle", detail: "" },
    { label: "Create session", status: "idle", detail: "" },
    { label: "Sign & complete", status: "idle", detail: "" },
  ]);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setError("");
    try {
      const payload = await fetchApproval(resolvedBackendUrl, approvalRequestId, approvalToken);
      startTransition(() => {
        setApproval(payload);
        setSteps((current) =>
          current.map((step, index) =>
            index === 0
              ? { ...step, status: "done", detail: `Status: ${payload.approvalRequest?.status || "-"}` }
              : step
          )
        );
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load approval request.");
    }
  }, [approvalRequestId, approvalToken, resolvedBackendUrl, startTransition]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHasInjectedWallet(Boolean(window.ethereum));
  }, []);

  useEffect(() => {
    return () => {
      if (walletProviderKind === "walletconnect") {
        const provider = walletProvider as WalletConnectProviderLike | null;
        void provider?.disconnect?.();
      }
    };
  }, [walletProvider, walletProviderKind]);

  async function connectWithProvider(nextProvider: RequestCapableProvider, kind: "injected" | "walletconnect") {
    setError("");
    await ensureKiteChain(nextProvider);
    const provider = new ethers.BrowserProvider(nextProvider as ethers.Eip1193Provider);
    await nextProvider.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const address = normalizeAddress(await signer.getAddress());
    setWalletAddress(address);
    setWalletProvider(nextProvider);
    setWalletProviderKind(kind);
    setSteps((current) =>
      current.map((step, index) =>
        index === 1 ? { ...step, status: "done", detail: `Connected ${address}` } : step
      )
    );
    return address;
  }

  async function connectInjectedWallet() {
    if (!window.ethereum) {
      setError("No injected wallet was found. Open this page in MetaMask or another browser wallet.");
      return "";
    }
    return connectWithProvider(window.ethereum, "injected");
  }

  async function connectWalletConnect() {
    setError("");
    if (!WALLETCONNECT_PROJECT_ID) {
      setError("WalletConnect is not configured yet. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID first.");
      return "";
    }
    const walletConnectModule = await import("@walletconnect/ethereum-provider");
    const EthereumProvider = walletConnectModule.default;
    const provider = (await EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [KITE_CHAIN_ID_DEC],
      optionalChains: [KITE_CHAIN_ID_DEC],
      rpcMap: {
        [KITE_CHAIN_ID_DEC]: KITE_RPC_URL,
      },
      showQrModal: true,
      methods: ["eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain", "wallet_addEthereumChain"],
      events: ["chainChanged", "accountsChanged", "disconnect"],
      metadata: {
        name: "Kite Trace Platform",
        description: "Approve KTRACE agent-first session requests",
        url: "https://kiteclaw.duckdns.org",
        icons: [],
      },
    })) as WalletConnectProviderLike;
    await provider.connect?.();
    return connectWithProvider(provider, "walletconnect");
  }

  async function handleApprove() {
    if (!approval?.approvalRequest) return;
    setWorking(true);
    setError("");
    try {
      const currentApproval = await fetchApproval(resolvedBackendUrl, approvalRequestId, approvalToken);
      const latestRequest = currentApproval.approvalRequest;
      if (latestRequest.status.toLowerCase() === "completed") {
        setApproval(currentApproval);
        setWorking(false);
        return;
      }

      const connectedAddress =
        walletAddress ||
        (walletProvider
          ? await connectWithProvider(walletProvider, walletProviderKind || "injected")
          : await connectInjectedWallet());
      if (!connectedAddress) {
        throw new Error("Wallet connection is required.");
      }
      if (normalizeAddress(latestRequest.userEoa) !== connectedAddress) {
        throw new Error(`Please switch wallet to ${latestRequest.userEoa}.`);
      }

      const activeProvider = walletProvider || window.ethereum;
      if (!activeProvider) {
        throw new Error("No wallet provider is currently connected.");
      }
      const provider = new ethers.BrowserProvider(activeProvider as ethers.Eip1193Provider);
      const signer = await provider.getSigner();
      const payload = normalizePayload(latestRequest.payload);
      const aaWallet = normalizeAddress(payload.payerAaWallet);
      if (!aaWallet) {
        throw new Error("Approval payload is missing payerAaWallet.");
      }

      setSteps((current) =>
        current.map((step, index) =>
          index === 2 ? { ...step, status: "working", detail: "Checking or deploying AA wallet..." } : step
        )
      );
      const accountCode = await provider.getCode(aaWallet);
      if (!accountCode || accountCode === "0x") {
        const factory = new ethers.Contract(KITE_FACTORY_ADDRESS, FACTORY_ABI, signer);
        const createTx = await factory.createAccount(connectedAddress, KITE_SALT);
        await createTx.wait();
      }
      const account = new ethers.Contract(aaWallet, ACCOUNT_ABI, signer);
      const onchainOwner = normalizeAddress(await account.owner().catch(() => ""));
      if (onchainOwner && onchainOwner !== connectedAddress) {
        throw new Error(`Connected wallet does not own this AA. Expected ${onchainOwner}.`);
      }
      setSteps((current) =>
        current.map((step, index) =>
          index === 2 ? { ...step, status: "done", detail: shorten(aaWallet) } : step
        )
      );

      setSteps((current) =>
        current.map((step, index) =>
          index === 3 ? { ...step, status: "working", detail: "Configuring token + session..." } : step
        )
      );
      try {
        const tokenTx = await account.addSupportedToken(payload.tokenAddress);
        await tokenTx.wait();
      } catch {
        // Token may already be configured.
      }

      const latestBlock = await provider.getBlock("latest");
      const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
      const sessionId = ethers.keccak256(
        ethers.toUtf8Bytes(`${latestRequest.sessionAddress}-${Date.now()}-${Math.random()}`)
      );
      const rules = [
        {
          timeWindow: BigInt(0),
          budget: ethers.parseUnits(payload.singleLimit || "0", 18),
          initialWindowStartTime: 0,
          targetProviders: [] as string[],
        },
        {
          timeWindow: BigInt(86400),
          budget: ethers.parseUnits(payload.dailyLimit || "0", 18),
          initialWindowStartTime: Math.max(0, nowTs - 1),
          targetProviders: [] as string[],
        },
      ];
      const sessionTx = await account.createSession(sessionId, latestRequest.sessionAddress, rules);
      await sessionTx.wait();
      setSteps((current) =>
        current.map((step, index) =>
          index === 3
            ? { ...step, status: "done", detail: shorten(String(sessionTx.hash || sessionId)) }
            : step
        )
      );

      setSteps((current) =>
        current.map((step, index) =>
          index === 4 ? { ...step, status: "working", detail: "Signing approval and finalizing..." } : step
        )
      );
      const message = createSessionAuthorizationMessage(payload, connectedAddress);
      const userSignature = await signer.signMessage(message);
      const response = await fetch(
        `${resolvedBackendUrl}/api/session/approval/${encodeURIComponent(approvalRequestId)}/complete?token=${encodeURIComponent(approvalToken)}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payload,
            userEoa: connectedAddress,
            userSignature,
            executionMode: "external",
            runtime: {
              owner: connectedAddress,
              aaWallet,
              sessionAddress: latestRequest.sessionAddress,
              sessionId,
              sessionTxHash: String(sessionTx.hash || "").trim(),
              maxPerTx: Number(payload.singleLimit || 0),
              dailyLimit: Number(payload.dailyLimit || 0),
              gatewayRecipient: payload.gatewayRecipient,
              tokenAddress: payload.tokenAddress,
              source: "approval-page-browser-wallet",
            },
          }),
        }
      );
      const completedPayload = (await response.json()) as { ok?: boolean; reason?: string } & ApprovalResponse;
      if (!response.ok || completedPayload?.ok === false) {
        throw new Error(String(completedPayload?.reason || "Approval completion failed."));
      }
      setSteps((current) =>
        current.map((step, index) =>
          index === 4 ? { ...step, status: "done", detail: "Approval completed" } : step
        )
      );
      setApproval(completedPayload);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Approval failed.");
    } finally {
      setWorking(false);
    }
  }

  const approvalRequest = approval?.approvalRequest || null;
  const payload = normalizePayload(approvalRequest?.payload);
  const isCompleted = String(approvalRequest?.status || "").toLowerCase() === "completed";
  const waitCommand =
    approvalRequest && approvalToken
      ? `ktrace session wait ${approvalRequest.approvalRequestId} --token ${approvalToken}`
      : "";

  /* ── Branch: job approval ────────────────────────────────── */
  const approvalKind = approvalRequest?.approvalKind;
  if (approvalKind === "job" && approval) {
    return (
      <main className="min-h-screen bg-[#faf7f1] px-4 py-12 text-[#18180e]">
        <div className="mx-auto max-w-5xl">
          <JobApprovalPanel
            approvalRequestId={approvalRequestId}
            approvalToken={approvalToken}
            resolvedBackendUrl={resolvedBackendUrl}
            approval={approval}
            onRefresh={() => void load()}
          />
        </div>
      </main>
    );
  }

  /* ── RENDER (session approval) ───────────────────────────── */
  return (
    <main className="min-h-screen bg-[#faf7f1] px-4 py-12 text-[#18180e]">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">

        {/* ── Page header ──────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
            <ShieldCheck className="size-3" />
            ktrace · Session Approval
          </span>
          <h1 className="font-display text-[2.6rem] font-normal leading-tight tracking-tight text-[#18180e] md:text-[3.2rem]">
            Approve an <em className="not-italic text-[#3a4220]">agent session</em>
          </h1>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
            Connect your wallet to verify the request, deploy your AA wallet if needed,
            create the session, and sign the final authorization.
          </p>
          {/* Request meta chip */}
          <div
            className="inline-flex w-fit flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[rgba(90,80,50,0.12)] bg-[#f2ebe0] px-4 py-2.5 text-[12px] text-[#7a6e56]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            <span><span className="text-[#9e8e76]">id </span>{shorten(approvalRequestId)}</span>
            <span className="h-3 w-px bg-[rgba(90,80,50,0.2)]" />
            <span><span className="text-[#9e8e76]">status </span>{approvalRequest?.status || (isPending ? "loading…" : "—")}</span>
          </div>
        </div>

        {/* ── Main grid ────────────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">

          {/* Left: checklist card */}
          <div className="flex flex-col gap-6">
            <div className="overflow-hidden rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0]">
              {/* Card header */}
              <div className="border-b border-[rgba(90,80,50,0.08)] px-6 py-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Approval Checklist</p>
                <p className="mt-1 text-[13px] text-[#7a6e56]">
                  Review the request, connect a wallet, then confirm the onchain steps.
                </p>
              </div>

              <div className="flex flex-col gap-5 px-6 py-5">
                {/* Error banner */}
                {error ? (
                  <div className="flex items-start gap-3 rounded-xl border border-[rgba(180,60,40,0.22)] bg-[rgba(180,60,40,0.06)] px-4 py-3">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
                    <div>
                      <p className="text-[12px] font-semibold text-[#9a4332]">Error</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#9a4332]/80">{error}</p>
                    </div>
                  </div>
                ) : null}

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3">
                  <MonoField label="User EOA" value={approvalRequest?.userEoa || ""} />
                  <MonoField label="Session Address" value={approvalRequest?.sessionAddress || ""} />
                  <MonoField label="AA Wallet" value={payload.payerAaWallet || ""} />
                  <div className="rounded-xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Spending Limits</p>
                    <p className="mt-1.5 text-[12.5px] text-[#2f351a]">
                      Per-tx <strong>{payload.singleLimit || "—"}</strong>
                      {" · "}
                      Daily <strong>{payload.dailyLimit || "—"}</strong>
                    </p>
                  </div>
                </div>

                {/* Steps */}
                <div className="flex flex-col gap-2">
                  {steps.map((step, i) => (
                    <div
                      key={step.label}
                      className="flex items-start gap-3 rounded-xl border px-4 py-3 transition"
                      style={{
                        borderColor: step.status === "done" ? "rgba(58,66,32,0.2)" : step.status === "working" ? "rgba(138,96,32,0.2)" : "rgba(90,80,50,0.1)",
                        background: step.status === "done" ? "rgba(58,66,32,0.05)" : step.status === "working" ? "rgba(138,96,32,0.06)" : "#faf7f1",
                      }}
                    >
                      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                        {step.status === "done" ? (
                          <CheckCircle2 className="size-5 text-[#3a4220]" />
                        ) : step.status === "working" ? (
                          <Loader2 className="size-5 animate-spin text-[#8a6020]" />
                        ) : (
                          <span className="flex size-5 items-center justify-center rounded-full border text-[10px] font-bold" style={{ borderColor: "rgba(90,80,50,0.22)", color: "#9e8e76" }}>
                            {i + 1}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[#2f351a]">{step.label}</p>
                        <p className="mt-0.5 truncate text-[11px] text-[#9e8e76]">{step.detail || "Waiting"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card footer */}
              <div className="flex flex-col gap-4 border-t border-[rgba(90,80,50,0.08)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] text-[#9e8e76]">
                  Connected:{" "}
                  <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    {walletAddress ? shorten(walletAddress) : "—"}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <GhostBtn onClick={() => void connectInjectedWallet()} disabled={working}>
                    <Wallet className="size-3.5" />
                    Browser Wallet
                  </GhostBtn>
                  {WALLETCONNECT_PROJECT_ID ? (
                    <GhostBtn onClick={() => void connectWalletConnect()} disabled={working}>
                      <QrCode className="size-3.5" />
                      WalletConnect
                    </GhostBtn>
                  ) : null}
                  <OliveBtn onClick={() => void handleApprove()} disabled={working || isCompleted || !approvalRequest}>
                    {working ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                    {isCompleted ? "Already Approved" : "Approve Session"}
                  </OliveBtn>
                </div>
              </div>
            </div>

            {/* Approval complete banner */}
            {isCompleted ? (
              <div className="overflow-hidden rounded-2xl border border-[rgba(58,66,32,0.2)] bg-[rgba(58,66,32,0.06)]">
                <div className="flex items-center gap-2 border-b border-[rgba(58,66,32,0.1)] px-6 py-4">
                  <CheckCircle2 className="size-4 text-[#3a4220]" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#3a4220]">Approval Complete</p>
                    <p className="text-[11px] text-[#6a7840]">The session is active. The agent can now continue.</p>
                  </div>
                </div>
                <div className="px-6 py-4">
                  <pre
                    className="overflow-x-auto rounded-xl bg-[#faf7f1] p-4 text-[11.5px] leading-[1.8] text-[#314016]"
                    style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                  >
                    {[
                      `authorizationId  ${String(approval?.authorization?.authorizationId || approvalRequest?.authorizationId || "—")}`,
                      `aaWallet         ${String(approval?.runtime?.aaWallet || payload.payerAaWallet || "—")}`,
                      `sessionAddress   ${String(approval?.runtime?.sessionAddress || approvalRequest?.sessionAddress || "—")}`,
                      `sessionId        ${String(approval?.runtime?.sessionId || "—")}`,
                    ].join("\n")}
                  </pre>
                  {waitCommand ? (
                    <div className="mt-4">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#667146]">Agent next command</p>
                      <div
                        className="rounded-xl border border-[rgba(58,66,32,0.12)] bg-[#faf7f1] px-4 py-2.5 text-[12px] text-[#2f351a]"
                        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                      >
                        {waitCommand}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {waitCommand ? (
                      <GhostBtn onClick={() => void navigator.clipboard.writeText(waitCommand)}>Copy Wait Command</GhostBtn>
                    ) : null}
                    <GhostBtn onClick={() => void navigator.clipboard.writeText(window.location.href)}>Copy Result URL</GhostBtn>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6">

            {/* What the wallet will do — dark terminal */}
            <div className="overflow-hidden rounded-2xl border border-[rgba(20,22,14,0.18)]">
              <div className="flex items-center gap-1.5 border-b border-[rgba(255,255,255,0.06)] bg-[#1c1e12] px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-3 text-[11px] text-white/30" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                  what will happen
                </span>
              </div>
              <div className="bg-[#141608] px-5 py-5">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgba(200,194,168,0.4)]">
                  Wallet actions
                </p>
                {[
                  "Connect to Kite Testnet and verify request matches your EOA.",
                  "Deploy or confirm the AA wallet, then authorize the session address.",
                  "Sign the final KTRACE approval — no owner key leaves the browser.",
                ].map((line, i) => (
                  <div key={i} className="flex items-start gap-3 py-2">
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "rgba(74,90,32,0.35)", color: "#a8b87a" }}>
                      {i + 1}
                    </span>
                    <p className="text-[12.5px] leading-relaxed text-[#c8c2a8]">{line}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Wallet detection */}
            <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Detected in this browser</p>
              <div
                className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[12.5px]"
                style={{
                  borderColor: hasInjectedWallet ? "rgba(58,66,32,0.2)" : "rgba(90,80,50,0.12)",
                  background: hasInjectedWallet ? "rgba(58,66,32,0.05)" : "#faf7f1",
                  color: hasInjectedWallet ? "#3a4220" : "#7a6e56",
                }}
              >
                <span className="mt-0.5 text-base">{hasInjectedWallet ? "✓" : "○"}</span>
                <span>
                  {hasInjectedWallet
                    ? "Injected wallet detected. Use Desktop Browser Wallet."
                    : "No injected wallet yet. Install MetaMask or OKX Wallet first."}
                </span>
              </div>
              {!WALLETCONNECT_PROJECT_ID ? (
                <p className="mt-3 text-[11px] text-[#9e8e76]">
                  WalletConnect disabled — set{" "}
                  <code style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code>{" "}
                  to enable.
                </p>
              ) : null}
            </div>

            {/* Request details */}
            <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9e8e76]">Request Details</p>
              <div
                className="space-y-1 rounded-xl bg-[#faf7f1] px-4 py-3 text-[11.5px] leading-[1.9] text-[#5a4e3a]"
                style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
              >
                <div><span className="text-[#9e8e76]">created  </span>{formatTime(approvalRequest?.createdAt || 0)}</div>
                <div><span className="text-[#9e8e76]">expires  </span>{formatTime(payload.expiresAt || 0)}</div>
                <div><span className="text-[#9e8e76]">token    </span>{shorten(payload.tokenAddress || "")}</div>
                <div><span className="text-[#9e8e76]">gateway  </span>{shorten(payload.gatewayRecipient || "")}</div>
                <div><span className="text-[#9e8e76]">agent    </span>{shorten(payload.agentWallet || "")}</div>
                <div><span className="text-[#9e8e76]">registry </span>{shorten(payload.identityRegistry || "")}</div>
                <div><span className="text-[#9e8e76]">nonce    </span>{shorten(payload.nonce || "")}</div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <GhostBtn onClick={() => void navigator.clipboard.writeText(approvalRequest?.approvalUrl || window.location.href)}>
                  Copy Approval URL
                </GhostBtn>
                <GhostBtn
                  href={`${resolvedBackendUrl}/api/approvals/${encodeURIComponent(approvalRequestId)}?token=${encodeURIComponent(approvalToken)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Raw JSON
                  <ExternalLink className="size-3.5" />
                </GhostBtn>
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}
