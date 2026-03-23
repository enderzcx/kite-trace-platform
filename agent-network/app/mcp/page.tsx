const BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "https://kiteclaw.duckdns.org").replace(/\/+$/, "");
const MCP_ENDPOINT = `${BASE_URL}/mcp`;
const WELL_KNOWN_ENDPOINT = `${BASE_URL}/.well-known/mcp.json`;

export const metadata = {
  title: "MCP Access | Kite Trace",
  description: "Connect directly to the public KTrace MCP endpoint.",
};

const MCP_CONFIG = `{
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

export default function McpPage() {
  return (
    <main className="min-h-screen bg-[#faf7f1] px-6 py-16 text-[#18180e]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8a6020]">
            Public MCP Access
          </span>
          <h1 className="font-display text-[2.8rem] leading-tight tracking-tight">
            Connect to KTrace through one public endpoint.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-[#7a6e56]">
            Generate an account-scoped API key, point your MCP client at the public endpoint,
            and start calling KTrace tools directly.
          </p>
        </div>

        <div className="rounded-3xl border border-[rgba(90,80,50,0.14)] bg-white/70 p-6">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">
                Endpoints
              </p>
              <div className="mt-3 flex flex-col gap-3">
                <div className="rounded-2xl border border-[rgba(74,90,32,0.14)] bg-[#f2ebe0] px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">
                    MCP
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-[#2f351a]">{MCP_ENDPOINT}</div>
                </div>
                <div className="rounded-2xl border border-[rgba(74,90,32,0.14)] bg-[#f2ebe0] px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">
                    Well-Known
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-[#2f351a]">{WELL_KNOWN_ENDPOINT}</div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">
                Authentication
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[#7a6e56]">
                Use an account-scoped API key in the <code className="font-mono">x-api-key</code> header.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">
                Example Config
              </p>
              <pre className="mt-3 overflow-x-auto rounded-2xl bg-[#141608] p-4 text-[12px] leading-[1.7] text-[#c8c2a8]">
                <code>{MCP_CONFIG}</code>
              </pre>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9e8e76]">
                What You Can Call
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  "ktrace__cap_news_signal",
                  "ktrace__cap_listing_alert",
                  "ktrace__job_show",
                  "ktrace__job_claim",
                  "ktrace__job_submit",
                  "ktrace__artifact_evidence",
                ].map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-[rgba(74,90,32,0.18)] bg-[rgba(74,90,32,0.05)] px-3 py-1 text-[11px] text-[#3a4220]"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
