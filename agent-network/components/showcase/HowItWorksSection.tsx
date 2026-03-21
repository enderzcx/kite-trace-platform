"use client";

import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, LockKeyhole, Wallet } from "lucide-react";

const commerceLanes = [
  {
    title: "Direct Buy",
    tone: "from-cyan-400/18 to-blue-400/8",
    steps: ["Discover", "Pay (x402)", "Result", "Evidence"],
  },
  {
    title: "Negotiated Buy",
    tone: "from-blue-400/18 to-violet-400/8",
    steps: ["Negotiate (XMTP)", "Pay (x402)", "Result", "Evidence"],
  },
  {
    title: "Escrow Job",
    tone: "from-emerald-400/18 to-cyan-400/8",
    steps: ["Negotiate", "Escrow (ERC-8183)", "Submit", "Evaluate", "Settle", "Evidence"],
  },
];

function StepPill({ label }: { label: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm text-slate-100">
      {label}
    </div>
  );
}

export default function HowItWorksSection() {
  return (
    <section className="space-y-8" id="how-it-works">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/80">How It Works</p>
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
          Commerce flow, authorization model, and audit surface.
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-300">
          Builders should be able to understand the whole system in one glance: discovery,
          payment, constrained execution, and exported proof.
        </p>
      </div>

      <div className="grid gap-6">
        <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(6,12,24,0.95),rgba(4,7,18,0.92))] p-6 shadow-2xl shadow-black/20">
          <div className="mb-6 flex items-center gap-3">
            <BadgeCheck className="h-5 w-5 text-cyan-300" />
            <h3 className="text-2xl font-semibold text-white">Commerce flow diagram</h3>
          </div>
          <div className="space-y-4">
            {commerceLanes.map((lane, laneIndex) => (
              <motion.div
                key={lane.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.35, delay: laneIndex * 0.06 }}
                className={`rounded-[1.6rem] border border-white/8 bg-gradient-to-r ${lane.tone} p-5`}
              >
                <div className="mb-4 text-lg font-semibold text-white">{lane.title}</div>
                <div className="flex flex-wrap items-center gap-3">
                  {lane.steps.map((step, index) => (
                    <div key={`${lane.title}-${step}`} className="flex items-center gap-3">
                      <StepPill label={step} />
                      {index < lane.steps.length - 1 ? (
                        <ArrowRight className="h-4 w-4 text-slate-500" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(10,18,36,0.95),rgba(4,8,18,0.92))] p-6 shadow-2xl shadow-black/20">
          <div className="mb-6 flex items-center gap-3">
            <LockKeyhole className="h-5 w-5 text-emerald-300" />
            <h3 className="text-2xl font-semibold text-white">Authorization model</h3>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">User EOA</p>
              <p className="mt-3 text-xl font-semibold text-white">Signs the permission</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                The user wallet authorizes a constrained spending session instead of handing over a
                private key.
              </p>
            </div>
            <ArrowRight className="hidden h-5 w-5 text-slate-500 lg:block" />
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-cyan-300" />
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">AA Wallet + Session Key</p>
              </div>
              <p className="mt-3 text-xl font-semibold text-white">Time window + spend limit</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                The agent executes with a revocable session key bounded by value limits and
                validity window.
              </p>
            </div>
            <ArrowRight className="hidden h-5 w-5 text-slate-500 lg:block" />
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Evidence</p>
              <p className="mt-3 text-xl font-semibold text-white">authorizedBy = User EOA</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Every successful call can export proof that ties payment, result, and the
                authorization context together.
              </p>
            </div>
          </div>
          <p className="mt-5 text-sm text-slate-300">
            The agent never holds your primary private key. It only uses a constrained session key
            you can revoke at any time.
          </p>
        </div>
      </div>
    </section>
  );
}
