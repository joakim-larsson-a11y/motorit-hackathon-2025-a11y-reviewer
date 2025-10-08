import { describe, expect, it } from "vitest";

import type { Fetcher } from "../http";
import { parseSitemap } from "../sitemaps";

const SAMPLE_XHTML_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="https://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.opera.se/</loc>
    <xhtml:link rel="alternate" hreflang="en-gb" href="https://www.opera.se/en/" />
    <lastmod>2025-08-18T09:32:44+00:00</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://www.opera.se/forestallningar/</loc>
    <xhtml:link rel="alternate" hreflang="en-gb" href="https://www.opera.se/en/what-s-on/" />
    <lastmod>2025-05-30T12:34:51+00:00</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;

const makeMockFetcher = (body: string, status = 200): Fetcher =>
  async () =>
    new Response(body, {
      status,
      headers: {
        "content-type": "application/xml"
      }
    });

describe("parseSitemap", () => {
  it("collects primary and xhtml alternate URLs", async () => {
    const fetcher = makeMockFetcher(SAMPLE_XHTML_SITEMAP);

    const result = await parseSitemap("https://www.opera.se/sitemap.xml", fetcher, {
      maxRetries: 1
    });

    expect(result).not.toBeNull();
    expect(result?.type).toBe("urlset");
    expect(result?.entries).toEqual([
      "https://www.opera.se/",
      "https://www.opera.se/en/",
      "https://www.opera.se/forestallningar/",
      "https://www.opera.se/en/what-s-on/"
    ]);
  });
});
