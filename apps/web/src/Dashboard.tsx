import { useEffect, useState } from "react";
import { apiGet, apiPost } from "./api";

const mad = new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", maximumFractionDigits: 0 });
const money = (value: unknown) => mad.format(Number(value) || 0);

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="surface kpi-card kpi-accent">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value money">{value}</div>
    </div>
  );
}

const TABS = ["Conversations", "Catalogue", "Stock", "Commandes", "Relances", "Escalades"] as const;
type Tab = (typeof TABS)[number];

export default function Dashboard() {
  const [kpis, setKpis] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("Conversations");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet("/api/kpis").then(setKpis).catch(() => setError(true));
  }, []);

  useEffect(() => {
    const endpoint: Record<Tab, string> = {
      Conversations: "/api/conversations",
      Catalogue: "/api/catalogue",
      Stock: "/api/stock",
      Commandes: "/api/commandes",
      Relances: "/api/relances",
      Escalades: "/api/escalations",
    };
    setLoading(true);
    apiGet<any[]>(endpoint[tab]).then(setRows).catch(() => { setRows([]); setError(true); }).finally(() => setLoading(false));
  }, [tab]);

  async function resumeHuman(conversationId: string) {
    await apiPost(`/api/conversations/${conversationId}/resume-human`);
    setRows((r) => r.map((x) => (x.id === conversationId ? { ...x, needs_human: true } : x)));
  }

  return (
    <div>
      <div className="dashboard-head">
        <div><div className="eyebrow">Vue d’ensemble</div><h1 className="page-title">Le commerce, en clair.</h1><p className="page-copy">Suivez les ventes, les paniers et les conversations qui ont besoin de vous.</p></div>
        <div className="status good">Actualisation en direct</div>
      </div>
      {error && <div className="surface" style={{ padding: 14, marginBottom: 18, color: "#9a5b1b", background: "#fff5e8" }}>Le serveur est momentanément indisponible. Vérifiez que l’API est démarrée.</div>}
      {kpis && (
        <div className="kpi-grid">
          <Kpi label="Conversations actives" value={kpis.conversations_actives} />
          <Kpi label="Commandes" value={kpis.commandes_total} />
          <Kpi label="CA total" value={money(kpis.chiffre_affaires_mad)} />
          <Kpi label="Panier moyen" value={money(kpis.panier_moyen_mad)} />
          <Kpi label="Ventes par l'agent" value={kpis.ventes_agent} />
          <Kpi label="CA agent" value={money(kpis.ca_agent_mad)} />
          <Kpi label="Taux de conversion" value={`${Math.round(kpis.taux_conversion * 100)}%`} />
          <Kpi label="Taux d'escalade" value={`${Math.round(kpis.taux_escalade * 100)}%`} />
        </div>
      )}

      <div className="surface data-surface">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`tab ${tab === t ? "active" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          {tab === "Conversations" && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Client</th><th>Téléphone</th><th>Langue</th><th>Statut</th><th>Panier</th><th>Dernier message</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1">{r.client_nom ?? "—"}</td>
                    <td>{r.telephone}</td>
                    <td>{r.langue}</td>
                    <td><span className={`status ${r.needs_human ? "warn" : ""}`}>{r.needs_human ? "humain" : r.statut}</span></td>
                    <td>{(r.cart ?? []).length} article(s)</td>
                    <td className="max-w-xs truncate">{r.dernier_message}</td>
                    <td>
                      {!r.needs_human && (
                        <button onClick={() => resumeHuman(r.id)} className="table-action">
                          Reprendre la main
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "Catalogue" && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Ref</th><th>Modèle</th><th>Famille</th><th>Couleur</th><th>Taille</th><th>Prix</th><th>Promo</th><th>Stock</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ref} className="border-t">
                    <td className="py-1">{r.ref}</td><td>{r.modele}</td><td>{r.famille}</td><td>{r.couleur}</td><td>{r.taille}</td>
                    <td className="money">{r.prix_promo_mad ? <><s className="muted">{money(r.prix_mad)}</s> {money(r.prix_promo_mad)}</> : money(r.prix_mad)}</td>
                    <td>{r.prix_promo_mad ? <span className="status good">promo</span> : "—"}</td>
                    <td><span className={`status ${r.stock === 0 ? "warn" : "good"}`}>{r.stock}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "Stock" && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Ref</th><th>Produit</th><th>Variante</th><th>Quantité</th><th>Statut</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ref} className="border-t">
                    <td className="py-1">{r.ref}</td><td>{r.modele}</td><td>{r.couleur} / {r.taille}</td>
                    <td>{r.stock}</td>
                    <td><span className={`status ${r.stock === 0 ? "warn" : "good"}`}>{r.stock === 0 ? "rupture" : "en stock"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "Commandes" && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Commande</th><th>Client</th><th>Total</th><th>Livraison</th><th>Statut</th><th>Date</th><th>Créée par</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.commande_id} className="border-t">
                    <td>{r.commande_id}</td><td>{r.client_nom ?? "—"}</td><td className="money">{money(r.total_mad)}</td>
                    <td>{r.ville_livraison} ({money(r.frais_livraison_mad)})</td><td><span className="status good">{r.statut}</span></td><td>{r.date}</td>
                    <td><span className="status">{r.created_by === "agent" ? "agent" : "humain"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "Relances" && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Conversation</th><th>Client</th><th>Variante</th><th>Planifiée</th><th>Envoyée</th><th>Résultat</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1">{r.conversation_id}</td><td>{r.client_nom ?? r.telephone ?? "—"}</td>
                    <td>{r.variante}</td><td>{r.planifiee_a}</td><td>{r.envoyee_a ?? "—"}</td><td><span className="status">{r.resultat}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "Escalades" && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Client</th><th>Motif</th><th>Statut</th><th>Contexte</th><th>Date</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-1">{r.client_nom ?? r.telephone ?? "—"}</td><td>{r.motif}</td><td>{r.statut}</td>
                    <td className="max-w-md whitespace-pre-wrap text-xs">{r.contexte_resume}</td>
                    <td>{r.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
