"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Copy } from "lucide-react";
import { BACKEND_URL } from "@/lib/chain-config";

function useClipboard(ms = 1600) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), ms);
  }

  return { copied, copy };
}

function TerminalWindow({
  title,
  code,
  copyKey,
  copied,
  onCopy,
  accentColor = "#4a5a20",
}: {
  title: string;
  code: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  accentColor?: string;
}) {
  const isCopied = copied === copyKey;

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(20,22,14,0.18)]">
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#1c1e12] px-3.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span
            className="ml-3 text-[11px] text-white/25"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            {title}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onCopy(copyKey, code)}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/25 transition hover:bg-white/[0.06] hover:text-white/55"
        >
          {isCopied ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-[#28c840]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre
        className="overflow-x-auto bg-[#141608] p-4 text-[12.5px] leading-[1.7] text-[#c8c2a8]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      >
        <code>
          {code.split("\n").map((line, i) => {
            const isPrompt = line.startsWith("$");
            const isComment = line.startsWith("#");

            return (
              <span key={i}>
                {isPrompt ? (
                  <>
                    <span style={{ color: accentColor, opacity: 0.7 }}>$ </span>
                    <span>{line.slice(2)}</span>
                  </>
                ) : isComment ? (
                  <span style={{ color: accentColor, opacity: 0.55 }}>{line}</span>
                ) : (
                  <span>{line}</span>
                )}
                {"\n"}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  note,
  code,
  copyKey,
  copied,
  onCopy,
  accentColor,
  delay,
}: {
  step: string;
  title: string;
  description: string;
  note?: string;
  code: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  accentColor: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[#faf7f1]"
          style={{ background: accentColor }}
        >
          {step}
        </span>
        <div>
          <p className="text-[13px] font-semibold text-[#18180e]">{title}</p>
          <p className="text-[12px] text-[#9e8e76]">{description}</p>
        </div>
      </div>
      <TerminalWindow
        title={`ktrace step ${step}`}
        code={code}
        copyKey={copyKey}
        copied={copied}
        onCopy={onCopy}
        accentColor={accentColor}
      />
      {note ? <p className="text-[11px] text-[#b0a08a]">{note}</p> : null}
    </motion.div>
  );
}

const MCP_ENDPOINT = `${BACKEND_URL}/mcp`;

function CopyLine({
  label,
  value,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const isCopied = copied === copyKey;
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(74,90,32,0.14)] bg-[#f2ebe0] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">{label}</p>
        <p
          className="mt-1 truncate text-[12px] text-[#2f351a]"
          style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
        >
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(copyKey, value)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-[#4a5a20] transition hover:bg-[rgba(74,90,32,0.08)]"
      >
        {isCopied ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-[#4a5a20]" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

function McpAccessCard({
  copied,
  onCopy,
}: {
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
      className="mt-8 overflow-hidden rounded-2xl border border-[rgba(74,90,32,0.2)] bg-[#faf7f1]"
    >
      {/* header */}
      <div className="flex items-start justify-between gap-4 border-b border-[rgba(74,90,32,0.1)] px-6 py-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8a6020]">
            MCP Access
          </p>
          <h3 className="mt-1.5 text-[16px] font-semibold text-[#18180e]">
            Connect any MCP-compatible client
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[#7a6e56]">
            Claude, Cursor, and other MCP clients can call ktrace capabilities directly.
            Each tool call goes through the same x402 payment and audit pipeline.
          </p>
        </div>
        <span className="mt-0.5 shrink-0 rounded-full border border-[rgba(74,90,32,0.22)] bg-[rgba(74,90,32,0.08)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#4a5a20]">
          Streamable HTTP
        </span>
      </div>

      {/* copy lines */}
      <div className="flex flex-col gap-3 px-6 py-5">
        <CopyLine
          label="MCP Endpoint"
          value={MCP_ENDPOINT}
          copyKey="mcp-endpoint"
          copied={copied}
          onCopy={onCopy}
        />
        <CopyLine
          label="Auth Header"
          value="x-api-key: <your-api-key>"
          copyKey="mcp-auth"
          copied={copied}
          onCopy={onCopy}
        />
      </div>

      {/* tool naming note */}
      <div className="border-t border-[rgba(74,90,32,0.08)] px-6 py-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4a5a20]">
          Tool naming
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            "ktrace__cap_news_signal",
            "ktrace__cap_listing_alert",
            "ktrace__cap_market_price_feed",
            "ktrace__cap_weather_context",
          ].map((name) => (
            <span
              key={name}
              className="rounded-full border border-[rgba(74,90,32,0.18)] bg-[rgba(74,90,32,0.05)] px-3 py-1 text-[11px] text-[#3a4220]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              {name}
            </span>
          ))}
          <span className="rounded-full border border-[rgba(90,80,50,0.12)] bg-transparent px-3 py-1 text-[11px] text-[#9e8e76]">
            + all active caps
          </span>
        </div>
        <p className="mt-3 text-[11px] text-[#9e8e76]">
          Tool names are derived from capability IDs at discovery time.
          Adding a new capability automatically exposes a new MCP tool — no config changes needed.
        </p>
      </div>
    </motion.div>
  );
}

const MCP_JSON_SNIPPET = `{
  "mcpServers": {
    "ktrace": {
      "type": "streamable-http",
      "url": "${MCP_ENDPOINT}",
      "headers": {
        "x-api-key": "<your-api-key>"
      }
    }
  }
}`;

const CURSOR_SNIPPET = `# ~/.cursor/mcp.json
{
  "mcpServers": {
    "ktrace": {
      "url": "${MCP_ENDPOINT}",
      "headers": { "x-api-key": "<your-api-key>" }
    }
  }
}`;

const TOOL_CALL_SNIPPET = `# Call any capability directly — payment is automatic
cap_news_signal({ "coin": "BTC", "limit": 3 })

# Delegate a job to another agent (ERC-8183)
job_create({ "capability": "cap_token_analysis", "expiresInHours": 24 })

# Verify results and fetch on-chain evidence
artifact_evidence({ "traceId": "<trace-id>" })`;

export default function KtraceCliSection() {
  const { copied, copy } = useClipboard();

  const steps = [
    {
      step: "1",
      title: "Add to your MCP client",
      description: "Paste the config into Claude Code, Cursor, or any MCP-compatible client.",
      copyKey: "claude-config",
      tabLabels: ["Claude Code", "Cursor"],
      codes: [MCP_JSON_SNIPPET, CURSOR_SNIPPET],
      note: "One config. All five agents and their tools are discovered automatically.",
      accentColor: "#4a5a20",
    },
    {
      step: "2",
      title: "Call any tool — payment is automatic",
      description: "Your AA wallet session key handles x402 payments inline. No manual steps.",
      copyKey: "tool-call",
      tabLabels: ["Tool Calls"],
      codes: [TOOL_CALL_SNIPPET],
      note: "Tools follow the pattern cap_*, job_*, artifact_* and flow_*.",
      accentColor: "#4a5a20",
    },
  ];

  return (
    <section id="ktrace" className="bg-[#faf7f1] px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#8a6020]">
            Using ktrace
          </span>
          <h2 className="font-display text-[2.4rem] font-normal leading-tight tracking-tight text-[#18180e]">
            One endpoint. Five agents.
          </h2>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
            Add the MCP server once, then call any capability across all agents.
            Payment, evidence, and audit trail are handled automatically.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {steps.map((step, i) => (
            <MultiTabStepCard key={step.copyKey} {...step} copied={copied} onCopy={copy} delay={i * 0.1} />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-10 rounded-2xl border border-[rgba(74,90,32,0.2)] bg-[rgba(74,90,32,0.05)] p-6"
        >
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4a5a20]">
            Evidence record on every purchase
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {[
              ["traceId", "Unique purchase identifier"],
              ["authorizedBy", "User EOA that signed the session"],
              ["txHash", "On-chain payment transaction"],
              ["sourceUrl + fetchedAt", "Data provenance per record"],
            ].map(([field, desc]) => (
              <div key={field} className="flex flex-col gap-0.5">
                <code
                  className="text-[12px] text-[#3a4220]"
                  style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                >
                  {field}
                </code>
                <span className="text-[11px] text-[#9e8e76]">{desc}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <McpAccessCard copied={copied} onCopy={copy} />
      </div>
    </section>
  );
}

function MultiTabStepCard({
  step,
  title,
  description,
  note,
  codes,
  tabLabels,
  copyKey,
  copied,
  onCopy,
  accentColor,
  delay,
}: {
  step: string;
  title: string;
  description: string;
  note?: string;
  codes: string[];
  tabLabels: string[];
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  accentColor: string;
  delay: number;
}) {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[#faf7f1]"
          style={{ background: accentColor }}
        >
          {step}
        </span>
        <div>
          <p className="text-[13px] font-semibold text-[#18180e]">{title}</p>
          <p className="text-[12px] text-[#9e8e76]">{description}</p>
        </div>
      </div>
      {tabLabels.length > 1 && (
        <div className="flex gap-1.5">
          {tabLabels.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setActiveTab(i)}
              className="rounded-full px-3 py-1 text-[11px] font-semibold transition"
              style={
                activeTab === i
                  ? { background: accentColor, color: "#faf7f1" }
                  : { background: "rgba(90,80,50,0.07)", color: "#9e8e76", border: "1px solid rgba(90,80,50,0.12)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <TerminalWindow
        title={tabLabels[activeTab] ?? "ktrace"}
        code={codes[activeTab] ?? ""}
        copyKey={`${copyKey}-${activeTab}`}
        copied={copied}
        onCopy={onCopy}
        accentColor={accentColor}
      />
      {note ? <p className="text-[11px] text-[#b0a08a]">{note}</p> : null}
    </motion.div>
  );
}
