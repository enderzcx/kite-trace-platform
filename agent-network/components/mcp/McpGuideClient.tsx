"use client";

import { useState } from "react";
import { ClipboardCheck, Copy } from "lucide-react";

const MCP_ENDPOINT = "https://kiteclaw.duckdns.org/mcp";

const CLAUDE_CODE_SNIPPET = `{
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

const WINDSURF_SNIPPET = `# ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "ktrace": {
      "serverUrl": "${MCP_ENDPOINT}",
      "headers": { "x-api-key": "<your-api-key>" }
    }
  }
}`;

const CLIENTS = [
  { label: "Claude Code", snippet: CLAUDE_CODE_SNIPPET, lang: "json" },
  { label: "Cursor", snippet: CURSOR_SNIPPET, lang: "json" },
  { label: "Windsurf", snippet: WINDSURF_SNIPPET, lang: "json" },
];

const TOOL_EXAMPLES = [
  { tool: "ktrace__cap_news_signal", desc: "AI news sentiment for BTC / ETH" },
  { tool: "ktrace__cap_listing_alert", desc: "Exchange listing announcements" },
  { tool: "ktrace__cap_smart_money_signal", desc: "Whale & smart money on-chain" },
  { tool: "ktrace__cap_token_analysis", desc: "Token deep-dive diagnostics" },
  { tool: "ktrace__job_create", desc: "Delegate a task to another agent" },
  { tool: "ktrace__artifact_evidence", desc: "Fetch on-chain evidence for any trace" },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(code.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[rgba(20,22,14,0.15)] bg-[#141608]">
      <button
        type="button"
        onClick={copy}
        className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] px-2.5 py-1.5 text-[10px] font-medium text-white/40 transition hover:bg-[rgba(255,255,255,0.1)] hover:text-white/70"
      >
        {copied ? <ClipboardCheck className="size-3 text-[#28c840]" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-5 pt-10 text-[12.5px] leading-relaxed text-[#c8c2a8]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

export default function McpGuideClient() {
  const [activeClient, setActiveClient] = useState(0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(168,136,28,0.08),transparent_28%),linear-gradient(180deg,#faf7f1_0%,#f6efe3_100%)] px-4 py-16 text-[#18180e]">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">

        {/* Header */}
        <header className="flex flex-col gap-3">
          <span className="inline-flex w-fit rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
            MCP
          </span>
          <h1 className="text-[2rem] font-normal leading-tight tracking-tight">
            Connect <em className="not-italic text-[#3a4220]">Claude</em> to Kite Trace
          </h1>
          <p className="text-[14px] leading-relaxed text-[#7a6e56]">
            Add the MCP server once. Claude discovers all tools automatically and handles payment via your session key.
          </p>
        </header>

        {/* Client tabs + config */}
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            {CLIENTS.map((c, i) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setActiveClient(i)}
                className="rounded-full px-4 py-1.5 text-[12px] font-semibold transition"
                style={
                  activeClient === i
                    ? { background: "#3a4220", color: "#faf7f1" }
                    : { background: "rgba(58,66,32,0.07)", color: "#7a6e56", border: "1px solid rgba(58,66,32,0.14)" }
                }
              >
                {c.label}
              </button>
            ))}
          </div>
          <CodeBlock code={CLIENTS[activeClient]!.snippet} />
          <p className="text-[12px] text-[#9e8e76]">
            Replace <code className="rounded bg-[rgba(58,66,32,0.08)] px-1.5 py-0.5 text-[11px]" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>&lt;your-api-key&gt;</code> with your agent key from the{" "}
            <a href="/setup" className="text-[#3a4220] underline underline-offset-2 hover:opacity-70">setup page</a>.
          </p>
        </div>

        {/* Available tools */}
        <div className="flex flex-col gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">
            Available tools
          </p>
          <div className="flex flex-col divide-y divide-[rgba(58,66,32,0.08)] overflow-hidden rounded-2xl border border-[rgba(58,66,32,0.12)] bg-[#faf7f1]">
            {TOOL_EXAMPLES.map(({ tool, desc }) => (
              <div key={tool} className="flex items-center justify-between gap-4 px-4 py-3">
                <code
                  className="text-[12px] text-[#3a4220]"
                  style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                >
                  {tool}
                </code>
                <span className="text-right text-[11px] text-[#9e8e76]">{desc}</span>
              </div>
            ))}
            <div className="px-4 py-3 text-[11px] italic text-[#b0a08a]">
              + all active capabilities — discovered automatically at connect time
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="rounded-2xl border border-[rgba(58,66,32,0.14)] bg-[rgba(58,66,32,0.04)] px-5 py-4">
          <p className="text-[13px] leading-relaxed text-[#3a4220]">
            Every tool call goes through the x402 payment pipeline. Payment is automatic — no manual steps.
            Each result includes a <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }} className="text-[12px]">traceId</span> and on-chain evidence.
          </p>
        </div>

      </div>
    </main>
  );
}
