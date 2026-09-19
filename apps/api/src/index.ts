import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerChatWs, warmGraph } from "./ws";
import { registerDashboardRoutes } from "./routes/dashboard";
import { pool } from "../../../packages/db/pool";
import { ensureRedis } from "../../../packages/agent/memory";

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: 15 * 1024 * 1024 } });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    const redis = await ensureRedis();
    await redis.ping();
    return { status: "ok" };
  });

  registerChatWs(app);
  registerDashboardRoutes(app);

  const port = Number(process.env.API_PORT || 4000);
  await app.listen({ port, host: "0.0.0.0" });
  // Prépare le checkpointer PostgreSQL (tables LangGraph) sans bloquer le démarrage.
  warmGraph().then(() => app.log.info("Graphe LangGraph + checkpointer PostgreSQL prêts")).catch((e) => app.log.error(e, "init graphe"));
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage de l'API:", err);
  process.exit(1);
});
