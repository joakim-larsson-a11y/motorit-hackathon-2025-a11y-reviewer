"use client";

import { useMemo } from "react";

import type { AxeResults } from "@/lib/types/axe";

type AxeIssuesProps = {
  axe: AxeResults;
};

const IMPACT_LABELS: Record<string, string> = {
  critical: "Kritisk",
  serious: "Allvarlig",
  moderate: "Måttlig",
  minor: "Lindrig",
  unknown: "Okänd"
};

export function AxeIssues({ axe }: AxeIssuesProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof axe.violations>();
    for (const violation of axe.violations ?? []) {
      const key = violation.impact ?? "unknown";
      const list = map.get(key) ?? [];
      list.push(violation);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => impactWeight(a[0]) - impactWeight(b[0]));
  }, [axe.violations]);

  if (!grouped.length) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Inga rapporterade problem.</p>;
  }

  return (
    <div className="space-y-6">
      {grouped.map(([impact, violations]) => (
        <section key={impact} className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {IMPACT_LABELS[impact] ?? impact} ({violations.length})
          </h3>
          <div className="space-y-3">
            {violations.map((violation) => {
              const summaries = Array.from(
                new Set(
                  violation.nodes
                    .map((node) => node.failureSummary)
                    .filter((summary): summary is string => Boolean(summary))
                )
              );

              return (
                <details
                  key={violation.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900/50"
                >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-slate-900 dark:text-slate-100">
                  <span className="font-medium">{violation.id}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {violation.nodes.length} {violation.nodes.length === 1 ? "nod" : "noder"}
                  </span>
                </summary>
                <div className="mt-3 space-y-3 text-slate-700 dark:text-slate-300">
                  {violation.help ? <p>{violation.help}</p> : null}
                  {violation.wcag?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {violation.wcag.map((ref) => (
                        <span
                          key={ref}
                          className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                        >
                          {formatWcagRef(ref)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {summaries.length ? (
                    <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                      {summaries.map((summary) => (
                        <li key={summary} className="rounded bg-slate-100 px-3 py-2 dark:bg-slate-900/60">
                          {summary}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {violation.helpUrl ? (
                    <a
                      href={violation.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-brand underline decoration-dotted underline-offset-4 transition hover:text-brand/80"
                    >
                      Läs mer
                    </a>
                  ) : null}
                  <div className="space-y-2">
                    {violation.nodes.map((node, index) => (
                      <div
                        key={`${violation.id}-${index}`}
                        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        {node.target.length ? (
                          <ul className="mt-2 space-y-2">
                            {node.target.map((selector) => (
                              <li key={selector} className="flex items-start justify-between gap-3">
                                <code className="flex-1 break-all rounded bg-slate-800/10 px-2 py-1 text-[11px] text-slate-800 dark:bg-slate-100/10 dark:text-slate-200">
                                  {selector}
                                </code>
                                <button
                                  type="button"
                                  className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                  onClick={() => copyToClipboard(selector)}
                                >
                                  Kopiera
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {node.html ? (
                          <pre className="mt-2 overflow-x-auto rounded bg-slate-900/90 p-2 text-[11px] text-slate-100">
                            <code>{node.html}</code>
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            );
          })}
          </div>
        </section>
      ))}
    </div>
  );
}

function impactWeight(impact: string): number {
  switch (impact) {
    case "critical":
      return 0;
    case "serious":
      return 1;
    case "moderate":
      return 2;
    case "minor":
      return 3;
    default:
      return 4;
  }
}

const copyToClipboard = (value: string) => {
  if (!navigator?.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(value);
};

function formatWcagRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) {
    return ref;
  }
  const match = trimmed.match(/\d+\.\d+\.\d+/);
  if (match) {
    return `WCAG ${match[0]}`;
  }
  return trimmed.toUpperCase();
}
