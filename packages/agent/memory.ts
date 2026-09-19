import IORedis from "ioredis";

/**
 * Mémoire courte (Redis) : état volatile de la conversation en cours
 * (dernier message, langue courante, compteur anti-spam...). La mémoire
 * longue (historique multi-conversations d'un même client) vit dans le
 * checkpointer PostgreSQL de LangGraph (packages/agent/graph.ts), qui
 * survit à un `docker compose restart`.
 */
export const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
redis.on("error", (err) => console.error("[redis] erreur:", err.message));

export async function ensureRedis() {
  if (redis.status === "wait") await redis.connect();
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
  await redis.set(`conv:${conversationId}:short`, JSON.stringify(value), "EX", TTL_SECONDS);
}
