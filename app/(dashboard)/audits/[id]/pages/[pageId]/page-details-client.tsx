"use client";

import Link from "next/link";
import { useMemo } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { PageStatus } from "@prisma/client";

import type { PageDetailsVM } from "@/lib/types/axe";
import { AxeIssues } from "@/components/page/axe-issues";

export function PageDetailsClient({ details }: { details: PageDetailsVM }) {
  const formattedUrl = useMemo(() => {
    try {
      const parsed = new URL(details.url);
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return details.url;
    }
  }, [details.url]);

  const screenshotAlt = useMemo(() => {
    try {
      const parsed = new URL(details.url);
      return `Skärmbild av ${parsed.hostname}${parsed.pathname}`;
    } catch {
      return "Skärmbild av sidan";
    }
  }, [details.url]);

  return (
    <>
      <nav className="mb-4">
        <Link
          href={`/audits/${details.runId}`}
          className="text-sm font-medium text-brand underline decoration-dotted underline-offset-4 transition hover:text-brand/80"
        >
          Tillbaka till översikten
        </Link>
      </nav>
      <main className="flex flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 break-all">{formattedUrl}</h1>
              {details.httpStatus ? (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">HTTP-status: {details.httpStatus}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Uppdaterad {formatTimestamp(details.updatedAt)}
              </p>
            </div>
            <StatusBadge status={details.status as PageStatus} />
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Skärmbild</h2>
            {details.screenshot ? (
              <img
                src={details.screenshot}
                alt={screenshotAlt}
                loading="lazy"
                className="w-full max-w-xl rounded-xl border border-slate-200 object-cover shadow-md dark:border-slate-800"
              />
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">Ingen skärmbild tillgänglig för denna sida.</p>
            )}
          </article>
          <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Artefakter</h2>
            <ul className="space-y-3 text-sm text-brand">
              {details.artifacts.html ? (
                <li>
                  <a
                    href={details.artifacts.html}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-4 transition hover:text-brand/80"
                  >
                    Öppna HTML-snapshot
                  </a>
                </li>
              ) : null}
              {details.artifacts.axe ? (
                <li>
                  <a
                    href={details.artifacts.axe}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-4 transition hover:text-brand/80"
                  >
                    Öppna axe JSON
                  </a>
                </li>
              ) : null}
              {details.artifacts.log ? (
                <li>
                  <a
                    href={details.artifacts.log}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-4 transition hover:text-brand/80"
                  >
                    Öppna rå logg
                  </a>
                </li>
              ) : null}
              {!details.artifacts.html && !details.artifacts.axe && !details.artifacts.log ? (
                <li className="text-slate-500 dark:text-slate-400">Inga artefakter tillgängliga.</li>
              ) : null}
            </ul>
          </article>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">AI-insikt</h2>
          {details.aiInsight ? (
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
              {details.aiInsight}
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Ingen AI-insikt genererades ännu. Kontrollera senare eller kör en ny analys.
            </p>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">axe-core issues</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Totalt {details.issueCount} hittade {details.issueCount === 1 ? "problem" : "problem"}.
              </p>
            </div>
            <ImpactLegend counts={details.impactCounts} />
          </header>
          <AxeIssues axe={details.axe} />
        </section>

        <footer className="mt-6 flex justify-start">
          <Link
            href={`/audits/${details.runId}`}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Tillbaka till listan
          </Link>
        </footer>
      </main>
    </>
  );
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

function ImpactLegend({ counts }: { counts: Record<string, number> }) {
  if (!counts || Object.keys(counts).length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Inga registrerade problem.</p>;
  }

  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <ul className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-400">
      {entries.map(([impact, count]) => (
        <li key={impact} className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800 dark:text-slate-300">
          <span className="font-medium capitalize text-slate-900 dark:text-slate-100">{impact}</span>: {count}
        </li>
      ))}
    </ul>
  );
}
