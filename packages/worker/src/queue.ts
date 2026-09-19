import { Queue } from "bullmq";
import IORedis from "ioredis";

export const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const relanceQueue = new Queue("relances", { connection });

export interface RelanceJobData {
  conversationId: string;
  variante: "A" | "B";
  relanceId: number;
}
