import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectCandidateUrls } from "../discover";

type FetchResponseFactory = Response | (() => Response);

const ORIGINAL_FETCH = global.fetch;

describe("collectCandidateUrls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_FETCH) {
      global.fetch = ORIGINAL_FETCH;
    }
    delete process.env.ALLOW_OFFDOMAIN_SITEMAPS;
    delete process.env.RESPECT_ROBOTS;
    delete process.env.MAX_URLS;
  });

  it("returns urls from a basic sitemap.xml", async () => {
    setupEnv();
    const responses = new Map<string, FetchResponseFactory>([
      ["https://example.com/robots.txt", () => new Response("", { status: 404 })],
      [
        "https://example.com/sitemap.xml",
        () =>
          new Response(
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/page-a</loc></url>
              <url><loc>https://example.com/page-b/</loc></url>
            </urlset>`,
            { status: 200 }
          )
      ]
    ]);

    mockFetch(responses);

    const urls = await collectCandidateUrls("https://example.com", 50);
    expect(urls).toEqual(["https://example.com", "https://example.com/page-a", "https://example.com/page-b/"]);
  });

  it("follows sitemap index discovered via robots.txt", async () => {
    setupEnv();
    const responses = new Map<string, FetchResponseFactory>([
      [
        "https://example.com/robots.txt",
        () =>
          new Response(
            `User-agent: *
Sitemap: https://example.com/sitemap-index.xml`,
            { status: 200 }
          )
      ],
      ["https://example.com/sitemap.xml", () => new Response("", { status: 404 })],
      [
        "https://example.com/sitemap-index.xml",
        () =>
          new Response(
            `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>
              <sitemap><loc>https://example.com/docs-sitemap.xml</loc></sitemap>
            </sitemapindex>`,
            { status: 200 }
          )
      ],
      [
        "https://example.com/post-sitemap.xml",
        () =>
          new Response(
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/blog/alpha</loc></url>
            </urlset>`,
            { status: 200 }
          )
      ],
      [
        "https://example.com/docs-sitemap.xml",
        () =>
          new Response(
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/docs/getting-started</loc></url>
              <url><loc>https://example.com/docs/api</loc></url>
            </urlset>`,
            { status: 200 }
          )
      ]
    ]);

    mockFetch(responses);

    const urls = await collectCandidateUrls("https://example.com", 50);
    expect(urls).toEqual([
      "https://example.com",
      "https://example.com/blog/alpha",
      "https://example.com/docs/api",
      "https://example.com/docs/getting-started"
    ]);
  });

  it("handles gzipped sitemaps", async () => {
    setupEnv();
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/catalog/a</loc></url>
    </urlset>`;
    const compressed = gzipSync(Buffer.from(xml));

    const responses = new Map<string, FetchResponseFactory>([
      ["https://example.com/robots.txt", () => new Response("", { status: 404 })],
      [
        "https://example.com/sitemap.xml",
        () =>
          new Response(compressed, {
            status: 200,
            headers: { "content-type": "application/gzip" }
          })
      ]
    ]);

    mockFetch(responses);

    const urls = await collectCandidateUrls("https://example.com", 10);
    expect(urls).toEqual(["https://example.com", "https://example.com/catalog/a"]);
  });

  it("respects robots.txt disallow rules when RESPECT_ROBOTS=true", async () => {
    setupEnv({ respect: "true" });
    const responses = new Map<string, FetchResponseFactory>([
      [
        "https://example.com/robots.txt",
        () =>
          new Response(
            `User-agent: *
Disallow: /private`,
            { status: 200 }
          )
      ],
      [
        "https://example.com/sitemap.xml",
        () =>
          new Response(
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/public</loc></url>
              <url><loc>https://example.com/private/secret</loc></url>
            </urlset>`,
            { status: 200 }
          )
      ]
    ]);

    mockFetch(responses);

    const urls = await collectCandidateUrls("https://example.com/", 10);
    expect(urls).toEqual(["https://example.com", "https://example.com/public"]);
  });

  it("falls back to the entry url when sitemap parsing fails", async () => {
    setupEnv();
    const responses = new Map<string, FetchResponseFactory>([
      ["https://example.com/robots.txt", () => new Response("", { status: 404 })],
      ["https://example.com/sitemap.xml", () => new Response("<not-xml>", { status: 200 })]
    ]);

    mockFetch(responses);

    const urls = await collectCandidateUrls("https://example.com/app", 10);
    expect(urls).toEqual(["https://example.com/app"]);
  });

  it("deduplicates urls and enforces cap deterministically", async () => {
    setupEnv({ max: "3" });
    const responses = new Map<string, FetchResponseFactory>([
      ["https://example.com/robots.txt", () => new Response("", { status: 404 })],
      [
        "https://example.com/sitemap.xml",
        () =>
          new Response(
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/b</loc></url>
              <url><loc>https://example.com/a</loc></url>
              <url><loc>https://example.com/a</loc></url>
              <url><loc>https://other.com/off</loc></url>
              <url><loc>https://example.com/c</loc></url>
            </urlset>`,
            { status: 200 }
          )
      ]
    ]);

    mockFetch(responses);

    const urls = await collectCandidateUrls("https://example.com/home", 50);
    expect(urls).toEqual([
      "https://example.com/home",
      "https://example.com/a",
      "https://example.com/b"
    ]);
  });
});

function setupEnv(overrides?: { respect?: string; max?: string }) {
  process.env.ALLOW_OFFDOMAIN_SITEMAPS = "false";
  process.env.RESPECT_ROBOTS = overrides?.respect ?? "true";
  process.env.MAX_URLS = overrides?.max ?? "10000";
}

function mockFetch(responses: Map<string, FetchResponseFactory>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const responseFactory = responses.get(url);
    if (!responseFactory) {
      return new Response("", { status: 404 });
    }
    return typeof responseFactory === "function" ? responseFactory() : responseFactory;
  });

  global.fetch = fetchMock;
}
