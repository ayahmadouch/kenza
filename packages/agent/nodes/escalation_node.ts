import { AIMessage } from "@langchain/core/messages";
import type { KenzaState, Langue } from "../types";
import { escalate } from "../tools/client_escalate";
import { setShortState } from "../memory";
import { ev, msgText } from "./util";

/**
 * Réponses SÛRES par code d'escalade. Aucune ne contient de chiffre, de prix,
 * de délai ni de promesse : le client sait qu'un humain reprend, c'est tout.
 */
const SAFE: Record<string, Record<Langue, string>> = {
  facture_societe: {
    fr: "Pour une facture au nom de votre société, je transmets votre demande au commerçant avec tout le contexte. Il revient vers vous rapidement, vous n'avez rien à répéter.",
    ar: "بخصوص الفاتورة باسم شركتكم، سأحيل طلبكم إلى التاجر مع كامل التفاصيل. سيتواصل معكم قريبا ولا داعي لإعادة أي شيء.",
    darija: "Bnisba l facture b smiyet charikatek, ghadi nssift talab dyalek l commerçant m3a ga3 les détails. Ghadi yjik daba, ma khassek t3awd walo.",
  },
  reclamation: {
    fr: "Je suis désolée pour ce désagrément. Je transmets immédiatement votre réclamation au commerçant avec tout l'historique pour qu'il la traite en priorité.",
    ar: "نعتذر عن هذا الإزعاج. سأحيل شكايتكم فورا إلى التاجر مع كامل السجل ليعالجها بشكل ذي أولوية.",
    darija: "Smh 3lia 3la had l mochkil. Ghadi nssift lchkaya dyalek daba l commerçant m3a ga3 l'historique bach ytkllef biha men lowel.",
  },
  remboursement_especes: {
    fr: "Je ne peux pas traiter un remboursement en espèces moi-même. Je transmets votre demande au commerçant avec le contexte, il vous répond rapidement.",
    ar: "لا أستطيع معالجة استرجاع المبلغ نقدا بنفسي. سأحيل طلبكم إلى التاجر مع التفاصيل وسيرد عليكم قريبا.",
    darija: "Ma nqderch nrja3 lflous cash b rassi. Ghadi nssift talab dyalek l commerçant m3a ga3 l contexte w ghadi yjawbek f a9rab wa9t.",
  },
  reassort_demande: {
    fr: "Je ne peux pas vous donner de date de retour en stock. Je transmets votre question au commerçant, qui pourra vous répondre. En attendant, je peux regarder d'autres modèles disponibles.",
    ar: "لا أستطيع إعطاءكم تاريخا لعودة المنتج. سأحيل سؤالكم إلى التاجر. في هذه الأثناء يمكنني اقتراح منتجات أخرى متوفرة.",
    darija: "Ma nqderch n3tik date dyal rjou3 l produit. Ghadi nssift so2al dyalek l commerçant. Daba nqder nwerrik modèles okhrin kaynin f stock.",
  },
  remise_hors_plancher: {
    fr: "Je ne peux pas accorder cette remise : elle dépasse ce que je suis autorisée à faire. Je transmets votre demande au commerçant qui pourra étudier un geste.",
    ar: "لا أستطيع منح هذا التخفيض لأنه يتجاوز ما أنا مخولة به. سأحيل طلبكم إلى التاجر ليدرس الأمر.",
    darija: "Ma nqderch n3tik had la remise, kaytjawez li 3ndi l7a9 fih. Ghadi nssift talab dyalek l commerçant bach ychouf m3ak.",
  },
  ville_hors_grille: {
    fr: "Cette ville ne figure pas dans notre grille de livraison, je ne peux donc pas vous annoncer de frais ni de délai. Je transmets votre demande au commerçant pour qu'il vous propose une solution.",
    ar: "هذه المدينة ليست ضمن شبكة التوصيل لدينا، لذلك لا أستطيع إعطاءكم تكلفة أو مدة. سأحيل طلبكم إلى التاجر ليقترح حلا.",
    darija: "Had la ville machi f la grille dyal tawsil, ma nqderch n9ol lik taman wla wa9t. Ghadi nssift talab dyalek l commerçant bach y9tar7 3lik 7al.",
  },
  hors_domaine: {
    fr: "Cette question sort de mon domaine (vente et conseil produit). Je la transmets au commerçant pour qu'il vous réponde correctement.",
    ar: "هذا السؤال خارج مجال اختصاصي (البيع والنصيحة حول المنتجات). سأحيله إلى التاجر ليجيبكم بشكل صحيح.",
    darija: "Had so2al khareej ikhtisasi (l bi3 w n-nasi7a 3la l produits). Ghadi nssifto l commerçant bach yjawbek mzyan.",
  },
  hors_catalogue: {
    fr: "Je ne retrouve pas ce produit dans notre catalogue. Je transmets votre demande au commerçant pour qu'il vérifie avec vous.",
    ar: "لا أجد هذا المنتج في كتالوجنا. سأحيل طلبكم إلى التاجر ليتحقق معكم.",
    darija: "Ma l9itch had l produit f catalogue dyalna. Ghadi nssift talab dyalek l commerçant bach ychouf m3ak.",
  },
  llm_indisponible: {
    fr: "Je vais transmettre votre demande à notre équipe afin qu'elle puisse vous répondre correctement.",
    ar: "سأحيل طلبكم إلى فريقنا حتى يتمكن من الرد عليكم بشكل صحيح.",
    darija: "Ghadi nssift talab dyalek l l'équipe dyalna bach ijawbouk mzyan.",
  },
  service_multimodal_indisponible: {
    fr: "Je n'ai pas réussi à traiter votre fichier (note vocale ou photo). Pouvez-vous m'écrire votre demande en texte ? Je transmets aussi à l'équipe pour qu'elle vous aide.",
    ar: "لم أتمكن من معالجة الملف (رسالة صوتية أو صورة). هل يمكنكم كتابة طلبكم نصيا؟ سأحيل الأمر أيضا إلى الفريق.",
    darija: "Ma 9dertch nfhem l fichier (vocal wla tswira). Wach t9der tktb liya talab dyalek? Ghadi nssift l équipe tan.",
  },
  default: {
    fr: "Je transmets votre demande à notre équipe pour qu'elle puisse vous répondre précisément. Elle revient vers vous rapidement, avec tout le contexte.",
    ar: "سأحيل طلبكم إلى فريقنا حتى يتمكن من الرد عليكم بدقة. سيتواصل معكم قريبا مع كامل السياق.",
    darija: "Ghadi nssift talab dyalek l l'équipe bach ijawbouk b dqa. Ghadi yjiwek 9rib m3a ga3 l contexte.",
  },
};

export function safeReply(code: string | undefined, langue: Langue): string {
  return (SAFE[code ?? "default"] ?? SAFE.default)[langue];
}

const ROLE: Record<string, string> = { human: "client", ai: "Kenza" };

function buildContext(state: KenzaState, motif: string): string {
  const last = state.messages.slice(-8).map((m) => `${ROLE[m.getType()] ?? m.getType()} : ${msgText(m)}`);
  const hist = state.facts.find((f) => f.type === "history")?.value as { client?: { nom?: string; ville?: string; segment?: string }; dernieres_commandes?: unknown[] } | undefined;
  const cart = state.cart.length ? state.cart.map((i) => `${i.qte}× ${i.modele} (${i.ref}, taille ${i.taille}) à ${i.prix_unitaire} MAD`).join(" ; ") : "vide";
  return [
    `Motif : ${motif}`,
    `Client : ${hist?.client?.nom ?? state.clientId ?? state.telephone ?? "non identifié"}${state.telephone ? ` (${state.telephone})` : ""}${hist?.client?.segment ? ` — segment ${hist.client.segment}` : ""}`,
    `Langue : ${state.langue} ; intention : ${state.intention ?? "inconnue"} ; ville : ${state.ville ?? "non précisée"}`,
    `Panier : ${cart}`,
    state.remise ? `Remise : demandée ${state.remise.demandee_pct}% / accordée ${state.remise.accordee_pct}%` : "",
    `Derniers échanges : ${last.join(" | ")}`,
    state.guardrail && !state.guardrail.ok ? `Garde-fou : ${state.guardrail.violations.join(" ; ")}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Crée l'escalade en base (motif + contexte complet) et répond au client par un
 * message sûr sans chiffre ni promesse. Le client n'a jamais à se répéter.
 */
export async function escalation_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const motif = state.escalation?.motif || (state.guardrail && !state.guardrail.ok ? `Garde-fou : ${state.guardrail.violations.join("; ")}` : `Intention ${state.intention ?? "inconnue"} non traitable`);
  const contexte = state.escalation?.contexte || buildContext(state, motif);
  const code = state.escalationCode ?? "default";
  const draft = safeReply(code, state.langue);

  const result = await escalate({ conversationId: state.conversationId, motif: `${code}: ${motif}`, contexte, payload: { code, langue: state.langue, cart: state.cart, intention: state.intention } });
  try { await setShortState(state.conversationId, { langue: state.langue, escalated: true, at: Date.now() }); } catch { /* Redis optionnel */ }

  return {
    needsHuman: true,
    draft,
    escalation: { motif, contexte },
    messages: [new AIMessage(draft)],
    trace: [...state.trace, ev("escalation_node", { tool: "escalate", args: { code, motif }, result, decision: "escalade créée, contexte complet transmis au commerçant", latency_ms: Date.now() - start })],
  };
}
