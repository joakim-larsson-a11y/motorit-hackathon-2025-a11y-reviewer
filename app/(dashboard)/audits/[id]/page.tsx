import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { getAuditRun } from "@/lib/services/audit-service";

type PageProps = {
  params: {
    id: string;
  };
};

export default async function AuditDashboardPage({ params }: PageProps) {
  const audit = await getAuditRun(params.id);

  if (!audit) {
    notFound();
  }

  const { summary } = audit;

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
          </div>
          <StatusBadge status={audit.status} />
        </div>
        <dl className="grid gap-4 md:grid-cols-4">
          <SummaryTile
            label="Skapad"
            value={new Date(audit.createdAt).toLocaleString("sv-SE")}
          />
          <SummaryTile label="Sidor" value={audit.pages.length.toString()} />
          <SummaryTile
            label="Total antal issues"
            value={audit.pages
              .reduce((sum, page) => sum + page.issues.length, 0)
              .toString()}
          />
          <SummaryTile
            label="AI-sammanfattning"
            value={summary ? "Tillgänglig" : "Ej klar"}
          />
        </dl>
      </section>

      {summary ? (
        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Översikt
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {summary.text}
            </p>
          </article>
          <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Snabba vinster
            </h2>
            {Array.isArray(summary.payload?.quick_wins) ? (
              <ul className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                {summary.payload.quick_wins.map(
                  (
                    win: { title: string; description: string },
                    index: number
                  ) => (
                    <li key={`${win.title}-${index}`}>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {win.title}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400">
                        {win.description}
                      </p>
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Analysen är på väg.
              </p>
            )}
          </article>
        </section>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Sidor
          </h2>
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
                <th className="py-3">Artefakter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {audit.pages.map((page) => (
                <tr
                  key={page.id}
                  className="text-slate-700 dark:text-slate-300"
                >
                  <td className="py-3 pr-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {page.url}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={page.status} />
                  </td>
                  <td className="py-3 pr-4">{page.issues.length}</td>
                  <td className="py-3 pr-4">
                    <ArtifactLinks
                      htmlUrl={page.htmlUrl}
                      cssUrl={page.cssBundleUrl}
                      screenshotUrl={page.screenshotUrl}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

function ArtifactLinks({
  htmlUrl,
  cssUrl,
  screenshotUrl
}: {
  htmlUrl: string | null;
  cssUrl: string | null;
  screenshotUrl: string | null;
}) {
  const links = [
    { label: "HTML", url: htmlUrl },
    { label: "CSS", url: cssUrl },
    { label: "Screenshot", url: screenshotUrl }
  ].filter((item) => Boolean(item.url));

  if (links.length === 0) {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        Klar när sidan har bearbetats.
      </span>
    );
  }

  return (
    <ul className="flex items-center gap-3 text-xs text-brand">
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
