import type { AuditStatus, PageStatus } from "@prisma/client";
import type { AuditRunWithRelations } from "../services/audit-service";

type JsonValue = unknown;

type MaybeDate = Date | string;

type SourceIssue = {
  impact?: string | null;
};

type SourcePage = {
  id: string;
  url: string;
  status: PageStatus | string;
  htmlUrl?: string | null;
  cssBundleUrl?: string | null;
  screenshotUrl?: string | null;
  axeReportUrl?: string | null;
  loadTimeMs?: number | null;
  httpStatus?: number | null;
  aiInsights?: JsonValue | null;
  updatedAt?: MaybeDate;
  issues?: SourceIssue[];
};

type SourceSummary = {
  text: string;
  payload?: JsonValue;
};

type SourceAudit = {
  id: string;
  rootUrl: string;
  status: AuditStatus | string;
  createdAt: MaybeDate;
  updatedAt: MaybeDate;
  pages?: SourcePage[];
  summary?: SourceSummary | null;
};

export type SerializableAuditPage = {
  id: string;
  url: string;
  status: PageStatus | string;
  htmlUrl: string | null;
  cssBundleUrl: string | null;
  screenshotUrl: string | null;
  axeReportUrl: string | null;
  loadTimeMs: number | null;
  httpStatus: number | null;
  issueCount: number;
  updatedAt: string;
};

export type SerializableAuditRun = {
  id: string;
  rootUrl: string;
  status: AuditStatus | string;
  createdAt: string;
  updatedAt: string;
  summary: { text: string; payload: JsonValue | null } | null;
  pages: SerializableAuditPage[];
  totalIssues: number;
};

const toIsoString = (value: MaybeDate): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const toIssueCount = (issues?: SourceIssue[]): number => {
  if (!Array.isArray(issues) || issues.length === 0) {
    return 0;
  }
  return new Set(issues.map((issue) => issue.ruleId)).size;
};

const normalizePage = (page: SourcePage): SerializableAuditPage => ({
  id: page.id,
  url: page.url,
  status: page.status,
  htmlUrl: page.htmlUrl ?? null,
  cssBundleUrl: page.cssBundleUrl ?? null,
  screenshotUrl: page.screenshotUrl ?? null,
  axeReportUrl: page.axeReportUrl ?? null,
  loadTimeMs: typeof page.loadTimeMs === "number" ? page.loadTimeMs : null,
  httpStatus: typeof page.httpStatus === "number" ? page.httpStatus : null,
  issueCount: toIssueCount(page.issues),
  updatedAt: toIsoString(page.updatedAt ?? new Date()),
});

const normalizeSummary = (summary?: SourceSummary | null) => {
  if (!summary) {
    return null;
  }

  return {
    text: summary.text,
    payload: summary.payload ?? null,
  };
};

const deriveTotalIssues = (pages: SerializableAuditPage[]): number =>
  pages.reduce((sum, page) => sum + page.issueCount, 0);

export const serializeAuditRun = (audit: AuditRunWithRelations): SerializableAuditRun =>
  normalizeAudit(audit);

export const normalizeAudit = (audit: SourceAudit): SerializableAuditRun => {
  const pages = Array.isArray(audit.pages) ? audit.pages.map(normalizePage) : [];

  return {
    id: audit.id,
    rootUrl: audit.rootUrl,
    status: audit.status,
    createdAt: toIsoString(audit.createdAt),
    updatedAt: toIsoString(audit.updatedAt),
    summary: normalizeSummary(audit.summary ?? null),
    pages,
    totalIssues: deriveTotalIssues(pages),
  };
};
