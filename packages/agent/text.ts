/**
 * Normalisation de texte multilingue (français / arabe / darija en
 * caractères latins "arabizi"). Utilisée par les règles déterministes, la
 * détection de langue et le guardrail. Le texte affiché au client n'est
 * jamais modifié.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Convertit les chiffres arabo-indiens en chiffres latins. */
export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = ARABIC_INDIC.indexOf(c);
    return String(i >= 0 ? i : EXT_ARABIC_INDIC.indexOf(c));
  });
}

/** Minuscule, sans accents latins, sans diacritiques/tatweel arabes, alef unifiés. */
export function foldText(s: string): string {
  return toLatinDigits(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase();
}

const ARABIZI_DIGITS: Record<string, string> = { "2": "a", "3": "a", "5": "kh", "7": "h", "8": "gh", "9": "q" };

/**
 * Normalise l'arabizi : les chiffres collés à des lettres dans un même mot
 * (ch7al, 3afak, b9it...) deviennent des lettres. Les nombres isolés
 * (30, 1290) ne sont jamais touchés.
 */
export function normalizeArabizi(text: string): string {
  return foldText(text).replace(/[a-z0-9']+/g, (tok) => {
    if (!/[a-z]/.test(tok) || !/[235789]/.test(tok)) return tok;
    return tok.replace(/[235789]/g, (d) => ARABIZI_DIGITS[d]);
  });
}

/** Distance de Levenshtein bornée (pour tolérer les fautes de frappe). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
