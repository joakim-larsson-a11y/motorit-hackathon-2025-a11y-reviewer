import { notFound } from "next/navigation";

import type { Issue } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AxeResults, PageDetailsVM } from "@/lib/types/axe";

type IssueRecord = Pick<Issue, "ruleId" | "impact" | "helpUrl" | "html" | "nodes">;

const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"] as const;

export async function getPageDetails(runId: string, pageId: string): Promise<PageDetailsVM> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, runId },
    include: { issues: true }
  });

  if (!page) {
    notFound();
  }

  const axeFromReport = await loadAxeReport(page.axeReportUrl);
  const axe = axeFromReport ?? groupIssuesIntoViolations(page.issues);

  const impactCounts = axe.violations.reduce<Record<string, number>>((acc, violation) => {
    const key = violation.impact ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const aiInsightSummary =
    typeof page.aiInsights === "object" && page.aiInsights !== null && "summary" in page.aiInsights
      ? (page.aiInsights as { summary?: string | null }).summary ?? null
      : null;

  return {
    id: page.id,
    runId: page.runId,
    url: page.url,
    status: page.status,
    httpStatus: page.httpStatus ?? null,
    updatedAt: page.updatedAt.toISOString(),
    issueCount: axe.violations.length,
    impactCounts,
    aiInsight: aiInsightSummary,
    artifacts: {
      html: page.htmlUrl ?? undefined,
      axe: page.axeReportUrl ?? undefined,
      screenshot: page.screenshotUrl ?? undefined
      // TODO: Add raw log path when available.
    },
    screenshot: page.screenshotUrl ?? undefined,
    axe
  };
}

async function loadAxeReport(url?: string | null): Promise<AxeResults | null> {
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as unknown;
    if (!json || typeof json !== "object") {
      return null;
    }
    if (!Array.isArray((json as AxeResults).violations)) {
      return null;
    }
    return json as AxeResults;
  } catch (error) {
    console.warn(
      "[page-service] axe_report_fetch_failed",
      JSON.stringify({
        url,
        message: error instanceof Error ? error.message : "unknown-error"
      })
    );
    return null;
  }
}

export function groupIssuesIntoViolations(issues: IssueRecord[]): AxeResults {
  const grouped = new Map<string, { violation: AxeResults["violations"][number]; order: number }>();

  for (const issue of issues) {
    const key = issue.ruleId;
    const impact = normalizeImpact(issue.impact);

    let record = grouped.get(key);
    if (!record) {
      record = {
        violation: {
          id: issue.ruleId,
          impact,
          help: issue.helpUrl ? `Se vägledning: ${issue.helpUrl}` : issue.ruleId,
          helpUrl: issue.helpUrl ?? "",
          description: issue.html ?? undefined,
          nodes: []
        },
        order: IMPACT_ORDER.indexOf(impact as (typeof IMPACT_ORDER)[number])
      };
      grouped.set(key, record);
    }

    const nodesPayload = normalizeNode(issue.nodes);
    record.violation.nodes.push(nodesPayload);
  }

  const violations = Array.from(grouped.values())
    .sort((a, b) => {
      if (a.order === b.order) {
        return a.violation.id.localeCompare(b.violation.id);
      }
      if (a.order === -1) {
        return 1;
      }
      if (b.order === -1) {
        return -1;
      }
      return a.order - b.order;
    })
    .map((entry) => entry.violation);

  return { violations };
}

function normalizeImpact(value: string | null): AxeResults["violations"][number]["impact"] {
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase();
  return IMPACT_ORDER.includes(lower as (typeof IMPACT_ORDER)[number]) ? (lower as typeof IMPACT_ORDER[number]) : null;
}

function normalizeNode(value: unknown): AxeResults["violations"][number]["nodes"][number] {
  if (!value || typeof value !== "object") {
    return { target: [], failureSummary: undefined, html: undefined };
  }

  const node = value as {
    target?: string[] | string;
    failureSummary?: string;
    html?: string;
  };

  const targets =
    Array.isArray(node.target) ? node.target : typeof node.target === "string" ? [node.target] : [];

  return {
    target: targets,
    failureSummary: node.failureSummary,
    html: node.html
  };
}
