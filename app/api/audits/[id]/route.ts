import { NextRequest, NextResponse } from "next/server";

import { getAuditRun } from "@/lib/services/audit-service";

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
