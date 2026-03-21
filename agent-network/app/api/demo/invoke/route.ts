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
  const apiKey = process.env.DEMO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DEMO_API_KEY is not configured.");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const serviceId = String(payload?.serviceId || payload?.capability || "").trim();
    if (!serviceId) {
      return NextResponse.json(
        { ok: false, error: "service_id_required", reason: "serviceId is required." },
        { status: 400 }
      );
    }

    const backendUrl = resolveBackendUrl();
    const apiKey = resolveDemoApiKey();
    const response = await fetch(
      `${backendUrl}/api/services/${encodeURIComponent(serviceId)}/invoke`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
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
        error: "proxy_invoke_failed",
        reason: error instanceof Error ? error.message : "proxy_invoke_failed",
      },
      { status: 500 }
    );
  }
}
