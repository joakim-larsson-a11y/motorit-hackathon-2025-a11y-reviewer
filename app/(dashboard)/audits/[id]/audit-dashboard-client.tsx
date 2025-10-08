'use client';

import { useCallback, useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { AuditStatus, PageStatus } from "@prisma/client";
import type { SerializableAuditRun, SerializableAuditPage } from "@/lib/serializers/audit";
import { normalizeAudit } from "@/lib/serializers/audit";

type Props = {
  initialAudit: SerializableAuditRun;
};

type PageInsight = {
  severity?: string;
  summary?: string;
  recommendations?: string[];
  top_rules?: Array<{
    rule_id: string;
    description?: string | null;
    wcag_refs?: string[];
    count?: number | null;
  }>;
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
              Uppdaterad {lastUpdated.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              {isPolling && !FINAL_STATUSES.has(audit.status) ? " • Uppdaterar var 5:e sekund" : ""}
            </p>
            {error ? (
              <p className="mt-2 text-xs text-rose-500 dark:text-rose-300">
                {error}
              </p>
            ) : null}
          </div>
          <StatusBadge status={audit.status as AuditStatus} />
        </div>
        <dl className="grid gap-4 md:grid-cols-4">
          <SummaryTile label="Skapad" value={new Date(audit.createdAt).toLocaleString("sv-SE")} />
          <SummaryTile label="Sidor" value={audit.pages.length.toString()} />
          <SummaryTile label="Total antal issues" value={issueTotal.toString()} />
          <SummaryTile
            label="AI-sammanfattning"
            value={audit.summary ? "Tillgänglig" : FINAL_STATUSES.has(audit.status) ? "Kunde inte genereras" : "Bearbetas"}
          />
        </dl>
      </section>

      <SummarySection summary={audit.summary} />

      <PageTable pages={audit.pages} />
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

function PageTable({ pages }: { pages: SerializableAuditPage[] }) {
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
              <th className="py-3">URL</th>
              <th className="py-3">Status</th>
              <th className="py-3">Issues</th>
              <th className="py-3">AI-insikt</th>
              <th className="py-3">Artefakter</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {pages.map((page) => (
              <tr key={page.id} className="align-top text-slate-700 dark:text-slate-300">
                <td className="py-3 pr-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{page.url}</span>
                    {page.httpStatus ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">HTTP {page.httpStatus}</span>
                    ) : null}
                    {typeof page.loadTimeMs === "number" ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{page.loadTimeMs} ms</span>
                    ) : null}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={page.status as PageStatus} />
                </td>
                <td className="py-3 pr-4">{page.issueCount}</td>
                <td className="py-3 pr-4">
                  <PageInsightCard insight={page.aiInsights as PageInsight | null} />
                </td>
                <td className="py-3 pr-4">
                  <ArtifactLinks
                    htmlUrl={page.htmlUrl}
                    cssUrl={page.cssBundleUrl}
                    screenshotUrl={page.screenshotUrl}
                    axeUrl={page.axeReportUrl}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PageInsightCard({ insight }: { insight: PageInsight | null }) {
  if (!insight) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">Väntar på analys…</span>;
  }

  const severity = insight.severity ?? "okänd";
  const recommendations = Array.isArray(insight.recommendations) ? insight.recommendations : [];
  const topRules = Array.isArray(insight.top_rules) ? insight.top_rules : [];

  return (
    <div className="space-y-2 rounded-lg bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
      <div className="font-semibold capitalize text-slate-900 dark:text-slate-100">{severity}</div>
      {insight.summary ? <p className="text-slate-600 dark:text-slate-400">{insight.summary}</p> : null}
      {topRules.length ? (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">Regler</p>
          <ul className="mt-1 space-y-1">
            {topRules.slice(0, 3).map((rule) => (
              <li key={rule.rule_id} className="text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">{rule.rule_id}</span>
                {rule.description ? ` – ${rule.description}` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {recommendations.length ? (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">Åtgärder</p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-slate-600 dark:text-slate-400">
            {recommendations.slice(0, 3).map((recommendation, index) => (
              <li key={`${recommendation}-${index}`}>{recommendation}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactLinks({
  htmlUrl,
  cssUrl,
  screenshotUrl,
  axeUrl,
}: {
  htmlUrl: string | null;
  cssUrl: string | null;
  screenshotUrl: string | null;
  axeUrl: string | null;
}) {
  const links = [
    { label: "HTML", url: htmlUrl },
    { label: "CSS", url: cssUrl },
    { label: "Screenshot", url: screenshotUrl },
    { label: "Axe report", url: axeUrl },
  ].filter((item) => Boolean(item.url));

  if (links.length === 0) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">Klar när sidan har bearbetats.</span>;
  }

  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-brand">
      {links.map((link) => (
        <li key={link.label}>
          <a
            className="underline decoration-dotted underline-offset-4 transition hover:text-brand/80"
            href={link.url ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
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
