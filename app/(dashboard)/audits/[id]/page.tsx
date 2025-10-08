import { notFound } from "next/navigation";

import { getAuditRun } from "@/lib/services/audit-service";
import { serializeAuditRun } from "@/lib/serializers/audit";

import { AuditDashboardClient } from "./audit-dashboard-client";

type PageProps = {
  params: {
    id: string;
  };
};

export default async function AuditDashboardPage({ params }: PageProps) {
  const audit = await getAuditRun(params.id);

  if (!audit) {
    notFound();
  }
  const serialized = serializeAuditRun(audit);

  return <AuditDashboardClient initialAudit={serialized} />;
}
