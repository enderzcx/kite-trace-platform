"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, ChevronDown, ExternalLink, FileText, ShieldCheck } from "lucide-react";

const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");
const EXPLORER = (
  process.env.NEXT_PUBLIC_KITE_EXPLORER ?? "https://testnet.kitescan.ai"
).replace(/\/+$/, "");
const ENV_JOB_ID = (process.env.NEXT_PUBLIC_DEMO_JOB_ID ?? "").trim();
const FALLBACK_JOB_IDS = [
  ENV_JOB_ID,
  "job_1774223853187_53153dad",
  "job_1774222287685_e3718114",
].filter(Boolean);

const CANONICAL_DEMO_JOB_ID = "job_1774223853187_53153dad";

interface LifecycleEntry {
  key?: string;
  label?: string;
  status?: string;
  at?: string;
  anchorTxHash?: string;
  escrowTxHash?: string;
}

interface NewsItem {
  headline?: string;
  sourceUrl?: string;
}

interface AuditData {
  jobId?: string;
  summary?: {
    state?: string;
    capability?: string;
    budget?: string;
    requester?: string;
    executor?: string;
    validator?: string;
    expiresAt?: string;
  };
  lifecycle?: LifecycleEntry[];
  deliveryStandard?: {
    schema?: string;
    conformant?: boolean;
  };
  delivery?: {
    summary?: string;
    items?: NewsItem[];
    newsTraceId?: string;
    paymentTxHash?: string;
    trustTxHash?: string;
  };
  evidence?: {
    primaryTraceId?: string;
    paymentRequestId?: string;
    paymentTxHash?: string;
    dataSourceTraceIds?: string[];
    primaryEvidenceRef?: string;
    receiptRefs?: string[];
    resultRef?: string;
    resultHash?: string;
  };
  authorization?: {
    authorizedBy?: string;
    authorizationMode?: string;
  };
  contractPrimitives?: {
    escrow?: {
      contractAddress?: string;
      tokenAddress?: string;
    };
    roleEnforcement?: {
      executionMode?: string;
      roleRuntimeSummary?: Record<string, string> | null;
    };
  };
  deadline?: {
    expiresAt?: string;
  };
}

const CANONICAL_DEMO_AUDIT: AuditData = {
  jobId: "job_1774223853187_53153dad",
  summary: {
    state: "completed",
    capability: "cap-news-signal",
    budget: "0.005 USDT",
    requester: "0x13a77fbf4ef77dd1044d22df0d048b85aa4f1a6a",
    executor: "0x13a77fbf4ef77dd1044d22df0d048b85aa4f1a6a",
    validator: "0x4b666887c452c0cd828fe4c9d5b78f33f5d636e4",
    expiresAt: "2026-03-23T05:57:33.026Z",
  },
  lifecycle: [
    {
      key: "created",
      label: "Created",
      status: "completed",
      at: "2026-03-22T23:57:33.150Z",
      anchorTxHash: "0x914f47df4de70dea34830d18bdfe80ea41844c69ec59e0ca6b095c3f8257ed67",
    },
    {
      key: "funded",
      label: "Funded",
      status: "completed",
      at: "2026-03-22T23:57:47.468Z",
      anchorTxHash: "0x51fa39e4ea7f9460cc3966d8b93f941d8850d28ec763c1881f05543316981f94",
      escrowTxHash: "0xf6909da4d0da5bffc0b07ef46f9d7e8cbb0f0f6ef8efe313f72fdba81a37cb2c",
    },
    {
      key: "accepted",
      label: "Accepted",
      status: "completed",
      at: "2026-03-22T23:59:19.335Z",
      anchorTxHash: "0x74c2a7fe49eeb810c48a081508950657eaf2a916aaa96b6901a66a8082c5ef78",
      escrowTxHash: "0xb0bdfae2c9cf8dd7d614e0ae39008d54a16fe862ce9c25552dd1d54b3ae3d04f",
    },
    {
      key: "submitted",
      label: "Submitted",
      status: "completed",
      at: "2026-03-23T00:01:09.169Z",
      anchorTxHash: "0xa0b9083d028309d576824e5acdbfe36e5aa71df0714928cd8d11039339dace11",
      escrowTxHash: "0x6e618db8a63435a9bd34a3ffe912fbc72f28e6847452b0b9aad8c84e972fe6d5",
    },
    {
      key: "outcome",
      label: "Outcome",
      status: "completed",
      at: "2026-03-23T00:01:46.543Z",
      anchorTxHash: "0xc5683d656cfd81b417691c4e324ae27269e03e68bd7262249aefa36054ada5d3",
      escrowTxHash: "0x0c7fa279460c00c1058bf2290a23cd60c915ea2ab93d5c6c6d13ab95aeb8a7c1",
    },
  ],
  deliveryStandard: { schema: "ktrace-news-brief-v1", conformant: true },
  delivery: {
    summary:
      "BTC hourly news brief (2026-03-22 22:00-23:59 UTC): geopolitical tensions dominated the signal set. Brent oil surged on Trump-Iran war threats, while repeated Strait of Hormuz headlines reinforced a macro risk-off backdrop. The final BTC signal remained neutral.",
    items: [
      {
        headline: "Brent oil rises 1.6% to $114/bbl on Trump-Iran war threats",
        sourceUrl: "https://www.bloomberg.com/news/articles/2026-03-22/brent-oil-rises-on-trump-iran-war-threats",
      },
      {
        headline: "Starmer and Trump agreed reopening Strait of Hormuz essential for global energy stability",
        sourceUrl: "https://www.reuters.com/world/starmer-trump-discuss-strait-of-hormuz-2026-03-22",
      },
      {
        headline: "Starmer and Trump discussed Middle East situation, need to reopen Strait of Hormuz for global shipping",
        sourceUrl: "https://www.reuters.com/world/starmer-trump-middle-east-hormuz-shipping-2026-03-22",
      },
    ],
    newsTraceId: "service_1774223983397_8a10f4b8",
    paymentTxHash: "0x23a9a3144da6014a727b86486621ec0df90b2b4ef5d5407e61024d6766101cac",
    trustTxHash: "0xed8d01816c61a3872e35932a9b5ee4e0b90d3c19671f0ac9e2661131eb4f1e11",
  },
  evidence: {
    primaryTraceId: "service_1774223983397_8a10f4b8",
    paymentRequestId: "job_payment_1774223867468_deb7d196",
    paymentTxHash: "0x23a9a3144da6014a727b86486621ec0df90b2b4ef5d5407e61024d6766101cac",
    dataSourceTraceIds: ["service_1774223983397_8a10f4b8"],
    primaryEvidenceRef: "/api/evidence/export?traceId=manual_news_demo_1774223852981",
    receiptRefs: ["/api/receipt/job_payment_1774223867468_deb7d196"],
    resultRef: "/api/jobs/job_1774223853187_53153dad/audit",
    resultHash: "c039a92015bacbc554e23a749538be0f18d898ab949509b52906c3be5e37a675",
  },
  authorization: {
    authorizedBy: "0x0309dc91bb89750c317ec69566baf1613b57e6bb",
    authorizationMode: "user_grant_self_custodial",
  },
  contractPrimitives: {
    escrow: {
      contractAddress: "0x95260b27c509Bf624B33702C09CdD37098a6967D",
      tokenAddress: "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
    },
    roleEnforcement: {
      executionMode: "aa_account_role_enforced",
      roleRuntimeSummary: {
        requesterRuntimeAddress: "0x13a77fBf4ef77DD1044d22Df0D048B85Aa4f1a6a",
        executorRuntimeAddress: "0x13a77fBf4ef77DD1044d22Df0D048B85Aa4f1a6a",
        validatorRuntimeAddress: "0x4b666887C452C0cD828fE4c9d5b78F33f5d636e4",
      },
    },
  },
  deadline: { expiresAt: "2026-03-23T05:57:33.026Z" },
};

function fmt(ts?: string) {
  if (!ts) return "-";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString();
}

function shorten(value = "", head = 8, tail = 6) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function TxLink({ hash, label }: { hash?: string; label?: string }) {
  if (!hash) return <span className="text-[#b0a08a]">—</span>;
  return (
    <a
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#3a4220] transition hover:opacity-70"
    >
      {label ?? shorten(hash)}
      <ExternalLink className="h-2.5 w-2.5 opacity-60" />
    </a>
  );
}

async function loadAudit(jobId: string): Promise<AuditData | null> {
  const response = await fetch(`${BACKEND}/api/public/jobs/${jobId}/audit`);
  if (!response.ok) return null;
  const payload = await response.json();
  const audit = (payload?.audit ?? payload) as AuditData | null;
  return audit;
}

// ── Lifecycle step expanded state ──────────────────────────────
function LifecycleStep({
  step,
  index,
  total,
}: {
  step: LifecycleEntry;
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const done = step.status === "completed";
  const isLast = index === total - 1;

  return (
    <div className="flex flex-1 flex-col items-center">
      {/* connector row */}
      <div className="relative flex w-full items-center justify-center">
        {/* left line */}
        {index > 0 && (
          <div className={`absolute left-0 right-1/2 h-px ${done ? "bg-[#3a4220]" : "bg-[rgba(90,80,50,0.15)]"}`} />
        )}
        {/* circle */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={[
            "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-all",
            done
              ? "border-[#3a4220] bg-[#3a4220] text-white hover:opacity-80"
              : "border-[rgba(90,80,50,0.2)] bg-[#faf7f1] text-[#9e8e76]",
          ].join(" ")}
        >
          {done ? <CheckCircle className="size-3.5" /> : <span className="text-[11px] font-bold">{index + 1}</span>}
        </button>
        {/* right line */}
        {!isLast && (
          <div className={`absolute left-1/2 right-0 h-px ${done ? "bg-[#3a4220]" : "bg-[rgba(90,80,50,0.15)]"}`} />
        )}
      </div>

      {/* label + time */}
      <div className="mt-2 flex flex-col items-center gap-0.5 text-center">
        <span className={`text-[11px] font-semibold ${done ? "text-[#18180e]" : "text-[#9e8e76]"}`}>
          {step.label ?? step.key}
        </span>
        <span className="text-[10px] text-[#b0a08a]">
          {step.at ? new Date(step.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
        </span>
        {/* expand button */}
        {(step.anchorTxHash || step.escrowTxHash) && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-1 flex items-center gap-0.5 text-[10px] text-[#9e8e76] transition hover:text-[#3a4220]"
          >
            txs <ChevronDown className={`size-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* expanded tx links */}
      {open && (
        <div className="mt-2 flex flex-col gap-1 rounded-xl border border-[rgba(58,66,32,0.12)] bg-white px-3 py-2 text-left">
          {step.anchorTxHash && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[#b0a08a]">Anchor</p>
              <TxLink hash={step.anchorTxHash} />
            </div>
          )}
          {step.escrowTxHash && (
            <div className="mt-1">
              <p className="text-[9px] uppercase tracking-widest text-[#b0a08a]">Escrow</p>
              <TxLink hash={step.escrowTxHash} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DemoAuditClient() {
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [resolvedJobId, setResolvedJobId] = useState(CANONICAL_DEMO_JOB_ID);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (const jobId of FALLBACK_JOB_IDS) {
        try {
          const nextAudit = await loadAudit(jobId);
          if (!nextAudit) continue;
          if (nextAudit.deliveryStandard?.schema !== "ktrace-news-brief-v1") continue;
          if (cancelled) return;
          setResolvedJobId(jobId);
          setAudit(nextAudit);
          return;
        } catch { /* continue */ }
      }
      if (!cancelled) {
        setResolvedJobId(CANONICAL_DEMO_JOB_ID);
        setAudit(CANONICAL_DEMO_AUDIT);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, []);

  const lifecycle = useMemo(() => audit?.lifecycle ?? [], [audit]);
  const delivery = audit?.delivery;
  const evidence = audit?.evidence;
  const state = audit?.summary?.state ?? "";
  const conformant = audit?.deliveryStandard?.conformant;
  const roleEnforcement = audit?.contractPrimitives?.roleEnforcement;
  const runtimeRoles = roleEnforcement?.roleRuntimeSummary ?? {};

  const roleRows: { label: string; value?: string }[] = [
    { label: "Authorized by", value: audit?.authorization?.authorizedBy },
    { label: "Requester", value: audit?.summary?.requester },
    { label: "Executor", value: audit?.summary?.executor },
    { label: "Validator", value: audit?.summary?.validator },
    { label: "Escrow contract", value: audit?.contractPrimitives?.escrow?.contractAddress },
    { label: "Settlement token", value: audit?.contractPrimitives?.escrow?.tokenAddress },
    { label: "Requester runtime", value: runtimeRoles?.requesterRuntimeAddress },
    { label: "Executor runtime", value: runtimeRoles?.executorRuntimeAddress },
    { label: "Validator runtime", value: runtimeRoles?.validatorRuntimeAddress },
  ].filter((r) => !!r.value);

  if (!audit) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf7f1]">
        <div className="animate-pulse text-[13px] text-[#9e8e76]">Loading demo…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#faf7f1_0%,#f6efe3_100%)] text-[#18180e]">

      {/* ── Nav bar ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-[rgba(90,80,50,0.1)] bg-[#faf7f1]/90 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2 text-[13px] text-[#7a6e56] transition hover:text-[#18180e]">
            <span className="text-[#9e8e76]">←</span>
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[#3a4220] text-[8px] font-bold text-white">KT</span>
            Kite Trace
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#3a4220]">
            <FileText className="size-3" /> Live Demo
          </span>
          <span
            className="rounded-full px-3 py-1 text-[11px] font-semibold"
            style={{
              background: state === "completed" ? "rgba(58,66,32,0.1)" : "rgba(180,140,20,0.1)",
              color: state === "completed" ? "#3a4220" : "#7a5a00",
            }}
          >
            {state || "unknown"}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">

        {/* ── Hero card ────────────────────────────────────────── */}
        <section className="rounded-3xl border border-[rgba(90,80,50,0.12)] bg-white px-7 py-7 shadow-[0_8px_32px_rgba(24,24,14,0.06)]">
          <h1 className="text-[26px] font-semibold tracking-tight">Hourly News Brief</h1>
          <p className="mt-1 text-[13px] text-[#7a6e56]">
            Real completed ERC-8183 job — requester, agent, and validator settled on-chain.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Job ID", value: shorten(resolvedJobId || audit.jobId, 10, 6), mono: true },
              { label: "Capability", value: audit.summary?.capability ?? "-" },
              { label: "Budget", value: audit.summary?.budget ?? "-" },
              {
                label: "Schema",
                value: audit.deliveryStandard?.schema ?? "-",
                badge: conformant === true ? "✓ conformant" : conformant === false ? "✗ failed" : undefined,
                mono: true,
              },
            ].map(({ label, value, mono, badge }) => (
              <div key={label} className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">{label}</p>
                <p className={`mt-1 text-[12px] font-semibold text-[#18180e] ${mono ? "font-mono" : ""}`}>{value}</p>
                {badge && (
                  <span className="mt-1 inline-block text-[10px] font-medium text-[#3a4220]">{badge}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Lifecycle timeline ───────────────────────────────── */}
        <section className="rounded-3xl border border-[rgba(90,80,50,0.12)] bg-white px-7 py-6 shadow-[0_8px_32px_rgba(24,24,14,0.04)]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Lifecycle</p>
          <h2 className="mb-6 text-[17px] font-semibold">On-chain job progression</h2>
          <div className="flex items-start gap-0">
            {lifecycle.map((step, i) => (
              <LifecycleStep key={step.key ?? i} step={step} index={i} total={lifecycle.length} />
            ))}
          </div>
          <p className="mt-4 text-center text-[10px] text-[#b0a08a]">Click any step to view transaction hashes</p>
        </section>

        {/* ── Delivery + Evidence ──────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">

          {/* Delivery */}
          <section className="rounded-3xl border border-[rgba(90,80,50,0.12)] bg-white px-7 py-6 shadow-[0_8px_32px_rgba(24,24,14,0.04)]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Delivery</p>
            <h2 className="mb-4 text-[17px] font-semibold">Submitted news brief</h2>
            <p className="text-[13px] leading-7 text-[#4b4537]">
              {delivery?.summary ?? "No delivery summary."}
            </p>
            {Array.isArray(delivery?.items) && delivery.items.length > 0 && (
              <ul className="mt-5 flex flex-col gap-3">
                {delivery.items.map((item, index) => (
                  <li
                    key={`${item.headline ?? "item"}-${index}`}
                    className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3"
                  >
                    <p className="text-[12px] font-semibold leading-snug text-[#18180e]">
                      {item.headline ?? `Item ${index + 1}`}
                    </p>
                    {item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:opacity-70"
                      >
                        Source <ExternalLink className="size-2.5 opacity-60" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Evidence */}
          <section className="rounded-3xl border border-[rgba(90,80,50,0.12)] bg-white px-7 py-6 shadow-[0_8px_32px_rgba(24,24,14,0.04)]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Evidence</p>
            <h2 className="mb-4 text-[17px] font-semibold">Trace & payment</h2>
            <div className="flex flex-col gap-4">
              {[
                {
                  label: "Trace ID",
                  node: (
                    <p className="break-all font-mono text-[11px] text-[#18180e]">
                      {delivery?.newsTraceId ?? evidence?.primaryTraceId ?? "-"}
                    </p>
                  ),
                },
                {
                  label: "Payment tx",
                  node: <TxLink hash={delivery?.paymentTxHash ?? evidence?.paymentTxHash} />,
                },
                {
                  label: "Trust tx",
                  node: <TxLink hash={delivery?.trustTxHash} />,
                },
                ...(evidence?.paymentRequestId
                  ? [{
                      label: "Payment request",
                      node: (
                        <p className="break-all font-mono text-[11px] text-[#18180e]">
                          {evidence.paymentRequestId}
                        </p>
                      ),
                    }]
                  : []),
              ].map(({ label, node }) => (
                <div key={label}>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">{label}</p>
                  <div className="mt-1">{node}</div>
                </div>
              ))}
              <div className="mt-1 flex flex-col gap-2">
                {evidence?.primaryEvidenceRef && (
                  <a
                    href={`${BACKEND}${evidence.primaryEvidenceRef}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:opacity-70"
                  >
                    Evidence export <ExternalLink className="size-2.5 opacity-60" />
                  </a>
                )}
                {evidence?.resultRef && (
                  <a
                    href={`${BACKEND}${evidence.resultRef}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:opacity-70"
                  >
                    Full audit record <ExternalLink className="size-2.5 opacity-60" />
                  </a>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* ── Execution roles ──────────────────────────────────── */}
        <section className="rounded-3xl border border-[rgba(90,80,50,0.12)] bg-white px-7 py-6 shadow-[0_8px_32px_rgba(24,24,14,0.04)]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#3a4220]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Execution Roles</p>
          </div>
          <h2 className="mb-1 mt-0.5 text-[17px] font-semibold">Authorized actors</h2>

          {/* mode pills */}
          <div className="mb-4 mt-2 flex flex-wrap gap-2">
            {roleEnforcement?.executionMode && (
              <span className="rounded-full border border-[rgba(58,66,32,0.15)] bg-[rgba(58,66,32,0.05)] px-3 py-1 font-mono text-[10px] text-[#3a4220]">
                {roleEnforcement.executionMode}
              </span>
            )}
            {audit.authorization?.authorizationMode && (
              <span className="rounded-full border border-[rgba(58,66,32,0.15)] bg-[rgba(58,66,32,0.05)] px-3 py-1 font-mono text-[10px] text-[#3a4220]">
                {audit.authorization.authorizationMode}
              </span>
            )}
          </div>

          {/* address table */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {roleRows.map(({ label, value }) => (
              <div key={label} className="flex items-baseline gap-2 rounded-xl border border-[rgba(90,80,50,0.08)] bg-[#faf7f1] px-3 py-2.5">
                <span className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9e8e76]">
                  {label}
                </span>
                <a
                  href={`${EXPLORER}/address/${value}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate font-mono text-[11px] text-[#3a4220] transition hover:opacity-70"
                  title={value}
                >
                  {shorten(value, 10, 8)}
                </a>
              </div>
            ))}
          </div>
          {audit.deadline?.expiresAt && (
            <p className="mt-3 text-[11px] text-[#b0a08a]">Expires {fmt(audit.deadline.expiresAt)}</p>
          )}
        </section>

      </main>

      <footer className="border-t border-[rgba(90,80,50,0.1)] py-6 text-center text-[11px] text-[#b0a08a]">
        Kite Trace Platform — Kite Testnet
      </footer>
    </div>
  );
}
