"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Anchor,
  ExternalLink,
  Search,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { BACKEND_URL, CONTRACTS, txUrl, addressUrl } from "@/lib/chain-config";

const USE_MOCK = process.env.NEXT_PUBLIC_TRUST_MOCK === "true";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChainProfile = {
  agentId: string;
  identity: {
    tokenId: string;
    ownerOf: string;
    registry: string;
    registryUrl: string;
  };
  onchain: {
    configured: boolean;
    anchorCount: number;
    latestAnchorId: string;
    latestAnchorTxHash: string;
    registryAddress: string;
  };
  reputation: {
    totalSignals: number;
    positiveCount: number;
    negativeCount: number;
    successRate: number;
    averageScore: number;
    latestAt: string;
  };
  publications: {
    total: number;
    published: number;
    latestAnchorTxHash: string;
  };
};

type Publication = {
  publicationId: string;
  publicationType: string;
  agentId: string;
  anchorTxHash: string;
  publicationRef: string;
  status: string;
  createdAt: string;
};

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_PROFILE: ChainProfile = {
  agentId: "agent-007",
  identity: {
    tokenId: "42",
    ownerOf: "0x7C3a98E5B1a3dE1F5c0a9B2e8D4f6A0E9C1b3D5f",
    registry: CONTRACTS.identityRegistry,
    registryUrl: addressUrl(CONTRACTS.identityRegistry),
  },
  onchain: {
    configured: true,
    anchorCount: 24,
    latestAnchorId: "88",
    latestAnchorTxHash: "0xabc123def456789012345678901234567890abcdef1234567890abcdef123456",
    registryAddress: CONTRACTS.identityRegistry,
  },
  reputation: {
    totalSignals: 24,
    positiveCount: 22,
    negativeCount: 2,
    successRate: 0.917,
    averageScore: 0.91,
    latestAt: "2026-03-20T10:42:00.000Z",
  },
  publications: {
    total: 3,
    published: 3,
    latestAnchorTxHash: "0xabc123def456789012345678901234567890abcdef1234567890abcdef123456",
  },
};

const MOCK_PUBLICATIONS: Publication[] = [
  {
    publicationId: "pub-88",
    publicationType: "job-completion",
    agentId: "agent-007",
    anchorTxHash: "0xabc123def456789012345678901234567890abcdef1234567890abcdef123456",
    publicationRef: "job-001",
    status: "published",
    createdAt: "2026-03-20T10:42:00.000Z",
  },
  {
    publicationId: "pub-72",
    publicationType: "validation",
    agentId: "agent-007",
    anchorTxHash: "0xdef456789012345678901234567890abcdef1234567890abcdef123456789012",
    publicationRef: "job-002",
    status: "published",
    createdAt: "2026-03-18T14:20:00.000Z",
  },
  {
    publicationId: "pub-61",
    publicationType: "reputation",
    agentId: "agent-007",
    anchorTxHash: "0x123456789012345678901234567890abcdef1234567890abcdef456789012345",
    publicationRef: "rep-batch-3",
    status: "published",
    createdAt: "2026-03-15T09:10:00.000Z",
  },
];

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

function pct(value?: number) {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchProfile(agentId: string): Promise<ChainProfile | null> {
  if (USE_MOCK) return MOCK_PROFILE;
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/trust/chain-profile?agentId=${encodeURIComponent(agentId)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as ChainProfile;
  } catch {
    return null;
  }
}

async function fetchPublications(agentId: string): Promise<Publication[]> {
  if (USE_MOCK) return MOCK_PUBLICATIONS;
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/trust/publications?agentId=${encodeURIComponent(agentId)}&limit=10`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {[120, 120, 120].map((h, i) => (
          <div key={i} className="rounded-2xl bg-[rgba(90,80,50,0.07)]" style={{ height: h }} />
        ))}
      </div>
      <div className="rounded-2xl bg-[rgba(90,80,50,0.07)]" style={{ height: 200 }} />
    </div>
  );
}

// ── Mono text ─────────────────────────────────────────────────────────────────

const mono = { fontFamily: "var(--font-jetbrains-mono, monospace)" };

// ── Summary cards ─────────────────────────────────────────────────────────────

function IdentityCard({ profile }: { profile: ChainProfile }) {
  const id = profile.identity;
  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="size-4 text-[#3a4220]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
          On-chain Identity
        </p>
      </div>
      <p className="text-[22px] font-semibold text-[#3a4220]" style={mono}>
        ERC-8004 #{id.tokenId || "-"}
      </p>
      <p className="mt-2 text-[11px] text-[#7a6e56]">
        Owner{" "}
        <span style={mono}>{shorten(id.ownerOf, 6, 4)}</span>
      </p>
      {id.registry ? (
        <a
          href={addressUrl(id.registry)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:underline"
        >
          Registry on Explorer
          <ExternalLink className="size-3 opacity-60" />
        </a>
      ) : null}
    </div>
  );
}

function ReputationCard({ profile }: { profile: ChainProfile }) {
  const r = profile.reputation;
  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp className="size-4 text-[#3a4220]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
          Reputation Score
        </p>
      </div>
      <p className="text-[28px] font-semibold text-[#3a4220]" style={mono}>
        {pct(r.successRate)}
      </p>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-[#7a6e56]">
        <span>{r.totalSignals} signals</span>
        <span className="text-[#c8b99a]">·</span>
        <span className="text-[#3a4220]">{r.positiveCount} positive</span>
        <span className="text-[#c8b99a]">·</span>
        <span className="text-[#9a4332]">{r.negativeCount} negative</span>
      </div>
      <p className="mt-1.5 text-[11px] text-[#9e8e76]">
        Avg score{" "}
        <span style={mono}>{r.averageScore?.toFixed(2) || "-"}</span>
      </p>
    </div>
  );
}

function AnchorsCard({ profile }: { profile: ChainProfile }) {
  const o = profile.onchain;
  return (
    <div className="rounded-2xl border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0] px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Anchor className="size-4 text-[#3a4220]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">
          On-chain Anchors
        </p>
      </div>
      <p className="text-[28px] font-semibold text-[#3a4220]" style={mono}>
        {o.anchorCount}
      </p>
      <p className="mt-2 text-[11px] text-[#7a6e56]">
        Latest anchor{" "}
        <span style={mono}>#{o.latestAnchorId || "-"}</span>
      </p>
      {o.latestAnchorTxHash ? (
        <a
          href={txUrl(o.latestAnchorTxHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:underline"
        >
          <span style={mono}>{shorten(o.latestAnchorTxHash, 8, 6)}</span>
          <ExternalLink className="size-3 opacity-60" />
        </a>
      ) : null}
    </div>
  );
}

// ── Publications table ────────────────────────────────────────────────────────

function PublicationsList({ items }: { items: Publication[] }) {
  if (!items.length) return null;
  return (
    <div className="overflow-hidden rounded-[20px] border border-[rgba(58,66,32,0.2)] bg-[#f2ebe0]">
      <div className="border-b border-[rgba(90,80,50,0.08)] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9e8e76]">
          Recent Trust Publications
        </p>
      </div>
      <div className="divide-y divide-[rgba(90,80,50,0.06)]">
        {items.map((pub) => (
          <div key={pub.publicationId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.07)] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-[#3a4220]"
              >
                {pub.publicationType.replace(/-/g, " ")}
              </span>
              {pub.anchorTxHash ? (
                <a
                  href={txUrl(pub.anchorTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:underline"
                  style={mono}
                >
                  {shorten(pub.anchorTxHash, 8, 6)}
                  <ExternalLink className="size-3 opacity-60" />
                </a>
              ) : (
                <span className="text-[11px] text-[#9e8e76]" style={mono}>-</span>
              )}
            </div>
            <span className="text-[10px] text-[#b0a08a]">{fmt(pub.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Verification notice ───────────────────────────────────────────────────────

function VerificationNotice({ registryAddress }: { registryAddress?: string }) {
  return (
    <div className="rounded-2xl border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.04)] px-5 py-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#3a4220]" />
        <div>
          <p className="text-[12px] font-medium text-[#3a4220]">Independent Verification</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#7a6e56]">
            All on-chain records above can be independently verified via the{" "}
            <span className="font-medium text-[#3a4220]">TrustPublicationAnchorV1</span> contract on
            HashKey Testnet. No trust in this platform is required.
          </p>
          {registryAddress ? (
            <a
              href={addressUrl(registryAddress)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#3a4220] transition hover:underline"
            >
              View contract on Explorer
              <ExternalLink className="size-3 opacity-60" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Teaser (idle state) ───────────────────────────────────────────────────────

function TeaserCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="overflow-hidden rounded-[20px] border border-[rgba(90,80,50,0.14)] bg-[#f2ebe0]"
    >
      <div className="border-b border-[rgba(90,80,50,0.08)] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3a4220]">
            <ShieldCheck className="size-3" />
            Trust Profile
          </span>
          <span className="text-[11px] text-[#9e8e76]">— enter an Agent ID above to inspect</span>
        </div>
      </div>

      <div className="select-none p-5">
        <div className="grid gap-4 md:grid-cols-3 blur-[3px] opacity-60">
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Identity</p>
            <p className="mt-1 text-[16px] font-semibold text-[#3a4220]" style={mono}>ERC-8004 #42</p>
          </div>
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Reputation</p>
            <p className="mt-1 text-[16px] font-semibold text-[#3a4220]" style={mono}>91%</p>
          </div>
          <div className="rounded-2xl border border-[rgba(90,80,50,0.1)] bg-[#faf7f1] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9e8e76]">Anchors</p>
            <p className="mt-1 text-[16px] font-semibold text-[#3a4220]" style={mono}>24</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type UIState = "idle" | "loading" | "success" | "error";

function readInitialAgentId() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return (params.get("agentId") || params.get("agent") || "").trim();
}

export default function TrustProfileClient() {
  const [initialAgentId] = useState(() => readInitialAgentId());
  const [input, setInput] = useState(initialAgentId);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [profile, setProfile] = useState<ChainProfile | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (agentId: string) => {
    const id = (agentId || input).trim();
    if (!id) return;
    setUiState("loading");
    setProfile(null);
    setPublications([]);
    const [profileResult, pubsResult] = await Promise.all([
      fetchProfile(id),
      fetchPublications(id),
    ]);
    if (profileResult) {
      setProfile(profileResult);
      setPublications(pubsResult);
      setUiState("success");
    } else {
      setUiState("error");
    }
  };

  useEffect(() => {
    if (initialAgentId) {
      const timer = window.setTimeout(() => {
        void run(initialAgentId);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void run(input);
  }

  return (
    <section className="bg-[#faf7f1] px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        {/* heading */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
          className="mb-10 flex flex-col gap-3"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#3a4220]">
            Trust Profile
          </span>
          <h2 className="font-display text-[2.4rem] font-normal leading-tight tracking-tight text-[#18180e]">
            Verify any agent,{" "}
            <em className="not-italic text-[#3a4220]">on-chain.</em>
          </h2>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#7a6e56]">
            Enter an Agent ID to see its full on-chain trust profile — identity, reputation, and
            anchored publications. Every record is independently verifiable on HashKey Testnet.
          </p>
        </motion.div>

        {/* search */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.42, delay: 0.08, ease: "easeOut" }}
          className="mb-8 flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#b0a08a]" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="agent-007"
              spellCheck={false}
              autoComplete="off"
              className="h-11 w-full rounded-2xl border border-[rgba(90,80,50,0.18)] bg-[#f2ebe0] pl-9 pr-4 text-[13px] text-[#18180e] outline-none placeholder:text-[#c8b99a] focus:border-[rgba(58,66,32,0.4)] focus:ring-2 focus:ring-[rgba(58,66,32,0.08)] transition"
              style={mono}
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || uiState === "loading"}
            className="h-11 rounded-2xl bg-[#3a4220] px-5 text-[13px] font-semibold text-[#faf7f1] transition hover:bg-[#2d3319] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uiState === "loading" ? "Loading…" : "Lookup"}
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
              className="rounded-2xl border border-[rgba(180,60,40,0.18)] bg-[rgba(180,60,40,0.04)] px-5 py-4 text-center"
            >
              <p className="text-[13px] text-[#9a4332]">
                No trust profile found for this Agent ID. Check the ID and try again.
              </p>
            </motion.div>
          )}

          {uiState === "success" && profile && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38 }}
              className="flex flex-col gap-5"
            >
              {/* agent id header */}
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.16)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3a4220]">
                  <ShieldCheck className="size-3" />
                  Trust Profile
                </span>
                <span className="text-[12px] text-[#7a6e56]" style={mono}>
                  {profile.agentId}
                </span>
              </div>

              {/* three summary cards */}
              <div className="grid gap-4 md:grid-cols-3">
                <IdentityCard profile={profile} />
                <ReputationCard profile={profile} />
                <AnchorsCard profile={profile} />
              </div>

              {/* publications */}
              <PublicationsList items={publications} />

              {/* verification notice */}
              <VerificationNotice registryAddress={profile.onchain.registryAddress} />
            </motion.div>
          )}

          {uiState === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <TeaserCard />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
