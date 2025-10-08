import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { XMLParser } from "fast-xml-parser";

import type { Fetcher, HttpRetryOptions } from "./http";
import { fetchWithRetry } from "./http";

const gunzipAsync = promisify(gunzip);

export type SitemapType = "index" | "urlset";

export type SitemapParseResult = {
  url: string;
  type: SitemapType;
  entries: string[];
  children?: string[];
};

export async function parseSitemap(
  url: string,
  fetcher: Fetcher,
  options: Partial<HttpRetryOptions> = {}
): Promise<SitemapParseResult | null> {
  const response = await fetchWithRetry(fetcher, url, undefined, options);
  if (!response.ok) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const isGzip =
    url.endsWith(".gz") ||
    response.headers.get("content-type")?.includes("gzip") ||
    response.headers.get("content-encoding")?.includes("gzip");
  const xmlBuffer = isGzip ? await gunzipAsync(buffer) : buffer;
  const xml = xmlBuffer.toString("utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    ignoreDeclaration: true,
    trimValues: true,
    parseTagValue: true,
    // Do not rely on prefix - collapse namespace prefixes while keeping localName.
    processTagValue: true,
    preserveOrder: false,
    removeNSPrefix: true
  });

  let parsed: unknown;

  try {
    parsed = parser.parse(xml);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const document = parsed as Record<string, unknown>;
  const rootEntry = findRoot(document);

  if (!rootEntry) {
    return null;
  }

  const [rootKey, rootValue] = rootEntry;
  if (rootKey.toLowerCase().includes("sitemapindex")) {
    const children = extractLocs(rootValue, "sitemap");
    return {
      url,
      type: "index",
      entries: [],
      children
    };
  }

  if (rootKey.toLowerCase().includes("urlset")) {
    const urls = extractLocs(rootValue, "url");
    return {
      url,
      type: "urlset",
      entries: urls
    };
  }

  return null;
}

function findRoot(document: Record<string, unknown>): [string, unknown] | null {
  const entries = Object.entries(document);
  if (entries.length === 1) {
    return entries[0]!;
  }

  for (const entry of entries) {
    const [key] = entry;
    const lower = key.toLowerCase();
    if (lower.includes("sitemapindex") || lower.includes("urlset")) {
      return entry;
    }
  }

  return null;
}

/**
 * Sitemap documents can wrap entries either as single object or arrays.
 * We extract the <loc> tag agnostic to namespaces.
 */
function extractLocs(node: unknown, childKey: string): string[] {
  if (!node || typeof node !== "object") {
    return [];
  }

  const container = node as Record<string, unknown>;
  const entry = container[childKey];
  if (!entry) {
    return [];
  }

  const entries = Array.isArray(entry) ? entry : [entry];

  const urls: string[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const data = item as Record<string, unknown>;
    const locEntry = Object.entries(data).find(([key]) => key.toLowerCase().includes("loc"));
    if (!locEntry) {
      continue;
    }

    const locValue = locEntry[1];
    if (typeof locValue === "string") {
      urls.push(locValue.trim());
    }
  }

  return urls.filter(Boolean);
}
