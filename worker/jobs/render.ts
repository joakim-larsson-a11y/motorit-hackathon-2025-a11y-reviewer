import { PageStatus } from "@prisma/client";
import { chromium } from "playwright";
import type { Page as PlaywrightPage, Response as PlaywrightResponse } from "playwright";

import { axeSource } from "../../lib/axe";
import { prisma } from "../../lib/db";
import { putObject } from "../../lib/s3";
import { markPageStatus } from "../../lib/services/audit-service";

type RenderJobData = {
  runId: string;
  pageId: string;
  url: string;
};

const bucketName = process.env.S3_BUCKET;

const parseIntegerEnv = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const NAVIGATION_TIMEOUT_MS = parseIntegerEnv(process.env.RENDER_NAVIGATION_TIMEOUT_MS) ?? 45_000;
const NAVIGATION_ATTEMPTS = Math.max(1, parseIntegerEnv(process.env.RENDER_NAVIGATION_ATTEMPTS) ?? 2);
const NAVIGATION_BACKOFF_MS = Math.max(0, parseIntegerEnv(process.env.RENDER_NAVIGATION_BACKOFF_MS) ?? 5_000);

async function gotoWithRetries(page: PlaywrightPage, url: string): Promise<PlaywrightResponse | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      return await page.goto(url, {
        waitUntil: "networkidle",
        timeout: NAVIGATION_TIMEOUT_MS
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "unknown-error";

      console.warn(
        "[render] navigation_retry",
        JSON.stringify({
          event: "render.navigation_retry",
          url,
          attempt,
          attempts: NAVIGATION_ATTEMPTS,
          message
        })
      );

      if (attempt < NAVIGATION_ATTEMPTS && NAVIGATION_BACKOFF_MS > 0) {
        await page.waitForTimeout(NAVIGATION_BACKOFF_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to navigate to ${url} after ${NAVIGATION_ATTEMPTS} attempts.`);
}

export async function handleRender({ runId, pageId, url }: RenderJobData) {
  await markPageStatus(pageId, PageStatus.IN_PROGRESS);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const start = Date.now();
    const response = await gotoWithRetries(page, url);

    const html = await page.content();
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const cssBundle = await collectStyles(page);
    const loadTimeMs = Date.now() - start;

    await page.addScriptTag({ content: axeSource });
    const axeResults = await page.evaluate(async () => {
      // @ts-expect-error axe injiceras på sidan
      return await window.axe.run();
    });

    const axeReport = JSON.stringify(axeResults, null, 2);
    const keys = await uploadArtifacts({
      pageId,
      html,
      cssBundle,
      screenshotBuffer,
      axeReport,
    });

    const violations = Array.isArray(axeResults?.violations) ? axeResults.violations : [];
    const issuePayloads = violations.flatMap((violation: any) => {
      const nodes = Array.isArray(violation.nodes) ? violation.nodes : [];
      return nodes.map((node: any) => ({
        pageId,
        ruleId: violation.id,
        impact: violation.impact,
        wcagRefs: violation.tags?.filter((tag: string) => tag.startsWith("wcag")) ?? [],
        helpUrl: violation.helpUrl,
        html: node.html,
        nodes: node,
      }));
    });
    const finalStatus =
      issuePayloads.length > 0
        ? PageStatus.COMPLETE_WITH_ISSUES
        : PageStatus.COMPLETE_NO_ISSUES;

    await prisma.page.update({
      where: { id: pageId },
      data: {
        status: finalStatus,
        htmlUrl: keys?.html ?? null,
        cssBundleUrl: keys?.css ?? null,
        screenshotUrl: keys?.screenshot ?? null,
        axeReportUrl: keys?.axe ?? null,
        httpStatus: response?.status() ?? null,
        loadTimeMs,
      },
    });

    await prisma.issue.deleteMany({ where: { pageId } });

    if (issuePayloads.length > 0) {
      await prisma.issue.createMany({
        data: issuePayloads,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    await prisma.page.update({
      where: { id: pageId },
      data: {
        status: PageStatus.FAILED,
        httpStatus: null,
        loadTimeMs: null,
      },
    });

    console.error(
      "[render] failed",
      JSON.stringify({
        event: "render.failed",
        runId,
        pageId,
        url,
        message,
      })
    );
    return;
  } finally {
    await browser.close();
  }
}

async function collectStyles(_page: PlaywrightPage) {
  // TODO: Implementera riktig CSS-hämtning (kombinera externa och inline-stilar).
  return "";
}

async function uploadArtifacts({
  pageId,
  html,
  cssBundle,
  screenshotBuffer,
  axeReport,
}: {
  pageId: string;
  html: string;
  cssBundle: string;
  screenshotBuffer: Buffer;
  axeReport: string;
}) {
  if (!bucketName) {
    return null;
  }

  const prefix = `audits/${pageId}`;
  const htmlKey = `${prefix}/dom.html`;
  const cssKey = `${prefix}/styles.css`;
  const screenshotKey = `${prefix}/screenshot.png`;
  const axeKey = `${prefix}/axe-report.json`;

  await Promise.all([
    putObject({
      bucket: bucketName,
      key: htmlKey,
      body: Buffer.from(html, "utf-8"),
      contentType: "text/html",
    }),
    putObject({
      bucket: bucketName,
      key: cssKey,
      body: Buffer.from(cssBundle, "utf-8"),
      contentType: "text/css",
    }),
    putObject({
      bucket: bucketName,
      key: screenshotKey,
      body: screenshotBuffer,
      contentType: "image/png",
    }),
    putObject({
      bucket: bucketName,
      key: axeKey,
      body: Buffer.from(axeReport, "utf-8"),
      contentType: "application/json",
    }),
  ]);

  const publicEndpoint = process.env.S3_PUBLIC_BASE_URL;

  const resolveUrl = (key: string) =>
    publicEndpoint
      ? `${publicEndpoint.replace(/\/$/, "")}/${key}`
      : `s3://${bucketName}/${key}`;

  return {
    html: resolveUrl(htmlKey),
    css: resolveUrl(cssKey),
    screenshot: resolveUrl(screenshotKey),
    axe: resolveUrl(axeKey),
  };
}
