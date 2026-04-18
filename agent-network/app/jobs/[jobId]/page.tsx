import { notFound } from "next/navigation";
import JobAuditView from "@/components/jobs/JobAuditView";
import type { JobAudit, TraceAnchor } from "@/components/jobs/JobAuditView";
import { BACKEND_URL } from "@/lib/chain-config";

export const dynamic = "force-dynamic";

async function fetchJobAudit(jobId: string): Promise<JobAudit | null> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/public/jobs/${encodeURIComponent(jobId)}/audit`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; audit?: JobAudit };
    if (!payload?.ok || !payload.audit) return null;
    return payload.audit;
  } catch {
    return null;
  }
}

async function fetchTraceAnchor(jobId: string): Promise<TraceAnchor | null> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/public/jobs/${encodeURIComponent(jobId)}/trace-anchor`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean } & TraceAnchor;
    if (!payload?.ok) return null;
    return {
      anchorRequired: payload.anchorRequired,
      anchor: payload.anchor,
    };
  } catch {
    return null;
  }
}

type JobPageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobPage(props: JobPageProps) {
  const { jobId } = await props.params;
  const [audit, traceAnchor] = await Promise.all([
    fetchJobAudit(jobId),
    fetchTraceAnchor(jobId),
  ]);
  if (!audit) notFound();
  const auditWithAnchor: JobAudit = traceAnchor
    ? { ...audit, traceAnchor }
    : audit;
  return <JobAuditView audit={auditWithAnchor} backendUrl={BACKEND_URL} />;
}
