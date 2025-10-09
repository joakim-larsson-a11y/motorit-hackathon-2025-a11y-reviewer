import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { getAuditRun, setAuditArchived } from "@/lib/services/audit-service";

type Params = {
  params: {
    id: string;
  };
};

export async function GET(_request: NextRequest, { params }: Params) {
  const audit = await getAuditRun(params.id);

  if (!audit) {
    return NextResponse.json({ error: "Granskningen hittades inte." }, { status: 404 });
  }

  return NextResponse.json(audit);
}

const archivePayloadSchema = z.object({
  archived: z.boolean()
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const json = await request.json();
  const parsed = archivePayloadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig begäran." }, { status: 400 });
  }

  try {
    const updated = await setAuditArchived(params.id, parsed.data.archived);
    return NextResponse.json({ id: updated.id, archived: updated.archived });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Granskningen hittades inte." }, { status: 404 });
    }
    throw err;
  }
}
