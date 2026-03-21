import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveBackendUrl() {
  const baseUrl = process.env.BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("BACKEND_URL is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ traceId: string }> }
) {
  try {
    const { traceId } = await context.params;
    const normalizedTraceId = String(traceId || "").trim();
    if (!normalizedTraceId) {
      return NextResponse.json(
        { ok: false, error: "trace_id_required", reason: "traceId is required." },
        { status: 400 }
      );
    }

    const backendUrl = resolveBackendUrl();
    const response = await fetch(
      `${backendUrl}/api/public/evidence/${encodeURIComponent(normalizedTraceId)}`,
      {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
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
        error: "proxy_evidence_failed",
        reason: error instanceof Error ? error.message : "proxy_evidence_failed",
      },
      { status: 500 }
    );
  }
}
