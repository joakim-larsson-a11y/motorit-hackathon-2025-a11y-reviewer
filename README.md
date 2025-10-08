# Motorit Hackathon 2025 – Accessibility Reviewer

En snabb MVP för att granska tillgänglighet på en webbplats. Frontend + API i Next.js, worker i Node/Playwright, kö via BullMQ/Redis, resultat i Postgres och artefakter i ett S3-kompatibelt objektlager. Syftet är att kunna bygga en demo med tydlig “wow-faktor” på 1–2 dagar.

## Funktionellt flöde
- **Skapa körning:** UI skickar `POST /api/audits` med en URL. API:t sparar en `AuditRun` och lägger ett `discover`-jobb i kön.
- **Discovery:** Worker hämtar sitemap eller crawlar, skriver `Page`-rader och schemalägger `render`-jobb per sida.
- **Rendering:** Playwright renderar sidan, sparar HTML/CSS/screenshot till S3, kör axe-core och skriver `Issue`s i databasen.
- **AI-analys:** När alla sidor är klara kör worker `analyze` som kallar OpenAI och sparar `AiSummary`.
- **UI:** Dashboard visar status i realtid, issues per sida, artefakter och AI-sammanfattning.

## Kom igång
1. Installera beroenden (rekommenderad pakethanterare är pnpm):
   ```bash
   pnpm install
   ```
2. Starta infrastruktur (Postgres, Redis, MinIO):
   ```bash
   docker compose up -d
   ```
3. Skapa databastabeller:
   ```bash
   pnpm prisma:migrate
   ```
4. Kör utvecklingsservrar:
   ```bash
   pnpm dev       # Next.js UI/API
   pnpm worker    # BullMQ + Playwright worker
   ```

Öppna sedan [http://localhost:3000](http://localhost:3000) och starta en granskning.

## Miljövariabler
Kopiera `.env.example` till `.env.local` och fyll i:

- `DATABASE_URL` – Postgres-anslutning.
- `REDIS_URL` – Redis-kö.
- `S3_*` – MinIO/S3 inställningar (bucket skapas av `docker-compose`).
- `OPENAI_API_KEY` – Nyckel till OpenAI (gpt-4o-mini).
- `WORKER_CONCURRENCY` – Antal parallella Playwright-jobb.

## Kodstruktur
```
app/                    Next.js UI + API routes
  api/audits            REST-endpoints för körningar
  (dashboard)/audits    Rapportvy per körning
components/             Delade UI-komponenter
lib/                    Delad logik (Prisma, BullMQ, S3, OpenAI)
worker/                 Fristående BullMQ-worker
prisma/                 Prisma schema
docker-compose.yml      Lokal infrastruktur (Postgres/Redis/MinIO)
```

## Nästa steg
1. Implementera riktig sitemap-parsning + fallback-crawl i `worker/jobs/discover.ts`.
2. Samla externa/interna CSS i `collectStyles` i `worker/jobs/render.ts`.
3. Lägg till UI-komponenter för filter (WCAG, impact, status) och SSE/WebSocket för liveuppdateringar.
4. Lägg till validering + rate limiting på API:t samt enkel auth om det behövs.
