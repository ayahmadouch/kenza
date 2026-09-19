import { createClient } from "redis";

/**
 * Mémoire courte (Redis) : état volatile de la conversation en cours
 * (dernier message, langue courante, compteur anti-spam...). La mémoire
 * longue (historique multi-conversations d'un même client) vit dans le
 * checkpointer PostgreSQL de LangGraph (packages/agent/graph.ts), qui
 * survit à un `docker compose restart`.
 */
export const redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
redis.on("error", (err) => console.error("[redis] erreur:", err));

let connected = false;
export async function ensureRedis() {
  if (!connected) {
    await redis.connect();
    connected = true;
  }
  return redis;
}

const TTL_SECONDS = 60 * 60 * 6; // 6h d'état conversationnel court

export async function getShortState(conversationId: string) {
  await ensureRedis();
  const raw = await redis.get(`conv:${conversationId}:short`);
  return raw ? JSON.parse(raw) : null;
}

export async function setShortState(conversationId: string, value: unknown) {
  await ensureRedis();
  await redis.set(`conv:${conversationId}:short`, JSON.stringify(value), { EX: TTL_SECONDS });
}
