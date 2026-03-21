import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

function resolveDemoApiKey() {
  return process.env.DEMO_API_KEY?.trim() || "";
}

function buildHeaders(extra?: Record<string, string>) {
  const apiKey = resolveDemoApiKey();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  };
}

export async function GET() {
  try {
    const backendUrl = resolveBackendUrl();
    const response = await fetch(`${backendUrl}/api/session/policy`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "proxy_policy_get_failed",
        reason: error instanceof Error ? error.message : "proxy_policy_get_failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/session/policy`, {
      method: "POST",
      headers: buildHeaders(),
      body,
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "proxy_policy_post_failed",
        reason: error instanceof Error ? error.message : "proxy_policy_post_failed",
      },
      { status: 500 }
    );
  }
}
