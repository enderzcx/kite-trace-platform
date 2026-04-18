"use client";

import AgentNetworkSection from "@/components/showcase/AgentNetworkSection";
import HeroSection from "@/components/showcase/HeroSection";
import {
  fallbackCapabilities,
  fallbackHealthStats,
  fallbackProviders,
  type ShowcaseCapability,
  type ShowcaseHealthStats,
  type ShowcaseProvider,
} from "@/components/showcase/showcase-data";
import { Github, Zap } from "lucide-react";
import { BACKEND_URL, CONTRACTS, addressUrl } from "@/lib/chain-config";

interface ShowcasePageClientProps {
  healthStats?: ShowcaseHealthStats;
  providers?: ShowcaseProvider[];
  capabilities?: ShowcaseCapability[];
}

export default function ShowcasePageClient({
  healthStats,
  providers,
  capabilities: _capabilities,
}: ShowcasePageClientProps) {
  const liveProviders = providers?.length ? providers : fallbackProviders;
  const mergedStats = healthStats || {
    ...fallbackHealthStats,
    agentsLive: liveProviders.length || fallbackHealthStats.agentsLive,
    capabilityCount:
      (_capabilities?.length ?? fallbackCapabilities.length) || fallbackHealthStats.capabilityCount,
  };

  return (
    <div className="min-h-screen bg-[#faf7f1] text-[#18180e] antialiased">

      {/* ── Navigation ─────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(90,80,50,0.1)] bg-[#faf7f1]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2.5 group">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#3a4220] text-[9px] font-bold text-[#faf7f1] leading-none select-none">
              KT
            </span>
            <span className="text-[13px] font-semibold tracking-tight text-[#18180e] group-hover:text-[#3a4220] transition-colors">
              Kite Trace
            </span>
          </a>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            <a
              href="#agents"
              className="rounded-md px-3 py-1.5 text-[13px] text-[#7a6e56] transition hover:text-[#18180e] hover:bg-[rgba(58,66,32,0.06)]"
            >
              Agents
            </a>
            <a
              href="/audit"
              className="rounded-md px-3 py-1.5 text-[13px] text-[#7a6e56] transition hover:text-[#18180e] hover:bg-[rgba(58,66,32,0.06)]"
            >
              Audit
            </a>
            <a
              href="/demo"
              className="rounded-md px-3 py-1.5 text-[13px] text-[#7a6e56] transition hover:text-[#18180e] hover:bg-[rgba(58,66,32,0.06)]"
            >
              Live Demo
            </a>
            <a
              href="/trust"
              className="rounded-md px-3 py-1.5 text-[13px] text-[#7a6e56] transition hover:text-[#18180e] hover:bg-[rgba(58,66,32,0.06)]"
            >
              Trust
            </a>
            <div className="mx-2 h-4 w-px bg-[rgba(90,80,50,0.18)]" />
            <a
              href="https://github.com/enderzcx/kite-trace-platform"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.06)] px-3.5 py-1.5 text-[13px] text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.1)] hover:border-[rgba(58,66,32,0.35)]"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
            </a>
            <a
              href="/setup"
              className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-[#3a4220] px-3.5 py-1.5 text-[13px] font-semibold text-[#faf7f1] transition hover:bg-[#4d5a2a] hover:shadow-[0_2px_12px_rgba(58,66,32,0.3)]"
            >
              <Zap className="h-3 w-3" />
              Setup
            </a>
          </nav>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────── */}
      <main className="pt-14">
        <HeroSection stats={mergedStats} />

        <div className="mx-auto max-w-6xl px-6">
          <div className="h-px bg-[rgba(90,80,50,0.1)]" />
        </div>

        <AgentNetworkSection providers={liveProviders} />

      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-[rgba(90,80,50,0.1)] px-6 py-10 bg-[#f2ebe0]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[#3a4220] text-[9px] font-bold text-[#faf7f1] leading-none">
              KT
            </span>
            <div>
              <p className="text-[13px] font-semibold text-[#18180e]">Kite Trace Platform</p>
              <p className="text-[12px] text-[#9e8e76]">Trust · Commerce · Audit on HashKey Testnet</p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-[12px] text-[#9e8e76]">
            <a href="/setup" className="transition hover:text-[#3a4220]">
              Setup
            </a>
            <a href="/demo" className="transition hover:text-[#3a4220]">
              Live Demo
            </a>
            <a href="/authority" className="transition hover:text-[#3a4220]">
              Authority
            </a>
            <a href="/trust" className="transition hover:text-[#3a4220]">
              Trust
            </a>
            <a
              href="https://github.com/enderzcx/kite-trace-platform"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[#3a4220]"
            >
              GitHub
            </a>
            <a
              href={addressUrl(CONTRACTS.identityRegistry)}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[#3a4220]"
            >
              Identity Registry
            </a>
            <a
              href={`${BACKEND_URL}/api/public/health`}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[#3a4220]"
            >
              Health
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
