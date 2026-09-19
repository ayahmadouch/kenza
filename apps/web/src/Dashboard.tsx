import { useEffect, useState } from "react";
import { apiGet, apiPost } from "./api";

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

const TABS = ["Conversations", "Catalogue", "Stock", "Commandes", "Relances", "Escalades"] as const;
type Tab = (typeof TABS)[number];

export default function Dashboard() {
  const [kpis, setKpis] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("Conversations");
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    apiGet("/api/kpis").then(setKpis).catch(() => {});
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
    apiGet<any[]>(endpoint[tab]).then(setRows).catch(() => setRows([]));
  }, [tab]);

  async function resumeHuman(conversationId: string) {
    await apiPost(`/api/conversations/${conversationId}/resume-human`);
    setRows((r) => r.map((x) => (x.id === conversationId ? { ...x, needs_human: true } : x)));
  }

  return (
    <div className="space-y-4">
      {kpis && (
        <div className="grid grid-cols-4 md:grid-cols-4 gap-3">
          <Kpi label="Conversations actives" value={kpis.conversations_actives} />
          <Kpi label="Commandes" value={kpis.commandes_total} />
          <Kpi label="CA total (MAD)" value={kpis.chiffre_affaires_mad} />
          <Kpi label="Panier moyen (MAD)" value={kpis.panier_moyen_mad} />
          <Kpi label="Ventes par l'agent" value={kpis.ventes_agent} />
          <Kpi label="CA agent (MAD)" value={kpis.ca_agent_mad} />
          <Kpi label="Taux de conversion" value={`${Math.round(kpis.taux_conversion * 100)}%`} />
          <Kpi label="Taux d'escalade" value={`${Math.round(kpis.taux_escalade * 100)}%`} />
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        <div className="flex border-b overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm whitespace-nowrap ${tab === t ? "border-b-2 border-blue-600 text-blue-600 font-medium" : "text-slate-500"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="p-4 overflow-x-auto">
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
                    <td>{r.needs_human ? <span className="text-orange-600">humain</span> : r.statut}</td>
                    <td>{(r.cart ?? []).length} article(s)</td>
                    <td className="max-w-xs truncate">{r.dernier_message}</td>
                    <td>
                      {!r.needs_human && (
                        <button onClick={() => resumeHuman(r.id)} className="text-xs bg-slate-800 text-white px-2 py-1 rounded">
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
                    <td>{r.prix_promo_mad ? <><s className="text-slate-400">{r.prix_mad}</s> {r.prix_promo_mad}</> : r.prix_mad} MAD</td>
                    <td>{r.prix_promo_mad ? "✓" : ""}</td>
                    <td className={r.stock === 0 ? "text-red-600 font-medium" : ""}>{r.stock}</td>
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
                    <td>{r.stock === 0 ? <span className="text-red-600">rupture</span> : <span className="text-green-600">en stock</span>}</td>
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
                    <td className="py-1">{r.commande_id}</td><td>{r.client_nom ?? "—"}</td><td>{r.total_mad} MAD</td>
                    <td>{r.ville_livraison} ({r.frais_livraison_mad} MAD)</td><td>{r.statut}</td><td>{r.date}</td>
                    <td>{r.created_by === "agent" ? <span className="text-blue-600 font-medium">agent</span> : "humain"}</td>
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
                    <td>{r.variante}</td><td>{r.planifiee_a}</td><td>{r.envoyee_a ?? "—"}</td><td>{r.resultat}</td>
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
