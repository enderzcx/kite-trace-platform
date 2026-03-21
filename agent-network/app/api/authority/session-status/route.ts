import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) throw new Error("BACKEND_URL is not configured.");
  return url.replace(/\/+$/, "");
}

function resolveDemoApiKey() {
  return process.env.DEMO_API_KEY?.trim() || "";
}

export async function GET() {
  try {
    const backendUrl = resolveBackendUrl();
    const apiKey = resolveDemoApiKey();
    const response = await fetch(`${backendUrl}/api/session/runtime`, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
        error: "proxy_session_status_failed",
        reason: error instanceof Error ? error.message : "proxy_session_status_failed",
      },
      { status: 500 }
    );
  }
}
