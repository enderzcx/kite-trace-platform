import { Suspense } from "react";
import McpGuideClient from "../../components/mcp/McpGuideClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "MCP Consumer Onboarding — Kite Trace",
};

export default function McpGuidePage() {
  return (
    <Suspense fallback={null}>
      <McpGuideClient />
    </Suspense>
  );
}
