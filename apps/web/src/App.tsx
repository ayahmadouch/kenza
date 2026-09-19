import { useState } from "react";
import Dashboard, { type Page } from "./Dashboard";
import type { Kpis } from "./api";
import { usePolling } from "./usePolling";
import { Icon, Khatam } from "./ui";
import CustomerPortal from "./CustomerPortal";

type View = Page;
const NAV: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Aujourd'hui", icon: "chart" },
  { id: "conversations", label: "Échanges", icon: "people" },
  { id: "orders", label: "Commandes", icon: "receipt" },
  { id: "escalations", label: "À traiter", icon: "alert" },
  { id: "relances", label: "Relances", icon: "clock" },
  { id: "catalogue", label: "Catalogue", icon: "hanger" },
  { id: "stock", label: "Stock", icon: "box" },
  { id: "activity", label: "Activité", icon: "pulse" },
];

export default function App() {
  const merchantMode = new URLSearchParams(window.location.search).get("mode") === "merchant";
  const [view, setView] = useState<View>("overview");
  const { data: k } = usePolling<Kpis>("/api/kpis", 5000);

  if (!merchantMode) {
    return <CustomerPortal />;
  }

  return (
    <div className="shell">
      <nav className="rail" aria-label="Navigation principale">
        <div className="rail-brand" title="Kenza"><Khatam size={30} fill="var(--safran)" /></div>
        {NAV.map((n) => (
          <button key={n.id} className={`rail-item ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)} aria-current={view === n.id ? "page" : undefined}>
            <span className="rail-icon"><Icon name={n.icon} size={21} />{n.id === "escalations" && (k?.escalades_ouvertes ?? 0) > 0 && <i className="rail-badge">{k?.escalades_ouvertes}</i>}</span>
            <span className="rail-label">{n.label}</span>
          </button>
        ))}
        <a className="rail-switch" href="/">Espace client</a>
        <div className="rail-foot" lang="ar">كنزة</div>
      </nav>
      <main className="content"><Dashboard page={view} /></main>
    </div>
  );
}
