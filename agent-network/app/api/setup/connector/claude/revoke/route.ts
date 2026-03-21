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
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/connector/claude/revoke`, {
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
        error: "proxy_connector_revoke_failed",
        reason: error instanceof Error ? error.message : "proxy_connector_revoke_failed",
      },
      { status: 500 }
    );
  }
}
