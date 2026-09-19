import { createHash } from "crypto";
import { z } from "zod";
import type { Intention, KenzaState, Langue } from "../types";
import { buildLlm, contentToText, invokeLogged, llmConfigured } from "../llm";
import { analyzeMessage, heuristicLangDetect, wantsCatalog, wantsProductLookup, wantsToBuy } from "../rules";
import { normalizeArabizi } from "../text";
import { ensureRedis } from "../memory";
import { ev, lastUserText } from "./util";

const INTENTIONS = [
  "prix_et_disponibilite", "rupture_de_stock", "darija_prix", "conseil_taille", "negociation", "question_arabe", "client_qui_revient",
  "changement_avis", "note_vocale", "photo_produit", "suivi_commande", "retour_produit", "hors_domaine", "livraison_arabe", "rupture_arabe",
  "reclamation_arabe", "panier_abandonne", "inconnu",
] as const;

const IntentSchema = z.object({
  intention: z.enum(INTENTIONS),
  langue: z.enum(["fr", "ar", "darija"]),
  confiance: z.number().min(0).max(1),
  difficulte: z.enum(["facile", "standard", "difficile"]).optional(),
  confirme_commande: z.boolean().optional(),
});
type IntentOut = z.infer<typeof IntentSchema>;

const SYSTEM = `Tu classifies le DERNIER message d'un client d'une boutique de prêt-à-porter marocaine (français, arabe, darija en lettres latines ou arabes, avec fautes possibles).
Réponds UNIQUEMENT avec un JSON valide, sans texte autour :
{"intention":"...","langue":"fr|ar|darija","confiance":0.0-1.0,"difficulte":"facile|standard|difficile","confirme_commande":true|false}
Intentions : ${INTENTIONS.join(", ")}.
- "langue" = langue du dernier message (arabe standard = ar ; dialecte marocain, même en lettres latines = darija).
- "confirme_commande" = true seulement si le client confirme clairement qu'il veut passer commande maintenant (oui, wakha, c'est bon, نعم...), sans réserve ni changement.
- Si le message est ambigu, tronqué ou que tu hésites : intention "inconnu" et confiance basse. Ne devine jamais.`;

async function classifyWithLlm(text: string): Promise<IntentOut> {
  const key = "intent:" + createHash("sha1").update(normalizeArabizi(text)).digest("hex");
  try {
    const cached = await (await ensureRedis()).get(key);
    if (cached) return IntentSchema.parse(JSON.parse(cached));
  } catch { /* cache indisponible : on continue sans */ }

  const res = await invokeLogged("intent", buildLlm(), [{ role: "system", content: SYSTEM }, { role: "user", content: text }]);
  const raw = contentToText(res.content);
  const m = raw.match(/\{[\s\S]*\}/);
  const parsed = IntentSchema.parse(JSON.parse(m ? m[0] : raw));
  try { await (await ensureRedis()).set(key, JSON.stringify(parsed), "EX", 3600); } catch { /* ignore */ }
  return parsed;
}

/** Repli quand le LLM est indisponible : jamais une supposition hasardeuse -> "inconnu" faible. */
function fallback(text: string, langue: Langue): IntentOut {
  const t = normalizeArabizi(text);
  const price = /prix|combien|taman|chhal|tmn|بكم|شحال|كم/.test(t);
  return { intention: price ? (langue === "darija" ? "darija_prix" : "prix_et_disponibilite") : "inconnu", langue, confiance: price ? 0.55 : 0.2 };
}

export async function intent_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const text = lastUserText(state.messages);
  const rules = analyzeMessage(text);

  let out: IntentOut;
  let source = "llm";
  try {
    if (!llmConfigured()) throw new Error("LLM non configuré");
    out = await classifyWithLlm(text);
  } catch {
    source = "regles";
    out = fallback(text, heuristicLangDetect(text));
  }
  let intention: Intention = out.confiance < 0.5 ? "inconnu" : out.intention;
  if (intention === "inconnu" && wantsToBuy(text)) {
    intention = "prix_et_disponibilite";
    out.confiance = Math.max(out.confiance, 0.8);
  }
  if (wantsCatalog(text)) {
    intention = "prix_et_disponibilite";
    out.confiance = Math.max(out.confiance, 0.8);
  }
  if (intention === "inconnu" && wantsProductLookup(text)) {
    intention = "prix_et_disponibilite";
    out.confiance = Math.max(out.confiance, 0.8);
  }
  if (state.media?.kind === "image") { intention = "photo_produit"; out.confiance = Math.max(out.confiance, 0.9); }
  else if (state.media?.kind === "audio" && intention === "inconnu") intention = "note_vocale";

  const patch: Partial<KenzaState> = {
    intention,
    intentConfidence: out.confiance,
    langue: out.langue,
    confirmation: rules.confirmation || out.confirme_commande === true,
  };
  if (rules.city?.kind === "grid") patch.ville = rules.city.ville;

  // Règles déterministes : prioritaires sur le LLM.
  let esc = rules.escalation;
  if (!esc && (intention === "hors_domaine" || intention === "reclamation_arabe")) {
    esc = { code: intention === "hors_domaine" ? "hors_domaine" : "reclamation", motif: intention === "hors_domaine" ? "Question hors domaine (hors périmètre de l'agent)." : "Réclamation client." };
  }
  if (!esc && rules.wantsHuman) esc = { code: "incertitude", motif: "Le client demande explicitement à parler à un humain." };
  if (esc) {
    patch.needsHuman = true;
    patch.escalationCode = esc.code;
    patch.escalation = { motif: esc.motif, contexte: "" };
  }

  return {
    ...patch,
    trace: [...state.trace, ev("intent_node", {
      decision: `intention=${intention} langue=${out.langue} confiance=${out.confiance.toFixed(2)} source=${source}${esc ? ` escalade=${esc.code}` : ""}`,
      latency_ms: Date.now() - start,
    })],
  };
}
