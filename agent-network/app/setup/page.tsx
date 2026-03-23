import SetupWizardClient from "@/components/setup/SetupWizardClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Setup | Kite Trace",
  description:
    "Connect your wallet, authorize a session, generate an API key, and access KTrace through the public MCP endpoint.",
};

export interface CapabilityInfo {
  id: string;
  name: string;
  providerId: string;
}

async function fetchCapabilities(): Promise<CapabilityInfo[]> {
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
      capabilities?: Array<{
        id?: string;
        capabilityId?: string;
        name?: string;
        providerId?: string;
        active?: boolean;
      }>;
    };
    const list = json.capabilities ?? [];
    return list
      .filter((c) => c.active !== false)
      .map((c) => ({
        id: (c.id ?? c.capabilityId ?? "").trim(),
        name: (c.name ?? "").trim(),
        providerId: (c.providerId ?? "").trim(),
      }))
      .filter((c) => Boolean(c.id));
  } catch {
    return [];
  }
}

export default async function SetupPage() {
  const capabilities = await fetchCapabilities();
  return <SetupWizardClient capabilities={capabilities} />;
}
