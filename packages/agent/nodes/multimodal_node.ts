import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createHash } from "crypto";
import { ChatOpenAI } from "@langchain/openai";
import type { Fact, KenzaState } from "../types";
import { contentToText, llmConfigured } from "../llm";
import { search_catalog } from "../tools/catalog";
import { ev } from "./util";

const VisionSchema = z.object({
  lisible: z.boolean(),
  famille: z.string().nullable().optional(),
  couleur: z.string().nullable().optional(),
  caracteristiques: z.array(z.string()).optional(),
});

const FAMILLES = ["Blouson", "Caftan", "Ceinture", "Chaussures", "Chemise", "Foulard", "Pantalon", "Robe", "Sac à main", "Veste"];

/** STT via l'endpoint OpenAI-compatible (/audio/transcriptions). Lève une erreur si indisponible -> dégradation propre. */
export async function transcribeAudio(base64: string, mime = "audio/webm"): Promise<string> {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  if (!base || !key) throw new Error("STT non configuré");
  const form = new FormData();
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "webm";
  form.append("file", new Blob([Buffer.from(base64, "base64")], { type: mime }), `note.${ext}`);
  form.append("model", process.env.STT_MODEL || "whisper-1");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.STT_TIMEOUT_MS || 30000));
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "api-key": key }, body: form, signal: ctrl.signal });
    if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
    const json = (await res.json()) as { text?: string };
    const text = (json.text ?? "").trim();
    if (!text) throw new Error("transcription vide");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function describeImage(base64: string, mime = "image/jpeg") {
  if (!llmConfigured()) throw new Error("LLM non configuré");
  const llm = new ChatOpenAI({ apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL || "gpt-5.5", timeout: 40000, maxRetries: 1, configuration: { baseURL: process.env.LLM_BASE_URL } });
  const res = await llm.invoke([
    new HumanMessage({
      content: [
        { type: "text", text: `Tu observes la photo d'un article de mode envoyée par un client. Réponds UNIQUEMENT en JSON : {"lisible":true|false,"famille":"une valeur parmi ${FAMILLES.join(", ")} ou null","couleur":"couleur principale en français ou null","caracteristiques":["..."]}. Ne devine JAMAIS une référence ni un prix.` },
        { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
      ],
    }),
  ]);
  const raw = contentToText(res.content);
  const m = raw.match(/\{[\s\S]*\}/);
  return VisionSchema.parse(JSON.parse(m ? m[0] : raw));
}

/**
 * 1er nœud du graphe. Texte -> passe-plat. Audio -> STT -> texte. Image -> vision ->
 * recherche catalogue réelle (facts). Toute panne dégrade proprement (escalade), sans jamais inventer.
 */
export async function multimodal_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const media = state.media;
  if (!media) return { trace: [...state.trace, ev("multimodal_node", { decision: "texte direct" })] };

  try {
    if (media.kind === "audio") {
      const text = await transcribeAudio(media.base64, media.mime);
      return {
        transcript: text,
        messages: [new HumanMessage(text)],
        trace: [...state.trace, ev("multimodal_node", { tool: "stt", args: { mime: media.mime, octets: media.base64.length }, result: { transcription: text }, decision: "note vocale transcrite -> pipeline normal", latency_ms: Date.now() - start })],
      };
    }

    const v = await describeImage(media.base64, media.mime);
    const famille = v.famille && FAMILLES.some((f) => f.toLowerCase() === v.famille!.toLowerCase()) ? v.famille : undefined;
    const facts: Fact[] = [{ type: "vision", value: { famille: famille ?? null, couleur: v.couleur ?? null, caracteristiques: v.caracteristiques ?? [] }, source: "vision:llm" }];
    let candidats: { ref: string }[] = [];
    if (v.lisible && (famille || v.couleur)) {
      const found = await search_catalog({ famille, couleur: v.couleur ?? undefined, en_stock_seulement: false });
      candidats = Array.isArray(found) ? found.slice(0, 5) : [];
      for (const p of candidats) facts.push({ type: "price", value: p, source: "db:products+promotions", ref: p.ref });
    }
    const desc = v.lisible ? [famille, v.couleur, ...(v.caracteristiques ?? []).slice(0, 3)].filter(Boolean).join(", ") : "photo illisible";
    const text = `[Photo envoyée] Le client veut ce type d'article : ${desc}. ${candidats.length > 1 ? "Plusieurs références correspondent : demander laquelle." : candidats.length === 1 ? "Une référence correspond : demander confirmation." : "Aucune référence trouvée."}`;
    return {
      transcript: text,
      facts,
      messages: [new HumanMessage(text)],
      trace: [...state.trace, ev("multimodal_node", { tool: "vision", args: { octets: media.base64.length }, result: { famille, couleur: v.couleur, candidats: candidats.length }, decision: "photo -> attributs -> recherche catalogue (confirmation requise)", latency_ms: Date.now() - start })],
    };
  } catch (err) {
    const label = media.kind === "audio" ? "transcription" : "vision";
    const fallback = new HumanMessage(media.kind === "audio" ? "[note vocale non transcrite]" : "[photo non analysée]");
    return {
      needsHuman: true,
      escalationCode: "service_multimodal_indisponible",
      escalation: { motif: `Service de ${label} indisponible (${String(err).slice(0, 80)}) : le message ${media.kind} n'a pas pu être traité.`, contexte: "" },
      messages: [fallback],
      transcript: fallback.content as string,
      trace: [...state.trace, ev("multimodal_node", { tool: media.kind === "audio" ? "stt" : "vision", result: { erreur: String(err).slice(0, 120), empreinte: createHash("sha1").update(media.base64.slice(0, 200)).digest("hex").slice(0, 8) }, decision: "service indisponible -> dégradation propre + escalade", latency_ms: Date.now() - start })],
    };
  }
}
