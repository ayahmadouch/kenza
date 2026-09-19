import { pool } from "../../db/pool";
import { ALLOWED_CITIES } from "../types";

export async function get_shipping_cost(args: { ville: string }) {
  const ville = ALLOWED_CITIES.find((v) => v.toLowerCase() === args.ville.trim().toLowerCase());
  if (!ville) {
    return { trouve: false, frais_mad: null, delai_heures: null, cod: false, retrait: false };
  }
  const { rows } = await pool.query(`SELECT * FROM shipping_rates WHERE ville = $1`, [ville]);
  if (!rows[0]) {
    // Ville nominalement autorisée mais absente de la grille tarifaire réelle :
    // traité comme "non trouvé" -> le nœud d'escalade doit être déclenché.
    return { trouve: false, frais_mad: null, delai_heures: null, cod: false, retrait: false };
  }
  const r = rows[0];
  return {
    trouve: true,
    frais_mad: r.frais_mad,
    delai_heures: r.delai_heures,
    cod: r.paiement_a_la_livraison,
    retrait: r.retrait_boutique,
  };
}

const DISCOUNT_MAX_PCT = Number(process.env.DISCOUNT_MAX_PCT || 10);

/**
 * Le plancher de remise est appliqué ICI, en code, jamais uniquement dans
 * le prompt. Le LLM ne peut pas le contourner : si pct > DISCOUNT_MAX_PCT,
 * l'outil refuse et le guardrail/escalation_node prend le relai.
 */
export async function apply_discount(args: { total: number; pct: number }) {
  const autorise = args.pct <= DISCOUNT_MAX_PCT && args.pct >= 0;
  const pct_applique = autorise ? args.pct : 0;
  const montant_remise = Math.round((args.total * pct_applique) / 100);
  return {
    autorise,
    plafond_pct: DISCOUNT_MAX_PCT,
    pct_demande: args.pct,
    pct_applique,
    montant_remise,
    total_apres_remise: args.total - montant_remise,
  };
}
