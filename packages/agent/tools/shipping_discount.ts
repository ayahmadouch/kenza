import { pool } from "../../db/pool";
import { resolveGridCity } from "../cities";
import { DISCOUNT_MAX_PCT } from "../config";

export interface ShippingResult {
  trouve: boolean;
  ville?: string;
  frais_mad: number | null;
  delai_heures: number | null;
  cod: boolean;
  retrait: boolean;
}

/**
 * Frais et délai de livraison : uniquement depuis `shipping_rates`. Une
 * ville absente de la grille (ou de ses alias connus) renvoie trouve=false,
 * ce qui déclenche l'escalade. Aucune estimation n'est jamais produite.
 */
export async function get_shipping_cost(args: { ville: string }): Promise<ShippingResult> {
  const notFound: ShippingResult = { trouve: false, frais_mad: null, delai_heures: null, cod: false, retrait: false };
  const ville = resolveGridCity(args.ville ?? "");
  if (!ville) return notFound;
  const { rows } = await pool.query(`SELECT * FROM shipping_rates WHERE ville = $1`, [ville]);
  if (!rows[0]) return notFound;
  const r = rows[0];
  return {
    trouve: true,
    ville: r.ville,
    frais_mad: r.frais_mad,
    delai_heures: r.delai_heures,
    cod: r.paiement_a_la_livraison,
    retrait: r.retrait_boutique,
  };
}

/**
 * Le plancher de remise est appliqué ICI, en code, jamais uniquement dans
 * le prompt. Si pct > DISCOUNT_MAX_PCT, l'outil refuse (autorise=false) et
 * le workflow escalade : le LLM ne peut pas contourner cette règle.
 */
export async function apply_discount(args: { total: number; pct: number }) {
  const total = Number.isFinite(args.total) ? Math.max(0, Math.round(args.total)) : 0;
  const pct = Number.isFinite(args.pct) ? args.pct : NaN;
  const autorise = Number.isFinite(pct) && pct >= 0 && pct <= DISCOUNT_MAX_PCT;
  const pct_applique = autorise ? pct : 0;
  const montant_remise = Math.round((total * pct_applique) / 100);
  return {
    autorise,
    escalade_requise: !autorise,
    plafond_pct: DISCOUNT_MAX_PCT,
    pct_demande: args.pct,
    pct_applique,
    montant_remise,
    total_avant_remise: total,
    total_apres_remise: total - montant_remise,
  };
}
