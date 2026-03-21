import Link from "next/link";
import { Suspense } from "react";
import { Github } from "lucide-react";
import AuditExplorer from "@/components/showcase/AuditExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Audit Explorer | Kite Trace",
};

export default function AuditPage() {
  return (
    <div className="min-h-screen bg-[#faf7f1] text-[#18180e] antialiased">
      {/* Navigation */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(90,80,50,0.1)] bg-[#faf7f1]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-6 w-6 select-none items-center justify-center rounded-md bg-[#3a4220] text-[9px] font-bold leading-none text-[#faf7f1]">
              KT
            </span>
            <span className="text-[13px] font-semibold tracking-tight text-[#18180e] transition-colors group-hover:text-[#3a4220]">
              Kite Trace
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className="rounded-md px-3 py-1.5 text-[13px] text-[#7a6e56] transition hover:bg-[rgba(58,66,32,0.06)] hover:text-[#18180e]"
            >
              Home
            </Link>
            <Link
              href="/audit"
              className="rounded-md bg-[rgba(58,66,32,0.08)] px-3 py-1.5 text-[13px] font-medium text-[#18180e]"
            >
              Audit
            </Link>
            <div className="mx-2 h-4 w-px bg-[rgba(90,80,50,0.18)]" />
            <a
              href="https://github.com/enderzcx/kite-trace-platform"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(58,66,32,0.22)] bg-[rgba(58,66,32,0.06)] px-3.5 py-1.5 text-[13px] text-[#3a4220] transition hover:border-[rgba(58,66,32,0.35)] hover:bg-[rgba(58,66,32,0.1)]"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
            </a>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="pt-14">
        <Suspense fallback={null}>
          <AuditExplorer />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="border-t border-[rgba(90,80,50,0.1)] bg-[#f2ebe0] px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[#3a4220] text-[9px] font-bold leading-none text-[#faf7f1]">
              KT
            </span>
            <div>
              <p className="text-[13px] font-semibold text-[#18180e]">Kite Trace Platform</p>
              <p className="text-[12px] text-[#9e8e76]">Trust · Commerce · Audit on Kite Testnet</p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-[12px] text-[#9e8e76]">
            <a
              href="https://github.com/enderzcx/kite-trace-platform"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[#3a4220]"
            >
              GitHub
            </a>
            <a
              href="https://testnet.kitescan.ai/address/0x60BF18964FCB1B2E987732B0477E51594B3659B1"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[#3a4220]"
            >
              Identity Registry
            </a>
            <a
              href="https://kiteclaw.duckdns.org/api/public/health"
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
