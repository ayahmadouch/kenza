import { mad, type TraceEvent } from "./api";
import { swatch } from "./ui";

export interface ProductView { ref: string; modele: string; couleur?: string; taille?: string; prix: number; prixNormal?: number; promo: boolean; stock: number; alternative: boolean }
type Row = Record<string, unknown>;

/** Produits issus des RÉSULTATS d'outils (search_catalog, suggest_alternatives) : jamais inventés par l'interface. */
export function productsFromTrace(trace?: TraceEvent[] | null): ProductView[] {
  const out = new Map<string, ProductView>();
  for (const e of trace ?? []) {
    if (!Array.isArray(e.result) || (e.tool !== "search_catalog" && e.tool !== "suggest_alternatives")) continue;
    for (const r of e.result as Row[]) {
      const ref = String(r.ref ?? ""); if (!ref || out.has(ref)) continue;
      const prix = Number(r.prix_effectif_mad ?? r.prix_mad ?? 0);
      out.set(ref, {
        ref, modele: String(r.modele ?? ref), couleur: r.couleur as string | undefined, taille: r.taille as string | undefined, prix,
        prixNormal: r.prix_mad !== undefined ? Number(r.prix_mad) : undefined, promo: r.promo_active === true, stock: Number(r.stock ?? 0), alternative: e.tool === "suggest_alternatives",
      });
    }
  }
  return [...out.values()].slice(0, 6);
}

export default function ProductCards({ items }: { items: ProductView[] }) {
  if (items.length === 0) return null;
  return (
    <div className="pcards" role="list">
      {items.map((p) => (
        <article key={p.ref} className={`pcard ${p.stock === 0 ? "out" : ""}`} role="listitem">
          <div className="pcard-swatch" style={{ background: swatch(p.couleur) }}>
            {p.promo && <span className="pcard-promo">Promo</span>}
            {p.alternative && <span className="pcard-alt">Alternative</span>}
          </div>
          <div className="pcard-body">
            <div className="pcard-name">{p.modele}</div>
            <div className="pcard-meta">{[p.couleur, p.taille && `taille ${p.taille}`].filter(Boolean).join(", ")}</div>
            <div className="pcard-price">
              <b>{mad(p.prix)}</b>
              {p.promo && p.prixNormal !== undefined && p.prixNormal !== p.prix && <s>{mad(p.prixNormal)}</s>}
            </div>
            <div className={`pcard-stock ${p.stock > 0 ? "ok" : "ko"}`}>{p.stock > 0 ? "En stock" : "Indisponible"}</div>
            <code className="pcard-ref">{p.ref}</code>
          </div>
        </article>
      ))}
    </div>
  );
}
