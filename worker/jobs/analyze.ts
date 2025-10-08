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
        wcag_refs: z.array(z.string()).default([]),
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
              count: z.number().int().nonnegative(),
            })
          )
          .default([]),
        wcag_refs: z.array(z.string()).default([]),
      })
    )
    .default([]),
  metrics: z
    .object({
      total_pages: z.number().int().nonnegative(),
      total_issues: z.number().int().nonnegative(),
      issues_by_severity: z
        .array(
          z.object({
            severity: z.string(),
            count: z.number().int().nonnegative()
          })
        )
        .default([]),
    })
    .default({
      total_pages: 0,
      total_issues: 0,
      issues_by_severity: [],
    }),
  follow_up_actions: z.array(z.string()).default([]),
  page_classifications: z
    .array(
      z.object({
        url: z.string(),
        severity: z.enum(["critical", "serious", "moderate", "minor"]),
        summary: z.string(),
        top_rules: z
          .array(
            z.object({
              rule_id: z.string(),
              description: z.string().nullable().optional(),
              wcag_refs: z.array(z.string()).default([]),
              count: z.number().int().nonnegative().nullable().optional(),
            })
          )
          .default([]),
        recommendations: z.array(z.string()).default([]),
      })
    )
    .default([]),
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
  page_summaries: Array<{
    url: string;
    severity: SummarySeverity;
    summary: string;
    top_rules: Array<{
      rule_id: string;
      description?: string | null;
      wcag_refs: string[];
      count?: number | null;
    }>;
    recommendations: string[];
  }>;
};

const ANALYZE_INCLUDE = {
  pages: {
    orderBy: { createdAt: "asc" },
    include: { issues: true },
  },
  summary: true,
} satisfies Prisma.AuditRunInclude;

type AuditWithRelations = Prisma.AuditRunGetPayload<{ include: typeof ANALYZE_INCLUDE }>;

const FALLBACK_OVERVIEW =
  "Kunde inte generera AI-sammanfattning. Visar enkel rapport baserad på rådata.";

export async function handleAnalyze({ runId }: AnalyzeJobData) {
  const auditMeta = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { id: true, rootUrl: true, status: true },
  });

  if (!auditMeta) {
    return;
  }

  if (
    auditMeta.status === AuditStatus.FAILED ||
    auditMeta.status === AuditStatus.COMPLETE
  ) {
    console.log(
      "[analyze] skip_status",
      JSON.stringify({
        event: "analyze.skip_status",
        runId,
        status: auditMeta.status,
      })
    );
    return;
  }

  const progress = await getRenderProgress(runId);

  if (progress.total === 0) {
    console.log(
      "[analyze] no_pages",
      JSON.stringify({
        event: "analyze.no_pages",
        runId,
      })
    );
    await updateAuditStatus(runId, AuditStatus.FAILED);
    return;
  }

  const processedCount = progress.rendered + progress.failed;

  if (processedCount < progress.total) {
    console.log(
      "[analyze] waiting_for_pages",
      JSON.stringify({
        event: "analyze.waiting_for_pages",
        runId,
        total: progress.total,
        rendered: progress.rendered,
        failed: progress.failed,
      })
    );
    const requeueId = `analyze-${runId}-${Date.now()}`;
    await auditQueue.add(
      "analyze",
      { runId },
      {
        jobId: requeueId,
        delay: 5_000,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    return;
  }

  if (progress.rendered === 0 && progress.failed > 0) {
    console.log(
      "[analyze] pages_failed",
      JSON.stringify({
        event: "analyze.pages_failed",
        runId,
        total: progress.total,
        rendered: progress.rendered,
        failed: progress.failed,
      })
    );
    await updateAuditStatus(runId, AuditStatus.FAILED);
    return;
  }

  if (progress.failed > 0) {
    console.warn(
      "[analyze] partial_pages",
      JSON.stringify({
        event: "analyze.partial_pages",
        runId,
        total: progress.total,
        rendered: progress.rendered,
        failed: progress.failed,
      })
    );
  }

  const existingSummary = await prisma.aiSummary.findUnique({
    where: { runId },
  });

  if (existingSummary) {
    console.log(
      "[analyze] skip_already_finalized",
      JSON.stringify({
        event: "analyze.skip_already_finalized",
        runId,
      })
    );
    return;
  }

  const audit = await prisma.auditRun.findUnique({
    where: { id: runId },
    include: ANALYZE_INCLUDE,
  });

  if (!audit) {
    return;
  }

  const renderedPages = audit.pages.filter(
    (page) => page.status === PageStatus.RENDERED
  );

  const payload = buildPromptPayload({
    audit,
    renderedPages,
  });

  let parsedSummary: AccessibilityAuditSummary | null = null;

  try {
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
    parsedSummary = response.output_parsed ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    console.error(
      "[analyze] openai_error",
      JSON.stringify({
        event: "analyze.openai_error",
        runId,
        message
      })
    );
  }

  const structured = parsedSummary
    ? normalizeSummary(parsedSummary, audit)
    : buildFallbackSummary(audit, FALLBACK_OVERVIEW);

  if (!parsedSummary) {
    console.log(
      "[analyze] fallback_summary",
      JSON.stringify({
        event: "analyze.fallback_summary",
        runId
      })
    );
  }

  if (progress.failed > 0) {
    structured.follow_up_actions = [
      `Kunde inte rendera ${progress.failed} av ${progress.total} sidor. Kontrollera dessa manuellt.`,
      ...structured.follow_up_actions,
    ];
  }

  const pageInsightsByUrl = new Map(
    structured.page_summaries.map((summary) => [summary.url, summary])
  );

  if (renderedPages.length > 0) {
    for (const page of renderedPages) {
      if (!pageInsightsByUrl.has(page.url)) {
        const placeholder = {
          url: page.url,
          severity: "moderate" as SummarySeverity,
          summary: "Ingen AI-insikt kunde genereras för denna sida.",
          top_rules: [],
          recommendations: [],
          wcag_refs: [],
        };
        structured.page_summaries.push(placeholder);
        pageInsightsByUrl.set(page.url, placeholder);
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.aiSummary.upsert({
      where: { runId },
      update: {
        text: structured.overview,
        payload: structured,
      },
      create: {
        runId,
        text: structured.overview,
        payload: structured,
      },
    });

    for (const page of renderedPages) {
      const insight = pageInsightsByUrl.get(page.url) ?? null;
        const aiInsightsValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue = insight
          ? (insight as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull;
        await tx.page.update({
          where: { id: page.id },
          data: {
            aiInsights: aiInsightsValue,
        },
      });
    }
  });

  console.log(
    "[analyze] completed",
    JSON.stringify({
      event: "analyze.completed",
      runId,
      pages: renderedPages.length,
      totalIssues: renderedPages.reduce(
        (sum, page) => sum + page.issues.length,
        0
      ),
    })
  );

  await updateAuditStatus(runId, AuditStatus.COMPLETE);
}

function buildPromptPayload({
  audit,
  renderedPages,
}: {
  audit: AuditWithRelations;
  renderedPages: AuditWithRelations["pages"];
}) {
  const totalIssues = renderedPages.reduce<number>(
    (sum, page) => sum + page.issues.length,
    0
  );
  const totalsBySeverity = renderedPages.reduce<Record<string, number>>(
    (acc, page) => {
      for (const issue of page.issues) {
        const key = issue.impact ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
      }
      return acc;
    },
    {}
  );

  const structuredData = {
    run: {
      id: audit.id,
      rootUrl: audit.rootUrl,
      pageCount: renderedPages.length,
      totalIssues,
      totalsBySeverity,
    },
    pages: renderedPages.map((page) => ({
      id: page.id,
      url: page.url,
      httpStatus: page.httpStatus,
      loadTimeMs: page.loadTimeMs,
      htmlUrl: page.htmlUrl,
      cssBundleUrl: page.cssBundleUrl,
      screenshotUrl: page.screenshotUrl,
      axeReportUrl: page.axeReportUrl,
      issueCount: page.issues.length,
      issues: page.issues.map((issue) => ({
        ruleId: issue.ruleId,
        impact: issue.impact,
        wcagRefs: issue.wcagRefs,
        helpUrl: issue.helpUrl,
      })),
    })),
  };

  return `Audit run ${audit.id} för ${audit.rootUrl}. Totalt ${
    renderedPages.length
  } renderade sidor och ${totalIssues} identifierade issues.\n\nRådata (JSON):\n${JSON.stringify(
    structuredData,
    null,
    2
  )}`;
}

function normalizeSummary(summary: AccessibilityAuditSummary, audit: AuditWithRelations): NormalizedSummary {
  const metrics = summary.metrics ?? {
    total_pages: audit.pages.length,
    total_issues: audit.pages.reduce<number>((sum, page) => sum + page.issues.length, 0),
    issues_by_severity: []
  };

  const issuesBySeverityRecord = Array.isArray(metrics.issues_by_severity)
    ? metrics.issues_by_severity.reduce<Record<string, number>>((acc, item) => {
        acc[item.severity] = item.count;
        return acc;
      }, {})
    : {};

  return {
    overview: summary.overview,
    quick_wins:
      summary.quick_wins?.map((win) => ({
        title: win.title,
        description: win.description,
        impacted_pages: win.impacted_pages ?? [],
        wcag_refs: win.wcag_refs ?? [],
      })) ?? [],
    grouped_findings:
      summary.grouped_findings?.map((finding) => ({
        category: finding.category,
        severity: finding.severity,
        summary: finding.summary,
        recommendations: finding.recommendations ?? [],
        pages:
          finding.pages?.map((page) => ({
            url: page.url,
            count: page.count,
          })) ?? [],
        wcag_refs: finding.wcag_refs ?? [],
      })) ?? [],
    metrics: {
      total_pages: metrics.total_pages,
      total_issues: metrics.total_issues,
      issues_by_severity: issuesBySeverityRecord,
    },
    follow_up_actions: summary.follow_up_actions ?? [],
    page_summaries:
      summary.page_classifications?.map((classification) => ({
        url: classification.url,
        severity: classification.severity,
        summary: classification.summary,
        top_rules:
          classification.top_rules?.map((rule) => ({
            rule_id: rule.rule_id,
            description: rule.description ?? null,
            wcag_refs: rule.wcag_refs ?? [],
            count: rule.count ?? null,
          })) ?? [],
        recommendations: classification.recommendations ?? [],
      })) ?? [],
  } satisfies NormalizedSummary;
}

function buildFallbackSummary(audit: AuditWithRelations, overrideOverview?: string): NormalizedSummary {
  return {
    overview: overrideOverview ?? FALLBACK_OVERVIEW,
    quick_wins: [],
    grouped_findings: [],
    metrics: {
      total_pages: audit.pages.length,
      total_issues: audit.pages.reduce<number>(
        (sum, page) => sum + page.issues.length,
        0
      ),
      issues_by_severity: {},
    },
    follow_up_actions: [],
    page_summaries: [],
  };
}

async function getRenderProgress(
  runId: string
): Promise<{ total: number; rendered: number; failed: number }> {
  const [row] = await prisma.$queryRaw<
    { total: bigint; rendered: bigint | null; failed: bigint | null }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      SUM(CASE WHEN "status" = 'RENDERED' THEN 1 ELSE 0 END)::bigint AS rendered,
      SUM(CASE WHEN "status" = 'FAILED' THEN 1 ELSE 0 END)::bigint AS failed
    FROM "Page"
    WHERE "runId" = ${runId}
  `;

  const total = row ? Number(row.total) : 0;
  const rendered = row?.rendered != null ? Number(row.rendered) : 0;
  const failed = row?.failed != null ? Number(row.failed) : 0;

  return { total, rendered, failed };
}
