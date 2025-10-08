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

export async function GET() {
  const runs = await prisma.auditRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return NextResponse.json(runs);
}
