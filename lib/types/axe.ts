export type AxeResults = {
  violations: Array<{
    id: string;
    impact: "critical" | "serious" | "moderate" | "minor" | null;
    help: string;
    helpUrl: string;
    description?: string;
    wcag: string[];
    nodes: Array<{
      html?: string;
      target: string[];
      failureSummary?: string;
    }>;
  }>;
};

export type PageDetailsVM = {
  id: string;
  runId: string;
  url: string;
  status: string;
  httpStatus: number | null;
  updatedAt: string;
  issueCount: number;
  impactCounts: Record<string, number>;
  aiInsight?: string | null;
  artifacts: {
    html?: string | null;
    axe?: string | null;
    log?: string | null;
    screenshot?: string | null;
  };
  screenshot?: string | null;
  axe: AxeResults;
};
