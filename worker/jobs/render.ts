import { AuditStatus, PageStatus } from "@prisma/client";
import { chromium } from "playwright";
import type { Page as PlaywrightPage } from "playwright";

import { axeSource } from "../../lib/axe";
import { prisma } from "../../lib/db";
import { putObject } from "../../lib/s3";
import { markPageStatus, updateAuditStatus } from "../../lib/services/audit-service";

type RenderJobData = {
  runId: string;
  pageId: string;
  url: string;
};

const bucketName = process.env.S3_BUCKET;

export async function handleRender({ runId, pageId, url }: RenderJobData) {
  await markPageStatus(pageId, PageStatus.RENDERING);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const start = Date.now();
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });

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

    await prisma.page.update({
      where: { id: pageId },
      data: {
        status: PageStatus.RENDERED,
        htmlUrl: keys?.html ?? null,
        cssBundleUrl: keys?.css ?? null,
        screenshotUrl: keys?.screenshot ?? null,
        axeReportUrl: keys?.axe ?? null,
        httpStatus: response?.status() ?? null,
        loadTimeMs,
      },
    });

    await prisma.issue.deleteMany({ where: { pageId } });

    await prisma.issue.createMany({
      data: axeResults.violations.flatMap((violation: any) =>
        violation.nodes.map((node: any) => ({
          pageId,
          ruleId: violation.id,
          impact: violation.impact,
          wcagRefs:
            violation.tags?.filter((tag: string) => tag.startsWith("wcag")) ??
            [],
          helpUrl: violation.helpUrl,
          html: node.html,
          nodes: node,
        }))
      ),
    });
  } catch (error) {
    await prisma.page.update({
      where: { id: pageId },
      data: {
        status: PageStatus.FAILED,
      },
    });
    await updateAuditStatus(runId, AuditStatus.FAILED);
    throw error;
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
