import { pool } from "../../db/pool";

/**
 * Tous les tools de ce fichier sont des fonctions déterministes qui lisent
 * PostgreSQL. Le LLM n'accède JAMAIS directement à la base : il ne peut
 * agir que via ces fonctions, dont chaque résultat numérique devient un
 * `fact` traçable (source: "db:...").
 */

async function getActivePromo(ref: string, atDate = new Date()) {
  const { rows } = await pool.query(
    `SELECT * FROM promotions WHERE ref = $1 AND debut <= $2 AND fin >= $2 ORDER BY id DESC LIMIT 1`,
    [ref, atDate.toISOString().slice(0, 10)]
  );
  return rows[0] ?? null;
}

export interface SearchCatalogArgs {
  famille?: string;
  couleur?: string;
  taille?: string;
  genre?: string;
  matiere?: string;
  prix_max?: number;
  en_stock_seulement?: boolean;
}

export async function search_catalog(args: SearchCatalogArgs) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (args.famille) { conditions.push(`famille ILIKE $${i++}`); params.push(`%${args.famille}%`); }
  if (args.couleur) { conditions.push(`couleur ILIKE $${i++}`); params.push(`%${args.couleur}%`); }
  if (args.taille) { conditions.push(`taille = $${i++}`); params.push(args.taille); }
  if (args.genre) { conditions.push(`genre ILIKE $${i++}`); params.push(`%${args.genre}%`); }
  if (args.matiere) { conditions.push(`matiere ILIKE $${i++}`); params.push(`%${args.matiere}%`); }
  if (args.prix_max !== undefined) { conditions.push(`prix_mad <= $${i++}`); params.push(args.prix_max); }
  if (args.en_stock_seulement) { conditions.push(`stock > 0`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY modele LIMIT 20`,
    params
  );

  const out = [];
  for (const p of rows) {
    const promo = await getActivePromo(p.ref);
    out.push({
      ref: p.ref,
      modele: p.modele,
      famille: p.famille,
      couleur: p.couleur,
      taille: p.taille,
      prix_mad: p.prix_mad,
      prix_effectif_mad: promo ? promo.prix_promo_mad : p.prix_mad,
      stock: p.stock,
      promo_active: !!promo,
    });
  }
  return out;
}

export interface CheckStockArgs {
  ref?: string;
  modele?: string;
  couleur?: string;
  taille?: string;
}

export async function check_stock(args: CheckStockArgs) {
  if (args.ref) {
    const { rows } = await pool.query(`SELECT ref, stock FROM products WHERE ref = $1`, [args.ref]);
    if (!rows[0]) return { disponible: false, stock: 0, ref: args.ref, trouve: false };
    return { disponible: rows[0].stock > 0, stock: rows[0].stock, ref: rows[0].ref, trouve: true };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (args.modele) { conditions.push(`modele ILIKE $${i++}`); params.push(`%${args.modele}%`); }
  if (args.couleur) { conditions.push(`couleur ILIKE $${i++}`); params.push(`%${args.couleur}%`); }
  if (args.taille) { conditions.push(`taille = $${i++}`); params.push(args.taille); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(`SELECT ref, stock FROM products ${where} LIMIT 1`, params);
  if (!rows[0]) return { disponible: false, stock: 0, ref: null, trouve: false };
  return { disponible: rows[0].stock > 0, stock: rows[0].stock, ref: rows[0].ref, trouve: true };
}

export async function suggest_alternatives(args: { ref: string }) {
  const { rows: base } = await pool.query(`SELECT * FROM products WHERE ref = $1`, [args.ref]);
  if (!base[0]) return [];
  const p = base[0];
  const { rows } = await pool.query(
    `SELECT * FROM products
     WHERE famille = $1 AND stock > 0 AND ref != $2
     ORDER BY
       (couleur = $3)::int DESC,
       (taille = $4)::int DESC,
       ABS(prix_mad - $5) ASC
     LIMIT 5`,
    [p.famille, p.ref, p.couleur, p.taille, p.prix_mad]
  );
  const out = [];
  for (const alt of rows) {
    const promo = await getActivePromo(alt.ref);
    out.push({
      ref: alt.ref,
      modele: alt.modele,
      couleur: alt.couleur,
      taille: alt.taille,
      prix_effectif_mad: promo ? promo.prix_promo_mad : alt.prix_mad,
      stock: alt.stock,
    });
  }
  return out;
}

export async function get_price(args: { ref: string }) {
  const { rows } = await pool.query(`SELECT * FROM products WHERE ref = $1`, [args.ref]);
  if (!rows[0]) return { trouve: false };
  const p = rows[0];
  const promo = await getActivePromo(p.ref);
  return {
    trouve: true,
    prix_normal: p.prix_mad,
    prix_promo: promo ? promo.prix_promo_mad : undefined,
    prix_effectif: promo ? promo.prix_promo_mad : p.prix_mad,
    promo_id: promo ? promo.id : undefined,
    valide_jusquau: promo ? promo.fin : undefined,
  };
}
