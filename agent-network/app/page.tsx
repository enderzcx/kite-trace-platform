import ShowcasePageClient from "@/components/showcase/ShowcasePageClient";
import {
  fallbackCapabilities,
  fallbackHealthStats,
  fallbackProviders,
  type ShowcaseCapability,
  type ShowcaseHealthStats,
  type ShowcaseProvider,
} from "@/components/showcase/showcase-data";
import { BACKEND_URL, addressUrl, CONTRACTS } from "@/lib/chain-config";

export const dynamic = "force-dynamic";

function buildHeaders() {
  const apiKey = process.env.DEMO_API_KEY?.trim();
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function prettyDefaultInput(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  return JSON.stringify(value, null, 2);
}

async function fetchJson<T>(pathname: string): Promise<T | null> {
  try {
    const response = await fetch(`${BACKEND_URL}${pathname}`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function mapCapabilities(payload: unknown): ShowcaseCapability[] {
  const response = payload as { items?: Array<Record<string, unknown>> } | null;
  if (!response?.items?.length) return fallbackCapabilities;

  return response.items.map((item) => {
    const existing =
      fallbackCapabilities.find(
        (capability) => capability.capabilityId === String(item.capabilityId || "")
      ) || fallbackCapabilities[0];
    const pricing =
      item.pricing && typeof item.pricing === "object"
        ? (item.pricing as Record<string, unknown>)
        : {};
    const discovery =
      item.discovery && typeof item.discovery === "object"
        ? (item.discovery as Record<string, unknown>)
        : {};

    return {
      capabilityId: String(item.capabilityId || existing.capabilityId),
      providerId: String(item.providerId || existing.providerId),
      name: String(item.name || existing.name),
      description: String(item.description || existing.description),
      price: `${String(pricing.amount || "0")} ${String(pricing.currency || "USDT")}`,
      tags: Array.isArray(discovery.tags)
        ? discovery.tags.map((tag) => String(tag))
        : existing.tags,
      defaultInput: prettyDefaultInput(item.exampleInput, existing.defaultInput),
    };
  });
}

function mapProviders(
  payload: unknown,
  capabilities: ShowcaseCapability[]
): ShowcaseProvider[] {
  const response = payload as { items?: Array<Record<string, unknown>> } | null;
  if (!response?.items?.length) return fallbackProviders;

  const providerItems = response.items.filter(
    (item) =>
      String(item.role || "") !== "router" &&
      String(item.onboardingSource || "") !== "system"
  );
  if (!providerItems.length) return fallbackProviders;

  return providerItems.map((item) => {
    const runtime =
      item.runtime && typeof item.runtime === "object"
        ? (item.runtime as Record<string, unknown>)
        : {};
    const identity =
      item.identity && typeof item.identity === "object"
        ? (item.identity as Record<string, unknown>)
        : {};
    const providerId = String(item.providerId || "");
    const fallback =
      fallbackProviders.find((provider) => provider.providerId === providerId) || fallbackProviders[0];
    const aaWalletAddress = String(runtime.aaAddress || fallback.aaWalletAddress || "");
    const ownerWalletAddress = String(runtime.ownerWallet || fallback.ownerWalletAddress || "");

    return {
      providerId: providerId || fallback.providerId,
      title: String(item.name || fallback.title),
      agentId: String(identity.agentId || fallback.agentId),
      description: String(item.description || fallback.description),
      aaWalletAddress,
      ownerWalletAddress,
      explorerUrl: aaWalletAddress
        ? addressUrl(aaWalletAddress)
        : fallback.explorerUrl,
      identityRegistryUrl:
        String(identity.registry || "")
          ? addressUrl(String(identity.registry))
          : fallback.identityRegistryUrl,
      capabilities: capabilities.filter(
        (capability) => capability.providerId === (providerId || fallback.providerId)
      ),
    };
  });
}

async function loadShowcaseData(): Promise<{
  healthStats: ShowcaseHealthStats;
  providers: ShowcaseProvider[];
  capabilities: ShowcaseCapability[];
}> {
  const [healthPayload, providersPayload, capabilitiesPayload] = await Promise.all([
    fetchJson<Record<string, unknown>>("/api/public/health"),
    fetchJson<Record<string, unknown>>("/api/v1/providers?discoverable=true"),
    fetchJson<Record<string, unknown>>("/api/v1/capabilities"),
  ]);

  const capabilities = mapCapabilities(capabilitiesPayload);
  const baseProviders = mapProviders(providersPayload, capabilities);

  // Enrich providers with trust profile data (graceful fallback if API not ready)
  const providers = await Promise.all(
    baseProviders.map(async (p) => {
      if (!p.agentId) return p;
      try {
        const profile = await fetchJson<Record<string, unknown>>(
          `/api/v1/trust/chain-profile?agentId=${encodeURIComponent(p.agentId)}`
        );
        if (!profile) return p;
        const identity = profile.identity as Record<string, unknown> | undefined;
        const onchain = profile.onchain as Record<string, unknown> | undefined;
        const reputation = profile.reputation as Record<string, unknown> | undefined;
        return {
          ...p,
          trustProfile: {
            tokenId: String(identity?.tokenId || ""),
            anchorCount: Number(onchain?.anchorCount || 0),
            successRate: Number(reputation?.successRate || 0),
          },
        };
      } catch {
        return p;
      }
    })
  );

  return {
    healthStats: {
      agentsLive: providers.length || fallbackHealthStats.agentsLive,
      capabilityCount: capabilities.length || fallbackHealthStats.capabilityCount,
      network: String(healthPayload?.network || fallbackHealthStats.network),
      standards: fallbackHealthStats.standards,
    },
    providers,
    capabilities,
  };
}

export default async function Home() {
  const { healthStats, providers, capabilities } = await loadShowcaseData();
  return (
    <ShowcasePageClient
      healthStats={healthStats}
      providers={providers}
      capabilities={capabilities}
    />
  );
}
