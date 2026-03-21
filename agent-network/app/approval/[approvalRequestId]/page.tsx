import ApprovalPageClient from "@/components/approval/ApprovalPageClient";

type ApprovalPageProps = {
  params: Promise<{
    approvalRequestId: string;
  }>;
  searchParams: Promise<{
    token?: string;
    backend?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function ApprovalPage(props: ApprovalPageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  return (
    <ApprovalPageClient
      approvalRequestId={params.approvalRequestId}
      approvalToken={String(searchParams.token || "").trim()}
      backendUrl={String(searchParams.backend || "").trim()}
    />
  );
}
