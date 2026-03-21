"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  XCircle,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthorityPolicy = {
  authorityId: string;
  sessionId: string;
  authorizedBy: string;
  payer: string;
  consumerAgentLabel: string;
  allowedCapabilities: string[];
  allowedProviders: string[];
  allowedRecipients: string[];
  singleLimit: number;
  dailyLimit: number;
  totalLimit: number;
  expiresAt: number;
  status: "active" | "revoked" | string;
  revokedAt: number;
  revocationReason: string;
  createdAt: number;
  updatedAt: number;
};

type PolicyResponse = {
  ok: boolean;
  traceId?: string;
  authority?: AuthorityPolicy;
  runtime?: {
    authorityId?: string;
    authorityStatus?: string;
    authorityExpiresAt?: number;
  };
  error?: string;
  reason?: string;
};

type ValidateResult = {
  ok: boolean;
  traceId?: string;
  allowed?: boolean;
  authority?: { authorityId?: string; status?: string };
  policySnapshotHash?: string;
  error?: string;
  reason?: string;
  detail?: { actionKind?: string; referenceId?: string };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shorten(value = "", head = 8, tail = 6) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.length <= head + tail + 2) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function formatTs(value?: number) {
  if (!value || value <= 0) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatNumber(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return String(value);
}

// ─── Primitive UI ─────────────────────────────────────────────────────────────

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

function FieldCard({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">{label}</p>
      <p
        className="mt-1.5 break-all text-[12px] text-[#2f351a]"
        style={mono ? { fontFamily: "var(--font-jetbrains-mono, monospace)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const normalized = String(status || "").toLowerCase();
  const style =
    normalized === "active"
      ? { borderColor: "rgba(58,66,32,0.22)", background: "rgba(58,66,32,0.08)", color: "#3a4220" }
      : normalized === "revoked"
        ? { borderColor: "rgba(180,60,40,0.22)", background: "rgba(180,60,40,0.06)", color: "#9a4332" }
        : { borderColor: "rgba(90,80,50,0.16)", background: "#f7f2ea", color: "#7a6e56" };

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
      style={style}
    >
      {normalized === "active" ? (
        <ShieldCheck className="size-3" />
      ) : normalized === "revoked" ? (
        <ShieldOff className="size-3" />
      ) : null}
      {status}
    </span>
  );
}

function TagList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <span className="text-[12px] italic text-[#9e8e76]">{emptyLabel}</span>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.06)] px-3 py-1 text-[11px] text-[#3a4220]"
          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-2xl border border-[rgba(90,80,50,0.16)] bg-[#faf7f1] px-4 py-2.5 text-[12px] text-[#2f351a] placeholder-[#b4a78f] outline-none transition focus:border-[rgba(58,66,32,0.4)] focus:ring-1 focus:ring-[rgba(58,66,32,0.12)] disabled:opacity-50"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-2xl border border-[rgba(90,80,50,0.16)] bg-[#faf7f1] px-4 py-2.5 text-[12px] text-[#2f351a] outline-none transition focus:border-[rgba(58,66,32,0.4)] focus:ring-1 focus:ring-[rgba(58,66,32,0.12)] disabled:opacity-50"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        className="w-full resize-none rounded-2xl border border-[rgba(90,80,50,0.16)] bg-[#faf7f1] px-4 py-2.5 text-[12px] text-[#2f351a] placeholder-[#b4a78f] outline-none transition focus:border-[rgba(58,66,32,0.4)] focus:ring-1 focus:ring-[rgba(58,66,32,0.12)] disabled:opacity-50"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      />
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  pending,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  pending: boolean;
  variant?: "primary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const styles = {
    primary:
      "border-[rgba(58,66,32,0.3)] bg-[rgba(58,66,32,0.09)] text-[#3a4220] hover:bg-[rgba(58,66,32,0.14)]",
    danger:
      "border-[rgba(180,60,40,0.3)] bg-[rgba(180,60,40,0.07)] text-[#9a4332] hover:bg-[rgba(180,60,40,0.12)]",
    ghost:
      "border-[rgba(90,80,50,0.18)] bg-transparent text-[#5a4e3a] hover:bg-[rgba(90,80,50,0.06)]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition disabled:opacity-50 ${styles[variant]}`}
    >
      {pending ? <RefreshCw className="size-3 animate-spin" /> : null}
      {label}
    </button>
  );
}

function ResultBanner({
  result,
  onDismiss,
}: {
  result: { ok: boolean; message: string } | null;
  onDismiss: () => void;
}) {
  if (!result) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border px-4 py-3"
      style={
        result.ok
          ? { borderColor: "rgba(58,66,32,0.2)", background: "rgba(58,66,32,0.06)", color: "#3a4220" }
          : { borderColor: "rgba(180,60,40,0.18)", background: "rgba(180,60,40,0.05)", color: "#9a4332" }
      }
    >
      {result.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <p className="flex-1 text-[12px] leading-relaxed">{result.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-[11px] opacity-50 hover:opacity-80"
      >
        ×
      </button>
    </div>
  );
}

// ─── Policy Inspection ────────────────────────────────────────────────────────

function PolicyInspection({ policy }: { policy: AuthorityPolicy }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip status={policy.status} />
        {policy.consumerAgentLabel ? (
          <span
            className="rounded-full border border-[rgba(90,80,50,0.14)] bg-[#f7f2ea] px-3 py-1 text-[11px] text-[#5f533f]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {policy.consumerAgentLabel}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FieldCard label="Authority ID" value={policy.authorityId} mono />
        <FieldCard label="Session ID" value={policy.sessionId} mono />
        <FieldCard label="Payer" value={policy.payer} mono />
        <FieldCard label="Authorized by" value={policy.authorizedBy} mono />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Single limit</p>
          <p
            className="mt-1.5 text-[14px] font-semibold text-[#3a4220]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {formatNumber(policy.singleLimit)}
          </p>
        </div>
        <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Daily limit</p>
          <p
            className="mt-1.5 text-[14px] font-semibold text-[#3a4220]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {formatNumber(policy.dailyLimit)}
          </p>
        </div>
        <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Total limit</p>
          <p
            className="mt-1.5 text-[14px] font-semibold text-[#3a4220]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {formatNumber(policy.totalLimit)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Expires at</p>
          <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatTs(policy.expiresAt)}</p>
        </div>
        <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Last updated</p>
          <p className="mt-1.5 text-[12px] text-[#2f351a]">{formatTs(policy.updatedAt)}</p>
        </div>
      </div>

      {policy.status === "revoked" ? (
        <div className="rounded-2xl border border-[rgba(180,60,40,0.18)] bg-[rgba(180,60,40,0.04)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9a4332]">Revocation</p>
          <p className="mt-1.5 text-[12px] text-[#9a4332]">
            {formatTs(policy.revokedAt)}
            {policy.revocationReason ? ` — ${policy.revocationReason}` : ""}
          </p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
          Allowed capabilities
        </p>
        <TagList items={policy.allowedCapabilities} emptyLabel="Any capability allowed" />
      </div>

      <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
          Allowed providers
        </p>
        <TagList items={policy.allowedProviders} emptyLabel="Any provider allowed" />
      </div>

      <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
          Allowed recipients
        </p>
        <TagList items={policy.allowedRecipients} emptyLabel="Resolved from session runtime" />
      </div>
    </div>
  );
}

// ─── Denial reason helpers ────────────────────────────────────────────────────

// Maps known backend denial codes to a short human label.
// Rule: always show the raw reason code alongside — never substitute it.
const DENIAL_LABELS: Record<string, string> = {
  authority_not_found: "No authority policy exists for this session.",
  authority_expired: "The authority policy has expired.",
  authority_revoked: "The authority policy has been revoked.",
  authority_migration_required: "Authority migration is required before execution can proceed.",
  capability_not_allowed: "This capability is not in the allowed list.",
  provider_not_allowed: "This provider is not in the allowed list.",
  recipient_not_allowed: "This recipient address is not in the allowed list.",
  amount_exceeds_single_limit: "The requested amount exceeds the per-transaction limit.",
  amount_exceeds_daily_limit: "The requested amount would exceed the daily spend limit.",
  intent_replayed: "Replay detected — this intent ID has already been processed.",
  intent_conflict: "Intent conflict — a concurrent request with the same intent ID is in flight.",
};

function DenialDetail({ reason }: { reason: string }) {
  const label = DENIAL_LABELS[reason];
  const isIntentState = reason.startsWith("intent_");
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p
        className="text-[12px] font-medium"
        style={{
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          color: isIntentState ? "#8a6020" : "#9a4332",
        }}
      >
        {reason}
      </p>
      {label ? (
        <p className="text-[12px] text-[#5a4e3a]">{label}</p>
      ) : null}
    </div>
  );
}

// ─── Validation Tester ────────────────────────────────────────────────────────

const ACTION_KIND_OPTIONS = [
  { label: "buy_direct", value: "buy_direct" },
  { label: "buy_request", value: "buy_request" },
  { label: "job_fund", value: "job_fund" },
  { label: "job_submit", value: "job_submit" },
  { label: "agent_invoke", value: "agent_invoke" },
];

type ValidateForm = {
  actionKind: string;
  capability: string;
  provider: string;
  recipient: string;
  amount: string;
  intentId: string;
};

function ValidationTester() {
  const [form, setForm] = useState<ValidateForm>({
    actionKind: "buy_direct",
    capability: "",
    provider: "",
    recipient: "",
    amount: "",
    intentId: "",
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ValidateResult | null>(null);

  function patch(key: keyof ValidateForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  }

  async function submit() {
    setPending(true);
    setResult(null);
    try {
      const body: Record<string, string> = { actionKind: form.actionKind };
      if (form.capability.trim()) body.capability = form.capability.trim();
      if (form.provider.trim()) body.provider = form.provider.trim();
      if (form.recipient.trim()) body.recipient = form.recipient.trim();
      if (form.amount.trim()) body.amount = form.amount.trim();
      if (form.intentId.trim()) body.intentId = form.intentId.trim();

      const res = await fetch("/api/authority/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ValidateResult;
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        error: "network_error",
        reason: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Action kind"
          value={form.actionKind}
          onChange={(v) => patch("actionKind", v)}
          options={ACTION_KIND_OPTIONS}
          disabled={pending}
        />
        <InputField
          label="Capability"
          value={form.capability}
          onChange={(v) => patch("capability", v)}
          placeholder="btc-price-feed"
          disabled={pending}
        />
        <InputField
          label="Provider"
          value={form.provider}
          onChange={(v) => patch("provider", v)}
          placeholder="price-agent"
          disabled={pending}
        />
        <InputField
          label="Recipient address"
          value={form.recipient}
          onChange={(v) => patch("recipient", v)}
          placeholder="0x..."
          disabled={pending}
        />
        <InputField
          label="Amount"
          value={form.amount}
          onChange={(v) => patch("amount", v)}
          placeholder="1"
          type="number"
          disabled={pending}
        />
        <InputField
          label="Intent ID (optional)"
          value={form.intentId}
          onChange={(v) => patch("intentId", v)}
          placeholder="intent-abc-123"
          disabled={pending}
        />
      </div>

      <ActionButton
        label="Validate"
        onClick={submit}
        pending={pending}
        variant="primary"
      />

      {result ? (
        <div
          className="rounded-2xl border px-4 py-4"
          style={
            result.allowed
              ? { borderColor: "rgba(58,66,32,0.2)", background: "rgba(58,66,32,0.06)" }
              : result.reason?.startsWith("intent_")
                ? { borderColor: "rgba(138,96,32,0.2)", background: "rgba(138,96,32,0.04)" }
                : { borderColor: "rgba(180,60,40,0.18)", background: "rgba(180,60,40,0.04)" }
          }
        >
          <div className="flex items-center gap-2">
            {result.allowed ? (
              <CheckCircle2 className="size-4 text-[#3a4220]" />
            ) : result.reason?.startsWith("intent_") ? (
              <AlertCircle className="size-4 text-[#8a6020]" />
            ) : (
              <XCircle className="size-4 text-[#9a4332]" />
            )}
            <span
              className="text-[12px] font-semibold"
              style={{
                color: result.allowed
                  ? "#3a4220"
                  : result.reason?.startsWith("intent_")
                    ? "#8a6020"
                    : "#9a4332",
              }}
            >
              {result.allowed
                ? "Allowed"
                : result.reason?.startsWith("intent_")
                  ? "Replay / Conflict"
                  : "Denied"}
            </span>
          </div>

          {/* Show raw backend reason code — never remapped */}
          {result.reason ? <DenialDetail reason={result.reason} /> : null}

          {result.policySnapshotHash ? (
            <p
              className="mt-3 text-[11px] text-[#9e8e76]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              snapshot {shorten(result.policySnapshotHash, 16, 8)}
            </p>
          ) : null}
          {result.traceId ? (
            <p
              className="mt-1 text-[11px] text-[#b4a78f]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              trace {result.traceId}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Set Policy Form ──────────────────────────────────────────────────────────

type PolicyForm = {
  consumerAgentLabel: string;
  allowedCapabilities: string;
  allowedProviders: string;
  allowedRecipients: string;
  singleLimit: string;
  dailyLimit: string;
  totalLimit: string;
  expiresAt: string;
};

function SetPolicyForm({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PolicyForm>({
    consumerAgentLabel: "",
    allowedCapabilities: "",
    allowedProviders: "",
    allowedRecipients: "",
    singleLimit: "",
    dailyLimit: "",
    totalLimit: "",
    expiresAt: "",
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function patch(key: keyof PolicyForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  }

  function commaSplit(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function submit() {
    setPending(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (form.consumerAgentLabel.trim()) body.consumerAgentLabel = form.consumerAgentLabel.trim();
      if (form.allowedCapabilities.trim()) body.allowedCapabilities = commaSplit(form.allowedCapabilities);
      if (form.allowedProviders.trim()) body.allowedProviders = commaSplit(form.allowedProviders);
      if (form.allowedRecipients.trim()) body.allowedRecipients = commaSplit(form.allowedRecipients);
      if (form.singleLimit.trim()) body.singleLimit = Number(form.singleLimit);
      if (form.dailyLimit.trim()) body.dailyLimit = Number(form.dailyLimit);
      if (form.totalLimit.trim()) body.totalLimit = Number(form.totalLimit);
      if (form.expiresAt.trim()) body.expiresAt = new Date(form.expiresAt).getTime();

      const res = await fetch("/api/authority/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      if (data.ok) {
        setResult({ ok: true, message: "Policy updated successfully." });
        onSuccess();
      } else {
        setResult({ ok: false, message: data.reason || "Policy update failed." });
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5a4e3a] transition hover:text-[#3a4220]"
      >
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {open ? "Hide grant form" : "Update authority grant"}
      </button>

      {open ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label="Consumer agent label (optional)"
              value={form.consumerAgentLabel}
              onChange={(v) => patch("consumerAgentLabel", v)}
              placeholder="example-consumer"
              disabled={pending}
            />
            <InputField
              label="Expiry date/time (optional)"
              value={form.expiresAt}
              onChange={(v) => patch("expiresAt", v)}
              placeholder="2026-12-31T00:00"
              type="datetime-local"
              disabled={pending}
            />
            <InputField
              label="Single limit"
              value={form.singleLimit}
              onChange={(v) => patch("singleLimit", v)}
              placeholder="5"
              type="number"
              disabled={pending}
            />
            <InputField
              label="Daily limit"
              value={form.dailyLimit}
              onChange={(v) => patch("dailyLimit", v)}
              placeholder="25"
              type="number"
              disabled={pending}
            />
            <InputField
              label="Total limit"
              value={form.totalLimit}
              onChange={(v) => patch("totalLimit", v)}
              placeholder="100"
              type="number"
              disabled={pending}
            />
          </div>
          <TextareaField
            label="Allowed capabilities (comma-separated, empty = any)"
            value={form.allowedCapabilities}
            onChange={(v) => patch("allowedCapabilities", v)}
            placeholder="btc-price-feed, market-quote"
            disabled={pending}
          />
          <TextareaField
            label="Allowed providers (comma-separated, empty = any)"
            value={form.allowedProviders}
            onChange={(v) => patch("allowedProviders", v)}
            placeholder="price-agent, risk-agent"
            disabled={pending}
          />
          <TextareaField
            label="Allowed recipients (comma-separated, empty = from session)"
            value={form.allowedRecipients}
            onChange={(v) => patch("allowedRecipients", v)}
            placeholder="0x3333..."
            disabled={pending}
          />
          <ResultBanner result={result} onDismiss={() => setResult(null)} />
          <ActionButton label="Save policy" onClick={submit} pending={pending} variant="primary" />
        </div>
      ) : null}
    </div>
  );
}

// ─── Revoke Section ───────────────────────────────────────────────────────────

function RevokeSection({ onSuccess }: { onSuccess: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    setPending(true);
    setResult(null);
    setConfirming(false);
    try {
      const res = await fetch("/api/authority/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revocationReason: reason.trim() || "revoked_by_operator" }),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      if (data.ok) {
        setResult({ ok: true, message: "Authority revoked." });
        setReason("");
        onSuccess();
      } else {
        setResult({ ok: false, message: data.reason || "Revoke failed." });
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-2xl border border-[rgba(180,60,40,0.14)] bg-[rgba(180,60,40,0.03)] px-4 py-3"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9a4332]">
          Danger zone
        </p>
        <p className="mt-1 text-[12px] text-[#7a6e56]">
          Revocation is global and immediate. All subsequent buy/job execution will be denied until a new grant
          is issued.
        </p>
      </div>
      <TextareaField
        label="Revocation reason (optional)"
        value={reason}
        onChange={(v) => {
          setReason(v);
          setConfirming(false);
          setResult(null);
        }}
        placeholder="revoked_by_operator"
        disabled={pending}
      />
      <ResultBanner result={result} onDismiss={() => setResult(null)} />
      {!confirming ? (
        <ActionButton
          label="Revoke authority"
          onClick={() => setConfirming(true)}
          pending={false}
          variant="danger"
          disabled={pending}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-[#9a4332]">Confirm revocation?</span>
          <ActionButton label="Yes, revoke" onClick={submit} pending={pending} variant="danger" />
          <ActionButton
            label="Cancel"
            onClick={() => setConfirming(false)}
            pending={false}
            variant="ghost"
          />
        </div>
      )}
    </div>
  );
}

// ─── MCP Connection + Readiness ───────────────────────────────────────────────

type McpInfo = {
  name?: string;
  version?: string;
  endpoint?: string;
  transport?: string;
  toolNamePrefix?: string;
  auth?: { required?: boolean; scheme?: string };
};

type SessionStatus = {
  ok?: boolean;
  sessionId?: string;
  aaWallet?: string;
  owner?: string;
  status?: string;
};

type ReadinessCheck = {
  label: string;
  ok: boolean;
  detail?: string;
};

function ReadinessRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="flex items-start gap-3">
      {check.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#3a4220]" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
      )}
      <div>
        <p className="text-[12px] font-semibold" style={{ color: check.ok ? "#3a4220" : "#9a4332" }}>
          {check.label}
        </p>
        {check.detail ? (
          <p className="text-[11px] text-[#9e8e76]">{check.detail}</p>
        ) : null}
      </div>
    </div>
  );
}

function McpConnectionSection({
  mcpInfo,
  mcpLoading,
  session,
  policy,
}: {
  mcpInfo: McpInfo | null;
  mcpLoading: boolean;
  session: SessionStatus | null;
  policy: AuthorityPolicy | null;
}) {
  const mcpReachable = Boolean(mcpInfo?.endpoint);
  const sessionReady = Boolean(session?.ok && session?.aaWallet && session?.sessionId);
  const authorityActive = policy?.status === "active";

  const readinessChecks: ReadinessCheck[] = [
    {
      label: "MCP server reachable",
      ok: mcpReachable,
      detail: mcpReachable
        ? `${mcpInfo?.endpoint || ""} · ${mcpInfo?.transport || "streamable-http"}`
        : "Cannot reach /.well-known/mcp.json — check BACKEND_URL",
    },
    {
      label: "Session runtime ready",
      ok: sessionReady,
      detail: sessionReady
        ? `AA wallet ${shorten(session?.aaWallet || "", 8, 6)}`
        : "No AA wallet or session key — run ktrace auth session",
    },
    {
      label: "Authority policy active",
      ok: authorityActive,
      detail: authorityActive
        ? `Authority ${shorten(policy?.authorityId || "", 10, 6)}`
        : policy?.status === "revoked"
          ? "Authority is revoked — issue a new grant below"
          : "No active authority — use Update Authority Grant below",
    },
  ];

  const allReady = mcpReachable && sessionReady && authorityActive;

  return (
    <div className="flex flex-col gap-5">
      {/* Readiness signal */}
      <div
        className="flex items-center gap-3 rounded-2xl border px-4 py-3"
        style={
          allReady
            ? { borderColor: "rgba(58,66,32,0.2)", background: "rgba(58,66,32,0.06)" }
            : { borderColor: "rgba(138,96,32,0.2)", background: "rgba(138,96,32,0.04)" }
        }
      >
        <Zap
          className="size-4 shrink-0"
          style={{ color: allReady ? "#3a4220" : "#8a6020" }}
        />
        <p
          className="text-[12px] font-semibold"
          style={{ color: allReady ? "#3a4220" : "#8a6020" }}
        >
          {allReady
            ? "Paid MCP calls ready — session and authority are both active."
            : "Paid MCP calls are not yet ready — see checks below."}
        </p>
        {mcpLoading ? <RefreshCw className="ml-auto size-3.5 animate-spin text-[#9e8e76]" /> : null}
      </div>

      {/* Individual checks */}
      <div className="flex flex-col gap-3">
        {readinessChecks.map((check) => (
          <ReadinessRow key={check.label} check={check} />
        ))}
      </div>

      {/* MCP endpoint info */}
      {mcpInfo ? (
        <div className="grid gap-3 md:grid-cols-2">
          {mcpInfo.endpoint ? (
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                MCP endpoint
              </p>
              <a
                href={mcpInfo.endpoint}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 flex items-center gap-1 break-all text-[12px] text-[#2f351a] hover:text-[#3a4220]"
                style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
              >
                {mcpInfo.endpoint}
                <ExternalLink className="ml-0.5 size-3 shrink-0 opacity-50" />
              </a>
            </div>
          ) : null}
          {mcpInfo.toolNamePrefix ? (
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                Tool name prefix
              </p>
              <p
                className="mt-1.5 text-[12px] text-[#2f351a]"
                style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
              >
                {mcpInfo.toolNamePrefix}
              </p>
            </div>
          ) : null}
          {mcpInfo.transport ? (
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                Transport
              </p>
              <p className="mt-1.5 text-[12px] text-[#2f351a]">{mcpInfo.transport}</p>
            </div>
          ) : null}
          {mcpInfo.auth !== undefined ? (
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                Auth
              </p>
              <p className="mt-1.5 text-[12px] text-[#2f351a]">
                {mcpInfo.auth?.required ? `Required · ${mcpInfo.auth.scheme || "bearer"}` : "Open"}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Auth role table */}
      <div className="overflow-hidden rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1]">
        <div className="border-b border-[rgba(90,80,50,0.08)] px-4 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Auth requirements</p>
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-[rgba(90,80,50,0.07)]">
              <th className="px-4 py-2 text-left font-semibold text-[#9e8e76]">Operation</th>
              <th className="px-4 py-2 text-left font-semibold text-[#9e8e76]">Minimum role</th>
              <th className="px-4 py-2 text-left font-semibold text-[#9e8e76]">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[rgba(90,80,50,0.05)]">
              <td className="px-4 py-2.5 font-medium text-[#2f351a]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                tools/list
              </td>
              <td className="px-4 py-2.5">
                <span className="rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.06)] px-2.5 py-0.5 font-medium text-[#3a4220]">
                  viewer
                </span>
              </td>
              <td className="px-4 py-2.5 text-[#9e8e76]">Discover available ktrace__ tools</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-[#2f351a]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                tools/call
              </td>
              <td className="px-4 py-2.5">
                <span className="rounded-full border border-[rgba(138,96,32,0.2)] bg-[rgba(138,96,32,0.06)] px-2.5 py-0.5 font-medium text-[#8a6020]">
                  agent
                </span>
              </td>
              <td className="px-4 py-2.5 text-[#9e8e76]">Execute tools — paid calls also need session + authority</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Discovery link */}
      <div className="flex items-center justify-between rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
        <div>
          <p className="text-[12px] font-medium text-[#3a4220]">Discovery document</p>
          <p className="text-[11px] text-[#9e8e76]">
            Consumer agents start here: <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>GET /.well-known/mcp.json</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/mcp"
            className="inline-flex items-center gap-2 rounded-full border border-[rgba(90,80,50,0.18)] bg-transparent px-4 py-2 text-[11px] font-medium text-[#5a4e3a] transition hover:bg-[rgba(90,80,50,0.06)]"
          >
            Onboarding guide
          </a>
          <a
            href="/api/authority/mcp-info"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 py-2 text-[11px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)]"
          >
            View JSON
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function AuthorityPanelClient() {
  const [policy, setPolicy] = useState<AuthorityPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [session, setSession] = useState<SessionStatus | null>(null);

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/authority/policy", { cache: "no-store" });
      const data = (await res.json()) as PolicyResponse;
      if (data.ok && data.authority) {
        setPolicy(data.authority);
      } else {
        setFetchError(data.reason || data.error || "Failed to load policy.");
        setPolicy(null);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load policy.");
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMcpAndSession = useCallback(async () => {
    setMcpLoading(true);
    try {
      const [mcpRes, sessionRes] = await Promise.all([
        fetch("/api/authority/mcp-info", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/authority/session-status", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setMcpInfo((mcpRes as McpInfo & { ok?: boolean })?.endpoint ? (mcpRes as McpInfo) : null);
      setSession(sessionRes as SessionStatus);
    } catch {
      setMcpInfo(null);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicy();
    fetchMcpAndSession();
  }, [fetchPolicy, fetchMcpAndSession]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(168,136,28,0.08),transparent_28%),linear-gradient(180deg,#faf7f1_0%,#f6efe3_100%)] px-4 py-12 text-[#18180e]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">

        {/* Header */}
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
            <ShieldCheck className="size-3" />
            Consumer Authority
          </span>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-[2.2rem] font-normal leading-tight tracking-tight text-[#18180e]">
                <em className="not-italic text-[#3a4220]">Authority</em> Control Plane
              </h1>
              <p className="mt-1 text-[14px] text-[#7a6e56]">
                Inspect, update, validate, and revoke the active consumer execution authority.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { fetchPolicy(); fetchMcpAndSession(); }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 py-2 text-[11px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)] disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </header>

        {/* MCP Connection + Readiness */}
        <Section
          title="Consumer MCP Connection"
          subtitle="Paid MCP calls require session runtime readiness and an active authority policy. ERC-8004 is not required."
        >
          <McpConnectionSection
            mcpInfo={mcpInfo}
            mcpLoading={mcpLoading}
            session={session}
            policy={policy}
          />
        </Section>

        {/* Loading skeleton */}
        {loading && !policy ? (
          <div className="flex items-center gap-3 rounded-[28px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-6 py-5">
            <RefreshCw className="size-4 animate-spin text-[#9e8e76]" />
            <span className="text-[13px] text-[#7a6e56]">Loading authority policy…</span>
          </div>
        ) : null}

        {/* Fetch error */}
        {fetchError && !policy ? (
          <div className="flex items-start gap-3 rounded-[28px] border border-[rgba(180,60,40,0.18)] bg-[rgba(180,60,40,0.04)] px-6 py-5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
            <div>
              <p className="text-[13px] font-semibold text-[#9a4332]">Unable to load authority policy</p>
              <p className="mt-1 text-[12px] text-[#7a6e56]">{fetchError}</p>
              <button
                type="button"
                onClick={fetchPolicy}
                className="mt-3 text-[11px] font-medium text-[#3a4220] underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {/* Active Policy */}
        {policy ? (
          <Section
            title="Active Policy"
            subtitle={`Authority ${shorten(policy.authorityId, 12, 6)} — ${policy.status}`}
          >
            <PolicyInspection policy={policy} />
          </Section>
        ) : null}

        {/* Pre-execution Validation */}
        <Section
          title="Pre-execution Validation"
          subtitle="Test whether a proposed action is allowed under the active authority before submitting."
        >
          <ValidationTester />
        </Section>

        {/* Update Grant */}
        <Section
          title="Update Authority Grant"
          subtitle="Modify allowed capabilities, providers, recipients, and spend limits."
        >
          <SetPolicyForm onSuccess={fetchPolicy} />
        </Section>

        {/* Revoke */}
        <Section
          title="Revoke Authority"
          subtitle="Immediately revoke the active grant. All subsequent execution will be denied."
        >
          <RevokeSection onSuccess={fetchPolicy} />
        </Section>

      </div>
    </main>
  );
}
