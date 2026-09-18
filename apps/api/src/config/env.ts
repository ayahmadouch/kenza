import { z } from "zod";

/**
 * Toute variable d'environnement manquante ou mal formée fait échouer le
 * process au démarrage plutôt que de laisser une valeur undefined se
 * propager silencieusement dans le graphe ou les tools.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")),
  REDIS_URL: z.string().min(1),
  LLM_BASE_URL: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  DEMO_DELAY_MINUTES: z.coerce.number().int().positive().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[env] configuration invalide :", parsed.error.flatten().fieldErrors);
    throw new Error("Variables d'environnement invalides — voir .env.example");
  }
  cached = parsed.data;
  return cached;
}
