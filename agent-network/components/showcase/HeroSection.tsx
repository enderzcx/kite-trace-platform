"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, Github, Zap } from "lucide-react";
import { fallbackHealthStats, type ShowcaseHealthStats } from "@/components/showcase/showcase-data";

interface HeroSectionProps {
  stats?: Partial<ShowcaseHealthStats>;
}

/* Organic blob dot cluster */
function DotBlob({
  className,
  style,
  driftClass,
}: {
  className?: string;
  style?: React.CSSProperties;
  driftClass?: string;
}) {
  return (
    <div className={`pointer-events-none absolute ${driftClass ?? ""} ${className ?? ""}`} style={style}>
      <div
        className="dot-blob h-full w-full"
        style={{
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 70% at 50% 50%, black 40%, transparent 75%)",
          maskImage:
            "radial-gradient(ellipse 70% 70% at 50% 50%, black 40%, transparent 75%)",
        }}
      />
    </div>
  );
}

export default function HeroSection({ stats }: HeroSectionProps) {
  const [liveNetwork, setLiveNetwork] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((p: { network?: string }) => {
        if (!cancelled && p?.network) setLiveNetwork(String(p.network));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const merged: ShowcaseHealthStats = {
    ...fallbackHealthStats,
    ...stats,
    ...(liveNetwork ? { network: liveNetwork } : {}),
  };

  return (
    <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-6 py-32 text-center bg-[#faf7f1]">

      {/* ── Amber dot blobs (gokite.ai style) ─────────────── */}

      {/* Left — large organic blob */}
      <DotBlob
        driftClass="drift-a"
        style={{
          left: "-4%",
          top: "8%",
          width: "36%",
          height: "70%",
          borderRadius: "62% 38% 46% 54% / 60% 44% 56% 40%",
        }}
      />

      {/* Top right — medium blob */}
      <DotBlob
        driftClass="drift-b"
        style={{
          right: "-3%",
          top: "4%",
          width: "30%",
          height: "50%",
          borderRadius: "40% 60% 55% 45% / 50% 55% 45% 50%",
        }}
      />

      {/* Bottom right — small accent blob */}
      <DotBlob
        style={{
          right: "10%",
          bottom: "6%",
          width: "18%",
          height: "30%",
          borderRadius: "50% 50% 60% 40% / 55% 45% 55% 45%",
        }}
      />

      {/* Top center — tiny scatter */}
      <DotBlob
        style={{
          left: "34%",
          top: "2%",
          width: "16%",
          height: "20%",
          borderRadius: "45% 55% 50% 50% / 55% 50% 50% 45%",
        }}
      />

      {/* ── Content ──────────────────────────────────────── */}
      <div className="relative z-10 flex max-w-4xl flex-col items-center gap-9">

        {/* Label */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(58,66,32,0.2)] bg-[rgba(58,66,32,0.07)] px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#3a4220]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3a4220] opacity-70" />
            Kite Trace Platform
          </span>
        </motion.div>

        {/* Headline — Crimson Text for editorial gravitas */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: "easeOut" }}
          className="flex flex-col items-center gap-2"
        >
          <h1
            className="font-display text-[clamp(2.8rem,7.5vw,5rem)] font-normal leading-[1.08] tracking-tight text-[#18180e]"
          >
            The Audit Layer for
          </h1>
          <h1
            className="font-display italic text-[clamp(2.8rem,7.5vw,5rem)] font-normal leading-[1.08] tracking-tight text-[#3a4220]"
          >
            Agent Commerce.
          </h1>
        </motion.div>

        {/* Subheading */}
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
          className="max-w-[460px] text-[15px] leading-[1.72] text-[#7a6e56]"
          style={{ fontFamily: "var(--font-dm-sans)" }}
        >
          Open infrastructure for trust, x402 payments, and verifiable on-chain
          evidence in autonomous agent networks. Built on HashKey Testnet.
        </motion.p>

        {/* Stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.28, ease: "easeOut" }}
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
        >
          <span className="flex items-center gap-1.5 text-[12px] text-[#9e8e76]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#5a7a20]" />
            <span className="font-semibold text-[#5c5544]">{merged.agentsLive}</span>&nbsp;agents live
          </span>
          <span className="h-3 w-px bg-[rgba(90,80,50,0.18)]" />
          <span className="text-[12px] text-[#9e8e76]">
            <span className="font-semibold text-[#5c5544]">{merged.capabilityCount}</span>&nbsp;capabilities
          </span>
          <span className="h-3 w-px bg-[rgba(90,80,50,0.18)]" />
          <span className="text-[12px] text-[#9e8e76]">{merged.network}</span>
          <span className="h-3 w-px bg-[rgba(90,80,50,0.18)]" />
          <span className="text-[12px] text-[#9e8e76]">{merged.standards}</span>
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.38, ease: "easeOut" }}
          className="flex flex-col items-center gap-3 sm:flex-row"
        >
          {/* Primary: Get Started */}
          <a
            href="/setup"
            className="group inline-flex h-11 items-center gap-2 rounded-full bg-[#3a4220] px-7 text-[13px] font-semibold text-[#faf7f1] transition hover:bg-[#4d5a2a] hover:shadow-[0_4px_20px_rgba(58,66,32,0.35)]"
            style={{ fontFamily: "var(--font-dm-sans)" }}
          >
            <Zap className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
            Get Started
          </a>
          {/* Secondary: Explore */}
          <a
            href="#agents"
            className="group inline-flex h-11 items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-7 text-[13px] font-semibold text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.07)] hover:border-[rgba(58,66,32,0.35)]"
            style={{ fontFamily: "var(--font-dm-sans)" }}
          >
            Explore Agents
            <ArrowDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" />
          </a>
          {/* GitHub */}
          <a
            href="https://github.com/enderzcx/kite-trace-platform"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-[rgba(58,66,32,0.22)] bg-transparent px-7 text-[13px] font-semibold text-[#3a4220] transition hover:bg-[rgba(58,66,32,0.07)] hover:border-[rgba(58,66,32,0.35)]"
            style={{ fontFamily: "var(--font-dm-sans)" }}
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </motion.div>
      </div>

      {/* Bottom fade */}
      <div className="pointer-events-none absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-[#faf7f1] to-transparent" />
    </section>
  );
}
