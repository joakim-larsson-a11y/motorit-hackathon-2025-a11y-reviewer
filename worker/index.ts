import { Worker } from "bullmq";

import { getRedisConnection } from "../lib/bullmq";
import { handleAnalyze } from "./jobs/analyze";
import { handleDiscover } from "./jobs/discover";
import { handleRender } from "./jobs/render";

const worker = new Worker(
  "audits",
  async (job) => {
    switch (job.name) {
      case "discover":
        await handleDiscover(job.data);
        break;
      case "render":
        await handleRender(job.data);
        break;
      case "analyze":
        await handleAnalyze(job.data);
        break;
      default:
        throw new Error(`Okänt jobb: ${job.name}`);
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2)
  }
);

worker.on("completed", (job) => {
  console.log(`[worker] Jobb "${job.name}" (${job.id}) klart.`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] Jobb "${job?.name}" misslyckades:`, error);
});

console.log("[worker] Lyssnar på 'audits'-kön...");
