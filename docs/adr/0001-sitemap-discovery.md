# ADR 0001: Sitemap Discovery Strategy

- Status: Accepted
- Date: 2025-01-07

## Context

The discover worker previously returned only the submitted URL, which meant audits ignored most of a site's surface area. We need a crawler that prefers sitemap information, copes with varying sitemap formats, observes robots.txt, and remains bounded so the worker cannot overload targets.

## Decision

1. Treat `<origin>/sitemap.xml` and every `Sitemap:` directive in `robots.txt` as entry points.
2. Parse sitemap XML (including indexes and `.xml.gz`) with `fast-xml-parser`, stripping namespace prefixes but retaining local names.
3. Follow sitemap indexes recursively with a depth limit of two and reject off-origin endpoints unless `ALLOW_OFFDOMAIN_SITEMAPS=true`.
4. Normalize and de-duplicate discovered URLs, enforce a deterministic cap based on `Math.min(maxPages, MAX_URLS)`, and prioritise the submitted URL when truncating.
5. Respect `User-agent: *` robots rules when `RESPECT_ROBOTS=true`, filtering disallowed paths before scheduling audits.
6. Emit structured logs for every sitemap attempt, robots result, truncation, and fallback, and return the original URL if no sitemap yields data.

## Consequences

- More HTTP requests during discovery, but retries, timeouts, and depth limits keep traffic bounded.
- Respecting robots directives may exclude pages the user expects; setting `RESPECT_ROBOTS=false` restores previous behaviour.
- Discovery results are reproducible thanks to deterministic sorting and logging, simplifying support and testing.
