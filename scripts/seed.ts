import "dotenv/config";
import { runMigrations } from "../packages/db/src/migrate.js";
import { runSeeder } from "../packages/db/src/seeder/seed.js";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL manquant (voir .env.example).");
    process.exit(1);
  }
  await runMigrations(connectionString);
  await runSeeder(connectionString);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
