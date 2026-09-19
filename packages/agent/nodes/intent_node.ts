import { z } from "zod";
import type { KenzaState, Intention, Langue } from "../types";
import { buildLlm } from "../llm";
import { heuristicLangDetect, normalizeDarijaText } from "./lang";

const IntentSchema = z.object({
  intention: z.enum([
    "prix_et_disponibilite", "rupture_de_stock", "darija_prix", "conseil_taille",
    "negociation", "question_arabe", "client_qui_revient", "changement_avis",
    "note_vocale", "photo_produit", "suivi_commande", "retour_produit",
    "hors_domaine", "livraison_arabe", "rupture_arabe", "reclamation_arabe",
    "panier_abandonne", "inconnu",
  ]),
  langue: z.enum(["fr", "ar", "darija"]),
  confiance: z.number().min(0).max(1),
  difficulte: z.enum(["facile", "standard", "difficile"]).optional(),
});

const SYSTEM = `Tu classifies un message client de boutique en ligne. Réponds UNIQUEMENT en JSON
valide, sans texte autour, au format:
{"intention": "...", "langue": "fr|ar|darija", "confiance": 0.0-1.0, "difficulte": "facile|standard|difficile"}

Intentions possibles: prix_et_disponibilite, rupture_de_stock, darija_prix, conseil_taille,
negociation, question_arabe, client_qui_revient, changement_avis, note_vocale, photo_produit,
suivi_commande, retour_produit, hors_domaine, livraison_arabe, rupture_arabe, reclamation_arabe,
panier_abandonne, inconnu.

Si tu n'es pas confiant (ambiguïté, message tronqué, mélange de langues), choisis "inconnu" et une
confiance basse plutôt que de deviner.`;

export async function intent_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const lastMessage = state.messages[state.messages.length - 1];
  const rawText = typeof lastMessage?.content === "string" ? lastMessage.content : String(lastMessage?.content ?? "");
  const normalized = normalizeDarijaText(rawText);

  let intention: Intention = "inconnu";
  let langue: Langue = heuristicLangDetect(rawText);
  let confiance = 0;

  try {
    const llm = buildLlm({ temperature: 0 });
    const res = await llm.invoke([
      { role: "system", content: SYSTEM },
      { role: "user", content: normalized },
    ]);
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = IntentSchema.parse(JSON.parse(jsonMatch ? jsonMatch[0] : text));
    intention = parsed.confiance < 0.5 ? "inconnu" : parsed.intention;
    langue = parsed.langue;
    confiance = parsed.confiance;
  } catch (err) {
    // Confiance faible explicite plutôt qu'une supposition : "inconnu" est préféré.
    intention = "inconnu";
    confiance = 0;
  }

  return {
    intention,
    intentConfidence: confiance,
    langue,
    trace: [
      ...state.trace,
      {
        node: "intent_node",
        ts: new Date().toISOString(),
        decision: `intention=${intention} langue=${langue} confiance=${confiance.toFixed(2)}`,
        latency_ms: Date.now() - start,
      },
    ],
  };
}

/** Intentions qui doivent systématiquement passer par l'escalade, sans tentative de réponse. */
export const FORCED_ESCALATION_INTENTS: Intention[] = ["reclamation_arabe", "hors_domaine"];
