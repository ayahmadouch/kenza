import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/**
 * Lit un CSV depuis data/ tel quel (CRLF, UTF-8, séparateur ',') sans jamais
 * modifier le fichier source. csv-parse gère nativement \r\n : ce wrapper
 * documente explicitement le choix plutôt que de le laisser implicite.
 */
export function parseCsvFile<T>(path: string): T[] {
  const raw = readFileSync(path, "utf-8");
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  }) as T[];
}

/** "oui"/"non" (livraison.csv) -> boolean. Toute autre valeur est une erreur explicite. */
export function parseOuiNon(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "oui") return true;
  if (v === "non") return false;
  throw new Error(`Valeur oui/non invalide: "${value}"`);
}

/** Chaîne vide -> null (ex: delai_reassort_jours, segment). Sinon parseInt strict. */
export function parseNullableInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Entier invalide: "${value}"`);
  return n;
}

export function parseInt10(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Entier invalide: "${value}"`);
  return n;
}

export function nullableStr(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value;
}
