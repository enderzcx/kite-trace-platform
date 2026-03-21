import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const baseUrl = process.env.BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("BACKEND_URL is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
}

function resolveDemoApiKey() {
  return process.env.DEMO_API_KEY?.trim() || "";
}

export async function GET(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const apiKey = resolveDemoApiKey();
    const search = request.nextUrl.searchParams.toString();
    const response = await fetch(
      `${backendUrl}/api/v1/discovery/select${search ? `?${search}` : ""}`,
      {
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        cache: "no-store",
      }
    );
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "proxy_discovery_failed",
        reason: error instanceof Error ? error.message : "proxy_discovery_failed",
      },
      { status: 500 }
    );
  }
}
