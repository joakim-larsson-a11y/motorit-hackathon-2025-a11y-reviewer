'use client';

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { AuditStatus, PageStatus } from "@prisma/client";
import type { SerializableAuditRun, SerializableAuditPage } from "@/lib/serializers/audit";
import { normalizeAudit } from "@/lib/serializers/audit";

type Props = {
  initialAudit: SerializableAuditRun;
};

const FINAL_STATUSES = new Set(["COMPLETE", "FAILED"]);

export function AuditDashboardClient({ initialAudit }: Props) {
  const [audit, setAudit] = useState<SerializableAuditRun>(initialAudit);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(() => new Date(initialAudit.updatedAt));

  const issueTotal = useMemo(() => audit.totalIssues, [audit.totalIssues]);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/audits/${audit.id}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Kunde inte hämta status (HTTP ${response.status}).`);
      }

      const payload = await response.json();
      const normalized = normalizeAudit(payload);
      setAudit((current) => (JSON.stringify(current) === JSON.stringify(normalized) ? current : normalized));
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Okänt fel vid uppdatering.");
    }
  }, [audit.id]);

  useEffect(() => {
    if (FINAL_STATUSES.has(audit.status)) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    setIsPolling(true);

    const tick = async () => {
      if (cancelled) {
        return;
      }
      await poll();
    };

    void tick();
    const interval = window.setInterval(tick, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setIsPolling(false);
    };
  }, [audit.status, poll]);

  return (
    <div className="flex flex-1 flex-col gap-10">
      <section className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
              Granskning #{audit.id.slice(0, 8)}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Rot-URL:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-200">
                {audit.rootUrl}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Uppdaterad{" "}
              {lastUpdated.toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
              {isPolling && !FINAL_STATUSES.has(audit.status)
                ? " • Uppdaterar var 5:e sekund"
                : ""}
            </p>
            {error ? (
              <p className="mt-2 text-xs text-rose-500 dark:text-rose-300">
                {error}
              </p>
            ) : null}
          </div>
          <StatusBadge status={audit.status as AuditStatus} />
        </div>
        <dl className="grid gap-4 md:grid-cols-3">
          <SummaryTile
            label="Skapad"
            value={new Date(audit.createdAt).toLocaleString("sv-SE")}
          />
          <SummaryTile label="Sidor" value={audit.pages.length.toString()} />
          <SummaryTile
            label="Total antal issues"
            value={issueTotal.toString()}
          />
        </dl>
      </section>

      <SummarySection summary={audit.summary} />

      <PageTable pages={audit.pages} runId={audit.id} />
    </div>
  );
}

function SummarySection({ summary }: { summary: SerializableAuditRun["summary"] }) {
  if (!summary) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
        AI-sammanfattningen publiceras när alla sidor är analyserade.
      </section>
    );
  }

  const quickWins = Array.isArray((summary.payload as any)?.quick_wins)
    ? ((summary.payload as any).quick_wins as Array<{ title: string; description: string }>)
    : [];

  return (
    <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
      <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Översikt</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {summary.text}
        </p>
      </article>
      <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Snabba vinster</h2>
        {quickWins.length > 0 ? (
          <ul className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
            {quickWins.map((win, index) => (
              <li key={`${win.title}-${index}`}>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{win.title}</p>
                <p className="text-slate-600 dark:text-slate-400">{win.description}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">Inga snabba vinster identifierades.</p>
        )}
      </article>
    </section>
  );
}

function PageTable({ pages, runId }: { pages: SerializableAuditPage[]; runId: string }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Sidor</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Visa status, antal issues och snabb åtkomst till artefakter.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th scope="col" className="py-3 pr-4">Titel</th>
              <th scope="col" className="py-3 pr-4">Status</th>
              <th scope="col" className="py-3 pr-4"># Issues</th>
              <th scope="col" className="py-3 pr-4">Uppdaterad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {pages.map((page) => (
              <tr key={page.id} className="align-top text-slate-700 dark:text-slate-300">
                <td className="py-3 pr-4">
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/audits/${runId}/pages/${page.id}`}
                      className="font-medium text-slate-900 underline decoration-dotted underline-offset-4 transition hover:text-brand dark:text-slate-100"
                    >
                      {deriveTitleFromUrl(page.url)}
                    </Link>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="break-all">{page.url}</span>
                      {page.httpStatus ? <span>HTTP {page.httpStatus}</span> : null}
                      {typeof page.loadTimeMs === "number" ? <span>{page.loadTimeMs} ms</span> : null}
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={page.status as PageStatus} />
                </td>
                <td className="py-3 pr-4">{page.issueCount}</td>
                <td className="py-3 pr-4 text-xs text-slate-500 dark:text-slate-400">
                  {formatTimestamp(page.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname.replace(/\+/g, " "));
    const readable = path
      .split("/")
      .filter(Boolean)
      .map((segment) =>
        segment
          .replace(/-/g, " ")
          .replace(/_/g, " ")
          .replace(/\s+/g, " ")
          .replace(/\b\w/g, (char) => char.toUpperCase())
      )
      .join(" / ");
    return readable.length > 0 ? readable : parsed.hostname;
  } catch {
    return url;
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
