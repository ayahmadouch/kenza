import { pool } from "../../db/pool";
import { foldText } from "../text";

/**
 * Tous les tools de ce fichier sont des fonctions déterministes qui lisent
 * PostgreSQL. Le LLM n'accède JAMAIS directement à la base : il ne peut
 * agir que via ces fonctions, dont chaque résultat numérique devient un
 * `fact` traçable (source: "db:...").
 */

const FOLD_SQL = (col: string) =>
  `translate(lower(${col}), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Produit + prix effectif (promo active à la date donnée prioritaire sur le prix normal). */
const PRODUCT_WITH_PROMO = `
  SELECT p.*, pr.id AS promo_id, pr.prix_promo_mad, pr.fin AS promo_fin,
         COALESCE(pr.prix_promo_mad, p.prix_mad) AS prix_effectif_mad
  FROM products p
  LEFT JOIN LATERAL (
    SELECT id, prix_promo_mad, fin FROM promotions
    WHERE ref = p.ref AND debut <= $1::date AND fin >= $1::date
    ORDER BY id DESC LIMIT 1
  ) pr ON true`;

export interface ProductRow {
  ref: string;
  modele: string;
  famille: string;
  genre: string;
  couleur: string;
  taille: string;
  matiere: string;
  prix_mad: number;
  stock: number;
  promo_id: number | null;
  prix_promo_mad: number | null;
  promo_fin: string | null;
  prix_effectif_mad: number;
}

export async function getProduct(ref: string, date = today()): Promise<ProductRow | null> {
  const { rows } = await pool.query(`${PRODUCT_WITH_PROMO} WHERE p.ref = $2`, [date, ref]);
  return (rows[0] as ProductRow) ?? null;
}

function toCatalogItem(p: ProductRow) {
  return {
    ref: p.ref,
    modele: p.modele,
    famille: p.famille,
    couleur: p.couleur,
    taille: p.taille,
    prix_mad: p.prix_mad,
    prix_effectif_mad: p.prix_effectif_mad,
    stock: p.stock,
    disponible: p.stock > 0,
    promo_active: p.promo_id !== null,
  };
}

export interface SearchCatalogArgs {
  famille?: string;
  modele?: string;
  couleur?: string;
  taille?: string;
  genre?: string;
  matiere?: string;
  prix_max?: number;
  en_stock_seulement?: boolean;
}

export async function search_catalog(args: SearchCatalogArgs) {
  const conditions: string[] = [];
  const params: unknown[] = [today()];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("$?", `$${params.length}`));
  };

  if (args.famille) add(`${FOLD_SQL("p.famille")} LIKE $?`, `%${foldText(args.famille)}%`);
  if (args.modele) add(`${FOLD_SQL("p.modele")} LIKE $?`, `%${foldText(args.modele)}%`);
  if (args.couleur) add(`${FOLD_SQL("p.couleur")} LIKE $?`, `%${foldText(args.couleur)}%`);
  if (args.taille) add(`lower(p.taille) = $?`, args.taille.trim().toLowerCase());
  if (args.genre) add(`${FOLD_SQL("p.genre")} LIKE $?`, `%${foldText(args.genre)}%`);
  if (args.matiere) add(`${FOLD_SQL("p.matiere")} LIKE $?`, `%${foldText(args.matiere)}%`);
  if (args.prix_max !== undefined) add(`COALESCE(pr.prix_promo_mad, p.prix_mad) <= $?`, args.prix_max);
  if (args.en_stock_seulement) conditions.push(`p.stock > 0`);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(`${PRODUCT_WITH_PROMO} ${where} ORDER BY p.modele, p.taille, p.ref LIMIT 15`, params);
  return (rows as ProductRow[]).map(toCatalogItem);
}

export interface CheckStockArgs {
  ref?: string;
  modele?: string;
  couleur?: string;
  taille?: string;
}

export async function check_stock(args: CheckStockArgs) {
  if (args.ref) {
    const p = await getProduct(args.ref.trim().toUpperCase());
    if (!p) return { trouve: false, disponible: false, stock: 0, ref: args.ref };
    return { trouve: true, disponible: p.stock > 0, stock: p.stock, ref: p.ref, modele: p.modele, taille: p.taille };
  }
  const matches = await search_catalog({ modele: args.modele, couleur: args.couleur, taille: args.taille });
  if (matches.length === 0) return { trouve: false, disponible: false, stock: 0, ref: null };
  if (matches.length > 1) {
    // Plusieurs références possibles : on ne devine jamais, on renvoie les candidats.
    return {
      trouve: true,
      ambigu: true,
      disponible: matches.some((m) => m.stock > 0),
      stock: matches.reduce((s, m) => s + m.stock, 0),
      ref: null,
      candidats: matches.map((m) => ({ ref: m.ref, modele: m.modele, taille: m.taille, stock: m.stock })),
    };
  }
  const m = matches[0];
  return { trouve: true, disponible: m.stock > 0, stock: m.stock, ref: m.ref, modele: m.modele, taille: m.taille };
}

export async function suggest_alternatives(args: { ref: string }) {
  const base = await getProduct(args.ref.trim().toUpperCase());
  if (!base) return [];
  const { rows } = await pool.query(
    `${PRODUCT_WITH_PROMO}
     WHERE p.famille = $2 AND p.stock > 0 AND p.ref <> $3
     ORDER BY (p.modele = $4)::int DESC, (p.couleur = $5)::int DESC, (p.taille = $6)::int DESC,
              ABS(COALESCE(pr.prix_promo_mad, p.prix_mad) - $7) ASC, p.ref
     LIMIT 4`,
    [today(), base.famille, base.ref, base.modele, base.couleur, base.taille, base.prix_effectif_mad]
  );
  return (rows as ProductRow[]).map((p) => ({
    ref: p.ref,
    modele: p.modele,
    couleur: p.couleur,
    taille: p.taille,
    prix_effectif_mad: p.prix_effectif_mad,
    stock: p.stock,
    promo_active: p.promo_id !== null,
    remplace: base.ref,
  }));
}

export async function get_price(args: { ref: string }) {
  const p = await getProduct(args.ref.trim().toUpperCase());
  if (!p) return { trouve: false };
  return {
    trouve: true,
    ref: p.ref,
    modele: p.modele,
    taille: p.taille,
    prix_normal: p.prix_mad,
    prix_promo: p.prix_promo_mad ?? undefined,
    prix_effectif: p.prix_effectif_mad,
    promo_id: p.promo_id ?? undefined,
    valide_jusquau: p.promo_fin ?? undefined,
  };
}
