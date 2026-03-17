import { notFound } from "next/navigation";
import JobAuditView from "@/components/jobs/JobAuditView";
import type { JobAudit } from "@/components/jobs/JobAuditView";

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "https://kiteclaw.duckdns.org"
).replace(/\/+$/, "");

export const dynamic = "force-dynamic";

async function fetchJobAudit(jobId: string): Promise<JobAudit | null> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/public/jobs/${encodeURIComponent(jobId)}/audit`,
      {
        headers: {
          Accept: "application/json",
        },
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

type JobPageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobPage(props: JobPageProps) {
  const { jobId } = await props.params;
  const audit = await fetchJobAudit(jobId);
  if (!audit) notFound();
  return <JobAuditView audit={audit} backendUrl={BACKEND_URL} />;
}
