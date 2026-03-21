import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

// Verify wallet signature → backend sets the ktrace_onboard HTTP-only cookie.
// This proxy must forward the Set-Cookie header back to the browser.
export async function POST(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/onboarding/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      cache: "no-store",
    });
    const text = await response.text();
    const nextRes = new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
    // Forward the session cookie issued by backend
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      nextRes.headers.set("set-cookie", setCookie);
    }
    return nextRes;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "proxy_verify_failed",
        reason: error instanceof Error ? error.message : "proxy_verify_failed",
      },
      { status: 500 }
    );
  }
}
