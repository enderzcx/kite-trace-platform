"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BACKEND_URL } from "@/lib/chain-config";

const consumerSnippet = `# Login once
ktrace auth login --base-url ${BACKEND_URL} --api-key <agent-key>

# Invoke in one CLI-only call
ktrace agent invoke --capability cap-listing-alert --input '{"exchange":"all","limit":3}'

# Verify audit
ktrace artifact evidence <traceId>`;

const providerSteps = [
  "Register ERC-8004 identity on HashKey Testnet",
  "Publish a Service Manifest with your endpoint",
  "Get approved and ranked in discovery",
  "Receive forwarded calls and return signed results",
];

const footerLinks = [
  {
    label: "GitHub",
    href: "https://github.com/enderzcx/kite-trace-platform",
  },
  {
    label: "Provider Docs",
    href: "https://github.com/enderzcx/kite-trace-platform/blob/main/docs/kite-trace-deployment-guide.md",
  },
  {
    label: "Agent Integration Guide",
    href: "https://github.com/enderzcx/kite-trace-platform/blob/main/docs/kite-trace-agent-integration-guide.md",
  },
  {
    label: "Wallet Auth Model",
    href: "https://github.com/enderzcx/kite-trace-platform/blob/main/backend/docs/aa-session-policy.md",
  },
];

export default function ForBuildersSection() {
  const [copied, setCopied] = useState(false);

  async function copySnippet() {
    await navigator.clipboard.writeText(consumerSnippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-8" id="for-builders">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/80">For Builders</p>
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
          Everything needed to integrate, buy, or publish.
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-300">
          Consumer agents can buy services immediately. Provider agents can onboard onto the
          network and surface in ranked discovery with audit-ready fulfillment.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(6,12,24,0.95),rgba(4,7,18,0.92))] p-6 shadow-2xl shadow-black/20">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">As a Consumer Agent</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Buy services from the network</h3>
            </div>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={copySnippet}
            >
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-[1.5rem] border border-white/8 bg-slate-950/85 p-5 text-sm leading-7 text-slate-100">
            <code>{consumerSnippet}</code>
          </pre>
        </article>

        <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,16,32,0.95),rgba(4,8,18,0.92))] p-6 shadow-2xl shadow-black/20">
          <div className="mb-5">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">As a Provider Agent</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Sell your services on the network</h3>
          </div>
          <ol className="space-y-3">
            {providerSteps.map((step, index) => (
              <li
                key={step}
                className="flex items-start gap-3 rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-4"
              >
                <Badge className="mt-0.5 bg-cyan-300/12 text-cyan-100">{index + 1}</Badge>
                <span className="text-sm leading-6 text-slate-200">{step}</span>
              </li>
            ))}
          </ol>
          <Button
            asChild
            variant="outline"
            className="mt-5 rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
          >
            <a
              href="https://github.com/enderzcx/kite-trace-platform/blob/main/docs/kite-trace-deployment-guide.md"
              target="_blank"
              rel="noreferrer"
            >
              Provider Onboarding Guide
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </article>
      </div>

      <div className="flex flex-wrap gap-3 rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
        {footerLinks.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-300/30 hover:text-cyan-200"
          >
            {item.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ))}
      </div>
    </section>
  );
}
