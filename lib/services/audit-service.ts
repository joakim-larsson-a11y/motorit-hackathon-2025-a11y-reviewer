import { AuditRun, AuditStatus, AiSummary, Issue, Page, PageStatus } from "@prisma/client";

import { auditQueue } from "../bullmq";
import { prisma } from "../db";

export type AuditRunWithRelations = AuditRun & {
  pages: (Page & { issues: Issue[] })[];
  summary: AiSummary | null;
};

export async function createAuditRun(rootUrl: string): Promise<AuditRun> {
  const run = await prisma.auditRun.create({
    data: {
      rootUrl,
      status: AuditStatus.PENDING
    }
  });

  await auditQueue.add("discover", { runId: run.id, rootUrl });
  return run;
}

export async function getAuditRun(runId: string): Promise<AuditRunWithRelations | null> {
  return prisma.auditRun.findUnique({
    where: { id: runId },
    include: {
      pages: {
        orderBy: { createdAt: "asc" },
        include: { issues: true }
      },
      summary: true
    }
  });
}

export async function updateAuditStatus(runId: string, status: AuditStatus) {
  await prisma.auditRun.update({
    where: { id: runId },
    data: { status }
  });
}

export async function markPageStatus(pageId: string, status: PageStatus) {
  await prisma.page.update({
    where: { id: pageId },
    data: { status }
  });
}

export async function setAuditArchived(runId: string, archived: boolean) {
  return prisma.auditRun.update({
    where: { id: runId },
    data: { archived }
  });
}
