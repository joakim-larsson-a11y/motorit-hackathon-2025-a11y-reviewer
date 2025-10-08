import { notFound } from "next/navigation";

import { getPageDetails } from "@/lib/services/page-service";

import { PageDetailsClient } from "./page-details-client";

type PageProps = {
  params: {
    id: string;
    pageId: string;
  };
};

export default async function AuditPageDetails({ params }: PageProps) {
  const details = await getPageDetails(params.id, params.pageId);

  if (!details) {
    notFound();
  }

  return <PageDetailsClient details={details} />;
}
