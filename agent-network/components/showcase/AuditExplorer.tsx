"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { JobAudit } from "@/components/jobs/JobAuditView";

// ── Config ────────────────────────────────────────────────────────────────────

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://kiteclaw.duckdns.org"
).replace(/\/+$/, "");

const DEMO_JOB_ID = process.env.NEXT_PUBLIC_DEMO_JOB_ID || "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function shorten(value = "", head = 8, tail = 6) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= head + tail + 2) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function fmt(value?: string | number) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function fetchAudit(jobId: string): Promise<JobAudit | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/public/jobs/${encodeURIComponent(jobId.trim())}/audit`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as { ok?: boolean; audit?: JobAudit };
    if (!payload?.ok || !payload.audit) return null;
    return payload.audit;
  } catch {
    return null;
  }
}

// ── State chip ────────────────────────────────────────────────────────────────

function StateChip({ value }: { value: string }) {
  const s = String(value || "").toLowerCase();
  const ok = s === "completed";
  const bad = ["rejected", "expired", "failed", "approval_rejected", "approval_expired"].includes(s);
  const amber = !ok && !bad;
  const style = ok
    ? { borderColor: "rgba(58,66,32,0.22)", background: "rgba(58,66,32,0.09)", color: "#3a4220" }
    : bad
      ? { borderColor: "rgba(180,60,40,0.22)", background: "rgba(180,60,40,0.06)", color: "#9a4332" }
      : amber
        ? { borderColor: "rgba(138,96,32,0.22)", background: "rgba(138,96,32,0.08)", color: "#8a6020" }
        : { borderColor: "rgba(90,80,50,0.16)", background: "#f7f2ea", color: "#7a6e56" };
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em]"
      style={style}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

// ── Delivery badge row ────────────────────────────────────────────────────────

function DeliveryBadge({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
      style={
        ok
          ? { borderColor: "rgba(58,66,32,0.18)", background: "rgba(58,66,32,0.06)", color: "#3a4220" }
          : { borderColor: "rgba(90,80,50,0.14)", background: "#faf7f1", color: "#9e8e76" }
      }
    >
      {ok ? <CheckCircle2 className="size-3 shrink-0" /> : <XCircle className="size-3 shrink-0 opacity-50" />}
      {label}
    </span>
  );
}

// ── Mini timeline ─────────────────────────────────────────────────────────────

function MiniTimeline({ steps }: { steps: JobAudit["lifecycle"] }) {
  const rows = (steps || []).slice(0, 6);
  return (
    <div className="flex flex-col gap-0">
      {rows.map((step, i) => {
        const isLast = i === rows.length - 1;
        const done = step.status === "completed";
        const active = step.status === "current";
        return (
          <div key={step.key || i} className="flex items-start gap-2.5">
            {/* dot + line */}
            <div className="flex flex-col items-center pt-0.5">
              <div
                className="flex size-5 items-center justify-center rounded-full border"
                style={
                  done
                    ? { background: "#3a4220", borderColor: "#3a4220" }
                    : active
                      ? { background: "rgba(138,96,32,0.08)", borderColor: "#8a6020" }
                      : { background: "#faf7f1", borderColor: "rgba(90,80,50,0.18)" }
                }
              >
                {done ? (
                  <CheckCircle2 className="size-2.5 text-[#faf7f1]" />
                ) : active ? (
                  <Clock3 className="size-2.5 text-[#8a6020]" />
                ) : (
                  <span className="size-1.5 rounded-full bg-[#c8b99a]" />
                )}
              </div>
              {!isLast && (
                <div
                  className="w-px flex-1"
                  style={{
                    minHeight: "1.4rem",
                    background: done ? "rgba(58,66,32,0.16)" : "rgba(90,80,50,0.07)",
                  }}
                />
              )}
            </div>
            {/* label */}
            <div className={`flex-1 ${isLast ? "pb-0" : "pb-2"}`}>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[12px] font-medium"
                  style={{ color: done ? "#2f351a" : active ? "#5a4e1e" : "#9e8e76" }}
                >
                  {step.label}
                </span>
                {step.at && done ? (
                  <span className="text-[10px] text-[#b0a08a]">{fmt(step.at)}</span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[72, 48, 56].map((h, i) => (
        <div
          key={i}
          className="rounded-2xl bg-[rgba(90,80,50,0.07)]"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

// ── Teaser card (idle state) ──────────────────────────────────────────────────

function TeaserCard({ onTryDemo }: { onTryDemo: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="overflow-hidden rounded-[20px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0]"
    >
      {/* mock header bar */}
      <div className="border-b border-[rgba(90,80,50,0.08)] px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3a4220]"
          >
            <ShieldCheck className="size-3" />
            KTRACE Audit
          </span>
          <span className="text-[11px] text-[#9e8e76]">— paste a Job ID above to inspect</span>
        </div>
      </div>

      {/* blurred mock content */}
      <div className="select-none p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          {/* left: fake timeline */}
          <div className="flex flex-col gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">
              Lifecycle Timeline
            </p>
            <div className="blur-[3px] opacity-60">
              {["Created", "Funded", "Accepted", "Submitted", "Validated", "Completed"].map(
                (label, i, arr) => (
                  <div key={label} className="flex items-start gap-2.5">
                    <div className="flex flex-col items-center pt-0.5">
                      <div
                        className="flex size-5 items-center justify-center rounded-full border"
                        style={
                          i < 4
                            ? { background: "#3a4220", borderColor: "#3a4220" }
                            : i === 4
                              ? { background: "rgba(138,96,32,0.08)", borderColor: "#8a6020" }
                              : { background: "#faf7f1", borderColor: "rgba(90,80,50,0.18)" }
                        }
                      >
                        {i < 4 ? (
                          <CheckCircle2 className="size-2.5 text-[#faf7f1]" />
                        ) : i === 4 ? (
                          <Clock3 className="size-2.5 text-[#8a6020]" />
                        ) : (
                          <span className="size-1.5 rounded-full bg-[#c8b99a]" />
                        )}
                      </div>
                      {i < arr.length - 1 && (
                        <div
                          className="w-px"
                          style={{
                            height: "1.4rem",
                            background: i < 4 ? "rgba(58,66,32,0.16)" : "rgba(90,80,50,0.07)",
                          }}
                        />
                      )}
                    </div>
                    <div className="flex-1 pb-2">
                      <span
                        className="text-[12px] font-medium"
                        style={{ color: i < 4 ? "#2f351a" : i === 4 ? "#5a4e1e" : "#9e8e76" }}
                      >
                        {label}
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* right: fake summary */}
          <div className="flex flex-col gap-3 blur-[3px] opacity-60">
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Budget</p>
              <p className="mt-1 text-[14px] font-semibold text-[#3a4220]" style={{ fontFamily: "monospace" }}>
                25.00 USDT
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76] mb-2">
                Delivery Standard
              </p>
              <div className="flex flex-wrap gap-1.5">
                <DeliveryBadge ok={true} label="Validator approved" />
                <DeliveryBadge ok={true} label="Result hash" />
                <DeliveryBadge ok={false} label="Anchored" />
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        {DEMO_JOB_ID ? (
          <div className="mt-5 flex items-center gap-3 border-t border-[rgba(90,80,50,0.08)] pt-4">
            <p className="text-[12px] text-[#9e8e76]">Try with a live demo job:</p>
            <button
              type="button"
              onClick={onTryDemo}
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.07)] px-3.5 py-1.5 text-[12px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.12)]"
            >
              <Search className="size-3" />
              Try demo job
            </button>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ audit }: { audit: JobAudit }) {
  const s = audit.summary;
  const d = audit.deliveryStandard || {};
  const auditUrl = `${BACKEND_URL}/api/public/jobs/${encodeURIComponent(audit.jobId)}/audit`;
  const pageUrl = `/jobs/${encodeURIComponent(audit.jobId)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38 }}
      className="overflow-hidden rounded-[20px] border border-[rgba(58,66,32,0.2)] bg-[#f2ebe0] shadow-[0_8px_32px_rgba(58,66,32,0.08)]"
    >
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(90,80,50,0.08)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3a4220]"
          >
            <ShieldCheck className="size-3" />
            {s.capability || "Job Audit"}
          </span>
          <StateChip value={s.state || "unknown"} />
          {s.provider ? (
            <span className="text-[12px] text-[#9e8e76]">via {s.provider}</span>
          ) : null}
        </div>
        <span
          className="text-[11px] text-[#9e8e76]"
          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
        >
          {shorten(audit.jobId, 10, 8)}
        </span>
      </div>

      {/* body */}
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_260px]">
        {/* left: lifecycle */}
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">
            Lifecycle Timeline
          </p>
          <MiniTimeline steps={audit.lifecycle} />
        </div>

        {/* right: summary + delivery */}
        <div className="flex flex-col gap-3">
          {/* budget */}
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Budget</p>
            <p
              className="mt-1 text-[14px] font-semibold text-[#3a4220]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              {s.budget || "-"}
              {s.escrowAmount && s.escrowAmount !== s.budget ? (
                <span className="ml-2 text-[11px] font-normal text-[#9e8e76]">
                  escrow {s.escrowAmount}
                </span>
              ) : null}
            </p>
          </div>

          {/* delivery standard */}
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
              Delivery Standard
            </p>
            <div className="flex flex-wrap gap-1.5">
              <DeliveryBadge ok={d.validatorApproved} label="Validator" />
              <DeliveryBadge ok={d.resultHashSubmitted} label="Result hash" />
              <DeliveryBadge ok={d.outcomeAnchored} label="Anchored" />
              <DeliveryBadge ok={d.satisfied} label="Satisfied" />
            </div>
          </div>

          {/* human approval if present */}
          {audit.humanApproval?.approvalId ? (
            <div className="rounded-2xl border border-[rgba(138,96,32,0.18)] bg-[rgba(138,96,32,0.04)] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8a6020]">
                Human Approval
              </p>
              <StateChip value={audit.humanApproval.approvalState || "pending"} />
              {audit.humanApproval.approvalDecidedBy ? (
                <p
                  className="mt-2 truncate text-[11px] text-[#7a6e56]"
                  style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                >
                  by {shorten(audit.humanApproval.approvalDecidedBy, 8, 4)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(90,80,50,0.08)] px-5 py-3.5">
        <p className="text-[11px] text-[#9e8e76]">
          Escrow ·{" "}
          <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
            {shorten(s.escrowAddress, 6, 4)}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <a
            href={auditUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[rgba(90,80,50,0.16)] bg-transparent px-3 py-1.5 text-[11px] text-[#7a6e56] transition hover:bg-[rgba(90,80,50,0.06)]"
          >
            Raw JSON
            <ExternalLink className="size-3 opacity-60" />
          </a>
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.07)] px-3 py-1.5 text-[11px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.12)]"
          >
            Full audit page
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type UIState = "idle" | "loading" | "success" | "error";

export default function AuditExplorer() {
  const [input, setInput] = useState("");
  const [uiState, setUiState] = useState<UIState>("idle");
  const [audit, setAudit] = useState<JobAudit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // read ?jobId= or #audit-explorer?jobId= from URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("jobId") || params.get("job");
    if (jobId) {
      setInput(jobId);
      void run(jobId);
      // scroll to section
      setTimeout(() => {
        document.getElementById("audit-explorer")?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(jobId: string) {
    const id = (jobId || input).trim();
    if (!id) return;
    setUiState("loading");
    setAudit(null);
    const result = await fetchAudit(id);
    if (result) {
      setAudit(result);
      setUiState("success");
    } else {
      setUiState("error");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void run(input);
  }

  function tryDemo() {
    if (!DEMO_JOB_ID) return;
    setInput(DEMO_JOB_ID);
    void run(DEMO_JOB_ID);
    inputRef.current?.focus();
  }

  return (
    <section id="audit-explorer" className="bg-[#faf7f1] px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">

        {/* heading block */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
          className="mb-10 flex flex-col gap-3"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#3a4220]">
            Audit Explorer
          </span>
          <h2 className="font-display text-[2.4rem] font-normal leading-tight tracking-tight text-[#18180e]">
            Inspect any job,{" "}
            <em className="not-italic text-[#3a4220]">live.</em>
          </h2>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
            Paste a Job ID to see its full lifecycle, delivery standard, and on-chain evidence — no
            login, no wallet. Every field is independently verifiable.
          </p>
        </motion.div>

        {/* search row */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.42, delay: 0.08, ease: "easeOut" }}
          className="mb-6 flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#b0a08a]" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="job-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              spellCheck={false}
              autoComplete="off"
              className="h-11 w-full rounded-2xl border border-[rgba(90,80,50,0.18)] bg-[#f2ebe0] pl-9 pr-4 text-[13px] text-[#18180e] outline-none placeholder:text-[#c8b99a] focus:border-[rgba(58,66,32,0.4)] focus:ring-2 focus:ring-[rgba(58,66,32,0.08)] transition"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || uiState === "loading"}
            className="h-11 rounded-2xl bg-[#3a4220] px-5 text-[13px] font-semibold text-[#faf7f1] transition hover:bg-[#2d3319] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uiState === "loading" ? "Fetching…" : "Inspect"}
          </button>
        </motion.form>

        {/* result area */}
        <AnimatePresence mode="wait">
          {uiState === "loading" && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Skeleton />
            </motion.div>
          )}

          {uiState === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-start gap-3 rounded-2xl border border-[rgba(180,60,40,0.2)] bg-[rgba(180,60,40,0.04)] px-5 py-4"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
              <div>
                <p className="text-[13px] font-medium text-[#9a4332]">Job not found</p>
                <p className="mt-0.5 text-[12px] text-[#b07060]">
                  Double-check the Job ID, or the job may not yet be indexed. Raw JSON is always
                  available at{" "}
                  <code
                    className="text-[11px]"
                    style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                  >
                    {BACKEND_URL}/api/public/jobs/&#123;jobId&#125;/audit
                  </code>
                  .
                </p>
              </div>
            </motion.div>
          )}

          {uiState === "success" && audit && (
            <motion.div
              key="result"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ResultCard audit={audit} />
            </motion.div>
          )}

          {uiState === "idle" && (
            <motion.div
              key="teaser"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <TeaserCard onTryDemo={tryDemo} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="mt-7 text-center text-[12px] text-[#b0a08a]"
        >
          Public endpoint ·{" "}
          <code
            className="rounded bg-[rgba(90,80,50,0.07)] px-1.5 py-0.5 text-[11px] text-[#7a6e56]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            GET /api/public/jobs/:jobId/audit
          </code>{" "}
          · No auth required
        </motion.p>
      </div>
    </section>
  );
}
