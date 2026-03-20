"use client";

import { AlertCircle, CheckCircle2, Clock3, ExternalLink, ShieldCheck, XCircle } from "lucide-react";

const KITE_EXPLORER = (
  process.env.NEXT_PUBLIC_KITE_EXPLORER || "https://testnet.kitescan.ai"
).replace(/\/+$/, "");

export type TraceAnchor = {
  anchorRequired?: boolean;
  anchor?: {
    published?: boolean;
    anchorId?: string;
    txHash?: string;
    registryAddress?: string;
    anchoredAt?: string;
  };
};

export type JobAudit = {
  jobId: string;
  traceId: string;
  traceAnchor?: TraceAnchor;
  summary: {
    state: string;
    provider: string;
    capability: string;
    requester: string;
    executor: string;
    validator: string;
    budget: string;
    escrowAmount: string;
    escrowAddress: string;
    tokenAddress: string;
    expiresAt: string;
  };
  deadline?: {
    expiresAt?: string;
    expiredAt?: string;
    isExpired?: boolean;
    onchainEnforced?: boolean;
    enforcementMode?: string;
  };
  deliveryStandard?: {
    version?: string;
    definition?: string;
    validatorApproved?: boolean;
    resultHashSubmitted?: boolean;
    outcomeAnchored?: boolean;
    satisfied?: boolean;
  };
  contractPrimitives?: {
    escrow?: { present?: boolean; enforcementMode?: string; contractAddress?: string; tokenAddress?: string };
    conditionalPayment?: { present?: boolean; enforcementMode?: string };
    deadline?: { present?: boolean; enforcementMode?: string };
    roleEnforcement?: { present?: boolean; enforcementMode?: string; executionMode?: string; aaMethod?: string };
    staking?: { present?: boolean; enforcementMode?: string };
    slashing?: { present?: boolean; enforcementMode?: string };
  };
  approvalPolicy?: {
    threshold?: number;
    ttlMs?: number;
    amount?: number;
    currency?: string;
    exceeded?: boolean;
    reasonCode?: string;
  };
  lifecycle?: Array<{
    key: string;
    label: string;
    status: "completed" | "current" | "pending";
    at?: string;
    anchorTxHash?: string;
    escrowTxHash?: string;
  }>;
  authorization?: {
    authorizationId?: string;
    authorizedBy?: string;
    authorizedAt?: number;
    authorizationMode?: string;
    authorizationPayloadHash?: string;
    authorizationExpiresAt?: number;
    authorizationAudience?: string;
    allowedCapabilities?: string[];
    authorityId?: string;
    intentId?: string;
    policySnapshotHash?: string;
    validationDecision?: string;
    authoritySummary?: {
      authorityId?: string;
      status?: string;
      allowedCapabilities?: string[];
    };
  };
  humanApproval?: {
    approvalId?: string;
    approvalState?: string;
    approvalReasonCode?: string;
    approvalUrl?: string;
    approvalRequestedAt?: number;
    approvalExpiresAt?: number;
    approvalDecidedAt?: number;
    approvalDecidedBy?: string;
    approvalDecisionNote?: string;
  };
  evidence?: {
    receiptRef?: string;
    evidenceRef?: string;
    resultRef?: string;
    resultHash?: string;
    inputHash?: string;
  };
};

function shorten(value = "", head = 8, tail = 6) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= head + tail + 2) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function formatDate(value?: string | number) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatBoolean(value?: boolean) {
  return value ? "Yes" : "No";
}

function formatNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

function formatDurationMs(value?: number) {
  if (!value || !Number.isFinite(value)) return "-";
  const totalMinutes = Math.round(value / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function explorerTxUrl(hash = "") {
  return `${KITE_EXPLORER}/tx/${hash}`;
}

function explorerAddressUrl(address = "") {
  return `${KITE_EXPLORER}/address/${address}`;
}

function toAbsoluteUrl(baseUrl: string, ref = "") {
  const text = String(ref || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `${baseUrl.replace(/\/+$/, "")}/${text.replace(/^\/+/, "")}`;
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] shadow-[0_20px_60px_rgba(58,66,32,0.08)]">
      <div className="border-b border-[rgba(90,80,50,0.08)] px-6 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">{title}</p>
        {subtitle ? <p className="mt-1 text-[13px] text-[#7a6e56]">{subtitle}</p> : null}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function StateChip({ value }: { value: string }) {
  const state = String(value || "").trim().toLowerCase();
  const ok = state === "completed";
  const bad = ["rejected", "expired", "failed", "approval_rejected", "approval_expired"].includes(state);
  const waiting = ["current", "pending", "pending_approval", "funded", "accepted", "submitted"].includes(state);

  const style = ok
    ? { borderColor: "rgba(58,66,32,0.22)", background: "rgba(58,66,32,0.08)", color: "#3a4220" }
    : bad
      ? { borderColor: "rgba(180,60,40,0.22)", background: "rgba(180,60,40,0.06)", color: "#9a4332" }
      : waiting
        ? { borderColor: "rgba(138,96,32,0.22)", background: "rgba(138,96,32,0.08)", color: "#8a6020" }
        : { borderColor: "rgba(90,80,50,0.16)", background: "#f7f2ea", color: "#7a6e56" };

  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
      style={style}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

function MonoCard({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">{label}</p>
      <p
        className="mt-1.5 break-all text-[12px] text-[#2f351a]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      >
        {value}
      </p>
    </div>
  );
}

function RoleCard({ label, value }: { label: string; value?: string }) {
  const address = String(value || "").trim();
  return (
    <div className="rounded-[24px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">{label}</p>
      {address ? (
        <a
          href={explorerAddressUrl(address)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-start gap-1 break-all text-[12px] leading-relaxed text-[#2f351a] hover:text-[#3a4220]"
          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
        >
          {address}
          <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-50" />
        </a>
      ) : (
        <p className="mt-2 text-[12px] text-[#9e8e76]">Not available</p>
      )}
    </div>
  );
}

function TimelineStep({
  label,
  status,
  at,
  anchorTxHash,
  escrowTxHash,
  isLast,
}: {
  label: string;
  status: "completed" | "current" | "pending";
  at?: string;
  anchorTxHash?: string;
  escrowTxHash?: string;
  isLast: boolean;
}) {
  const icon =
    status === "completed" ? (
      <CheckCircle2 className="size-4 text-[#faf7f1]" />
    ) : status === "current" ? (
      <Clock3 className="size-4 text-[#8a6020]" />
    ) : (
      <span className="text-[11px] font-bold text-[#b4a78f]">•</span>
    );
  const circleStyle =
    status === "completed"
      ? { background: "#3a4220", borderColor: "#3a4220" }
      : status === "current"
        ? { background: "rgba(138,96,32,0.08)", borderColor: "#8a6020" }
        : { background: "#faf7f1", borderColor: "rgba(90,80,50,0.18)" };

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className="flex size-8 items-center justify-center rounded-full border-2"
          style={circleStyle}
        >
          {icon}
        </div>
        {!isLast ? (
          <div
            className="mt-1 w-0.5 flex-1"
            style={{
              minHeight: "2.5rem",
              background:
                status === "completed" ? "rgba(58,66,32,0.18)" : "rgba(90,80,50,0.08)",
            }}
          />
        ) : null}
      </div>

      <div className={`flex-1 ${isLast ? "" : "pb-6"}`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[13px] font-semibold text-[#2f351a]">{label}</p>
          <StateChip value={status} />
          {at ? <span className="text-[11px] text-[#9e8e76]">{formatDate(at)}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {escrowTxHash ? (
            <a
              href={explorerTxUrl(escrowTxHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-[rgba(90,80,50,0.12)] bg-[#faf7f1] px-3 py-1 text-[11px] text-[#5a4e3a]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              escrow {shorten(escrowTxHash, 6, 4)}
              <ExternalLink className="size-3 opacity-60" />
            </a>
          ) : null}
          {anchorTxHash ? (
            <a
              href={explorerTxUrl(anchorTxHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-[rgba(90,80,50,0.12)] bg-[#faf7f1] px-3 py-1 text-[11px] text-[#5a4e3a]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              anchor {shorten(anchorTxHash, 6, 4)}
              <ExternalLink className="size-3 opacity-60" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ value }: { value?: boolean }) {
  return value ? (
    <CheckCircle2 className="size-4 text-[#3a4220]" />
  ) : (
    <XCircle className="size-4 text-[#b07a50]" />
  );
}

function TraceAnchorSection({ anchor }: { anchor: TraceAnchor }) {
  const published = Boolean(anchor?.anchor?.published);
  const required = anchor?.anchorRequired !== false;
  const txHash = anchor?.anchor?.txHash || "";
  const anchorId = anchor?.anchor?.anchorId || "";
  const registryAddress = anchor?.anchor?.registryAddress || "";
  const anchoredAt = anchor?.anchor?.anchoredAt || "";

  const statusColor = published
    ? { borderColor: "rgba(58,66,32,0.22)", background: "rgba(58,66,32,0.06)", color: "#3a4220" }
    : required
      ? { borderColor: "rgba(180,60,40,0.18)", background: "rgba(180,60,40,0.04)", color: "#9a4332" }
      : { borderColor: "rgba(90,80,50,0.14)", background: "#faf7f1", color: "#7a6e56" };

  return (
    <Section
      title="Submit Anchor"
      subtitle="On-chain ordering proof required before escrow submit."
    >
      <div className="grid gap-3">
        <div
          className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-[12px]"
          style={statusColor}
        >
          {published ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <XCircle className="size-4 shrink-0" />
          )}
          <span>
            {published
              ? "Anchor published — escrow submit order confirmed."
              : required
                ? "Anchor not yet published."
                : "Anchor not required for this job."}
          </span>
        </div>

        {txHash ? (
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
              Anchor tx
            </p>
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 flex items-center gap-1 break-all text-[12px] text-[#2f351a] hover:text-[#3a4220]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              {shorten(txHash, 10, 6)}
              <ExternalLink className="size-3 shrink-0 opacity-50" />
            </a>
          </div>
        ) : null}

        {anchoredAt ? (
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
              Anchored at
            </p>
            <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(anchoredAt)}</p>
          </div>
        ) : null}

        {anchorId ? <MonoCard label="Anchor ID" value={anchorId} /> : null}
        {registryAddress ? <MonoCard label="Registry" value={registryAddress} /> : null}
      </div>
    </Section>
  );
}

export default function JobAuditView({
  audit,
  backendUrl,
}: {
  audit: JobAudit;
  backendUrl: string;
}) {
  const summary = audit.summary || {
    state: "",
    provider: "",
    capability: "",
    requester: "",
    executor: "",
    validator: "",
    budget: "",
    escrowAmount: "",
    escrowAddress: "",
    tokenAddress: "",
    expiresAt: "",
  };
  const approval = audit.humanApproval || {};
  const authorization = audit.authorization || {};
  const evidence = audit.evidence || {};
  const deadline = audit.deadline || {};
  const delivery = audit.deliveryStandard || {};
  const primitives = audit.contractPrimitives || {};
  const hasHumanApproval = Boolean(
    approval.approvalId ||
      approval.approvalState ||
      approval.approvalRequestedAt ||
      approval.approvalDecidedAt
  );
  const isSuccess = String(summary.state || "").trim().toLowerCase() === "completed";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(168,136,28,0.08),transparent_28%),linear-gradient(180deg,#faf7f1_0%,#f6efe3_100%)] px-4 py-12 text-[#18180e]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
            <ShieldCheck className="size-3" />
            KTRACE Public Job Audit
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[2.4rem] font-normal leading-tight tracking-tight text-[#18180e] md:text-[3.1rem]">
              <em className="not-italic text-[#3a4220]">{summary.capability || "Job Lifecycle"}</em>
              {summary.provider ? <span className="text-[#8e8067]"> via {summary.provider}</span> : null}
            </h1>
            <StateChip value={summary.state || "unknown"} />
          </div>

          <p className="max-w-3xl text-[14px] leading-relaxed text-[#6f624d]">
            Public audit view for escrow funding, human approvals, validator judgment, and final delivery evidence.
          </p>

          <div className="flex flex-wrap gap-2">
            <span
              className="inline-flex items-center rounded-full border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-3 py-1 text-[11px] text-[#5f533f]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              job {shorten(audit.jobId)}
            </span>
            {audit.traceId ? (
              <span
                className="inline-flex items-center rounded-full border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-3 py-1 text-[11px] text-[#5f533f]"
                style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
              >
                trace {shorten(audit.traceId)}
              </span>
            ) : null}
          </div>

          <div
            className="inline-flex w-fit items-center gap-2 rounded-2xl border px-4 py-3 text-[12px]"
            style={
              isSuccess
                ? { borderColor: "rgba(58,66,32,0.2)", background: "rgba(58,66,32,0.06)", color: "#3a4220" }
                : { borderColor: "rgba(180,60,40,0.16)", background: "rgba(180,60,40,0.04)", color: "#8a5d38" }
            }
          >
            {isSuccess ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertCircle className="size-4 shrink-0" />}
            <span>
              {isSuccess
                ? "Delivery standard satisfied: validator approved, result hash submitted, outcome anchored."
                : "Audit trail available even when the job is still in progress or ended without successful delivery."}
            </span>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <RoleCard label="Requester" value={summary.requester} />
          <RoleCard label="Executor" value={summary.executor} />
          <RoleCard label="Validator" value={summary.validator} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.45fr_0.55fr]">
          <div className="flex flex-col gap-6">
            <Section
              title="Lifecycle Timeline"
              subtitle="Each stage exposes escrow and anchor proof independently when available."
            >
              <div className="flex flex-col">
                {(audit.lifecycle || []).map((step, index, rows) => (
                  <TimelineStep
                    key={step.key || `${step.label}-${index}`}
                    label={step.label}
                    status={step.status}
                    at={step.at}
                    anchorTxHash={step.anchorTxHash}
                    escrowTxHash={step.escrowTxHash}
                    isLast={index === rows.length - 1}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="Delivery Standard"
              subtitle={delivery.definition || "validator approval plus onchain outcome proof"}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-4">
                  <div className="flex items-center gap-2">
                    <StatusDot value={delivery.validatorApproved} />
                    <p className="text-[13px] font-semibold text-[#2f351a]">Validator approved</p>
                  </div>
                  <p className="mt-2 text-[12px] text-[#7a6e56]">
                    Final delivery judgment from the validator role.
                  </p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-4">
                  <div className="flex items-center gap-2">
                    <StatusDot value={delivery.resultHashSubmitted} />
                    <p className="text-[13px] font-semibold text-[#2f351a]">Result hash submitted</p>
                  </div>
                  <p className="mt-2 text-[12px] text-[#7a6e56]">
                    Execution produced a result hash that can be audited later.
                  </p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-4">
                  <div className="flex items-center gap-2">
                    <StatusDot value={delivery.outcomeAnchored} />
                    <p className="text-[13px] font-semibold text-[#2f351a]">Outcome anchored onchain</p>
                  </div>
                  <p className="mt-2 text-[12px] text-[#7a6e56]">
                    Public onchain anchor confirms the final terminal outcome.
                  </p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-4">
                  <div className="flex items-center gap-2">
                    <StatusDot value={delivery.satisfied} />
                    <p className="text-[13px] font-semibold text-[#2f351a]">Standard satisfied</p>
                  </div>
                  <p className="mt-2 text-[12px] text-[#7a6e56]">
                    Version {delivery.version || "-"} of the current public delivery contract.
                  </p>
                </div>
              </div>
            </Section>

            {hasHumanApproval ? (
              <Section
                title="Human Approval"
                subtitle="Over-limit pause and operator decision trail."
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <MonoCard label="Approval ID" value={approval.approvalId} />
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Approval state</p>
                    <div className="mt-2">
                      <StateChip value={approval.approvalState || "pending"} />
                    </div>
                  </div>
                  <MonoCard label="Reason code" value={approval.approvalReasonCode} />
                  <MonoCard label="Decided by" value={approval.approvalDecidedBy} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Requested</p>
                    <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(approval.approvalRequestedAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Expires</p>
                    <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(approval.approvalExpiresAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Decided</p>
                    <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(approval.approvalDecidedAt)}</p>
                  </div>
                </div>
                {approval.approvalDecisionNote ? (
                  <div className="mt-4 rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Decision note</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-[#2f351a]">{approval.approvalDecisionNote}</p>
                  </div>
                ) : null}
              </Section>
            ) : null}
          </div>

          <div className="flex flex-col gap-6">
            <Section title="Summary" subtitle="Compact header for demos, audits, and judge review.">
              <div className="grid gap-3">
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Budget</p>
                  <p className="mt-1.5 text-[14px] font-semibold text-[#3a4220]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    {summary.budget || "-"}
                    {summary.escrowAmount && summary.escrowAmount !== summary.budget ? (
                      <span className="ml-2 text-[11px] font-normal text-[#8d816a]">
                        escrow {summary.escrowAmount}
                      </span>
                    ) : null}
                  </p>
                </div>
                <MonoCard label="Escrow contract" value={summary.escrowAddress} />
                <MonoCard label="Settlement token" value={summary.tokenAddress} />
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Expires</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(summary.expiresAt)}</p>
                </div>
              </div>
            </Section>

            <Section title="Authorization" subtitle="Who authorized the agent and under what scope.">
              <div className="grid gap-3">
                <MonoCard label="Authorization ID" value={authorization.authorizationId} />
                <MonoCard label="Authority ID" value={authorization.authorityId} />
                <MonoCard label="Authorized by" value={authorization.authorizedBy} />
                <MonoCard label="Mode" value={authorization.authorizationMode} />
                <MonoCard label="Payload hash" value={authorization.authorizationPayloadHash} />
                <MonoCard label="Policy snapshot hash" value={authorization.policySnapshotHash} />
                <MonoCard label="Intent ID" value={authorization.intentId} />
                {authorization.validationDecision ? (
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Validation decision</p>
                    <p
                      className="mt-1.5 text-[12px] font-semibold"
                      style={{ color: authorization.validationDecision === "allowed" ? "#3a4220" : "#9a4332" }}
                    >
                      {authorization.validationDecision}
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Authorized at</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(authorization.authorizedAt)}</p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Authorization expires</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(authorization.authorizationExpiresAt)}</p>
                </div>
                {Array.isArray(authorization.allowedCapabilities) && authorization.allowedCapabilities.length > 0 ? (
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Allowed capabilities</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {authorization.allowedCapabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.06)] px-3 py-1 text-[11px] text-[#3a4220]"
                          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {authorization.authoritySummary ? (
                  <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Authority summary</p>
                    <p className="mt-1.5 text-[11px] text-[#7a6e56]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                      {JSON.stringify(authorization.authoritySummary)}
                    </p>
                  </div>
                ) : null}
              </div>
            </Section>

            <Section title="Evidence & Proof" subtitle="Artifacts and exports that others can verify independently.">
              <div className="grid gap-3">
                <MonoCard label="Input hash" value={evidence.inputHash} />
                <MonoCard label="Result hash" value={evidence.resultHash} />
                <div className="flex flex-col gap-2">
                  {evidence.receiptRef ? (
                    <a
                      href={toAbsoluteUrl(backendUrl, evidence.receiptRef)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-between rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3 text-[12px] text-[#2f351a]"
                    >
                      <span>Receipt</span>
                      <ExternalLink className="size-3.5 opacity-60" />
                    </a>
                  ) : null}
                  {evidence.evidenceRef ? (
                    <a
                      href={toAbsoluteUrl(backendUrl, evidence.evidenceRef)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-between rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3 text-[12px] text-[#2f351a]"
                    >
                      <span>Evidence export</span>
                      <ExternalLink className="size-3.5 opacity-60" />
                    </a>
                  ) : null}
                  {evidence.resultRef ? (
                    <a
                      href={toAbsoluteUrl(backendUrl, evidence.resultRef)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-between rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3 text-[12px] text-[#2f351a]"
                    >
                      <span>Result payload</span>
                      <ExternalLink className="size-3.5 opacity-60" />
                    </a>
                  ) : null}
                </div>
              </div>
            </Section>

            {audit.traceAnchor ? (
              <TraceAnchorSection anchor={audit.traceAnchor} />
            ) : null}

            <Section title="Policy & Deadline" subtitle="Backend-enforced rules that shaped this run.">
              <div className="grid gap-3">
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Threshold</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatNumber(audit.approvalPolicy?.threshold)}</p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Approval TTL</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDurationMs(audit.approvalPolicy?.ttlMs)}</p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Amount exceeded</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatBoolean(audit.approvalPolicy?.exceeded)}</p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Deadline enforcement</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{deadline.enforcementMode || "-"}</p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Expires at</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatDate(deadline.expiresAt)}</p>
                </div>
                <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Expired</p>
                  <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatBoolean(deadline.isExpired)}</p>
                </div>
              </div>
            </Section>
          </div>
        </div>

        <Section title="Contract Primitive Status" subtitle="Explicitly calls out which pieces are already onchain and which are still backend-mediated.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["Escrow", primitives.escrow?.present, primitives.escrow?.enforcementMode],
              ["Conditional payment", primitives.conditionalPayment?.present, primitives.conditionalPayment?.enforcementMode],
              ["Deadline", primitives.deadline?.present, primitives.deadline?.enforcementMode],
              ["Role enforcement", primitives.roleEnforcement?.present, primitives.roleEnforcement?.enforcementMode],
              ["Staking", primitives.staking?.present, primitives.staking?.enforcementMode],
              ["Slashing", primitives.slashing?.present, primitives.slashing?.enforcementMode],
            ].map(([label, present, mode]) => (
              <div key={String(label)} className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-4">
                <div className="flex items-center gap-2">
                  <StatusDot value={Boolean(present)} />
                  <p className="text-[13px] font-semibold text-[#2f351a]">{label}</p>
                </div>
                <p className="mt-2 text-[12px] text-[#7a6e56]">{String(mode || "not available")}</p>
              </div>
            ))}
          </div>
          {(primitives.roleEnforcement?.executionMode || primitives.roleEnforcement?.aaMethod) && (
            <div className="mt-3 flex flex-wrap gap-4 rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              {primitives.roleEnforcement?.executionMode && (
                <div className="flex items-center gap-2 text-[11px] text-[#7a6e56]">
                  <span className="font-medium text-[#2f351a]">Execution mode:</span>
                  <code className="font-mono">{primitives.roleEnforcement.executionMode}</code>
                </div>
              )}
              {primitives.roleEnforcement?.aaMethod && (
                <div className="flex items-center gap-2 text-[11px] text-[#7a6e56]">
                  <span className="font-medium text-[#2f351a]">AA method:</span>
                  <code className="font-mono">{primitives.roleEnforcement.aaMethod}</code>
                </div>
              )}
            </div>
          )}
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-6 py-4">
          <div>
            <p className="text-[12px] font-medium text-[#3a4220]">Raw public audit JSON</p>
            <p className="text-[11px] text-[#9e8e76]">Use this endpoint for demos, sharing, or independent verification.</p>
          </div>
          <a
            href={`${backendUrl.replace(/\/+$/, "")}/api/public/jobs/${encodeURIComponent(audit.jobId)}/audit`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 py-2 text-[12px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)]"
          >
            Open JSON
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </main>
  );
}
