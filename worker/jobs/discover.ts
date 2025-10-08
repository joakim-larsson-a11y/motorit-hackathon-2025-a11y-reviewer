import { AuditStatus, PageStatus } from "@prisma/client";

import { auditQueue } from "../../lib/bullmq";
import { prisma } from "../../lib/db";
import { updateAuditStatus } from "../../lib/services/audit-service";

type DiscoverJobData = {
  runId: string;
  rootUrl: string;
  maxPages?: number;
};

export async function handleDiscover({ runId, rootUrl, maxPages = 50 }: DiscoverJobData) {
  await updateAuditStatus(runId, AuditStatus.PROCESSING);

  const urls = await collectCandidateUrls(rootUrl, maxPages);

  if (urls.length === 0) {
    await updateAuditStatus(runId, AuditStatus.FAILED);
    throw new Error("Inga sidor kunde hittas.");
  }

  await prisma.page.createMany({
    data: urls.map((url) => ({
      runId,
      url,
      status: PageStatus.QUEUED
    })),
    skipDuplicates: true
  });

  const pages = await prisma.page.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" }
  });

  for (const page of pages) {
    await auditQueue.add("render", { runId, pageId: page.id, url: page.url });
  }

  // Analyssteget kan köras efter att render-jobben markerat sig som klara.
  await auditQueue.add(
    "analyze",
    { runId },
    {
      jobId: `analyze-${runId}`,
      removeOnComplete: true,
      removeOnFail: false,
      delay: 5_000
    }
  );
}

async function collectCandidateUrls(rootUrl: string, maxPages: number): Promise<string[]> {
  // TODO: Implementera riktig sitemap-parse + fallback crawl.
  // För MVP-struktur returnerar vi åtminstone startsidan.
  const normalized = rootUrl.endsWith("/") ? rootUrl.slice(0, -1) : rootUrl;
  return [normalized].slice(0, maxPages);
}
