import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { createAuditRun } from "@/lib/services/audit-service";

const payloadSchema = z.object({
  url: z.string().url()
});

export async function POST(request: NextRequest) {
  const json = await request.json();
  const parsed = payloadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltig URL. Ange en fullständig adress inklusive https://" },
      { status: 400 }
    );
  }

  const run = await createAuditRun(parsed.data.url);

  return NextResponse.json({ id: run.id, status: run.status, url: run.rootUrl }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const offset = Math.max(Number.parseInt(params.get("offset") ?? "0", 10), 0);
  const limitParam = Math.max(Number.parseInt(params.get("limit") ?? "20", 10), 1);
  const limit = Math.min(limitParam, 100);

  const runs = await prisma.auditRun.findMany({
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit + 1
  });

  const visibleRuns = runs.slice(0, limit);
  const issueCounts = await Promise.all(
    visibleRuns.map((run) =>
      prisma.issue.count({
        where: { page: { runId: run.id } }
      })
    )
  );

  const items = visibleRuns.map((run, index) => ({
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    rootUrl: run.rootUrl,
    status: run.status,
    issueTotal: issueCounts[index] ?? 0
  }));

  return NextResponse.json({
    items,
    hasMore: runs.length > limit
  });
}
