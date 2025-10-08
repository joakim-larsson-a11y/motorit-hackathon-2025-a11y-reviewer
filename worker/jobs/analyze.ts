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

const PAGE_INSIGHT_SCHEMA = z.object({
  summary: z.string(),
  severity: z.enum(["critical", "serious", "moderate", "minor"]),
  recommendations: z.array(z.string()).default([]),
  top_rules: z
    .array(
      z.object({
        rule_id: z.string(),
        description: z.string().nullable().optional(),
        wcag_refs: z.array(z.string()).default([]),
        count: z.number().int().nonnegative().nullable().optional()
      })
    )
    .default([]),
  quick_wins: z.array(z.string()).default([])
});

type PageInsight = z.infer<typeof PAGE_INSIGHT_SCHEMA>;

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
    auditMeta.status === AuditStatus.COMPLETE_WITH_ISSUES ||
    auditMeta.status === AuditStatus.COMPLETE_NO_ISSUES
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

  const processedCount = progress.completedWithIssues + progress.completedWithoutIssues + progress.failed;

  if (processedCount < progress.total) {
    console.log(
      "[analyze] waiting_for_pages",
      JSON.stringify({
        event: "analyze.waiting_for_pages",
        runId,
        total: progress.total,
        completedWithIssues: progress.completedWithIssues,
        completedWithoutIssues: progress.completedWithoutIssues,
        failed: progress.failed,
        inProgress: progress.inProgress,
        queued: progress.queued,
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

  if ((progress.completedWithIssues + progress.completedWithoutIssues) === 0 && progress.failed > 0) {
    console.log(
      "[analyze] pages_failed",
      JSON.stringify({
        event: "analyze.pages_failed",
        runId,
        total: progress.total,
        completedWithIssues: progress.completedWithIssues,
        completedWithoutIssues: progress.completedWithoutIssues,
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
        completedWithIssues: progress.completedWithIssues,
        completedWithoutIssues: progress.completedWithoutIssues,
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
    (page) =>
      page.status === PageStatus.COMPLETE_WITH_ISSUES ||
      page.status === PageStatus.COMPLETE_NO_ISSUES
  );

  const pageInsights = await generatePageInsights(audit, renderedPages);

  const payload = buildRunSummaryPrompt({
    audit,
    renderedPages,
    pageInsights
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
    ? normalizeSummary(parsedSummary, audit, pageInsights)
    : buildFallbackSummary(audit, pageInsights, FALLBACK_OVERVIEW);

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

  const hasIssues = renderedPages.some((page) => page.status === PageStatus.COMPLETE_WITH_ISSUES);
  await updateAuditStatus(
    runId,
    hasIssues ? AuditStatus.COMPLETE_WITH_ISSUES : AuditStatus.COMPLETE_NO_ISSUES
  );
}

type NormalizedPageInsight = {
  url: string;
  severity: SummarySeverity;
  summary: string;
  recommendations: string[];
  top_rules: Array<{
    rule_id: string;
    description?: string | null;
    wcag_refs: string[];
    count?: number | null;
  }>;
  quick_wins: string[];
};

async function generatePageInsights(
  audit: AuditWithRelations,
  renderedPages: AuditWithRelations["pages"]
): Promise<NormalizedPageInsight[]> {
  const insights: NormalizedPageInsight[] = [];

  for (const page of renderedPages) {
    const existing = parseStoredPageInsight(page.aiInsights);
    if (existing) {
      insights.push(existing);
      continue;
    }

    const prompt = buildPageInsightPrompt(page, audit);
    let parsed: PageInsight | null = null;
    try {
      const response = await openai.responses.parse({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content:
              "Du analyserar tillgänglighetsproblem för en enskild webbsida. Svara alltid på svenska och håll dig kortfattad men handlingsorienterad."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        text: {
          format: zodTextFormat(PAGE_INSIGHT_SCHEMA, "insight")
        }
      });
      parsed = response.output_parsed ?? null;
    } catch (error) {
      console.warn(
        "[analyze] page_insight_error",
        JSON.stringify({
          event: "analyze.page_insight_error",
          runId: audit.id,
          pageId: page.id,
          message: error instanceof Error ? error.message : "unknown-error"
        })
      );
    }

    const normalized = parsed ? normalizePageInsight(parsed, page) : buildPageFallbackInsight(page);

    const aiInsightsValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue = normalized
      ? (normalized as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;

    await prisma.page.update({
      where: { id: page.id },
      data: {
        aiInsights: aiInsightsValue
      }
    });

    if (normalized) {
      insights.push(normalized);
    }
  }

  return insights;
}

function parseStoredPageInsight(value: unknown): NormalizedPageInsight | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || typeof candidate.severity !== "string") {
    return null;
  }

  return {
    url: typeof candidate.url === "string" ? candidate.url : "",
    summary: candidate.summary,
    severity: normalizeSeverity(candidate.severity),
    recommendations: Array.isArray(candidate.recommendations)
      ? (candidate.recommendations.filter((item): item is string => typeof item === "string") ?? [])
      : [],
    top_rules:
      Array.isArray(candidate.top_rules) && candidate.top_rules.length
        ? candidate.top_rules
            .map((rule) => {
              if (!rule || typeof rule !== "object") {
                return null;
              }
              const payload = rule as {
                rule_id?: unknown;
                description?: unknown;
                wcag_refs?: unknown;
                count?: unknown;
              };
              if (typeof payload.rule_id !== "string") {
                return null;
              }
              return {
                rule_id: payload.rule_id,
                description:
                  typeof payload.description === "string" || payload.description === null ? payload.description : null,
                wcag_refs: Array.isArray(payload.wcag_refs)
                  ? payload.wcag_refs.filter((ref): ref is string => typeof ref === "string")
                  : [],
                count: typeof payload.count === "number" ? payload.count : null
              };
            })
            .filter(Boolean)
        : [],
    quick_wins: Array.isArray(candidate.quick_wins)
      ? candidate.quick_wins.filter((item): item is string => typeof item === "string")
      : []
  };
}

function normalizePageInsight(insight: PageInsight, page: AuditWithRelations["pages"][number]): NormalizedPageInsight {
  return {
    url: page.url,
    summary: insight.summary,
    severity: insight.severity,
    recommendations: insight.recommendations ?? [],
    top_rules:
      insight.top_rules?.map((rule) => ({
        rule_id: rule.rule_id,
        description: rule.description ?? null,
        wcag_refs: rule.wcag_refs ?? [],
        count: rule.count ?? null
      })) ?? [],
    quick_wins: insight.quick_wins ?? []
  };
}

function buildPageFallbackInsight(page: AuditWithRelations["pages"][number]): NormalizedPageInsight {
  return {
    url: page.url,
    summary: "Ingen AI-insikt kunde genereras för denna sida.",
    severity: "moderate",
    recommendations: [],
    top_rules: [],
    quick_wins: []
  };
}

function normalizeSeverity(value: unknown): SummarySeverity {
  switch (value) {
    case "critical":
    case "serious":
    case "moderate":
    case "minor":
      return value;
    default:
      return "moderate";
  }
}

function buildRunSummaryPrompt({
  audit,
  renderedPages,
  pageInsights
}: {
  audit: AuditWithRelations;
  renderedPages: AuditWithRelations["pages"];
  pageInsights: NormalizedPageInsight[];
}) {
  const totalIssues = renderedPages.reduce<number>((sum, page) => sum + page.issues.length, 0);
  const totalsByImpact = renderedPages.reduce<Record<string, number>>((acc, page) => {
    for (const issue of page.issues) {
      const key = issue.impact ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
    }
    return acc;
  }, {});

  const pageIssueCounts = renderedPages.reduce<Record<string, number>>((acc, page) => {
    acc[page.url] = page.issues.length;
    return acc;
  }, {});

  const summarizedPages = pageInsights.map((insight) => {
    const issueCount = pageIssueCounts[insight.url] ?? 0;
    const limitedRecommendations = insight.recommendations.slice(0, 5);
    const limitedQuickWins = insight.quick_wins.slice(0, 5);
    const limitedTopRules = insight.top_rules.slice(0, 5).map((rule) => ({
      ruleId: rule.rule_id,
      description: rule.description ?? null,
      wcagRefs: rule.wcag_refs,
      count: rule.count ?? null
    }));

    return {
      url: insight.url,
      issueCount,
      severity: insight.severity,
      summary: insight.summary,
      recommendations: limitedRecommendations,
      quickWins: limitedQuickWins,
      topRules: limitedTopRules
    };
  });

  const structuredData = {
    run: {
      id: audit.id,
      rootUrl: audit.rootUrl,
      pageCount: renderedPages.length,
      totalIssues,
      totalsByImpact
    },
    pages: summarizedPages
  };

  return `Audit run ${audit.id} för ${audit.rootUrl}. Varje sida har först analyserats separat och du får deras sammanfattningar nedan.\n\nUppgift:\n1. Läs igenom sidornas insikter.\n2. Skapa en övergripande tillgänglighetsrapport på svenska som sammanfattar helheten, grupperar återkommande problem och lyfter snabba vinster.\n3. Inkludera rekommendationer och nästa steg baserat på de aggregerade insikterna.\n\nUnderlag (JSON):\n${JSON.stringify(structuredData, null, 2)}`;
}

function buildPageInsightPrompt(page: AuditWithRelations["pages"][number], audit: AuditWithRelations): string {
  const impactCounts = page.issues.reduce<Record<string, number>>((acc, issue) => {
    const key = (issue.impact ?? "unknown").toString();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const topIssues = page.issues.slice(0, 15).map((issue) => {
    let selectors: string[] = [];
    let summary: string | undefined;
    if (issue.nodes && typeof issue.nodes === "object") {
      const payload = issue.nodes as Record<string, unknown>;
      if (Array.isArray(payload.target)) {
        selectors = payload.target.filter((selector): selector is string => typeof selector === "string").slice(0, 3);
      } else if (typeof payload.target === "string") {
        selectors = [payload.target];
      }
      if (typeof payload.failureSummary === "string") {
        summary = payload.failureSummary;
      }
    }
    return {
      ruleId: issue.ruleId,
      impact: issue.impact,
      helpUrl: issue.helpUrl,
      selectors,
      summary
    };
  });

  return `Du analyserar sidan ${page.url} inom audit ${audit.id}.

Metadata:
- Status: ${page.status}
- HTTP-status: ${page.httpStatus ?? "okänt"}
- Laddtid: ${page.loadTimeMs ?? "okänt"} ms
- Antal problem: ${page.issues.length}
- Fördelning efter impact: ${JSON.stringify(impactCounts)}

Nedan ser du en lista med de viktigaste problemen. Varje post innehåller regel-id, impact och eventuell sammanfattning:
${JSON.stringify(topIssues, null, 2)}

Sammanfatta kort vad som behöver åtgärdas, vilken allvarlighetsgrad sidan har, föreslå max tre konkreta rekommendationer och lyft eventuella snabba vinster.`;
}

function normalizeSummary(
  summary: AccessibilityAuditSummary,
  audit: AuditWithRelations,
  pageInsights: NormalizedPageInsight[]
): NormalizedSummary {
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
      summary.page_classifications && summary.page_classifications.length
        ? summary.page_classifications.map((classification) => ({
            url: classification.url,
            severity: classification.severity,
            summary: classification.summary,
            top_rules:
              classification.top_rules?.map((rule) => ({
                rule_id: rule.rule_id,
                description: rule.description ?? null,
                wcag_refs: rule.wcag_refs ?? [],
                count: rule.count ?? null
              })) ?? [],
            recommendations: classification.recommendations ?? []
          }))
        : pageInsights.map((insight) => ({
            url: insight.url,
            severity: insight.severity,
            summary: insight.summary,
            top_rules: insight.top_rules,
            recommendations: insight.recommendations
          })),
  } satisfies NormalizedSummary;
}

function buildFallbackSummary(
  audit: AuditWithRelations,
  pageInsights: NormalizedPageInsight[],
  overrideOverview?: string
): NormalizedSummary {
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
    page_summaries: pageInsights.length
      ? pageInsights.map((insight) => ({
          url: insight.url,
          severity: insight.severity,
          summary: insight.summary,
          top_rules: insight.top_rules,
          recommendations: insight.recommendations
        }))
      : [],
  };
}

async function getRenderProgress(
  runId: string
): Promise<{
  total: number;
  queued: number;
  inProgress: number;
  completedWithIssues: number;
  completedWithoutIssues: number;
  failed: number;
}> {
  const [row] = await prisma.$queryRaw<
    {
      total: bigint;
      queued: bigint | null;
      in_progress: bigint | null;
      with_issues: bigint | null;
      without_issues: bigint | null;
      failed: bigint | null;
    }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      SUM(CASE WHEN "status" = 'QUEUED' THEN 1 ELSE 0 END)::bigint AS queued,
      SUM(CASE WHEN "status" = 'IN_PROGRESS' THEN 1 ELSE 0 END)::bigint AS in_progress,
      SUM(CASE WHEN "status" = 'COMPLETE_WITH_ISSUES' THEN 1 ELSE 0 END)::bigint AS with_issues,
      SUM(CASE WHEN "status" = 'COMPLETE_NO_ISSUES' THEN 1 ELSE 0 END)::bigint AS without_issues,
      SUM(CASE WHEN "status" = 'FAILED' THEN 1 ELSE 0 END)::bigint AS failed
    FROM "Page"
    WHERE "runId" = ${runId}
  `;

  const total = row ? Number(row.total) : 0;
  return {
    total,
    queued: row?.queued != null ? Number(row.queued) : 0,
    inProgress: row?.in_progress != null ? Number(row.in_progress) : 0,
    completedWithIssues: row?.with_issues != null ? Number(row.with_issues) : 0,
    completedWithoutIssues: row?.without_issues != null ? Number(row.without_issues) : 0,
    failed: row?.failed != null ? Number(row.failed) : 0,
  };
}
