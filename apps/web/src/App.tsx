import { useState } from "react";
import ChatSimulator from "./ChatSimulator";
import Dashboard, { type Page } from "./Dashboard";
import type { Kpis } from "./api";
import { usePolling } from "./usePolling";
import { Icon, Khatam } from "./ui";

type View = "chat" | Page;
const NAV: { id: View; label: string; icon: string }[] = [
  { id: "chat", label: "Discuter", icon: "chat" },
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
  const [view, setView] = useState<View>("chat");
  const { data: k } = usePolling<Kpis>("/api/kpis", 5000);
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
        <div className="rail-foot" lang="ar">كنزة</div>
      </nav>
      <main className={`content ${view === "chat" ? "content-chat" : ""}`}>{view === "chat" ? <ChatSimulator /> : <Dashboard page={view} />}</main>
    </div>
  );
}
