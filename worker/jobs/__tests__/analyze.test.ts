// @ts-nocheck

import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiParseMock = vi.fn();

vi.mock("../../lib/openai", () => {
  const client = {
    responses: {
      parse: openAiParseMock
    }
  };
  return {
    __esModule: true,
    default: client,
    openai: client
  };
});

const mockAuditRunFindUnique = vi.fn();
const mockAiSummaryFindUnique = vi.fn();
const mockAiSummaryUpsert = vi.fn();
const mockPageUpdate = vi.fn();
const mockTransaction = vi.fn(async (callback) => {
  await callback({
    aiSummary: { upsert: mockAiSummaryUpsert },
    page: { update: mockPageUpdate }
  });
});
const mockQueryRaw = vi.fn();

vi.mock("../../lib/db", () => ({
  prisma: {
    auditRun: { findUnique: mockAuditRunFindUnique },
    aiSummary: { findUnique: mockAiSummaryFindUnique },
    page: { update: mockPageUpdate },
    $transaction: mockTransaction,
    $queryRaw: mockQueryRaw
  }
}));

const mockAuditQueueAdd = vi.fn();
vi.mock("../../lib/bullmq", () => ({
  auditQueue: {
    add: mockAuditQueueAdd
  }
}));

const mockUpdateAuditStatus = vi.fn();
vi.mock("../../lib/services/audit-service", () => ({
  updateAuditStatus: mockUpdateAuditStatus
}));

describe("handleAnalyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAiParseMock.mockReset();
  });

  it("requeues analyze when pages are still rendering", async () => {
    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-1", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([
      { total: 3, queued: 1, in_progress: 1, with_issues: 1, without_issues: 0, failed: 0 }
    ]);

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-1" });

    expect(mockAuditQueueAdd).toHaveBeenCalledWith(
      "analyze",
      { runId: "run-1" },
      expect.objectContaining({ jobId: expect.stringMatching(/^analyze-run-1-/) })
    );
    expect(mockAiSummaryFindUnique).not.toHaveBeenCalled();
    expect(mockAiSummaryUpsert).not.toHaveBeenCalled();
    expect(mockUpdateAuditStatus).not.toHaveBeenCalled();
  });

  it("generates per-page insights and final summary", async () => {
    const pageInsightA = {
      summary: "Förbättra rubrikstrukturen",
      severity: "serious",
      recommendations: ["Lägg till h1"],
      top_rules: [],
      quick_wins: []
    };
    const pageInsightB = {
      summary: "Åtgärda länkkontraster",
      severity: "minor",
      recommendations: [],
      top_rules: [],
      quick_wins: []
    };
    const summaryPayload = {
      overview: "All set",
      quick_wins: [],
      grouped_findings: [],
      metrics: {
        total_pages: 2,
        total_issues: 2,
        issues_by_severity: [{ severity: "serious", count: 2 }]
      },
      follow_up_actions: [],
      page_classifications: []
    };

    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-2", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([
      { total: 2, queued: 0, in_progress: 0, with_issues: 2, without_issues: 0, failed: 0 }
    ]);
    mockAiSummaryFindUnique.mockResolvedValueOnce(null);
    mockAuditRunFindUnique.mockResolvedValueOnce({
      id: "run-2",
      rootUrl: "https://example.com",
      status: "PROCESSING",
      pages: [
        {
          id: "page-1",
          url: "https://example.com",
          status: "COMPLETE_WITH_ISSUES",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 100,
          httpStatus: 200,
          issues: [{
            ruleId: "rule-1",
            impact: "serious",
            wcagRefs: ["1.4.3"],
            helpUrl: null,
            nodes: { target: [".alpha"], failureSummary: "Alpha" }
          }]
        },
        {
          id: "page-2",
          url: "https://example.com/about",
          status: "COMPLETE_WITH_ISSUES",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 120,
          httpStatus: 200,
          issues: [{
            ruleId: "rule-2",
            impact: "minor",
            wcagRefs: ["2.4.4"],
            helpUrl: null,
            nodes: { target: [".beta"], failureSummary: "Beta" }
          }]
        }
      ],
      summary: null
    });

    openAiParseMock
      .mockResolvedValueOnce({ output_parsed: pageInsightA })
      .mockResolvedValueOnce({ output_parsed: pageInsightB })
      .mockResolvedValueOnce({ output_parsed: summaryPayload });

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-2" });

    expect(openAiParseMock).toHaveBeenCalledTimes(3);
    expect(mockPageUpdate).toHaveBeenCalledTimes(2);
    expect(mockPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "page-1" },
        data: expect.objectContaining({
          aiInsights: expect.objectContaining({ summary: pageInsightA.summary, severity: pageInsightA.severity })
        })
      })
    );
    expect(mockPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "page-2" },
        data: expect.objectContaining({
          aiInsights: expect.objectContaining({ summary: pageInsightB.summary, severity: pageInsightB.severity })
        })
      })
    );
    expect(mockAiSummaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ runId: "run-2" })
      })
    );
    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-2", "COMPLETE_WITH_ISSUES");
    expect(mockAuditQueueAdd).not.toHaveBeenCalled();
  });

  it("stores fallback page insight when OpenAI per-page call fails", async () => {
    const summaryPayload = {
      overview: "Partial",
      quick_wins: [],
      grouped_findings: [],
      metrics: { total_pages: 1, total_issues: 1, issues_by_severity: [] },
      follow_up_actions: [],
      page_classifications: []
    };

    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-3", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([
      { total: 2, queued: 0, in_progress: 0, with_issues: 1, without_issues: 0, failed: 1 }
    ]);
    mockAiSummaryFindUnique.mockResolvedValueOnce(null);
    mockAuditRunFindUnique.mockResolvedValueOnce({
      id: "run-3",
      rootUrl: "https://example.com",
      status: "PROCESSING",
      pages: [
        {
          id: "page-1",
          url: "https://example.com",
          status: "COMPLETE_WITH_ISSUES",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 100,
          httpStatus: 200,
          issues: [{ ruleId: "rule-1", impact: "serious", wcagRefs: [], helpUrl: null, nodes: { target: [".alpha"] } }]
        },
        {
          id: "page-2",
          url: "https://example.com/fail",
          status: "FAILED",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: null,
          httpStatus: null,
          issues: []
        }
      ],
      summary: null
    });

    openAiParseMock
      .mockRejectedValueOnce(new Error("page insight failed"))
      .mockResolvedValueOnce({ output_parsed: summaryPayload });

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-3" });

    expect(mockPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "page-1" },
        data: expect.objectContaining({
          aiInsights: expect.objectContaining({ summary: "Ingen AI-insikt kunde genereras för denna sida." })
        })
      })
    );
    const payload = mockAiSummaryUpsert.mock.calls[0][0].create.payload;
    expect(payload.follow_up_actions[0]).toMatch(/Kunde inte rendera 1 av 2 sidor/);
    expect(payload.page_summaries[0]).toEqual(
      expect.objectContaining({ summary: "Ingen AI-insikt kunde genereras för denna sida." })
    );
    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-3", "COMPLETE_WITH_ISSUES");
  });

  it("falls back to a static summary when the final OpenAI call fails", async () => {
    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-4", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([
      { total: 1, queued: 0, in_progress: 0, with_issues: 1, without_issues: 0, failed: 0 }
    ]);
    mockAiSummaryFindUnique.mockResolvedValueOnce(null);
    mockAuditRunFindUnique.mockResolvedValueOnce({
      id: "run-4",
      rootUrl: "https://example.com",
      status: "PROCESSING",
      pages: [
        {
          id: "page-3",
          url: "https://example.com",
          status: "COMPLETE_WITH_ISSUES",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 100,
          httpStatus: 200,
          issues: [{ ruleId: "rule-1", impact: "serious", wcagRefs: [], helpUrl: null, nodes: { target: [".alpha"], failureSummary: "Alpha" } }]
        }
      ],
      summary: null
    });

    openAiParseMock
      .mockResolvedValueOnce({
        output_parsed: {
          summary: "Kontrollera kontraster",
          severity: "serious",
          recommendations: ["Förbättra kontrast"],
          top_rules: [],
          quick_wins: []
        }
      })
      .mockRejectedValueOnce(new Error("no api key"));

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-4" });

    expect(mockAiSummaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          text: "Kunde inte generera AI-sammanfattning. Visar enkel rapport baserad på rådata."
        })
      })
    );
    expect(mockPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiInsights: expect.objectContaining({ summary: "Kontrollera kontraster" })
        })
      })
    );
    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-4", "COMPLETE_WITH_ISSUES");
  });

  it("marks the run as failed when every page fails", async () => {
    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-5", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([
      { total: 2, queued: 0, in_progress: 0, with_issues: 0, without_issues: 0, failed: 2 }
    ]);

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-5" });

    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-5", "FAILED");
    expect(mockAiSummaryFindUnique).not.toHaveBeenCalled();
    expect(mockAiSummaryUpsert).not.toHaveBeenCalled();
  });
});
