import { useState } from "react";
import ChatSimulator from "./ChatSimulator";
import { day, mad } from "./api";
import { Icon, Khatam } from "./ui";
import { usePolling } from "./usePolling";

type CustomerPage = "chat" | "orders";
interface CustomerOrder {
  commande_id: string;
  date: string;
  statut: string;
  total_mad: number;
  ville_livraison: string;
  paiement: string;
  items: { modele: string; taille: string; quantite: number; prix_unitaire_mad: number }[];
}

function CustomerOrders() {
  const clientId = localStorage.getItem("kenza-client-id");
  const { data, error } = usePolling<CustomerOrder[]>(clientId ? `/api/clients/${encodeURIComponent(clientId)}/commandes` : "/api/clients/unknown/commandes", 5000);
  if (!clientId) return <div className="empty-state">Commencez une conversation avec Kenza pour retrouver vos commandes.</div>;
  if (!data) return <div className="empty-state">{error ? `Erreur : ${error}` : "Chargement de vos commandes…"}</div>;
  return (
    <>
      <div className="dashboard-head"><div><h1 className="page-title">Mes commandes</h1><p className="page-copy">Votre historique personnel, associé à vos informations.</p></div></div>
      <div className="customer-orders">
        {data.length === 0 ? <div className="empty-state">Aucune commande pour le moment. Kenza peut vous aider à choisir un article.</div> : data.map((order) => (
          <article className="surface customer-order" key={order.commande_id}>
            <div className="row-between"><div><b>{order.commande_id}</b><div className="muted small">{day(order.date)} · {order.ville_livraison}</div></div><span className="chip chip-good">{order.statut}</span></div>
            <div className="customer-order-items">{order.items.map((item) => <span key={`${order.commande_id}-${item.modele}-${item.taille}`}>{item.quantite} × {item.modele}, taille {item.taille}</span>)}</div>
            <div className="row-between"><span className="muted small">Paiement : {order.paiement}</span><b className="money">{mad(order.total_mad)}</b></div>
          </article>
        ))}
      </div>
    </>
  );
}

export default function CustomerPortal() {
  const [page, setPage] = useState<CustomerPage>("chat");
  return (
    <div className="shell customer-shell">
      <nav className="rail" aria-label="Navigation client">
        <div className="rail-brand" title="Kenza"><Khatam size={30} fill="var(--safran)" /></div>
        <button className={`rail-item ${page === "chat" ? "active" : ""}`} onClick={() => setPage("chat")}>
          <span className="rail-icon"><Icon name="chat" size={21} /></span><span className="rail-label">Discuter</span>
        </button>
        <button className={`rail-item ${page === "orders" ? "active" : ""}`} onClick={() => setPage("orders")}>
          <span className="rail-icon"><Icon name="receipt" size={21} /></span><span className="rail-label">Commandes</span>
        </button>
        <button className="rail-logout" onClick={() => { localStorage.removeItem("kenza-client"); localStorage.removeItem("kenza-client-id"); window.location.href = "/"; }}>Se déconnecter</button>
        <a className="rail-switch" href="?mode=merchant">Espace commerçant</a>
        <div className="rail-foot" lang="ar">كنزة</div>
      </nav>
      <main className={`content ${page === "chat" ? "content-chat" : ""}`}>
        <div className={page === "chat" ? "" : "customer-view-hidden"}><ChatSimulator /></div>
        {page === "orders" && <CustomerOrders />}
      </main>
    </div>
  );
}
