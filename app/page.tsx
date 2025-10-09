"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { HistoryRow, SortDescriptor, SortKey } from "@/components/history/history-table";
import { HistoryTable } from "@/components/history/history-table";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col gap-10">
      <header className="space-y-4">
        <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand dark:bg-brand/20">
          Accessibility audit MVP
        </span>
        <h1 className="text-4xl font-semibold text-slate-900 dark:text-slate-100 md:text-5xl">
          Kör en tillgänglighetsgranskning av din webbplats på några minuter.
        </h1>
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400 md:text-base">
          Vi hämtar sitemap, renderar varje sida i en headless-browser, kör
          axe-core, låter en tillgänglighetsexpert (LLM) prioritera fynden och
          presenterar dem i ett interaktivt dashboard.
        </p>
      </header>
      <section className="max-w-xl rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900/60">
        <AuditLauncher />
      </section>
      <HistorySection />
      <section className="grid gap-6 md:grid-cols-3">
        {FEATURES.map(({ title, description }) => (
          <article
            key={title}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg transition dark:border-slate-800 dark:bg-slate-900/40"
          >
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {description}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}

const PAGE_SIZE = 20;

type HistoryResponse = {
  items: HistoryRow[];
  hasMore: boolean;
};

function HistorySection() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [sort, setSort] = useState<SortDescriptor>({ column: "date", direction: "desc" });
  const [initialLoading, setInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivingIds, setArchivingIds] = useState<Set<string>>(() => new Set());
  const pageRef = useRef(0);

  const loadPage = useCallback(
    async (pageIndex: number, replace = false) => {
      if (replace) {
        setInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      const offset = pageIndex * PAGE_SIZE;

      try {
        const response = await fetch(`/api/audits?offset=${offset}&limit=${PAGE_SIZE}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("Could not load audit history.");
        }

        const payload = (await response.json()) as HistoryResponse;
        setHasMore(payload.hasMore);

        setRows((previous) => {
          const next = new Map<string, HistoryRow>();
          if (!replace) {
            for (const item of previous) {
              next.set(item.id, item);
            }
          }
          for (const item of payload.items) {
            next.set(item.id, item);
          }

          return Array.from(next.values());
        });

        pageRef.current = pageIndex;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load audit history.");
      } finally {
        if (replace) {
          setInitialLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void loadPage(0, true);
  }, [loadPage]);

  const handleSort = useCallback((column: SortKey) => {
    setSort((current) => {
      if (current.column === column) {
        return {
          column,
          direction: current.direction === "asc" ? "desc" : "asc"
        };
      }

      return {
        column,
        direction: column === "date" ? "desc" : "asc"
      };
    });
  }, []);

  const handleShowMore = useCallback(() => {
    void loadPage(pageRef.current + 1);
  }, [loadPage]);

  const handleArchive = useCallback(async (id: string) => {
    setError(null);
    setArchivingIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });

    try {
      const response = await fetch(`/api/audits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true })
      });

      if (!response.ok) {
        throw new Error("Could not archive audit.");
      }

      setRows((previous) => previous.filter((row) => row.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive audit.");
    } finally {
      setArchivingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">History</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Recently completed audits appear here. Sort any column or load older runs.
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {initialLoading ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Loading history…</p>
      ) : rows.length === 0 && !error ? (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          No audits yet—run your first one above.
        </p>
      ) : (
        <HistoryTable
          rows={rows}
          sort={sort}
          onSort={handleSort}
          hasMore={hasMore}
          onShowMore={handleShowMore}
          isLoadingMore={isLoadingMore}
          onArchive={handleArchive}
          archivingIds={archivingIds}
        />
      )}
    </section>
  );
}

function AuditLauncher() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const body = JSON.stringify({ url });
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });

      if (!response.ok) {
        throw new Error("Kunde inte starta granskningen. Försök igen.");
      }

      const audit = (await response.json()) as { id: string };
      startTransition(() => router.push(`/audits/${audit.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ett oväntat fel uppstod.");
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
          htmlFor="root-url"
        >
          Startsida eller sitemap
        </label>
        <input
          id="root-url"
          name="root-url"
          type="text"
          required
          placeholder="www.exempel.se"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/40 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
          autoComplete="url"
          inputMode="url"
        />
      </div>
      {error ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        {isPending ? "Startar..." : "Starta granskning"}
      </button>
    </form>
  );
}

const FEATURES = [
  {
    title: "Automatisk upptäckning",
    description:
      "Hämtar sitemap.xml eller crawlar sajten upp till en rimlig nivå för att skapa en lista av sidor."
  },
  {
    title: "Headless-rendering",
    description:
      "Playwright renderar varje vy, sparar HTML, CSS och fullständiga skärmdumpar för fortsatt analys."
  },
  {
    title: "AI-prioritering",
    description:
      "axe-core ger råa fynd som sedan grupperas, prioriteras och sammanfattas av en tränad LLM."
  }
] as const;
