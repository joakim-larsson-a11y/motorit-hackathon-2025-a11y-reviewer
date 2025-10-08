import { AuditStatus, PageStatus } from "@prisma/client";

import { auditQueue } from "../../lib/bullmq";
import { prisma } from "../../lib/db";
import { updateAuditStatus } from "../../lib/services/audit-service";
import type { Fetcher, HttpRetryOptions } from "./discovery/http";
import { filterByRobots, fetchRobotsTxt, getAgentRules } from "./discovery/robots";
import type { RobotsInfo } from "./discovery/robots";
import type { SitemapParseResult } from "./discovery/sitemaps";
import { parseSitemap } from "./discovery/sitemaps";

type DiscoverJobData = {
  runId: string;
  rootUrl: string;
  maxPages?: number;
};

export async function handleDiscover({
  runId,
  rootUrl,
  maxPages = 3,
}: DiscoverJobData) {
  await updateAuditStatus(runId, AuditStatus.PROCESSING);

  const urls = await collectCandidateUrls(rootUrl, maxPages);

  if (urls.length === 0) {
    await updateAuditStatus(runId, AuditStatus.FAILED);
    throw new Error("Inga sidor kunde hittas.");
  }

  await prisma.page.createMany({
    data: urls.map((url) => ({
      runId,
      url,
      status: PageStatus.QUEUED,
    })),
    skipDuplicates: true,
  });

  const pages = await prisma.page.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });

  for (const page of pages) {
    await auditQueue.add("render", { runId, pageId: page.id, url: page.url });
  }
  console.log(`---- KLAR med renderjobb for ${pages.length} sidor ----`);

  // Analyssteget kan köras efter att render-jobben markerat sig som klara.
  await auditQueue.add(
    "analyze",
    { runId },
    {
      jobId: `analyze-${runId}`,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

export async function collectCandidateUrls(
  rootUrl: string,
  maxPages: number
): Promise<string[]> {
  const allowOffDomain = process.env.ALLOW_OFFDOMAIN_SITEMAPS === "true";
  const respectRobots = process.env.RESPECT_ROBOTS !== "false";
  const maxUrlsEnv = Number.parseInt(process.env.MAX_URLS ?? "", 10);
  const maxUrls =
    Number.isFinite(maxUrlsEnv) && maxUrlsEnv > 0 ? maxUrlsEnv : 10_000;
  const limit = Math.min(maxPages, maxUrls);

  let entry: URL;
  try {
    entry = new URL(rootUrl);
  } catch {
    throw new Error(`Ogiltig URL: ${rootUrl}`);
  }

  const entryNormalized = normalizeUrl(rootUrl);
  const origin = new URL(entry.origin);
  const fetcher: Fetcher = (input, init) => fetch(input, init);
  const fetchOptions = { timeoutMs: 8_000, maxRetries: 3, backoffMs: 400 };

  console.log(
    JSON.stringify({
      event: "discover.start",
      runUrl: entryNormalized,
      limit,
      allowOffDomain,
      respectRobots,
    })
  );

  const robotsInfo = await fetchRobotsTxt(origin, fetcher, fetchOptions);
  if (!robotsInfo) {
    console.log(
      JSON.stringify({
        event: "discover.robots_missing",
        url: new URL("/robots.txt", origin).toString(),
      })
    );
  } else {
    console.log(
      JSON.stringify({
        event: "discover.robots_loaded",
        sitemapDirectives: robotsInfo.sitemapUrls.length,
        agentCount: robotsInfo.agents.size,
      })
    );
  }
  const robotsRules = respectRobots ? getAgentRules(robotsInfo, "*") : null;

  const sitemapEndpoints = buildSitemapEndpoints(
    origin,
    robotsInfo,
    allowOffDomain
  );

  console.log(
    JSON.stringify({
      event: "discover.sitemaps",
      attempted: sitemapEndpoints.map((endpoint) => endpoint.url),
    })
  );

  const discovered = new Set<string>();
  const reports: SitemapTelemetry[] = [];
  const visited = new Set<string>();
  let hadSuccessfulSitemap = false;

  let reachedLimit = limit <= 0;

  const hasCapacity = () => !reachedLimit;
  const recordUrl = (candidate: string) => {
    if (!candidate || reachedLimit) {
      return false;
    }

    if (discovered.has(candidate)) {
      return !reachedLimit;
    }

    discovered.add(candidate);
    if (discovered.size >= limit) {
      reachedLimit = true;
    }

    return !reachedLimit;
  };

  if (entryNormalized) {
    recordUrl(entryNormalized);
  }

  for (const endpoint of sitemapEndpoints) {
    if (!hasCapacity()) {
      break;
    }

    await traverseSitemap(
      endpoint.url,
      endpoint.source,
      0,
      fetcher,
      fetchOptions,
      origin,
      allowOffDomain,
      visited,
      discovered,
      reports,
      () => {
        hadSuccessfulSitemap = true;
      },
      {
        recordUrl,
        hasCapacity,
      }
    );

    if (!hasCapacity()) {
      break;
    }
  }

  let urls = Array.from(discovered);

  if (respectRobots) {
    const before = urls.length;
    urls = filterByRobots(urls, origin, robotsRules);
    if (urls.length !== before) {
      console.log(
        JSON.stringify({
          event: "discover.robots_filtered",
          before,
          after: urls.length,
        })
      );
    }
  }

  if (urls.length === 0 && entryNormalized) {
    console.log(
      JSON.stringify({
        event: "discover.fallback",
        reason: "no-urls",
        url: entryNormalized,
      })
    );
    return [entryNormalized];
  }

  const sorted = urls.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (entryNormalized) {
    const entryIndex = sorted.indexOf(entryNormalized);
    if (entryIndex > 0) {
      sorted.splice(entryIndex, 1);
      sorted.unshift(entryNormalized);
    }
  }
  const truncated = sorted.slice(0, limit);

  if (sorted.length > limit) {
    console.log(
      JSON.stringify({
        event: "discover.truncate",
        before: sorted.length,
        after: truncated.length,
        limit,
      })
    );
  }

  console.log(
    JSON.stringify({
      event: "discover.summary",
      discoveredCount: discovered.size,
      finalCount: truncated.length,
      reports,
      fallbackUsed: !hadSuccessfulSitemap,
    })
  );

  return truncated;
}

type SitemapTelemetry = {
  url: string;
  source: SitemapSource;
  type: SitemapParseResult["type"];
  count: number;
};

type SitemapSource = "default" | "robots" | "index";

function buildSitemapEndpoints(
  origin: URL,
  robotsInfo: RobotsInfo | null,
  allowOffDomain: boolean
): { url: string; source: SitemapSource }[] {
  const endpoints = new Map<string, SitemapSource>();

  const defaultSitemap = new URL("/sitemap.xml", origin).toString();
  endpoints.set(defaultSitemap, "default");

  const sitemapUrls = robotsInfo?.sitemapUrls ?? [];
  for (const raw of sitemapUrls) {
    const normalized = normalizeUrl(raw, origin);
    if (!normalized) {
      continue;
    }

    if (!allowOffDomain && !isSameOrigin(normalized, origin)) {
      continue;
    }

    if (!endpoints.has(normalized)) {
      endpoints.set(normalized, "robots");
    }
  }

  return Array.from(endpoints.entries()).map(([url, source]) => ({
    url,
    source,
  }));
}

const MAX_SITEMAP_DEPTH = 2;

async function traverseSitemap(
  sitemapUrl: string,
  source: SitemapSource,
  depth: number,
  fetcher: Fetcher,
  fetchOptions: Partial<HttpRetryOptions>,
  origin: URL,
  allowOffDomain: boolean,
  visited: Set<string>,
  output: Set<string>,
  reports: SitemapTelemetry[],
  onSuccess: () => void,
  controls?: {
    recordUrl: (url: string) => boolean;
    hasCapacity: () => boolean;
  }
) {
  const recordUrl =
    controls?.recordUrl ??
    ((candidate: string) => {
      if (candidate) {
        output.add(candidate);
      }
      return true;
    });
  const hasCapacity = controls?.hasCapacity ?? (() => true);

  if (!hasCapacity()) {
    return;
  }

  const normalized = normalizeUrl(sitemapUrl, origin);
  if (!normalized || visited.has(normalized)) {
    return;
  }

  visited.add(normalized);

  let parsed: SitemapParseResult | null = null;

  try {
    parsed = await parseSitemap(normalized, fetcher, fetchOptions);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "discover.sitemap_error",
        url: normalized,
        message: error instanceof Error ? error.message : "unknown-error",
      })
    );
    return;
  }

  if (!parsed) {
    console.log(
      JSON.stringify({
        event: "discover.sitemap_unavailable",
        url: normalized,
      })
    );
    return;
  }

  onSuccess();

  if (parsed.type === "urlset") {
    const urls: string[] = [];
    for (const rawUrl of parsed.entries) {
      if (!hasCapacity()) {
        break;
      }

      const candidate = normalizeUrl(rawUrl, origin);
      if (!candidate) {
        continue;
      }
      if (!allowOffDomain && !isSameOrigin(candidate, origin)) {
        continue;
      }

      const canContinue = recordUrl(candidate);
      urls.push(candidate);

      if (!canContinue) {
        break;
      }
    }

    reports.push({
      url: normalized,
      source,
      type: parsed.type,
      count: urls.length,
    });
    return;
  }

  const children: string[] = [];
  if (parsed.children) {
    for (const childRaw of parsed.children) {
      const candidate = normalizeUrl(childRaw, origin);
      if (!candidate) {
        continue;
      }
      if (!allowOffDomain && !isSameOrigin(candidate, origin)) {
        continue;
      }
      children.push(candidate);
    }
  }

  reports.push({
    url: normalized,
    source,
    type: parsed.type,
    count: children.length,
  });

  if (depth >= MAX_SITEMAP_DEPTH) {
    return;
  }

  for (const child of children) {
    if (!hasCapacity()) {
      break;
    }
    await traverseSitemap(
      child,
      "index",
      depth + 1,
      fetcher,
      fetchOptions,
      origin,
      allowOffDomain,
      visited,
      output,
      reports,
      onSuccess,
      controls
    );
  }
}

function normalizeUrl(rawUrl: string, base?: URL): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  let absolute: URL;
  try {
    absolute = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }

  absolute.hash = "";

  if (absolute.pathname === "/" && !absolute.search) {
    if (!trimmed.endsWith("/")) {
      return absolute.origin;
    }
  }

  return absolute.toString();
}

function isSameOrigin(url: string, origin: URL): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin.origin;
  } catch {
    return false;
  }
}
