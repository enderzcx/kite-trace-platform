import { Suspense } from "react";
import DemoAuditClient from "@/components/demo/DemoAuditClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live Demo | Kite Trace",
  description: "Live audit of a completed hourly news brief job on Kite Testnet.",
};

export default function DemoPage() {
  return (
    <Suspense fallback={null}>
      <DemoAuditClient />
    </Suspense>
  );
}
