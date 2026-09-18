import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Applique tous les fichiers .sql de migrations/ dans l'ordre alphabétique.
 * Chaque fichier est écrit en IF NOT EXISTS : rejouable sans erreur.
 * Aucune étape manuelle n'est requise après `docker compose up`.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const dir = join(__dirname, "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf-8");
      console.log(`[migrate] applying ${file}`);
      await client.query(sql);
    }
    console.log(`[migrate] ${files.length} migration(s) appliquée(s).`);
  } finally {
    await client.end();
  }
}

// Exécution directe : `tsx packages/db/src/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL manquant.");
    process.exit(1);
  }
  runMigrations(connectionString)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate] échec :", err);
      process.exit(1);
    });
}
