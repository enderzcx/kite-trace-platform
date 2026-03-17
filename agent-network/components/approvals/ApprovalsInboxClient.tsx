"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const DEFAULT_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:3399";
const ADMIN_KEY_STORAGE_KEY = "ktrace.approvals.adminKey";

/* ── Types ───────────────────────────────────────────────────── */

type ApprovalItem = {
  approvalId: string;
  approvalRequestId?: string;
  approvalKind: "session" | "job";
  state: string;
  jobId?: string;
  traceId?: string;
  capability?: string;
  budget?: string;
  requestedByOwnerEoa?: string;
  requestedByAaWallet?: string;
  reasonCode?: string;
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  approvalUrl?: string;
};

type ListResponse = {
  ok?: boolean;
  items?: ApprovalItem[];
  reason?: string;
};

/* ── Utilities ───────────────────────────────────────────────── */

function shorten(v: string, head = 8, tail = 6): string {
  const t = String(v || "").trim();
  if (!t) return "—";
  if (t.length <= head + tail + 2) return t;
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

function fmtTime(v: string | number | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Small primitives ────────────────────────────────────────── */

function StateChip({ state }: { state: string }) {
  const s = state.toLowerCase();
  const ok = ["approved", "completed"].includes(s);
  const err = ["rejected", "approval_rejected", "expired", "approval_expired"].includes(s);
  const mid = s === "pending" || s === "pending_approval";

  const style = ok
    ? { border: "rgba(58,66,32,0.22)", bg: "rgba(58,66,32,0.08)", text: "#3a4220" }
    : err
      ? { border: "rgba(180,60,40,0.22)", bg: "rgba(180,60,40,0.06)", text: "#9a4332" }
      : mid
        ? { border: "rgba(138,96,32,0.22)", bg: "rgba(138,96,32,0.06)", text: "#8a6020" }
        : { border: "rgba(90,80,50,0.14)", bg: "#f2ebe0", text: "#7a6e56" };

  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
      style={{ borderColor: style.border, background: style.bg, color: style.text }}
    >
      {state.replace(/_/g, "\u00a0")}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      className="inline-flex items-center rounded border border-[rgba(90,80,50,0.12)] bg-[#faf7f1] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#9e8e76]"
    >
      {kind}
    </span>
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
      className="inline-flex items-center gap-1.5 rounded-full bg-[#3a4220] px-4 py-2 text-[12px] font-semibold text-[#faf7f1] transition hover:bg-[#4a5a28] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostBtn({
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
      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 py-2 text-[12px] font-semibold text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/* ── State icon ──────────────────────────────────────────────── */
function StateIcon({ state }: { state: string }) {
  const s = state.toLowerCase();
  if (["approved", "completed"].includes(s)) return <CheckCircle2 className="size-4 text-[#3a4220]" />;
  if (["rejected", "approval_rejected", "expired", "approval_expired"].includes(s)) return <XCircle className="size-4 text-[#9a4332]" />;
  if (s === "pending" || s === "pending_approval") return <Clock className="size-4 text-[#8a6020]" />;
  return <AlertCircle className="size-4 text-[#9e8e76]" />;
}

/* ── Row component ───────────────────────────────────────────── */
function ApprovalRow({ item }: { item: ApprovalItem }) {
  const id = item.approvalId || item.approvalRequestId || "";
  const approvalUrl = item.approvalUrl || `/approval/${id}`;
  const isPending = ["pending", "pending_approval"].includes(item.state.toLowerCase());

  return (
    <div className="flex items-start gap-4 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[#f2ebe0] px-5 py-4 transition hover:border-[rgba(90,80,50,0.22)]">
      <div className="mt-0.5 shrink-0">
        <StateIcon state={item.state} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[12.5px] font-semibold text-[#2f351a]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {shorten(id)}
          </span>
          <StateChip state={item.state} />
          <KindBadge kind={item.approvalKind} />
          {item.reasonCode ? (
            <span className="text-[11px] text-[#9e8e76]">{item.reasonCode.replace(/_/g, " ")}</span>
          ) : null}
        </div>

        <div
          className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#7a6e56]"
          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
        >
          {item.jobId ? (
            <span><span className="text-[#9e8e76]">job </span>{shorten(item.jobId)}</span>
          ) : null}
          {item.capability ? (
            <span><span className="text-[#9e8e76]">cap </span>{item.capability}</span>
          ) : null}
          {item.budget ? (
            <span><span className="text-[#9e8e76]">budget </span>{item.budget}</span>
          ) : null}
          {item.requestedByOwnerEoa ? (
            <span><span className="text-[#9e8e76]">eoa </span>{shorten(item.requestedByOwnerEoa)}</span>
          ) : null}
          <span><span className="text-[#9e8e76]">created </span>{fmtTime(item.createdAt)}</span>
          {item.expiresAt ? (
            <span><span className="text-[#9e8e76]">expires </span>{fmtTime(item.expiresAt)}</span>
          ) : null}
          {item.decidedAt ? (
            <span><span className="text-[#9e8e76]">decided </span>{fmtTime(item.decidedAt)}</span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isPending ? (
          <a
            href={approvalUrl}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#3a4220] px-4 py-2 text-[12px] font-semibold text-[#faf7f1] transition hover:bg-[#4a5a28]"
          >
            Review
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <a
            href={approvalUrl}
            className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 py-2 text-[12px] font-semibold text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)]"
          >
            View
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────── */
export default function ApprovalsInboxClient() {
  const [adminKey, setAdminKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const backendUrl =
    (typeof window !== "undefined"
      ? (window as Window & { __BACKEND_URL__?: string }).__BACKEND_URL__
      : undefined) || DEFAULT_BACKEND_URL;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedKey = window.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) || "";
    if (storedKey) {
      setAdminKey(storedKey);
      setKeyInput(storedKey);
    }
  }, []);

  const fetchApprovals = useCallback(
    async (key: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (filter !== "all") params.set("state", filter);
        params.set("limit", "100");
        const res = await fetch(
          `${backendUrl}/api/approvals?${params.toString()}`,
          {
            headers: {
              Accept: "application/json",
              "X-Admin-Key": key,
            },
            cache: "no-store",
          }
        );
        const payload = (await res.json()) as ListResponse;
        if (!res.ok || payload?.ok === false) {
          throw new Error(String(payload?.reason || "Failed to fetch approvals."));
        }
        setItems(payload.items || []);
        setLastFetched(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch approvals.");
      } finally {
        setLoading(false);
      }
    },
    [backendUrl, filter]
  );

  // Re-fetch when filter changes and we already have a key
  useEffect(() => {
    if (adminKey) void fetchApprovals(adminKey);
  }, [adminKey, fetchApprovals]);

  function handleKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, key);
    }
    setAdminKey(key);
  }

  const pendingCount = items.filter((i) =>
    ["pending", "pending_approval"].includes(i.state.toLowerCase())
  ).length;

  const filteredItems =
    filter === "all"
      ? items
      : filter === "pending"
        ? items.filter((i) => ["pending", "pending_approval"].includes(i.state.toLowerCase()))
        : filter === "approved"
          ? items.filter((i) => ["approved", "completed"].includes(i.state.toLowerCase()))
          : items.filter((i) =>
            ["rejected", "approval_rejected", "expired", "approval_expired"].includes(i.state.toLowerCase())
          );

  /* ── Key gate ── */
  if (!adminKey) {
    return (
      <main className="min-h-screen bg-[#faf7f1] px-4 py-12 text-[#18180e]">
        <div className="mx-auto flex max-w-md flex-col gap-8">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
              <ShieldCheck className="size-3" />
              ktrace · Approvals Inbox
            </span>
            <h1 className="font-display text-[2.2rem] font-normal leading-tight text-[#18180e]">
              Operator <em className="not-italic text-[#3a4220]">access</em>
            </h1>
            <p className="text-[13px] leading-relaxed text-[#7a6e56]">
              This page requires an admin key. Enter your <code
                className="rounded bg-[#f2ebe0] px-1.5 py-0.5 text-[12px]"
                style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
              >KTRACE_ADMIN_KEY</code> to continue.
            </p>
          </div>

          <form onSubmit={handleKeySubmit} className="flex flex-col gap-3">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Admin key…"
              autoFocus
              className="w-full rounded-xl border border-[rgba(90,80,50,0.2)] bg-[#f2ebe0] px-4 py-3 text-[13px] text-[#2f351a] outline-none placeholder:text-[#c4b89e] focus:border-[rgba(58,66,32,0.4)]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            />
            <OliveBtn onClick={() => handleKeySubmit({ preventDefault: () => {} } as React.FormEvent)}>
              <ShieldCheck className="size-3.5" />
              Enter Inbox
            </OliveBtn>
          </form>

          {error ? (
            <div className="flex items-start gap-3 rounded-xl border border-[rgba(180,60,40,0.22)] bg-[rgba(180,60,40,0.06)] px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
              <p className="text-[12px] text-[#9a4332]">{error}</p>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  /* ── Inbox ── */
  return (
    <main className="min-h-screen bg-[#faf7f1] px-4 py-12 text-[#18180e]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
              <ShieldCheck className="size-3" />
              ktrace · Approvals Inbox
            </span>
            <h1 className="font-display text-[2.2rem] font-normal leading-tight text-[#18180e]">
              {pendingCount > 0 ? (
                <>
                  <em className="not-italic text-[#8a6020]">{pendingCount} pending</em>{" "}
                  approval{pendingCount !== 1 ? "s" : ""}
                </>
              ) : (
                <>All <em className="not-italic text-[#3a4220]">approvals</em></>
              )}
            </h1>
            {lastFetched ? (
              <p className="text-[11px] text-[#9e8e76]">
                Last fetched {lastFetched.toLocaleTimeString()}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <GhostBtn onClick={() => void fetchApprovals(adminKey)} disabled={loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </GhostBtn>
            <GhostBtn onClick={() => {
              if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
              }
              setAdminKey("");
              setKeyInput("");
              setItems([]);
              setError("");
            }}>
              Lock
            </GhostBtn>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[#f2ebe0] p-1">
          {(["all", "pending", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="flex-1 rounded-xl px-3 py-2 text-[12px] font-semibold capitalize transition"
              style={
                filter === f
                  ? { background: "#faf7f1", color: "#2f351a", boxShadow: "0 1px 3px rgba(90,80,50,0.12)" }
                  : { background: "transparent", color: "#9e8e76" }
              }
            >
              {f}
            </button>
          ))}
        </div>

        {/* Error */}
        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-[rgba(180,60,40,0.22)] bg-[rgba(180,60,40,0.06)] px-4 py-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
            <p className="text-[12px] text-[#9a4332]">{error}</p>
          </div>
        ) : null}

        {/* Loading skeleton */}
        {loading && items.length === 0 ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl border border-[rgba(90,80,50,0.08)] bg-[#f2ebe0]"
              />
            ))}
          </div>
        ) : null}

        {/* Empty state */}
        {!loading && filteredItems.length === 0 && !error ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[#f2ebe0] px-6 py-12 text-center">
            <CheckCircle2 className="size-8 text-[#3a4220] opacity-30" />
            <p className="text-[13px] font-medium text-[#7a6e56]">
              {filter === "pending" ? "No pending approvals." : "No approvals found."}
            </p>
          </div>
        ) : null}

        {/* List */}
        {filteredItems.length > 0 ? (
          <div className="flex flex-col gap-3">
            {filteredItems.map((item) => (
              <ApprovalRow key={item.approvalId || item.approvalRequestId} item={item} />
            ))}
          </div>
        ) : null}

      </div>
    </main>
  );
}
