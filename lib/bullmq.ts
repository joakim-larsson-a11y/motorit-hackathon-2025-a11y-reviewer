import { Queue, QueueEvents } from "bullmq";
import IORedis, { Redis } from "ioredis";

let sharedConnection: Redis | null = null;

export const getRedisConnection = () => {
  if (sharedConnection) {
    return sharedConnection;
  }

  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  sharedConnection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });

  return sharedConnection;
};

export const auditQueue = new Queue("audits", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

export const auditQueueEvents = new QueueEvents("audits", {
  connection: getRedisConnection()
});
