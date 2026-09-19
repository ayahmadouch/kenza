import { foldText } from "./text";
import { ALLOWED_CITIES } from "./types";

/**
 * Résolution de villes. Les 12 villes de la grille (livraison.csv) sont
 * reconnues avec leurs alias ; une liste de villes marocaines HORS grille
 * permet de déclencher l'escalade même quand le client écrit seulement
 * "Essaouira". Aucune estimation de frais n'est jamais faite hors grille.
 */
const GRID_ALIASES: Record<string, string[]> = {
  Casablanca: ["casablanca", "casa", "dar el beida", "dar lbida", "الدار البيضاء", "كازا", "كازابلانكا"],
  Rabat: ["rabat", "الرباط"],
  "Fès": ["fes", "fas", "فاس"],
  Marrakech: ["marrakech", "marrakesh", "marakech", "mrrakech", "marrakch", "مراكش"],
  Tanger: ["tanger", "tangier", "tanja", "طنجه"],
  Agadir: ["agadir", "اكادير"],
  "Meknès": ["meknes", "مكناس"],
  Oujda: ["oujda", "وجده"],
  "Kénitra": ["kenitra", "القنيطره"],
  "Tétouan": ["tetouan", "tetwan", "تطوان"],
  "Salé": ["sale", "سلا"],
  Mohammedia: ["mohammedia", "mohamedia", "المحمديه"],
};

/** Alias ambigus avec un mot courant : n'acceptés qu'avec une préposition de lieu. */
const AMBIGUOUS_GRID = new Set(["sale", "fas"]);

const OUT_OF_GRID = [
  "essaouira", "الصويره", "el jadida", "eljadida", "jadida", "الجديده", "nador", "الناظور", "beni mellal", "بني ملال",
  "khouribga", "خريبكه", "settat", "سطات", "laayoune", "layoune", "العيون", "dakhla", "الداخله", "errachidia", "الراشيديه",
  "ouarzazate", "ورزازات", "al hoceima", "alhoucema", "الحسيمه", "larache", "العرايش", "taza", "تازه", "berkane", "بركان",
  "ifrane", "افران", "chefchaouen", "chaouen", "شفشاون", "tiznit", "تيزنيت", "guelmim", "كلميم", "khemisset", "الخميسات",
  "azrou", "sefrou", "temara", "تمارة", "تمارا", "skhirat", "berrechid", "برشيد", "tan-tan", "tan tan", "taroudant",
  "asilah", "assilah", "ksar el kebir", "sidi slimane", "sidi kacem", "midelt", "zagora", "tinghir", "youssoufia",
  "benguerir", "bouznika", "nouaceur", "dar bouazza", "ain harrouda", "el hajeb", "oued zem", "fnideq", "martil",
  "paris", "france", "lyon", "marseille", "bruxelles", "belgique", "dubai", "espagne", "madrid", "barcelone", "canada",
  "montreal", "alger", "tunis", "italie", "allemagne", "londres", "usa", "etats-unis",
];
/** Villes hors grille dont le nom est aussi un mot courant (préposition de lieu obligatoire). */
const AMBIGUOUS_OUT = new Set(["safi", "اسفي", "taza", "france"]);

const LOC_PREP = "(?:a|au|aux|en|de|d'|du|vers|l|li|to|f|fi|ل|الى|في|من|ب)";

export type CityMention =
  | { kind: "grid"; ville: string }
  | { kind: "unknown"; name: string };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAlias(folded: string, alias: string, needPrep: boolean): boolean {
  const a = escapeRe(alias);
  const boundary = "(?<![\\p{L}\\d])" + a + "(?![\\p{L}\\d])";
  if (!needPrep) return new RegExp(boundary, "u").test(folded);
  return new RegExp("(?<![\\p{L}\\d])" + LOC_PREP + "\\s*" + a + "(?![\\p{L}\\d])", "u").test(folded);
}

/** Retourne la ville de la grille correspondant à un nom (alias tolérés), sinon null. */
export function resolveGridCity(name: string): string | null {
  const f = foldText(name).trim();
  for (const [ville, aliases] of Object.entries(GRID_ALIASES)) {
    if (foldText(ville) === f || aliases.some((a) => foldText(a) === f)) return ville;
  }
  return null;
}

const GENERIC_STOP = new Set([
  "domicile", "maison", "chez", "moi", "mon", "ma", "mes", "la", "le", "les", "un", "une", "cette", "ce", "ville", "bureau",
  "adresse", "boutique", "magasin", "point", "relais", "retrait", "combien", "quel", "quelle", "quand", "demain", "vous",
  "toi", "nous", "hna", "dar", "darna", "ldar", "dyali", "dyal", "chhal", "chal", "l'adresse", "votre", "notre", "et", "ou",
  "the", "my", "home", "house", "office", "eux", "elle", "lui", "cet", "cette", "prix", "frais", "delai", "tarif",
]);

/**
 * Détecte une ville mentionnée dans un message : ville de la grille, ville
 * marocaine/étrangère hors grille, ou nom inconnu introduit par "livraison à X".
 */
export function detectCity(text: string): CityMention | null {
  const folded = foldText(text);

  // 1) villes de la grille (la plus longue d'abord n'est pas nécessaire : alias disjoints)
  for (const [ville, aliases] of Object.entries(GRID_ALIASES)) {
    for (const alias of aliases.map(foldText)) {
      if (findAlias(folded, alias, AMBIGUOUS_GRID.has(alias) && !/^\s*\S+\s*$/.test(folded))) return { kind: "grid", ville };
    }
  }

  // 2) villes hors grille connues
  for (const c of OUT_OF_GRID.map(foldText)) {
    if (findAlias(folded, c, AMBIGUOUS_OUT.has(c))) return { kind: "unknown", name: c };
  }

  // 3) "livraison à X" avec un nom propre inconnu (majuscule dans le texte d'origine)
  const lead = /(?:livr\w*|exp[ée]di\w*|envoy\w*|tawsil|tawsel|twsil|توصيل|شحن|ship\w*|deliver\w*|habite|suis)\s+(?:à|a|au|aux|en|vers|l|li|to|f|fi|ل|الى|إلى|في)\s+/giu;
  let lm: RegExpExecArray | null;
  while ((lm = lead.exec(text))) {
    const rest = text.slice(lm.index + lm[0].length);
    const m = rest.match(/^(\p{Lu}[\p{L}'\-]+(?:\s+\p{Lu}[\p{L}'\-]+)?)/u);
    if (!m) continue;
    const cand = m[1].trim();
    const first = foldText(cand).split(/\s+/)[0];
    if (!GENERIC_STOP.has(first)) return { kind: "unknown", name: cand };
  }
  return null;
}
export { ALLOWED_CITIES };
