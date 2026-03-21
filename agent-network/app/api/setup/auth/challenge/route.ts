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
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/onboarding/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
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
        error: "proxy_challenge_failed",
        reason: error instanceof Error ? error.message : "proxy_challenge_failed",
      },
      { status: 500 }
    );
  }
}
