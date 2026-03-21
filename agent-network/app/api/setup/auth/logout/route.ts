import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = resolveBackendUrl();
    const incomingCookie = request.headers.get("cookie") ?? "";
    const response = await fetch(`${backendUrl}/api/onboarding/auth/logout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(incomingCookie ? { Cookie: incomingCookie } : {}),
      },
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
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      nextRes.headers.set("set-cookie", setCookie);
    }
    return nextRes;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "proxy_logout_failed",
        reason: error instanceof Error ? error.message : "proxy_logout_failed",
      },
      { status: 500 }
    );
  }
}
