import dotenv from "dotenv";
import { join } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadEnv } from "./config/env.js";
import { bootstrapDatabase } from "./bootstrap/runSeederOnStart.js";
import { healthRoutes } from "./routes/health.js";

dotenv.config({ path: join(process.cwd(), "..", "..", ".env") });

async function main() {
  const env = loadEnv();

  await bootstrapDatabase(env.DATABASE_URL);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(healthRoutes);

  // WebSocket /ws, routes dashboard et graphe LangGraph : Phases 4 et 5.

  await app.listen({ host: "0.0.0.0", port: env.PORT });
  app.log.info(`Kenza API démarrée sur le port ${env.PORT}`);
}

main().catch((err) => {
  console.error("[api] démarrage impossible :", err);
  process.exit(1);
});
