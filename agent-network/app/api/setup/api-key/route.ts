import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

// GET  — read existing key metadata (never returns the full secret)
// POST — revoke the current key
export async function GET(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const incomingCookie = request.headers.get("cookie") ?? "";
    const response = await fetch(`${backendUrl}/api/account/api-key`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(incomingCookie ? { Cookie: incomingCookie } : {}),
      },
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
        error: "proxy_apikey_get_failed",
        reason: error instanceof Error ? error.message : "proxy_apikey_get_failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const incomingCookie = request.headers.get("cookie") ?? "";
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/account/api-key/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(incomingCookie ? { Cookie: incomingCookie } : {}),
      },
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
        error: "proxy_apikey_revoke_failed",
        reason: error instanceof Error ? error.message : "proxy_apikey_revoke_failed",
      },
      { status: 500 }
    );
  }
}
