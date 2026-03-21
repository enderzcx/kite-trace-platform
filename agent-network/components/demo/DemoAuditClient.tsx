"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Clock, ExternalLink, XCircle } from "lucide-react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
const JOB_ID = process.env.NEXT_PUBLIC_DEMO_JOB_ID ?? "";

const STATE_ORDER = ["created", "funded", "accepted", "submitted", "completed"];

interface RoleEnforcement {
  executionMode?: string;
  roleRuntimeSummary?: Record<string, string>;
}

interface AuditData {
  summary?: { state?: string; jobId?: string };
  lifecycle?: Array<{ state: string; timestamp: string }>;
  deliveryStandard?: { schema?: string; conformant?: boolean };
  delivery?: {
    marketSnapshot?: { price?: number; volume24h?: number; priceSource?: string };
    tradingPlan?: {
      bias?: string;
      entry?: { price?: number; zone?: number[] };
      takeProfit?: Array<{ target?: number; price?: number; rationale?: string }>;
      stopLoss?: { price?: number; rationale?: string };
      riskRewardRatio?: number;
    };
    analysis?: { summary?: string; keyLevels?: string[]; sentiment?: string };
  };
  evidence?: {
    primaryTraceId?: string;
    paymentRequestId?: string;
    receiptRefs?: string[];
    primaryEvidenceRef?: string;
  };
  // AA-native fields
  requester?: string;
  executor?: string;
  validator?: string;
  contractPrimitives?: {
    escrowAmount?: string;
    roleEnforcement?: RoleEnforcement;
  };
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

function AddrRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-xs">
      <span className="text-[#9e8e76]">{label}: </span>
      <span className="font-mono break-all">{value}</span>
    </p>
  );
}

export default function DemoAuditClient() {
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [error, setError] = useState<string | null>(JOB_ID ? null : "not_seeded");

  useEffect(() => {
    if (!JOB_ID) return;
    fetch(`${BACKEND}/api/public/jobs/${JOB_ID}/audit`)
      .then((r) => {
        if (r.status === 404) throw new Error("not_seeded");
        if (!r.ok) throw new Error("fetch_error");
        return r.json();
      })
      .then((j) => setAudit(j.audit ?? j))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error === "not_seeded") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[#9e8e76] text-sm">
        Demo job not seeded yet.
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-red-500 text-sm">
        Failed to load audit: {error}
      </div>
    );
  }
  if (!audit) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[#9e8e76] text-sm animate-pulse">
        Loading audit…
      </div>
    );
  }

  const state = audit.summary?.state ?? "";
  const conformant = audit.deliveryStandard?.conformant;
  const snap = audit.delivery?.marketSnapshot;
  const plan = audit.delivery?.tradingPlan;
  const analysis = audit.delivery?.analysis;
  const evidence = audit.evidence;
  const roleEnforcement = audit.contractPrimitives?.roleEnforcement;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-[#18180e]">

      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#3a4220] text-[10px] font-bold text-[#faf7f1]">KT</span>
        <h1 className="text-xl font-semibold">BTC Trading Plan — Live Audit</h1>
        <span className={`ml-auto rounded-full px-3 py-0.5 text-xs font-semibold ${state === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {state}
        </span>
      </div>

      {/* Lifecycle timeline */}
      <section className="rounded-xl border border-[rgba(90,80,50,0.12)] bg-white p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9e8e76]">Lifecycle</p>
        <ol className="flex flex-wrap gap-x-1 gap-y-2">
          {STATE_ORDER.map((s, i) => {
            const entry = audit.lifecycle?.find((l) => l.state === s);
            const done = !!entry;
            return (
              <li key={s} className="flex items-center gap-1 text-xs">
                {done
                  ? <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  : <Clock className="h-3.5 w-3.5 shrink-0 text-[#c8bfb0]" />}
                <span className={done ? "text-[#18180e]" : "text-[#c8bfb0]"}>{s}</span>
                {entry && <span className="text-[#9e8e76]">· {fmt(entry.timestamp)}</span>}
                {i < STATE_ORDER.length - 1 && <span className="text-[#c8bfb0] mx-1">→</span>}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Delivery schema badge */}
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.06)] px-3 py-1 text-xs font-mono text-[#3a4220]">
          {audit.deliveryStandard?.schema ?? "—"}
        </span>
        {conformant === true && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle className="h-3.5 w-3.5" /> conformant</span>}
        {conformant === false && <span className="flex items-center gap-1 text-xs text-red-500"><XCircle className="h-3.5 w-3.5" /> non-conformant</span>}
        {roleEnforcement?.executionMode && (
          <span className="rounded-full border border-[rgba(58,66,32,0.15)] px-2.5 py-0.5 text-xs font-mono text-[#7a6e56]">
            {roleEnforcement.executionMode}
          </span>
        )}
      </div>

      {/* Market snapshot */}
      {snap && (
        <section className="rounded-xl border border-[rgba(90,80,50,0.12)] bg-white p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9e8e76]">Market Snapshot</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-[#9e8e76] text-xs">Price</p><p className="font-semibold">${snap.price?.toLocaleString()}</p></div>
            <div><p className="text-[#9e8e76] text-xs">24h Volume</p><p className="font-semibold">${snap.volume24h?.toLocaleString()}</p></div>
            <div><p className="text-[#9e8e76] text-xs">Source</p><p className="font-mono text-xs truncate">{snap.priceSource}</p></div>
          </div>
        </section>
      )}

      {/* Trading plan */}
      {plan && (
        <section className="rounded-xl border border-[rgba(90,80,50,0.12)] bg-white p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#9e8e76]">Trading Plan</p>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><p className="text-[#9e8e76] text-xs">Bias</p><p className="font-semibold capitalize">{plan.bias}</p></div>
            <div><p className="text-[#9e8e76] text-xs">Entry</p><p className="font-semibold">${plan.entry?.price?.toLocaleString()}</p></div>
            <div><p className="text-[#9e8e76] text-xs">Stop Loss</p><p className="font-semibold text-red-600">${plan.stopLoss?.price?.toLocaleString()}</p></div>
            <div><p className="text-[#9e8e76] text-xs">R/R</p><p className="font-semibold">{plan.riskRewardRatio}</p></div>
          </div>
          {plan.entry?.zone && (
            <p className="text-xs text-[#7a6e56]">Entry zone: ${plan.entry.zone[0]?.toLocaleString()} – ${plan.entry.zone[1]?.toLocaleString()}</p>
          )}
          {plan.takeProfit && plan.takeProfit.length > 0 && (
            <div>
              <p className="text-xs text-[#9e8e76] mb-1">Take Profit</p>
              <ul className="space-y-1">
                {plan.takeProfit.map((tp) => (
                  <li key={tp.target} className="text-xs">
                    <span className="font-semibold text-emerald-600">TP{tp.target} ${tp.price?.toLocaleString()}</span>
                    {tp.rationale && <span className="text-[#7a6e56]"> — {tp.rationale}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.stopLoss?.rationale && (
            <p className="text-xs text-[#7a6e56]"><span className="font-semibold text-red-500">SL rationale:</span> {plan.stopLoss.rationale}</p>
          )}
        </section>
      )}

      {/* Analysis */}
      {analysis?.summary && (
        <section className="rounded-xl border border-[rgba(90,80,50,0.12)] bg-white p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9e8e76]">Analysis</p>
          <p className="text-sm text-[#18180e] leading-relaxed">{analysis.summary}</p>
          {analysis.sentiment && (
            <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${analysis.sentiment === "bullish" ? "bg-emerald-100 text-emerald-700" : analysis.sentiment === "bearish" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"}`}>
              {analysis.sentiment}
            </span>
          )}
        </section>
      )}

      {/* Evidence */}
      {evidence && (
        <section className="rounded-xl border border-[rgba(90,80,50,0.12)] bg-white p-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#9e8e76]">Evidence</p>
          {evidence.primaryTraceId && (
            <p className="text-xs"><span className="text-[#9e8e76]">Trace ID: </span><span className="font-mono">{evidence.primaryTraceId}</span></p>
          )}
          {evidence.paymentRequestId && (
            <p className="text-xs"><span className="text-[#9e8e76]">Payment Request: </span><span className="font-mono">{evidence.paymentRequestId}</span></p>
          )}
          {evidence.primaryEvidenceRef && (
            <a href={`${BACKEND}${evidence.primaryEvidenceRef}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#3a4220] hover:underline">
              <ExternalLink className="h-3 w-3" /> Evidence export
            </a>
          )}
          {evidence.receiptRefs?.map((ref) => (
            <a key={ref} href={`${BACKEND}${ref}`} target="_blank" rel="noreferrer" className="block text-xs text-[#3a4220] hover:underline font-mono">
              {ref}
            </a>
          ))}
        </section>
      )}

      {/* AA Role Addresses */}
      {(audit.requester || audit.executor || audit.validator) && (
        <section className="rounded-xl border border-[rgba(90,80,50,0.12)] bg-white p-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#9e8e76]">AA Execution Roles</p>
          <AddrRow label="Consumer AA wallet" value={audit.requester} />
          <AddrRow label="Executor AA wallet" value={audit.executor} />
          <AddrRow label="Validator AA wallet" value={audit.validator} />
          {audit.contractPrimitives?.escrowAmount && (
            <p className="text-xs"><span className="text-[#9e8e76]">Escrow: </span>{audit.contractPrimitives.escrowAmount} KITE</p>
          )}
          {roleEnforcement?.roleRuntimeSummary && Object.entries(roleEnforcement.roleRuntimeSummary).map(([k, v]) => (
            <p key={k} className="text-xs font-mono text-[#7a6e56]">{k}: {v}</p>
          ))}
        </section>
      )}
    </div>
  );
}
