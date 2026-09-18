import { runMigrations } from "@kenza/db/src/migrate.js";
import { runSeeder } from "@kenza/db/src/seeder/seed.js";

/**
 * Appelé une fois au démarrage du process API. Aucune étape manuelle n'est
 * requise après `docker compose up` (exigence §3 du cahier des charges).
 * Idempotent : rejouable sans erreur à chaque redémarrage du conteneur.
 */
export async function bootstrapDatabase(databaseUrl: string): Promise<void> {
  console.log("[bootstrap] application des migrations...");
  await runMigrations(databaseUrl);
  console.log("[bootstrap] exécution du seeder...");
  await runSeeder(databaseUrl);
  console.log("[bootstrap] base prête.");
}
