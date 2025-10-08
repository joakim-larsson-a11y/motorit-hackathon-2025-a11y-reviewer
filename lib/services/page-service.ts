import { notFound } from "next/navigation";

import type { Issue } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AxeResults, PageDetailsVM } from "@/lib/types/axe";

type IssueRecord = Pick<Issue, "ruleId" | "impact" | "helpUrl" | "html" | "nodes" | "wcagRefs">;

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
    return normalizeAxeResults(json);
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
  const grouped = new Map<
    string,
    { violation: AxeResults["violations"][number]; order: number; wcag: Set<string> }
  >();

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
          nodes: [],
          wcag: []
        },
        order: IMPACT_ORDER.indexOf(impact as (typeof IMPACT_ORDER)[number]),
        wcag: new Set<string>()
      };
      grouped.set(key, record);
    }

    if (Array.isArray(issue.wcagRefs)) {
      for (const ref of issue.wcagRefs) {
        if (typeof ref === "string" && ref.trim() !== "") {
          record.wcag.add(ref);
        }
      }
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
    .map((entry) => ({
      ...entry.violation,
      wcag: Array.from(entry.wcag).sort()
    }));

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

function normalizeAxeResults(raw: unknown): AxeResults | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as { violations?: unknown[] };
  if (!Array.isArray(source.violations)) {
    return null;
  }

  const violations = source.violations.map((violationRaw) => {
    if (!violationRaw || typeof violationRaw !== "object") {
      return null;
    }

    const violation = violationRaw as {
      id?: unknown;
      impact?: unknown;
      help?: unknown;
      helpUrl?: unknown;
      description?: unknown;
      tags?: unknown;
      wcag?: unknown;
      nodes?: unknown;
    };

    const wcagFromTags =
      Array.isArray(violation.tags) && violation.tags.length
        ? violation.tags.filter((tag): tag is string => typeof tag === "string" && tag.toLowerCase().startsWith("wcag"))
        : [];
    const wcagExplicit =
      Array.isArray(violation.wcag) && violation.wcag.length
        ? violation.wcag.filter((tag): tag is string => typeof tag === "string")
        : [];

    const wcag = Array.from(new Set([...wcagFromTags, ...wcagExplicit]));

    return {
      id: typeof violation.id === "string" ? violation.id : String(violation.id ?? "unknown"),
      impact: normalizeImpact(typeof violation.impact === "string" ? violation.impact : null),
      help: typeof violation.help === "string" ? violation.help : "",
      helpUrl: typeof violation.helpUrl === "string" ? violation.helpUrl : "",
      description: typeof violation.description === "string" ? violation.description : undefined,
      wcag,
      nodes: Array.isArray(violation.nodes)
        ? violation.nodes.map((node) => normalizeNode(node))
        : []
    };
  });

  return {
    violations: violations.filter((item): item is AxeResults["violations"][number] => Boolean(item))
  };
}
