import { AuditStatus, PageStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import openai from "../../lib/openai";
import { zodTextFormat } from "openai/helpers/zod";
import { prisma } from "../../lib/db";
import { updateAuditStatus } from "../../lib/services/audit-service";
import { auditQueue } from "../../lib/bullmq";

type AnalyzeJobData = {
  runId: string;
};

const AccessibilityAuditSummarySchema = z.object({
  overview: z.string(),
  quick_wins: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        impacted_pages: z.array(z.string()).default([]),
        wcag_refs: z.array(z.string()).default([])
      })
    )
    .default([]),
  grouped_findings: z
    .array(
      z.object({
        category: z.string(),
        severity: z.enum(["critical", "serious", "moderate", "minor"]),
        summary: z.string(),
        recommendations: z.array(z.string()).default([]),
        pages: z
          .array(
            z.object({
              url: z.string(),
              count: z.number().int().nonnegative()
            })
          )
          .default([]),
        wcag_refs: z.array(z.string()).default([])
      })
    )
    .default([]),
  metrics: z
    .object({
      total_pages: z.number().int().nonnegative(),
      total_issues: z.number().int().nonnegative(),
    })
    .default({
      total_pages: 0,
      total_issues: 0,
    }),
  follow_up_actions: z.array(z.string()).default([])
});

type AccessibilityAuditSummary = z.infer<typeof AccessibilityAuditSummarySchema>;

type SummarySeverity = "critical" | "serious" | "moderate" | "minor";

type NormalizedSummary = {
  overview: string;
  quick_wins: Array<{
    title: string;
    description: string;
    impacted_pages: string[];
    wcag_refs: string[];
  }>;
  grouped_findings: Array<{
    category: string;
    severity: SummarySeverity;
    summary: string;
    recommendations: string[];
    pages: Array<{
      url: string;
      count: number;
    }>;
    wcag_refs: string[];
  }>;
  metrics: {
    total_pages: number;
    total_issues: number;
    issues_by_severity: Record<string, number>;
  };
  follow_up_actions: string[];
};

const ANALYZE_INCLUDE = {
  pages: {
    include: { issues: true }
  },
  summary: true
} satisfies Prisma.AuditRunInclude;

type AuditWithRelations = Prisma.AuditRunGetPayload<{ include: typeof ANALYZE_INCLUDE }>;

export async function handleAnalyze({ runId }: AnalyzeJobData) {
  const audit = await prisma.auditRun.findUnique({
    where: { id: runId },
    include: ANALYZE_INCLUDE
  });

  if (!audit) {
    return;
  }

  const incompletePages = audit.pages.filter(
    (page) => page.status === PageStatus.QUEUED || page.status === PageStatus.PROCESSING
  );

  if (incompletePages.length > 0) {
    await auditQueue.add(
      "analyze",
      { runId },
      {
        jobId: `analyze-${runId}`,
        delay: 10_000,
        removeOnComplete: true
      }
    );
    return;
  }

  const payload = buildPromptPayload(audit);

  const response = await openai.responses.parse({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content:
          "Du är en assistent som agerar som tillgänglighetsexpert. Analysera inkommande data och svara alltid på svenska."
      },
      {
        role: "user",
        content: payload
      }
    ],
    text: {
      format: zodTextFormat(AccessibilityAuditSummarySchema, "summary"),
    }
  });

  const structured = response.output_parsed
    ? normalizeSummary(response.output_parsed, audit)
    : buildFallbackSummary(audit);

  await prisma.aiSummary.upsert({
    where: { runId },
    update: {
      text: structured.overview,
      payload: structured
    },
    create: {
      runId,
      text: structured.overview,
      payload: structured
    }
  });

  await updateAuditStatus(runId, AuditStatus.COMPLETE);
}

function buildPromptPayload(audit: AuditWithRelations) {
  const totalIssues = audit.pages.reduce<number>((sum, page) => sum + page.issues.length, 0);
  const totalsBySeverity = audit.pages.reduce<Record<string, number>>((acc, page) => {
    for (const issue of page.issues) {
      const key = issue.impact ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
    }
    return acc;
  }, {});

  const structuredData = {
    pages: audit.pages.map((page) => ({
      url: page.url,
      status: page.status,
      issues: page.issues.map((issue) => ({
        ruleId: issue.ruleId,
        impact: issue.impact,
        wcagRefs: issue.wcagRefs,
        helpUrl: issue.helpUrl
      }))
    })),
    totalsBySeverity
  };

  return `Audit run ${audit.id} för ${audit.rootUrl}. Totalt ${audit.pages.length} sidor och ${totalIssues} identifierade issues.\n\nRådata (JSON):\n${JSON.stringify(
    structuredData,
    null,
    2
  )}`;
}

function normalizeSummary(summary: AccessibilityAuditSummary, audit: AuditWithRelations): NormalizedSummary {
  const metrics = summary.metrics ?? {
    total_pages: audit.pages.length,
    total_issues: audit.pages.reduce<number>((sum, page) => sum + page.issues.length, 0),
    issues_by_severity: {}
  };

  return {
    overview: summary.overview,
    quick_wins: summary.quick_wins?.map((win) => ({
      title: win.title,
      description: win.description,
      impacted_pages: win.impacted_pages ?? [],
      wcag_refs: win.wcag_refs ?? []
    })) ?? [],
    grouped_findings:
      summary.grouped_findings?.map((finding) => ({
        category: finding.category,
        severity: finding.severity,
        summary: finding.summary,
        recommendations: finding.recommendations ?? [],
        pages: finding.pages?.map((page) => ({
          url: page.url,
          count: page.count
        })) ?? [],
        wcag_refs: finding.wcag_refs ?? []
      })) ?? [],
    metrics: {
      total_pages: metrics.total_pages,
      total_issues: metrics.total_issues,
      issues_by_severity: metrics.issues_by_severity ?? {}
    },
    follow_up_actions: summary.follow_up_actions ?? [],
  } satisfies NormalizedSummary;
}

function buildFallbackSummary(audit: AuditWithRelations): NormalizedSummary {
  return {
    overview: "Analysen kunde inte genereras.",
    quick_wins: [],
    grouped_findings: [],
    metrics: {
      total_pages: audit.pages.length,
      total_issues: audit.pages.reduce<number>((sum, page) => sum + page.issues.length, 0),
      issues_by_severity: {}
    },
    follow_up_actions: []
  };
}
