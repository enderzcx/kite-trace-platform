"use client";

import { ArrowRight } from "lucide-react";

export default function McpGuideClient() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#faf7f1_0%,#f6efe3_100%)] px-4">
      <div className="flex max-w-sm flex-col items-center gap-6 text-center">
        <span className="inline-flex rounded-full border border-[rgba(58,66,32,0.18)] bg-[rgba(58,66,32,0.07)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#3a4220]">
          MCP
        </span>
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight text-[#18180e]">
          Connect Claude to Kite Trace
        </h1>
        <p className="text-[14px] leading-relaxed text-[#7a6e56]">
          Complete the setup wizard to get your personalized bridge command. Takes under two minutes.
        </p>
        <a
          href="/setup"
          className="inline-flex items-center gap-2 rounded-full bg-[#3a4220] px-6 py-2.5 text-[13px] font-semibold text-[#faf7f1] transition hover:opacity-80"
        >
          Go to Setup <ArrowRight className="size-3.5" />
        </a>
      </div>
    </main>
  );
}
