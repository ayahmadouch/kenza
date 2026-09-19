import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerChatWs } from "./ws";
import { registerDashboardRoutes } from "./routes/dashboard";
import { pool } from "../../../packages/db/pool";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  registerChatWs(app);
  registerDashboardRoutes(app);

  const port = Number(process.env.API_PORT || 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Kenza API démarrée sur :${port}`);
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage de l'API:", err);
  process.exit(1);
});
