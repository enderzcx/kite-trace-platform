"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, BadgeCheck, CheckCircle2, Copy } from "lucide-react";
import { fallbackProviders, type ShowcaseCapability, type ShowcaseProvider } from "@/components/showcase/showcase-data";

interface AgentNetworkSectionProps {
  providers?: ShowcaseProvider[];
}

type CallTab = "mac" | "win";

const AGENT_THEME: Record<
  string,
  {
    accent: string;
    accentBorder: string;
    accentMuted: string;
    accentStrip: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    icon: string;
    priceColor: string;
  }
> = {
  "fundamental-agent-real": {
    accent: "#4a5a20",
    accentBorder: "rgba(74,90,32,0.22)",
    accentMuted: "rgba(74,90,32,0.07)",
    accentStrip: "linear-gradient(90deg, transparent, rgba(74,90,32,0.35), transparent)",
    badgeBg: "rgba(74,90,32,0.08)",
    badgeText: "#4a5a20",
    badgeBorder: "rgba(74,90,32,0.2)",
    icon: "F",
    priceColor: "#4a5a20",
  },
  "technical-agent-real": {
    accent: "#8a6020",
    accentBorder: "rgba(138,96,32,0.22)",
    accentMuted: "rgba(138,96,32,0.07)",
    accentStrip: "linear-gradient(90deg, transparent, rgba(138,96,32,0.35), transparent)",
    badgeBg: "rgba(138,96,32,0.08)",
    badgeText: "#8a6020",
    badgeBorder: "rgba(138,96,32,0.2)",
    icon: "T",
    priceColor: "#8a6020",
  },
};

const DEFAULT_THEME = AGENT_THEME["fundamental-agent-real"];
const BASE_URL = "https://kiteclaw.duckdns.org";
const TABS: { id: CallTab; label: string }[] = [
  { id: "mac", label: "macOS / Linux" },
  { id: "win", label: "Windows" },
];
const TAB_NOTE: Record<CallTab, string> = {
  mac: "Save auth once with ktrace auth login, then use ktrace agent invoke for discovery, payment, and evidence in one flow.",
  win: "Same flow on PowerShell or Command Prompt: login once, then call ktrace agent invoke as a single command.",
};

function abbreviateAddress(address = "") {
  const normalized = String(address || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-5)}`;
}

function safeParseInput(input = "") {
  try {
    const parsed = JSON.parse(input || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function buildCallSnippet(provider: ShowcaseProvider, capability: ShowcaseCapability | undefined, tab: CallTab) {
  const capabilityId = capability?.capabilityId ?? "cap-listing-alert";
  const inputJson = JSON.stringify(safeParseInput(capability?.defaultInput || "{}"));

  if (tab === "mac") {
    return (
      `# One-time setup\n` +
      `ktrace auth login --base-url ${BASE_URL} --api-key <agent-key>\n\n` +
      `# Invoke in one CLI-only call\n` +
      `ktrace agent invoke \\\n` +
      `  --capability ${capabilityId} \\\n` +
      `  --input '${inputJson}'\n\n` +
      `# Audit the returned trace\n` +
      `ktrace artifact evidence <trace-id>`
    );
  }

  return (
    `:: One-time setup\n` +
    `ktrace auth login --base-url ${BASE_URL} --api-key <agent-key>\n\n` +
    `:: Invoke in one CLI-only call\n` +
    `ktrace agent invoke --capability ${capabilityId} --input '${inputJson}'\n\n` +
    `:: Audit the returned trace\n` +
    `ktrace artifact evidence <trace-id>`
  );
}

function useClipboard(ms = 1600) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), ms);
  }

  return { copied, copy };
}

function TerminalBlock({
  title = "ktrace",
  code,
  copyKey,
  copied,
  onCopy,
  accentColor = "#4a5a20",
}: {
  title?: string;
  code: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  accentColor?: string;
}) {
  const isCopied = copied === copyKey;

  return (
    <div className="terminal-block overflow-hidden rounded-xl border border-[rgba(20,22,14,0.15)]">
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
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/30 transition hover:bg-white/[0.06] hover:text-white/60"
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
        className="overflow-x-auto bg-[#141608] p-4 text-[12.5px] leading-[1.65] text-[#c8c2a8]"
        style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
      >
        <code>
          {code.split("\n").map((line, i) => {
            const trimmed = line.trimStart();
            const isComment = trimmed.startsWith("#") || trimmed.startsWith("::");
            const isFlag =
              line.includes("--capability") ||
              line.includes("--input") ||
              line.includes("--base-url") ||
              line.includes("--api-key");

            return (
              <span key={i}>
                {isComment ? (
                  <span style={{ color: accentColor, opacity: 0.75 }}>{line}</span>
                ) : isFlag ? (
                  <span style={{ color: "rgba(200,194,168,0.88)" }}>{line}</span>
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

function AgentCard({
  provider,
  index,
  copied,
  onCopy,
}: {
  provider: ShowcaseProvider;
  index: number;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const theme = AGENT_THEME[provider.providerId] ?? DEFAULT_THEME;
  const [callTab, setCallTab] = useState<CallTab>("mac");
  const firstCap = provider.capabilities[0];
  const snippet = buildCallSnippet(provider, firstCap, callTab);

  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.48, delay: index * 0.12, ease: "easeOut" }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-[#f2ebe0]"
      style={{ borderColor: "rgba(90,80,50,0.14)" }}
    >
      <div className="h-[1.5px] w-full" style={{ background: theme.accentStrip }} />

      <div className="relative flex flex-col gap-6 p-6 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
              style={{
                background: theme.accentMuted,
                border: `1px solid ${theme.accentBorder}`,
                color: theme.accent,
              }}
            >
              {theme.icon}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-[#18180e]">{provider.title}</h3>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: theme.badgeBg,
                    color: theme.badgeText,
                    border: `1px solid ${theme.badgeBorder}`,
                  }}
                >
                  <BadgeCheck className="h-2.5 w-2.5" />
                  ERC-8004
                </span>
              </div>
              <p className="mt-0.5 text-[13px] text-[#7a6e56]">{provider.description}</p>
              <p className="mt-1 text-[11px]" style={{ color: theme.accent, opacity: 0.65 }}>
                agentId = {provider.agentId}
              </p>
              <p className="mt-1 text-[11px] text-[#9e8e76]">
                AA wallet:{" "}
                <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                  {abbreviateAddress(provider.aaWalletAddress)}
                </span>
              </p>
              {provider.ownerWalletAddress ? (
                <p className="mt-1 text-[11px] text-[#9e8e76]">
                  Owner EOA:{" "}
                  <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    {abbreviateAddress(provider.ownerWalletAddress)}
                  </span>
                </p>
              ) : null}
              {provider.trustProfile && (provider.trustProfile.anchorCount ?? 0) > 0 ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: "#3a4220" }}>
                  <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    ERC-8004 #{provider.trustProfile.tokenId}
                  </span>
                  <span className="text-[#c8b99a]">&middot;</span>
                  <span>{provider.trustProfile.anchorCount} on-chain</span>
                  <span className="text-[#c8b99a]">&middot;</span>
                  <span>{Math.round((provider.trustProfile.successRate || 0) * 100)}% success</span>
                  <span className="text-[#c8b99a]">&middot;</span>
                  <a
                    href={`/trust?agentId=${encodeURIComponent(provider.agentId)}`}
                    className="font-medium hover:underline"
                  >
                    Trust Profile &rarr;
                  </a>
                </p>
              ) : null}
            </div>
          </div>

          <a
            href={provider.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center gap-1 text-[11px] text-[#9e8e76] transition hover:text-[#3a4220]"
          >
            {abbreviateAddress(provider.aaWalletAddress)}
            <ArrowUpRight className="h-2.5 w-2.5" />
          </a>
        </div>

        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
            Capabilities
          </p>
          <div className="divide-y divide-[rgba(90,80,50,0.08)] overflow-hidden rounded-xl border border-[rgba(90,80,50,0.12)] bg-[#faf7f1]">
            {provider.capabilities.map((cap, i) => (
              <div
                key={cap.capabilityId}
                className="flex items-center justify-between px-4 py-2.5"
                style={{
                  background: i % 2 === 0 ? "rgba(90,80,50,0.025)" : "transparent",
                }}
              >
                <div className="min-w-0 flex-1">
                  <span
                    className="block text-[12px] font-medium text-[#18180e]"
                    style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
                  >
                    {cap.capabilityId}
                  </span>
                  <span className="block truncate text-[11px] text-[#9e8e76]">{cap.name}</span>
                </div>
                <span
                  className="ml-4 shrink-0 text-[12px] font-semibold tabular-nums"
                  style={{ color: theme.priceColor }}
                >
                  {cap.price}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
            How to call
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCallTab(tab.id)}
                className="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                style={
                  callTab === tab.id
                    ? { background: theme.accent, color: "#faf7f1" }
                    : { background: "rgba(90,80,50,0.07)", color: "#9e8e76", border: "1px solid rgba(90,80,50,0.12)" }
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          <TerminalBlock
            title="ktrace"
            code={snippet}
            copyKey={`${callTab}-${provider.providerId}`}
            copied={copied}
            onCopy={onCopy}
            accentColor={theme.accent}
          />

          <p className="mt-2 text-[11px] text-[#b0a08a]">{TAB_NOTE[callTab]}</p>
        </div>
      </div>
    </motion.article>
  );
}

export default function AgentNetworkSection({
  providers = fallbackProviders,
}: AgentNetworkSectionProps) {
  const { copied, copy } = useClipboard();

  return (
    <section id="agents" className="bg-[#faf7f1] px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#4a5a20]">
            Agent Network
          </span>
          <h2 className="font-display text-[2.4rem] font-normal leading-tight tracking-tight text-[#18180e]">
            Live agents with discoverable capabilities.
          </h2>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
            Each capability has a fixed price, an ERC-8004 identity, and produces
            verifiable on-chain evidence with every purchase.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {providers.map((provider, idx) => (
            <AgentCard
              key={provider.providerId}
              provider={provider}
              index={idx}
              copied={copied}
              onCopy={copy}
            />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-8 text-center text-[12px] text-[#b0a08a]"
        >
          Discoverable via{" "}
          <code
            className="rounded bg-[rgba(90,80,50,0.08)] px-1.5 py-0.5 text-[11px] text-[#7a6e56]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            GET /api/v1/discovery/select?capability=&lt;cap-id&gt;
          </code>
        </motion.p>
      </div>
    </section>
  );
}
