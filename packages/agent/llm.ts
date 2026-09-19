import { ChatOpenAI } from "@langchain/openai";

/**
 * Client LLM générique, compatible OpenAI. Aucune ligne de code
 * spécifique à un fournisseur : seules les variables d'environnement
 * changent (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL) pour pointer vers
 * l'endpoint Numeos fourni pour le hackathon.
 */
export function buildLlm(opts?: { temperature?: number }) {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-5.5";

  if (!apiKey || !baseURL) {
    throw new Error("LLM_BASE_URL / LLM_API_KEY manquants. Renseignez-les dans .env (voir .env.example).");
  }

  return new ChatOpenAI({
    apiKey,
    model,
    temperature: opts?.temperature ?? 0.2,
    configuration: { baseURL },
  });
}
