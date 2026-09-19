import { ChatOpenAI } from "@langchain/openai";
import { createHash } from "crypto";
import { LLM_BASE_URL } from "./config";

/**
 * Client LLM générique compatible OpenAI. Aucun code spécifique à un
 * fournisseur : LLM_BASE_URL / LLM_API_KEY / LLM_MODEL suffisent.
 * `temperature` n'est envoyée QUE si LLM_TEMPERATURE est défini : les modèles
 * de raisonnement (gpt-5...) refusent ce paramètre.
 */
export function llmConfigured(): boolean {
  return !!(process.env.LLM_API_KEY && LLM_BASE_URL);
}

export function buildLlm() {
  const baseURL = LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-5.5";
  if (!apiKey || !baseURL) throw new Error("LLM_BASE_URL / LLM_API_KEY manquants (voir .env.example).");
  const temperature = process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : undefined;
  return new ChatOpenAI({
    apiKey,
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    timeout: Number(process.env.LLM_TIMEOUT_MS || 40000),
    maxRetries: 1,
    configuration: { baseURL },
  });
}

export interface Invokable {
  invoke(input: never): Promise<{ content: unknown; tool_calls?: { id?: string; name: string; args: unknown }[]; usage_metadata?: unknown }>;
}

/** Appel LLM journalisé : prompt_hash, model, latence, tokens. Jamais la clé API ni le prompt en clair. */
export async function invokeLogged<T extends Invokable>(tag: string, llm: T, messages: unknown[]) {
  const start = Date.now();
  const prompt_hash = createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 12);
  try {
    const res = await llm.invoke(messages as never);
    console.log(JSON.stringify({ llm: tag, prompt_hash, model: process.env.LLM_MODEL, latency_ms: Date.now() - start, tokens: res.usage_metadata ?? null }));
    return res;
  } catch (err) {
    console.log(JSON.stringify({ llm: tag, prompt_hash, model: process.env.LLM_MODEL, latency_ms: Date.now() - start, error: String(err).slice(0, 200) }));
    throw err;
  }
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? "")).join("");
  return "";
}
