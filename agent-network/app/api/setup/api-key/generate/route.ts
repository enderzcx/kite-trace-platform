import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

// Generate a new account-scoped MCP API key.
// The full ktrace_sk_... secret is returned only once in this response.
export async function POST(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const incomingCookie = request.headers.get("cookie") ?? "";
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/account/api-key/generate`, {
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
        error: "proxy_apikey_generate_failed",
        reason: error instanceof Error ? error.message : "proxy_apikey_generate_failed",
      },
      { status: 500 }
    );
  }
}
