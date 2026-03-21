import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const baseUrl = process.env.BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("BACKEND_URL is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
}

export async function GET() {
  try {
    const backendUrl = resolveBackendUrl();
    const response = await fetch(`${backendUrl}/api/public/health`, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
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
        error: "proxy_health_failed",
        reason: error instanceof Error ? error.message : "proxy_health_failed",
      },
      { status: 500 }
    );
  }
}
