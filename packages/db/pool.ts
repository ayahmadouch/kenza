import { Pool } from "pg";

// Source de vérité unique pour la connexion PostgreSQL, réutilisée par
// l'API, le worker et les scripts (seed, tests). Ne jamais construire de
// SQL par concaténation : toutes les requêtes doivent être paramétrées.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://kenza:kenza@localhost:5432/kenza",
});

export async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
