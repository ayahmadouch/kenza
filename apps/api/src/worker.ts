import dotenv from "dotenv";
import { join } from "node:path";
import { loadEnv } from "./config/env.js";

dotenv.config({ path: join(process.cwd(), "..", "..", ".env") });

/**
 * Placeholder du service worker (5e service Docker requis par le cahier des
 * charges). La file BullMQ "relances" et la logique de relance de paniers
 * abandonnés sont implémentées en Phase 8. Ce fichier garantit uniquement
 * que le conteneur `worker` démarre proprement dès la Phase 3.
 */
async function main() {
  const env = loadEnv();
  console.log(`[worker] démarré, connecté à Redis: ${env.REDIS_URL}`);
  console.log("[worker] file BullMQ 'relances' : à implémenter en Phase 8.");

  // Garde le process vivant.
  setInterval(() => {
    console.log("[worker] en attente (heartbeat)...");
  }, 60_000);
}

main().catch((err) => {
  console.error("[worker] démarrage impossible :", err);
  process.exit(1);
});
