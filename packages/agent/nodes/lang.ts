import type { Langue } from "../types";

/**
 * Normalise les chiffres-lettres (chat-arabi / arabizi) fréquents en darija
 * écrite en alphabet latin, pour aider la classification d'intention et la
 * compréhension, sans jamais modifier le texte affiché au client.
 */
const ARABIZI_MAP: Record<string, string> = {
  "2": "a", "3": "3", "7": "h", "9": "q",
};

export function normalizeDarijaText(text: string): string {
  // On ne remplace 3/7/9 que lorsqu'ils sont collés à des lettres (mots
  // darija), pas des nombres isolés (prix, quantités) qui doivent rester
  // des chiffres pour le reste du pipeline.
  return text.replace(/([a-zA-Z])([2379])([a-zA-Z])/g, (_, a, d, b) => `${a}${ARABIZI_MAP[d] ?? d}${b}`);
}

const DARIJA_MARKERS = [
  "chhal", "chal", "ch7al", "b7al", "kayn", "kain", "kayna", "makaynach",
  "bghit", "bghiti", "3afak", "wach", "wakha", "safi", "3andi", "nsajel",
  "khoud", "smh", "taman", "dyal", "bzaf", "daba",
];

const ARABIC_RANGE = /[\u0600-\u06FF]/;

/**
 * Heuristique légère utilisée en repli si le nœud d'intention (LLM) échoue.
 * Le LLM reste la source principale de détection de langue.
 */
export function heuristicLangDetect(text: string): Langue {
  if (ARABIC_RANGE.test(text)) return "ar";
  const lower = text.toLowerCase();
  if (DARIJA_MARKERS.some((m) => lower.includes(m))) return "darija";
  return "fr";
}
