"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col gap-10">
      <header className="space-y-4">
        <span className="rounded-full bg-brand/20 px-3 py-1 text-xs font-medium text-brand">
          Accessibility audit MVP
        </span>
        <h1 className="text-4xl font-semibold text-slate-100 md:text-5xl">
          Kör en tillgänglighetsgranskning av din webbplats på några minuter.
        </h1>
        <p className="max-w-2xl text-sm text-slate-400 md:text-base">
          Vi hämtar sitemap, renderar varje sida i en headless-browser, kör axe-core, låter en
          tillgänglighetsexpert (LLM) prioritera fynden och presenterar dem i ett interaktivt
          dashboard.
        </p>
      </header>
      <section className="max-w-xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <AuditLauncher />
      </section>
      <section className="grid gap-6 md:grid-cols-3">
        {FEATURES.map(({ title, description }) => (
          <article
            key={title}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg"
          >
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">{description}</p>
          </article>
        ))}
      </section>
    </main>
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
        <label className="text-sm font-medium text-slate-300" htmlFor="root-url">
          Startsida eller sitemap
        </label>
        <input
          id="root-url"
          name="root-url"
          type="url"
          required
          placeholder="https://www.exempel.se"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/40"
        />
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-700"
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
