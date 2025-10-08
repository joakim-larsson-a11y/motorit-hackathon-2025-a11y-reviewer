"use client";

import Link from "next/link";
import { useMemo } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { AuditStatus } from "@prisma/client";

export type HistoryRow = {
  id: string;
  createdAt: string;
  rootUrl: string;
  status: AuditStatus;
  issueTotal: number;
};

export type SortKey = "date" | "page" | "status" | "link" | "errors";
export type SortDirection = "asc" | "desc";

export type SortDescriptor = {
  column: SortKey;
  direction: SortDirection;
};

type HistoryTableProps = {
  rows: HistoryRow[];
  sort: SortDescriptor;
  onSort: (column: SortKey) => void;
  hasMore: boolean;
  onShowMore: () => void;
  isLoadingMore: boolean;
};

const COLUMN_DEFINITIONS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "date", label: "Date" },
  { key: "page", label: "Page reviewed" },
  { key: "status", label: "Status" },
  { key: "link", label: "Link to audit" },
  { key: "errors", label: "Total errors found", align: "right" }
];

export function HistoryTable({
  rows,
  sort,
  onSort,
  hasMore,
  onShowMore,
  isLoadingMore
}: HistoryTableProps) {
  const sortedRows = useMemo(() => sortHistoryRows(rows, sort), [rows, sort]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/70">
            <tr>
              {COLUMN_DEFINITIONS.map((column) => {
                const isActive = sort.column === column.key;
                const ariaSort = isActive ? sort.direction : "none";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-4 py-3 font-semibold text-slate-700 dark:text-slate-200 ${column.align === "right" ? "text-right" : ""}`}
                    aria-sort={ariaSort}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-slate-700 outline-none transition hover:bg-slate-200/70 focus-visible:ring-2 focus-visible:ring-brand dark:text-slate-200 dark:hover:bg-slate-700/60"
                    >
                      {column.label}
                      <SortIndicator active={isActive} direction={sort.direction} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {sortedRows.map((row) => {
              const displayUrl = getDisplayUrl(row.rootUrl);
              const formattedDate = formatLocalDateTime(row.createdAt);

              return (
                <tr key={row.id} className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900/40 dark:even:bg-slate-900/20">
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{formattedDate}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    <span className="line-clamp-1 break-all">{displayUrl}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/audits/${row.id}`}
                      className="text-sm font-medium text-brand transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {`View audit for ${displayUrl}`}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                    {row.issueTotal}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onShowMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-100"
          >
            {isLoadingMore ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function sortHistoryRows(rows: HistoryRow[], sort: SortDescriptor): HistoryRow[] {
  const sorter = SORT_FUNCTIONS[sort.column] ?? SORT_FUNCTIONS.date;
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const result = sorter(a, b);
    if (result === 0) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return result * direction;
  });
}

const STATUS_ORDER = ["PROCESSING", "PENDING", "COMPLETE", "FAILED"] as const;

const SORT_FUNCTIONS: Record<SortKey, (a: HistoryRow, b: HistoryRow) => number> = {
  date: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  page: (a, b) => compareStrings(getDisplayUrl(a.rootUrl), getDisplayUrl(b.rootUrl)),
  status: (a, b) => getStatusIndex(a.status) - getStatusIndex(b.status),
  link: (a, b) => compareStrings(a.rootUrl, b.rootUrl),
  errors: (a, b) => a.issueTotal - b.issueTotal
};

function getStatusIndex(status: AuditStatus): number {
  const idx = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  return idx === -1 ? STATUS_ORDER.length : idx;
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <span aria-hidden="true" className="text-xs text-slate-500">-</span>;
  }

  return (
    <span aria-hidden="true" className="text-xs text-slate-500">
      {direction === "asc" ? "^" : "v"}
    </span>
  );
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getDisplayUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname}${path}${url.search ?? ""}`;
  } catch {
    return rawUrl;
  }
}

function formatLocalDateTime(isoTime: string): string {
  const parsed = new Date(isoTime);
  if (Number.isNaN(parsed.getTime())) {
    return isoTime;
  }

  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}
