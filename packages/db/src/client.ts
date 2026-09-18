import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import * as schema from "./schema/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL manquant. Vérifie .env / .env.example (voir README §installation)."
  );
}

// Pool partagé par l'API et le worker. maxConnections volontairement modeste :
// le hackathon ne nécessite pas de pool de production.
export const pool = new pg.Pool({ connectionString, max: 10 });

export const db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
