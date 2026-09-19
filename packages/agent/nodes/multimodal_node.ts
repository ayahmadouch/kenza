import type { KenzaState } from "../types";
import { buildLlm } from "../llm";

export interface MultimodalInput {
  kind: "text" | "audio" | "image";
  text?: string;
  audioBase64?: string;
  imageBase64?: string;
}

/**
 * Convertit une entrée audio/image en texte exploitable par le reste du
 * pipeline. En cas d'échec du service STT/vision, on dégrade proprement :
 * pas de crash, pas d'invention, et une escalade est marquée pour que le
 * commerçant reprenne la main si le texte n'a pas pu être récupéré.
 */
export async function multimodal_node(state: KenzaState, input: MultimodalInput): Promise<Partial<KenzaState>> {
  const trace = [...state.trace];
  const start = Date.now();

  if (input.kind === "text") {
    trace.push({ node: "multimodal_node", ts: new Date().toISOString(), decision: "texte direct", latency_ms: Date.now() - start });
    return { messages: state.messages, trace };
  }

  try {
    if (input.kind === "audio") {
      const llm = buildLlm();
      // Le endpoint Numeos étant compatible OpenAI, la transcription passe
      // par le même client, en confiant l'audio comme pièce jointe au modèle
      // multimodal si le modèle configuré le supporte. Si l'appel échoue,
      // on dégrade proprement ci-dessous (catch).
      const res = await llm.invoke([
        { role: "system", content: "Transcris fidèlement cette note vocale, sans l'interpréter ni la résumer." },
        { role: "user", content: [{ type: "audio_url", audio_url: { url: `data:audio/ogg;base64,${input.audioBase64}` } }] as unknown as string },
      ]);
      const texte = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      trace.push({ node: "multimodal_node", ts: new Date().toISOString(), decision: "STT ok", latency_ms: Date.now() - start });
      return { trace, draft: undefined, facts: state.facts, messages: [...state.messages], intention: state.intention, __transcript: texte } as Partial<KenzaState> & Record<string, unknown>;
    }

    if (input.kind === "image") {
      const llm = buildLlm();
      const res = await llm.invoke([
        {
          role: "system",
          content: "Décris uniquement ce que tu vois : famille de vêtement, couleur, caractéristiques visibles. Ne devine jamais une référence catalogue précise.",
        },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` } }] as unknown as string,
        },
      ]);
      const description = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      trace.push({ node: "multimodal_node", ts: new Date().toISOString(), decision: "vision ok", latency_ms: Date.now() - start });
      return { trace, __transcript: `[Photo décrite par le client] ${description}` } as Partial<KenzaState> & Record<string, unknown>;
    }
  } catch (err) {
    trace.push({
      node: "multimodal_node",
      ts: new Date().toISOString(),
      decision: `échec service ${input.kind}, dégradation propre`,
      result: String(err),
      latency_ms: Date.now() - start,
    });
    return {
      trace,
      needsHuman: true,
      escalation: {
        motif: "service_multimodal_indisponible",
        contexte: `Le service ${input.kind === "audio" ? "de transcription" : "de reconnaissance d'image"} est indisponible. Le message brut n'a pas pu être traité automatiquement.`,
      },
    };
  }

  return { trace };
}
