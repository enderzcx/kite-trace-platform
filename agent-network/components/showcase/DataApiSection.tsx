"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Copy, Database, Newspaper } from "lucide-react";

const BASE_URL = "https://kiteclaw.duckdns.org";

// ── Types ────────────────────────────────────────────────────────────────────

interface DataApiDef {
  id: string;
  method: "GET" | "POST";
  path: string;
  name: string;
  description: string;
  params?: string;
  exampleUrl: string;
}

interface ApiGroup {
  groupId: string;
  label: string;
  icon: "data" | "news";
  accent: string;
  accentBorder: string;
  accentMuted: string;
  accentStrip: string;
  apis: DataApiDef[];
}

// ── Static API catalog ────────────────────────────────────────────────────────

const API_GROUPS: ApiGroup[] = [
  {
    groupId: "data-feeds",
    label: "Data Feeds",
    icon: "data",
    accent: "#4a5a20",
    accentBorder: "rgba(74,90,32,0.22)",
    accentMuted: "rgba(74,90,32,0.07)",
    accentStrip: "linear-gradient(90deg, transparent, rgba(74,90,32,0.35), transparent)",
    apis: [
      {
        id: "weather",
        method: "GET",
        path: "/api/data/weather",
        name: "Weather Context",
        description: "3-day daily weather forecast with condition summaries. Source: Open-Meteo.",
        params: "?lat=40.71&lon=-74.01",
        exampleUrl: `${BASE_URL}/api/data/weather?lat=40.71&lon=-74.01`,
      },
      {
        id: "tech-buzz",
        method: "GET",
        path: "/api/data/tech-buzz",
        name: "Tech Buzz Signal",
        description: "Top HackerNews stories with score and comment count, normalized for feed use.",
        params: "?limit=5",
        exampleUrl: `${BASE_URL}/api/data/tech-buzz?limit=5`,
      },
      {
        id: "market-price",
        method: "GET",
        path: "/api/data/market-price",
        name: "Market Price Feed",
        description: "Real-time crypto market prices from CoinGecko with rank and 24h change.",
        params: "?ids=bitcoin,ethereum&vs=usd",
        exampleUrl: `${BASE_URL}/api/data/market-price?ids=bitcoin,ethereum&vs=usd`,
      },
    ],
  },
  {
    groupId: "news-feeds",
    label: "News Feeds",
    icon: "news",
    accent: "#8a6020",
    accentBorder: "rgba(138,96,32,0.22)",
    accentMuted: "rgba(138,96,32,0.07)",
    accentStrip: "linear-gradient(90deg, transparent, rgba(138,96,32,0.35), transparent)",
    apis: [
      {
        id: "news-categories",
        method: "GET",
        path: "/api/news/categories",
        name: "News Categories",
        description: "Available news category definitions with normalized IDs.",
        params: "",
        exampleUrl: `${BASE_URL}/api/news/categories`,
      },
      {
        id: "news-hot",
        method: "GET",
        path: "/api/news/hot",
        name: "Hot News",
        description: "Top trending news items across all categories, ranked by AI score.",
        params: "?limit=5",
        exampleUrl: `${BASE_URL}/api/news/hot?limit=5`,
      },
      {
        id: "news-signals",
        method: "GET",
        path: "/api/news/signals",
        name: "News Signals",
        description: "Market signal articles normalized to long / short / neutral.",
        params: "?limit=5",
        exampleUrl: `${BASE_URL}/api/news/signals?limit=5`,
      },
      {
        id: "news-listings",
        method: "GET",
        path: "/api/news/listings",
        name: "Listing Alerts",
        description: "New token listing and exchange announcement articles.",
        params: "?limit=5",
        exampleUrl: `${BASE_URL}/api/news/listings?limit=5`,
      },
      {
        id: "news-memes",
        method: "GET",
        path: "/api/news/memes",
        name: "Meme Sentiment",
        description: "Meme coin social sentiment articles with source URL and publishedAt.",
        params: "?limit=5",
        exampleUrl: `${BASE_URL}/api/news/memes?limit=5`,
      },
    ],
  },
];

const TOTAL_APIS = API_GROUPS.reduce((sum, g) => sum + g.apis.length, 0);

// ── Helpers ───────────────────────────────────────────────────────────────────

function useClipboard(ms = 1600) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), ms);
  }
  return { copied, copy };
}

function buildCurlSnippet(api: DataApiDef): string {
  return (
    `# No wallet required — viewer key optional\n` +
    `curl -H "x-api-key: <your-key>" \\\n` +
    `  "${api.exampleUrl}"`
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TerminalBlock({
  code,
  copyKey,
  copied,
  onCopy,
  accentColor,
}: {
  code: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  accentColor: string;
}) {
  const isCopied = copied === copyKey;

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(20,22,14,0.15)]">
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#1c1e12] px-3.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span
            className="ml-3 text-[11px] text-white/25"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            curl
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
            const isComment = trimmed.startsWith("#");
            return (
              <span key={i}>
                {isComment ? (
                  <span style={{ color: accentColor, opacity: 0.75 }}>{line}</span>
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

function ApiRow({
  api,
  accent,
  isLast,
  copied,
  onCopy,
}: {
  api: DataApiDef;
  accent: string;
  isLast: boolean;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const snippet = buildCurlSnippet(api);

  return (
    <div className={`${isLast ? "" : "border-b border-[rgba(90,80,50,0.08)]"}`}>
      {/* summary row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-[rgba(90,80,50,0.03)]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{
              background: "rgba(74,90,32,0.08)",
              color: accent,
              border: `1px solid rgba(74,90,32,0.18)`,
            }}
          >
            {api.method}
          </span>
          <div className="min-w-0">
            <span
              className="block text-[12px] font-medium text-[#18180e]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              {api.path}
              {api.params ? (
                <span className="text-[#9e8e76]">{api.params}</span>
              ) : null}
            </span>
            <span className="block truncate text-[11px] text-[#9e8e76]">{api.name}</span>
          </div>
        </div>
        <span
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wide transition"
          style={{ color: open ? accent : "#b0a08a" }}
        >
          {open ? "hide" : "how to call"}
        </span>
      </button>

      {/* expanded curl */}
      {open ? (
        <div className="px-4 pb-4">
          <p className="mb-2 text-[11px] text-[#9e8e76]">{api.description}</p>
          <TerminalBlock
            code={snippet}
            copyKey={`curl-${api.id}`}
            copied={copied}
            onCopy={onCopy}
            accentColor={accent}
          />
          <p className="mt-2 text-[11px] text-[#b0a08a]">
            Response includes{" "}
            <code
              className="rounded bg-[rgba(90,80,50,0.08)] px-1 py-0.5 text-[10px] text-[#7a6e56]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              sourceUrl
            </code>
            {" "}and{" "}
            <code
              className="rounded bg-[rgba(90,80,50,0.08)] px-1 py-0.5 text-[10px] text-[#7a6e56]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              fetchedAt
            </code>
            {" "}for independent verification.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function GroupCard({
  group,
  index,
  copied,
  onCopy,
}: {
  group: ApiGroup;
  index: number;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const Icon = group.icon === "news" ? Newspaper : Database;

  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.48, delay: index * 0.12, ease: "easeOut" }}
      className="relative flex flex-col overflow-hidden rounded-2xl border bg-[#f2ebe0]"
      style={{ borderColor: "rgba(90,80,50,0.14)" }}
    >
      <div className="h-[1.5px] w-full" style={{ background: group.accentStrip }} />

      <div className="flex flex-col gap-5 p-6 md:p-7">
        {/* header */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: group.accentMuted,
              border: `1px solid ${group.accentBorder}`,
              color: group.accent,
            }}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-[#18180e]">{group.label}</h3>
            <p className="text-[12px] text-[#9e8e76]">
              {group.apis.length} endpoint{group.apis.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* api rows */}
        <div className="overflow-hidden rounded-xl border border-[rgba(90,80,50,0.12)] bg-[#faf7f1]">
          {group.apis.map((api, i) => (
            <ApiRow
              key={api.id}
              api={api}
              accent={group.accent}
              isLast={i === group.apis.length - 1}
              copied={copied}
              onCopy={onCopy}
            />
          ))}
        </div>
      </div>
    </motion.article>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function DataApiSection() {
  const { copied, copy } = useClipboard();

  return (
    <section id="data-apis" className="bg-[#faf7f1] px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#8a6020]">
            Data APIs
          </span>
          <h2 className="font-display text-[2.4rem] font-normal leading-tight tracking-tight text-[#18180e]">
            {TOTAL_APIS} data endpoints, no wallet required.
          </h2>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
            Weather, market prices, tech buzz, and news feeds — all normalized with{" "}
            <code
              className="rounded bg-[rgba(90,80,50,0.08)] px-1.5 py-0.5 text-[13px]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              sourceUrl
            </code>{" "}
            and{" "}
            <code
              className="rounded bg-[rgba(90,80,50,0.08)] px-1.5 py-0.5 text-[13px]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              fetchedAt
            </code>{" "}
            for verifiable provenance.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {API_GROUPS.map((group, idx) => (
            <GroupCard
              key={group.groupId}
              group={group}
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
          All responses include{" "}
          <code
            className="rounded bg-[rgba(90,80,50,0.08)] px-1.5 py-0.5 text-[11px] text-[#7a6e56]"
            style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
          >
            sourceUrl · sourceName · publishedAt · fetchedAt
          </code>
        </motion.p>
      </div>
    </section>
  );
}
