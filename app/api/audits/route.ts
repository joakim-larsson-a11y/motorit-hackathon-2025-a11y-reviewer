import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { createAuditRun } from "@/lib/services/audit-service";

const payloadSchema = z.object({
  url: z.string().trim().min(1, "url-required")
});

function normalizeRootUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  return url.toString();
}

export async function POST(request: NextRequest) {
  const json = await request.json();
  const parsed = payloadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltig URL. Ange en giltig adress." },
      { status: 400 }
    );
  }

  const normalizedUrl = normalizeRootUrl(parsed.data.url);
  if (!normalizedUrl) {
    return NextResponse.json(
      { error: "Ogiltig URL. Ange en giltig adress." },
      { status: 400 }
    );
  }

  const run = await createAuditRun(normalizedUrl);

  return NextResponse.json({ id: run.id, status: run.status, url: run.rootUrl }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const offset = Math.max(Number.parseInt(params.get("offset") ?? "0", 10), 0);
  const limitParam = Math.max(Number.parseInt(params.get("limit") ?? "20", 10), 1);
  const limit = Math.min(limitParam, 100);

  const runs = await prisma.auditRun.findMany({
    where: { archived: false },
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
