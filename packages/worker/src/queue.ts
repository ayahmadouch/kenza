import { Queue } from "bullmq";
import IORedis from "ioredis";

export const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
export const QUEUE_NAME = "relances";
export const relanceQueue = new Queue(QUEUE_NAME, { connection });

export interface RelanceJobData {
  conversationId: string;
  relanceId: number;
}
