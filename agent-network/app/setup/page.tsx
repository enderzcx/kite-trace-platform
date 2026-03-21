import SetupWizardClient from "@/components/setup/SetupWizardClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Setup — Kite Trace",
  description:
    "Connect your wallet, authorize a session, and get your MCP API key to use Kite Trace with Claude Desktop.",
};

// Fetch the available capability IDs server-side so the wizard can populate
// the allowedCapabilities checkbox list without an extra client-side round trip.
async function fetchCapabilities(): Promise<string[]> {
  try {
    const backendUrl = (process.env.BACKEND_URL ?? "").replace(/\/+$/, "");
    if (!backendUrl) return [];
    const apiKey = process.env.DEMO_API_KEY?.trim() ?? "";
    const res = await fetch(`${backendUrl}/api/v1/capabilities?limit=200`, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      capabilities?: Array<{ id?: string; capabilityId?: string }>;
    };
    const list = json.capabilities ?? [];
    return list
      .map((c) => (c.id ?? c.capabilityId ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export default async function SetupPage() {
  const capabilities = await fetchCapabilities();
  return <SetupWizardClient capabilities={capabilities} />;
}
