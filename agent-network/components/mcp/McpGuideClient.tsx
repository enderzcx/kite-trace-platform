"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  ExternalLink,
  ShieldCheck,
  Zap,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
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
            <>
              <ClipboardCheck className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[11.5px] leading-relaxed text-[#c8d8a0]">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

function Section({
  id,
  step,
  title,
  children,
}: {
  id?: string;
  step?: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-[28px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] shadow-[0_20px_60px_rgba(58,66,32,0.08)]"
    >
      <div className="border-b border-[rgba(90,80,50,0.08)] px-6 py-5">
        <div className="flex items-center gap-3">
          {step !== undefined ? (
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.07)] text-[11px] font-bold text-[#3a4220]"
            >
              {step}
            </span>
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">
            {title}
          </p>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function InfoCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
        {label}
      </p>
      <p
        className="mt-1.5 text-[12px] text-[#2f351a]"
        style={mono ? { fontFamily: "var(--font-jetbrains-mono, monospace)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function RoleChip({ role }: { role: "viewer" | "agent" }) {
  return role === "viewer" ? (
    <span className="inline-flex items-center rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.06)] px-2.5 py-0.5 text-[10px] font-semibold text-[#3a4220]">
      viewer
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-[rgba(138,96,32,0.2)] bg-[rgba(138,96,32,0.06)] px-2.5 py-0.5 text-[10px] font-semibold text-[#8a6020]">
      agent
    </span>
  );
}

// ─── Denial code table ────────────────────────────────────────────────────────

const AUTH_FAILURES = [
  {
    code: "Missing or invalid API key.",
    desc: "No valid backend key was provided.",
    kind: "auth",
  },
  {
    code: 'Role "viewer" cannot access "agent" MCP method.',
    desc: "Viewer key cannot execute tools/call — upgrade to agent role.",
    kind: "auth",
  },
];

const AUTHORITY_FAILURES = [
  { code: "authority_not_found", desc: "No authority policy exists for this session." },
  { code: "authority_expired", desc: "The authority policy has expired." },
  { code: "authority_revoked", desc: "The authority policy has been revoked." },
  { code: "authority_migration_required", desc: "Migration is required before execution can proceed." },
  { code: "capability_not_allowed", desc: "This capability is not in the allowed list." },
  { code: "provider_not_allowed", desc: "This provider is not in the allowed list." },
  { code: "recipient_not_allowed", desc: "This recipient address is not in the allowed list." },
  { code: "amount_exceeds_single_limit", desc: "Amount exceeds the per-transaction limit." },
  { code: "amount_exceeds_daily_limit", desc: "Amount would exceed the daily spend limit." },
  { code: "intent_replayed", desc: "Replay — this intent ID has already been processed." },
  { code: "intent_conflict", desc: "Conflict — a concurrent request with the same intent ID is in flight." },
];

const SESSION_FAILURES = [
  { code: "session_runtime_not_ready", desc: "AA wallet or session key is not ready." },
  { code: "payment_required", desc: "The paid invoke flow could not complete." },
  { code: "upstream_unavailable", desc: "Upstream execution or network dependency is unhealthy." },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function McpGuideClient() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(168,136,28,0.08),transparent_28%),linear-gradient(180deg,#faf7f1_0%,#f6efe3_100%)] px-4 py-12 text-[#18180e]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">

        {/* Header */}
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
            MCP Consumer Onboarding
          </span>
          <h1 className="font-display text-[2.2rem] font-normal leading-tight tracking-tight text-[#18180e]">
            <em className="not-italic text-[#3a4220]">Connect</em> to Kite Trace via MCP
          </h1>
          <p className="max-w-2xl text-[14px] leading-relaxed text-[#7a6e56]">
            Consumer agents may use MCP as the protocol surface for Kite Trace discovery and tool calls.
            Authority, payment, and audit stay inside the existing backend control plane.
            <strong className="font-semibold text-[#5a4e3a]"> ERC-8004 is not required.</strong>
          </p>

          {/* Protocol chain */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[rgba(58,66,32,0.14)] bg-[rgba(58,66,32,0.04)] px-4 py-3">
            {[
              "MCP client",
              "POST /mcp",
              "tools/call",
              "/api/services/:id/invoke",
              "authority + session pay",
              "receipt / evidence",
            ].map((step, i, arr) => (
              <span key={step} className="flex items-center gap-2">
                <span
                  className="text-[11px] text-[#3a4220]"
                  style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                >
                  {step}
                </span>
                {i < arr.length - 1 ? (
                  <ChevronRight className="size-3 shrink-0 text-[#9e8e76]" />
                ) : null}
              </span>
            ))}
          </div>

          {/* Nav links */}
          <div className="flex flex-wrap gap-3">
            <a
              href="/authority"
              className="inline-flex items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-4 py-2 text-[11px] font-medium text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.06)]"
            >
              <ShieldCheck className="size-3.5" />
              Authority control panel
            </a>
            <a
              href="/api/authority/mcp-info"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[rgba(90,80,50,0.18)] bg-transparent px-4 py-2 text-[11px] font-medium text-[#5a4e3a] transition hover:bg-[rgba(90,80,50,0.06)]"
            >
              Discovery JSON
              <ExternalLink className="size-3" />
            </a>
          </div>
        </header>

        {/* Prerequisites */}
        <Section title="What You Need">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[rgba(58,66,32,0.1)] bg-[#faf7f1] px-4 py-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                  Discovery
                </p>
                <ul className="flex flex-col gap-1.5 text-[12px] text-[#2f351a]">
                  <li>Backend base URL</li>
                  <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    GET /.well-known/mcp.json
                  </li>
                  <li className="flex items-center gap-1.5">
                    <RoleChip role="viewer" /> key or higher
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[#faf7f1] px-4 py-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                  Tool Calls
                </p>
                <ul className="flex flex-col gap-1.5 text-[12px] text-[#2f351a]">
                  <li>Backend base URL</li>
                  <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    POST /mcp
                  </li>
                  <li className="flex items-center gap-1.5">
                    <RoleChip role="agent" /> key or higher
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl border border-[rgba(138,96,32,0.14)] bg-[#faf7f1] px-4 py-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                  Paid Calls
                </p>
                <ul className="flex flex-col gap-1.5 text-[12px] text-[#2f351a]">
                  <li className="flex items-center gap-1.5">
                    <Zap className="size-3.5 text-[#8a6020]" />
                    Session runtime ready
                  </li>
                  <li className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-[#3a4220]" />
                    Active authority policy
                  </li>
                  <li className="text-[11px] italic text-[#9e8e76]">ERC-8004 not required</li>
                </ul>
              </div>
            </div>
          </div>
        </Section>

        {/* Step 1: Discover */}
        <Section id="step-discover" step={1} title="Discover The MCP Server">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[#5a4e3a]">
              Fetch the discovery document to get the MCP endpoint, transport, and auth requirements.
              This only requires a <RoleChip role="viewer" /> key.
            </p>
            <CodeBlock
              lang="http"
              code={`GET /.well-known/mcp.json
Accept: application/json
x-api-key: <VIEWER_OR_HIGHER_KEY>`}
            />
            <p className="text-[12px] text-[#7a6e56]">Frozen fields in the response:</p>
            <div className="grid gap-2 md:grid-cols-2">
              <InfoCard label="endpoint" value="POST target for all MCP requests" />
              <InfoCard label="transport" value="streamable-http" />
              <InfoCard label="toolNamePrefix" value="ktrace__" mono />
              <InfoCard label="auth.listRole" value="viewer" mono />
              <InfoCard label="auth.toolCallRole" value="agent" mono />
            </div>
            <CodeBlock
              lang="json"
              code={JSON.stringify(
                {
                  name: "Kite Trace MCP Server",
                  version: "1.0.0",
                  endpoint: "https://kiteclaw.duckdns.org/mcp",
                  transport: "streamable-http",
                  auth: {
                    type: "api-key-header",
                    header: "x-api-key",
                    listRole: "viewer",
                    toolCallRole: "agent",
                  },
                  toolNamePrefix: "ktrace__",
                },
                null,
                2
              )}
            />
          </div>
        </Section>

        {/* Step 2: List */}
        <Section id="step-list" step={2} title="List Available Tools">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[#5a4e3a]">
              Send a <code className="rounded bg-[rgba(58,66,32,0.08)] px-1.5 py-0.5 text-[11px]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>tools/list</code> request.
              Tools are derived from the capability catalog and follow the <code className="rounded bg-[rgba(58,66,32,0.08)] px-1.5 py-0.5 text-[11px]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>ktrace__</code> prefix.
              Requires <RoleChip role="viewer" /> or higher.
            </p>
            <CodeBlock
              lang="bash"
              code={`curl -s https://kiteclaw.duckdns.org/mcp \\
  -H "accept: application/json, text/event-stream" \\
  -H "content-type: application/json" \\
  -H "x-api-key: <VIEWER_OR_HIGHER_KEY>" \\
  -d '{"jsonrpc":"2.0","id":"list-1","method":"tools/list","params":{}}'`}
            />
          </div>
        </Section>

        {/* Step 3: Call */}
        <Section id="step-call" step={3} title="Call A Tool">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[#5a4e3a]">
              Use <code className="rounded bg-[rgba(58,66,32,0.08)] px-1.5 py-0.5 text-[11px]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>tools/call</code> to invoke a capability.
              This requires an <RoleChip role="agent" /> key. Include <code className="rounded bg-[rgba(58,66,32,0.08)] px-1.5 py-0.5 text-[11px]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>_meta.traceId</code> for clean audit lookups.
            </p>
            <CodeBlock
              lang="bash"
              code={`curl -s https://kiteclaw.duckdns.org/mcp \\
  -H "accept: application/json, text/event-stream" \\
  -H "content-type: application/json" \\
  -H "x-api-key: <AGENT_OR_HIGHER_KEY>" \\
  -d '{
  "jsonrpc": "2.0",
  "id": "call-1",
  "method": "tools/call",
  "params": {
    "name": "ktrace__cap_news_signal",
    "arguments": {
      "coin": "BTC",
      "limit": 3,
      "_meta": { "traceId": "mcp_consumer_demo_001" }
    }
  }
}'`}
            />
            <p className="text-[12px] text-[#7a6e56]">Structured fields returned on success:</p>
            <div className="grid gap-2 md:grid-cols-2">
              <InfoCard label="traceId" value="Your trace reference for audit lookups" />
              <InfoCard label="requestId" value="Backend request ID for receipt lookup" />
              <InfoCard label="invocationId" value="Service invocation record ID" />
              <InfoCard label="evidenceRef" value="Reference to the evidence export" />
            </div>
          </div>
        </Section>

        {/* Step 4: Paid behavior */}
        <Section id="step-paid" step={4} title="Paid Call Behavior">
          <div className="flex flex-col gap-4">
            <div
              className="flex items-start gap-3 rounded-2xl border px-4 py-3"
              style={{ borderColor: "rgba(58,66,32,0.18)", background: "rgba(58,66,32,0.05)" }}
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#3a4220]" />
              <p className="text-[12px] text-[#3a4220]">
                MCP does not bypass consumer authority, session pay, or receipt/evidence generation.
                Authority is validated before any payment is attempted.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {[
                "Authenticate the MCP request",
                "Resolve tool name to service invoke target",
                "Validate consumer authority — fails here if denied, before payment",
                "Run the normal paid invoke flow (session pay)",
                "Emit receipt and evidence through standard audit routes",
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.06)] text-[10px] font-bold text-[#3a4220]">
                    {i + 1}
                  </span>
                  <p className="text-[12px] text-[#2f351a]">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Step 5: Audit */}
        <Section id="step-audit" step={5} title="Audit Lookups After Execution">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[#5a4e3a]">
              Use the structured fields returned by <code className="rounded bg-[rgba(58,66,32,0.08)] px-1.5 py-0.5 text-[11px]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>tools/call</code> to retrieve receipt and evidence.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <InfoCard label="Receipt" value="GET /api/receipt/:requestId" mono />
              <InfoCard label="Evidence export" value="GET /api/evidence/export?traceId=..." mono />
              <InfoCard label="Public evidence" value="GET /api/public/evidence/:traceId" mono />
            </div>
            <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Authority metadata in evidence</p>
              <ul className="flex flex-col gap-1 text-[12px] text-[#2f351a]">
                <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>receipt.authorityId</li>
                <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>receipt.policySnapshotHash</li>
                <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>evidence.authorization.authorityId</li>
                <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>evidence.authorization.validationDecision</li>
                <li style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>publicEvidence.authoritySummary</li>
              </ul>
            </div>
          </div>
        </Section>

        {/* Failure states */}
        <Section id="failure-states" title="Common Failure States">
          <div className="flex flex-col gap-6">

            {/* Auth */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                Auth failures
              </p>
              <div className="flex flex-col gap-2">
                {AUTH_FAILURES.map((f) => (
                  <div
                    key={f.code}
                    className="flex items-start gap-3 rounded-2xl border border-[rgba(180,60,40,0.14)] bg-[rgba(180,60,40,0.03)] px-4 py-3"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#9a4332]" />
                    <div>
                      <p
                        className="text-[11px] font-medium text-[#9a4332]"
                        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                      >
                        {f.code}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#7a6e56]">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Authority */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                Authority denial codes — always returned before payment
              </p>
              <div className="overflow-hidden rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1]">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-[rgba(90,80,50,0.08)]">
                      <th className="px-4 py-2 text-left font-semibold text-[#9e8e76]">Code</th>
                      <th className="px-4 py-2 text-left font-semibold text-[#9e8e76]">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AUTHORITY_FAILURES.map((f, i) => (
                      <tr
                        key={f.code}
                        className={i < AUTHORITY_FAILURES.length - 1 ? "border-b border-[rgba(90,80,50,0.05)]" : ""}
                      >
                        <td
                          className="px-4 py-2.5 font-medium"
                          style={{
                            fontFamily: "var(--font-jetbrains-mono, monospace)",
                            color: f.code.startsWith("intent_") ? "#8a6020" : "#9a4332",
                          }}
                        >
                          {f.code}
                        </td>
                        <td className="px-4 py-2.5 text-[#5a4e3a]">{f.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] italic text-[#9e8e76]">
                <code style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>intent_*</code> codes indicate replay or conflict states — not generic failures.
              </p>
            </div>

            {/* Session / upstream */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
                Session and upstream failures
              </p>
              <div className="flex flex-col gap-2">
                {SESSION_FAILURES.map((f) => (
                  <div
                    key={f.code}
                    className="flex items-start gap-3 rounded-2xl border border-[rgba(90,80,50,0.12)] bg-[rgba(90,80,50,0.03)] px-4 py-3"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#8a6020]" />
                    <div>
                      <p
                        className="text-[11px] font-medium text-[#7a5020]"
                        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                      >
                        {f.code}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#7a6e56]">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Practical rules */}
        <Section title="Practical Integration Rules">
          <div className="flex flex-col gap-3">
            {[
              { icon: <CheckCircle2 className="size-4 text-[#3a4220]" />, text: "Use viewer key for discovery and tools/list only." },
              { icon: <CheckCircle2 className="size-4 text-[#3a4220]" />, text: "Use agent key for tools/call." },
              { icon: <CheckCircle2 className="size-4 text-[#3a4220]" />, text: "Treat MCP as an adapter over service invoke — not a separate product surface." },
              { icon: <CheckCircle2 className="size-4 text-[#3a4220]" />, text: "Keep your own traceId stable per user-facing action for clean audit lookups." },
              { icon: <CheckCircle2 className="size-4 text-[#3a4220]" />, text: "Read receipt and evidence from the standard backend routes after execution." },
              { icon: <CheckCircle2 className="size-4 text-[#3a4220]" />, text: "ERC-8004 is not required for consumer MCP access." },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">{item.icon}</span>
                <p className="text-[13px] text-[#2f351a]">{item.text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Product statement */}
        <div className="rounded-[28px] border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.05)] px-6 py-6 text-center">
          <p className="text-[14px] font-semibold leading-relaxed text-[#3a4220]">
            Providers join Kite Trace through identity.
            Consumers may call Kite Trace through MCP.
            Paid MCP calls are controlled by delegated authority, not mandatory onchain identity.
          </p>
        </div>

      </div>
    </main>
  );
}
