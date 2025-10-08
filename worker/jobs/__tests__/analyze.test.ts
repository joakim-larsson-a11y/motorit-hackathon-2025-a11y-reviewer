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
const mockTransaction = vi.fn(async (callback: (tx: { aiSummary: { upsert: typeof mockAiSummaryUpsert }; page: { update: typeof mockPageUpdate } }) => Promise<void> | void) => {
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
    mockQueryRaw.mockResolvedValueOnce([{ total: 3, rendered: 1, failed: 0 }]);

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

  it("aggregates rendered pages and finalises the audit once ready", async () => {
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
      page_classifications: [
        {
          url: "https://example.com",
          severity: "serious",
          summary: "Fix headings",
          recommendations: ["Add missing h1"],
          top_rules: [{ rule_id: "rule-1", description: "Heading levels" }]
        }
      ]
    };

    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-2", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([{ total: 2, rendered: 2, failed: 0 }]);
    mockAiSummaryFindUnique.mockResolvedValueOnce(null);
    mockAuditRunFindUnique.mockResolvedValueOnce({
      id: "run-2",
      rootUrl: "https://example.com",
      status: "PROCESSING",
      pages: [
        {
          id: "page-1",
          url: "https://example.com",
          status: "RENDERED",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 100,
          httpStatus: 200,
          issues: [{ ruleId: "rule-1", impact: "serious", wcagRefs: [], helpUrl: null }]
        },
        {
          id: "page-2",
          url: "https://example.com/about",
          status: "RENDERED",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 120,
          httpStatus: 200,
          issues: [{ ruleId: "rule-2", impact: "minor", wcagRefs: [], helpUrl: null }]
        }
      ],
      summary: null
    });

    openAiParseMock.mockResolvedValueOnce({ output_parsed: summaryPayload });

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-2" });

    expect(mockAiSummaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ runId: "run-2" })
      })
    );
    expect(mockPageUpdate).toHaveBeenCalled();
    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-2", "COMPLETE");
    expect(mockAuditQueueAdd).not.toHaveBeenCalled();
  });

  it("completes with partial data when some pages failed", async () => {
    const summaryPayload = {
      overview: "Partial",
      quick_wins: [],
      grouped_findings: [],
      metrics: { total_pages: 1, total_issues: 1, issues_by_severity: [] },
      follow_up_actions: [],
      page_classifications: []
    };

    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-3", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([{ total: 2, rendered: 1, failed: 1 }]);
    mockAiSummaryFindUnique.mockResolvedValueOnce(null);
    mockAuditRunFindUnique.mockResolvedValueOnce({
      id: "run-3",
      rootUrl: "https://example.com",
      status: "PROCESSING",
      pages: [
        {
          id: "page-1",
          url: "https://example.com",
          status: "RENDERED",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 100,
          httpStatus: 200,
          issues: [{ ruleId: "rule-1", impact: "serious", wcagRefs: [], helpUrl: null }]
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

    openAiParseMock.mockResolvedValueOnce({ output_parsed: summaryPayload });

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-3" });

    expect(mockAiSummaryUpsert).toHaveBeenCalled();
    const payload = mockAiSummaryUpsert.mock.calls[0][0].create.payload;
    expect(payload.follow_up_actions[0]).toMatch(/Kunde inte rendera 1 av 2 sidor/);
    expect(payload.page_summaries).toEqual([
      expect.objectContaining({
        url: "https://example.com",
        summary: "Ingen AI-insikt kunde genereras för denna sida.",
      }),
    ]);
    expect(mockPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "page-1" },
        data: expect.objectContaining({
          aiInsights: expect.objectContaining({ summary: "Ingen AI-insikt kunde genereras för denna sida." })
        })
      })
    );
    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-3", "COMPLETE");
  });

  it("falls back to a static summary when OpenAI parsing fails", async () => {
    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-4", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([{ total: 1, rendered: 1, failed: 0 }]);
    mockAiSummaryFindUnique.mockResolvedValueOnce(null);
    mockAuditRunFindUnique.mockResolvedValueOnce({
      id: "run-4",
      rootUrl: "https://example.com",
      status: "PROCESSING",
      pages: [
        {
          id: "page-3",
          url: "https://example.com",
          status: "RENDERED",
          htmlUrl: null,
          cssBundleUrl: null,
          screenshotUrl: null,
          axeReportUrl: null,
          loadTimeMs: 100,
          httpStatus: 200,
          issues: [{ ruleId: "rule-1", impact: "serious", wcagRefs: [], helpUrl: null }]
        }
      ],
      summary: null
    });

    openAiParseMock.mockRejectedValueOnce(new Error("no api key"));

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-4" });

    expect(mockAiSummaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          text: "Kunde inte generera AI-sammanfattning. Visar enkel rapport baserad på rådata."
        }),
        update: expect.objectContaining({
          text: "Kunde inte generera AI-sammanfattning. Visar enkel rapport baserad på rådata."
        })
      })
    );
    expect(mockPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiInsights: expect.objectContaining({ summary: "Ingen AI-insikt kunde genereras för denna sida." })
        })
      })
    );
    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-4", "COMPLETE");
    expect(mockAuditQueueAdd).not.toHaveBeenCalled();
  });

  it("marks the run as failed when every page fails", async () => {
    mockAuditRunFindUnique.mockResolvedValueOnce({ id: "run-5", rootUrl: "https://example.com", status: "PROCESSING" });
    mockQueryRaw.mockResolvedValueOnce([{ total: 2, rendered: 0, failed: 2 }]);

    const { handleAnalyze } = await import("../analyze");

    await handleAnalyze({ runId: "run-5" });

    expect(mockUpdateAuditStatus).toHaveBeenCalledWith("run-5", "FAILED");
    expect(mockAiSummaryFindUnique).not.toHaveBeenCalled();
    expect(mockAiSummaryUpsert).not.toHaveBeenCalled();
  });
});
