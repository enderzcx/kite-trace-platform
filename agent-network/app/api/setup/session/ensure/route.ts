import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

// Ensure AA session runtime for the wallet-authenticated user.
// Forwards the ktrace_onboard cookie so the backend can scope the request.
export async function POST(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const incomingCookie = request.headers.get("cookie") ?? "";
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/session/runtime/ensure`, {
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
        error: "proxy_session_ensure_failed",
        reason: error instanceof Error ? error.message : "proxy_session_ensure_failed",
      },
      { status: 500 }
    );
  }
}
