import { DISCOUNT_MAX_PCT } from "./config";
import { detectCity, type CityMention } from "./cities";
import { foldText, normalizeArabizi } from "./text";
import type { Langue } from "./types";

/**
 * Règles DÉTERMINISTES appliquées avant/indépendamment du LLM. Le cahier
 * des charges impose que les escalades obligatoires et le plancher de
 * remise soient garantis dans le code, pas seulement dans le prompt : un
 * LLM distrait ou indisponible ne doit jamais les contourner.
 */

export type EscalationCode =
  | "facture_societe"
  | "reclamation"
  | "remboursement_especes"
  | "reassort_demande"
  | "remise_hors_plancher"
  | "ville_hors_grille"
  | "hors_domaine"
  | "hors_catalogue"
  | "outil_sans_resultat"
  | "incertitude"
  | "guardrail_echec"
  | "llm_indisponible"
  | "service_multimodal_indisponible";

export interface EscalationTrigger {
  code: EscalationCode;
  motif: string;
  detail?: string;
}

const RE = {
  facture: [
    /\bice\b/, /\bsarl\b/, /societe/, /entreprise/, /patente/, /\bfactur/, /\bfatur/, /\binvoice\b/, /\bsharika\b|\bcharika\b|\bcharikat/,
    /فاتوره/, /شركه/, /شركتي/, /سجل تجاري/,
  ],
  reclamation: [
    /reclam/, /plainte/, /litige/, /arnaque/, /escroc/, /scandale/, /inadmissible/, /honteux/,
    /pas (?:conforme|livre|recu)/, /jamais (?:recu|livre)/, /(?:colis|commande) (?:perdu|abime|casse|egare)/,
    /(?:article|produit|robe|veste|chaussure\w*|sac|pantalon|chemise) (?:abime|casse|defectueu\w*|dechire|tache|troue)/,
    /defectueu/, /erreur (?:dans|sur) (?:ma |la )?commande/, /pas ce que j'ai commande/, /avocat/, /tribunal/, /remboursez/, /service client(?:ele)? nul/,
    /شكايه/, /شكوي/, /احتجاج/, /نصب/, /مشكل في (?:الطلب|الطلبيه|السلعه)/, /(?:ما|لم) (?:وصلني|يصلني|توصلت)/, /وصلني مكسور/, /معيوب/, /خربان/, /تالف/, /محامي/, /محكمه/,
    /chkaya|chikaya|chka[iy]a|chekaya/, /\bnsab\b|\bnasab\b|nssab/, /kharban|kherban|kharb[ae]n/, /ma (?:wsel|wasel|wslni|wsalni)|mawsel|mawaslnich|ma wslatch/, /\b(?:ghalat|mghlot|mghalt)\b/, /\b(?:3yib|ayib)\b/,
  ],
  remboursement: [
    /rembours/, /restitu/, /\brefund\b/, /rendez.?moi (?:mon|l')\s*argent/, /(?:en |f )(?:especes|cash|liquide)/,
    /استرجاع (?:المال|الاموال|الفلوس|المبلغ)/, /(?:ارجاع|استرداد|اسرتداد) (?:المال|الاموال|الفلوس|المبلغ)/, /رجع(?:وا)?(?:ي|ولي|لي)? (?:الفلوس|المال|الاموال|المبلغ)/, /فلوسي/,
  ],
  reassort: [
    /reassort/, /reapprovision/, /restock/, /retour en stock/, /de retour/, /back in stock/, /nouvel arrivage/, /remis en stock/,
    /quand.{0,30}(?:revien|redevien|reviend|reviendra|remis|de nouveau|a nouveau|sera dispo|serait dispo|sera de retour|rentre)/,
    /(?:sera|serait|redevient|redeviendra) (?:de nouveau |a nouveau )?(?:dispo|disponible)/,
    /(?:imta|wa9tach|waqtach|wakt|wqt|wa9t)\w*.{0,25}(?:yrj|yrja|yji|yweslo|ywsl|ytwafar|ykon|yban|yrd|trj|tji|twsl|tkon|tweslo|trja)/,
    /متي.{0,25}(?:يتوفر|سيتوفر|يرجع|يعود|يوصل|تتوفر|ستتوفر|ترجع|تعود|توصل)/, /امتي.{0,25}(?:يرجع|يوصل|يتوفر|ترجع|توصل|تتوفر)/, /تاريخ (?:التوفر|الوصول|التزود)/,
  ],
} as const;

const MONEY_WORD = /\b(?:flous|floss|flouss|fels|flus|argent)\b/;
const GIVE_BACK = /\b[nty]?r(?:ja?\w*|e?dd?\w*|edo\w*|do\w*)\b/;

function anyMatch(list: readonly RegExp[], ...texts: string[]): boolean {
  return list.some((re) => texts.some((t) => re.test(t)));
}

export interface DiscountRequest {
  pct: number;
  /** true si le client demande la gratuité / un pourcentage extrême. */
  extreme: boolean;
}

/** Extrait le pourcentage de remise demandé ("30 %", "30 pourcent", "-30%"), sinon null. */
export function extractDiscountPct(text: string): number | null {
  const f = foldText(text);
  if (/\b(?:gratuit|free|balash|blash)\b|بلاش|مجانا|مجاني/.test(f)) return 100;
  if (/moitie prix|nos taman|نص الثمن|نصف الثمن|demi[- ]prix/.test(f)) return 50;
  const re = /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|pour ?cent(?:s)?|pourcent|percent|بالمايه|بالميه|فالمايه|فالميه|f\s*l?mi+y?a|pct)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f))) {
    const after = f.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (/^\s*(?:de |en |d')?(?:coton|cuir|laine|soie|lin|polyester|denim|viscose|cotton)/.test(after)) continue; // composition, pas une remise
    return Number(m[1].replace(",", "."));
  }
  return null;
}

export function detectEscalationTrigger(text: string): EscalationTrigger | null {
  const f = foldText(text);
  const a = normalizeArabizi(text);
  const texts = [f, a];

  // Le réassort est testé en premier : "quand ça revient" doit toujours escalader.
  if (anyMatch(RE.reassort, ...texts)) {
    return { code: "reassort_demande", motif: "Le client demande une date de réassort/retour en stock (aucune promesse autorisée)." };
  }
  const darijaRefund = texts.some((t) => MONEY_WORD.test(t) && GIVE_BACK.test(t));
  if (anyMatch(RE.remboursement, ...texts) || darijaRefund) {
    return { code: "remboursement_especes", motif: "Demande de remboursement (espèces/argent) : non accordé par l'agent." };
  }
  if (anyMatch(RE.facture, ...texts)) {
    return { code: "facture_societe", motif: "Demande de facture / facture au nom d'une société (ICE) : hors périmètre de l'agent." };
  }
  if (anyMatch(RE.reclamation, ...texts)) {
    return { code: "reclamation", motif: "Réclamation / litige client à traiter par le commerçant." };
  }
  const pct = extractDiscountPct(text);
  if (pct !== null && pct > DISCOUNT_MAX_PCT) {
    return {
      code: "remise_hors_plancher",
      motif: `Remise demandée (${pct}%) supérieure au plafond autorisé (${DISCOUNT_MAX_PCT}%).`,
      detail: String(pct),
    };
  }
  const city = detectCity(text);
  if (city?.kind === "unknown") {
    return { code: "ville_hors_grille", motif: `Ville hors grille de livraison : « ${city.name} ». Aucun frais/délai ne peut être annoncé.`, detail: city.name };
  }
  return null;
}

const CONFIRM = [
  /\b(?:oui|ouais|ok|okay|okey|dacc|d'accord|confirme\w*|c'est bon|cest bon|valide\w*|je (?:la |le |les )?prends|go|allez-?y|vas-?y|parfait|yes|yep|top|banco)\b/,
  /\b(?:iyeh|iyah|eyh|ih|ah|wah|waha|wakha|wakhha|safi|nsajel|sajel|sajjel|yalah|yallah|mzyan|mezyan|mzian|bismillah|nakhod|nkhod|khodha|khoud)\b/,
  /نعم|ايه|اه|واخا|موافق|تمام|اكيد|سجل|اوكي|حسنا|اكد|ماشي مشكل/,
];
const NEGATE = [
  /\b(?:non|pas|jamais|attends?|attendez|stop|finalement|plutot|annule\w*|change\w*|mais)\b/,
  /\b(?:la|lla|ma|makaynch|stanna|stana|bdlt|bdel|bghit\s+ghir)\b/,
  /لا\b|انتظر|بدلت|غيرت|الغاء|لكن|ولكن/,
];

/** Le client confirme-t-il explicitement (oui / wakha / نعم) sans réserve ? */
export function looksLikeConfirmation(text: string): boolean {
  const f = foldText(text);
  const a = normalizeArabizi(text);
  if (f.length > 80) return false;
  const yes = CONFIRM.some((re) => re.test(f) || re.test(a));
  if (!yes) return false;
  return !NEGATE.some((re) => re.test(f) || re.test(a));
}

export interface MessageAnalysis {
  escalation: EscalationTrigger | null;
  discountPct: number | null;
  city: CityMention | null;
  confirmation: boolean;
  policyTopics: PolicyTopic[];
  wantsHuman: boolean;
}

export type PolicyTopic = "retour" | "horaires" | "garantie" | "retrait" | "paiement";

export function detectPolicyTopics(text: string): PolicyTopic[] {
  const f = foldText(text);
  const a = normalizeArabizi(text);
  const t = `${f} ${a}`;
  const out: PolicyTopic[] = [];
  if (/retour|retourn|echang|avoir\b|rendre|renvoy|رجاع|استبدال|ترجيع|ba9i|bdel|nbdl|rj3/.test(t)) out.push("retour");
  if (/horaire|ouvert|ferme|ouverture|heure d'ouv|wa9tach kat|imta katfta|مفتوح|ساعات|اوقات/.test(t)) out.push("horaires");
  if (/garantie|garanti|defaut de fabrication|ضمان/.test(t)) out.push("garantie");
  if (/retrait|retirer|recuperer en boutique|click.?and.?collect|nakhdha mn|استلام من المحل|سحب/.test(t)) out.push("retrait");
  if (/paiement|payer|virement|carte|cod\b|a la livraison|cash|khlas|kanxlss|الدفع|اداء|دفع/.test(t)) out.push("paiement");
  return out;
}

export function wantsHuman(text: string): boolean {
  const f = foldText(text);
  return /(?:parler|passer|voir).{0,20}(?:humain|conseiller|responsable|commercant|patron|proprietaire|quelqu'un)|un humain|human agent|(?:bghit|بغيت).{0,15}(?:bnadem|insan|patron|responsable)|مع (?:بني ادم|انسان|صاحب المحل|المسؤول)/.test(f);
}

export function analyzeMessage(text: string): MessageAnalysis {
  return {
    escalation: detectEscalationTrigger(text),
    discountPct: extractDiscountPct(text),
    city: detectCity(text),
    confirmation: looksLikeConfirmation(text),
    policyTopics: detectPolicyTopics(text),
    wantsHuman: wantsHuman(text),
  };
}

// ---------------------------------------------------------------------------
// Détection de langue (heuristique, repli si le LLM est indisponible)
// ---------------------------------------------------------------------------
const DARIJA_LATIN = [
  "chhal", "chal", "ch7al", "chhel", "b7al", "bhal", "kayn", "kain", "kayna", "kayen", "makaynach", "makaynch", "bghit", "bghiti", "bghina", "bghitha",
  "3afak", "afak", "wach", "wakha", "wakhha", "safi", "3andi", "andi", "nsajel", "sajel", "khoud", "khod", "smh", "smhli", "taman", "tmn", "dyal", "diyal", "dyali",
  "bzaf", "bzzaf", "daba", "dba", "mzyan", "mezyan", "mzian", "zwin", "zwina", "tawsil", "twsil", "tawsel", "salam", "slm", "lah", "khti", "khoya", "sahbi",
  "fin", "kifach", "3lach", "chno", "shno", "ash", "wa9tach", "imta", "ghadi", "ghda", "hna", "mochkil", "mouchkil", "kanbghi", "kan", "ana", "nta", "nti",
  "stanna", "bdlt", "kbira", "sghira", "chwiya", "chwia", "ba9i", "bqa", "mnin", "3lia", "3lik", "lia", "liya", "lik", "walo", "wlad", "flous", "flouss",
];
const DARIJA_KEYS = new Set(DARIJA_LATIN.map((w) => normalizeArabizi(w)));
const DARIJA_ARABIC = /(?:شحال|بغيت|بغينا|واش|كاين|كاينه|ديال|فين|دابا|زوين|بزاف|مزيان|عافاك|غادي|علاش|شنو|كيفاش|ماشي|خويا|ختي|واخا|بلاصه|فلوس|لاباس|الله يخليك|ياك|هاد|هادي|ديالي|ديالك|كنبغي|بغا|بغات)/;
const FRENCH_HINT = /\b(?:bonjour|bonsoir|merci|je|vous|votre|est-ce|combien|livraison|disponible|prix|commande|taille|s'il|svp|voudrais|veux|avez|quel|quelle|pour|avec|dans|une?|des|les|pas|oui|non)\b/;

export function heuristicLangDetect(text: string): Langue {
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  if (hasArabic) return DARIJA_ARABIC.test(foldText(text)) ? "darija" : "ar";
  const key = normalizeArabizi(text);
  const words = key.split(/[^a-z0-9']+/).filter(Boolean);
  const darijaHits = words.filter((w) => DARIJA_KEYS.has(w) && !["ana", "kan", "ash", "fin", "lah", "hna"].includes(w)).length
    + (words.some((w) => ["ana", "kan", "ash", "fin", "lah", "hna"].includes(w)) ? 0.5 : 0);
  const frenchHits = words.filter((w) => FRENCH_HINT.test(w)).length;
  if (darijaHits >= 1 && darijaHits >= frenchHits) return "darija";
  return "fr";
}
