import { useState } from "react";
import ChatSimulator from "./ChatSimulator";
import Dashboard from "./Dashboard";

export default function App() {
  const [view, setView] = useState<"chat" | "dashboard">("chat");

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div><div className="brand-name">Kenza</div><div className="brand-subtitle">Assistant commercial marocain</div></div>
        </div>
        <nav className="main-nav" aria-label="Navigation principale">
          <button onClick={() => setView("chat")} className={`nav-button ${view === "chat" ? "active" : ""}`}>Conversation</button>
          <button onClick={() => setView("dashboard")} className={`nav-button ${view === "dashboard" ? "active" : ""}`}>Pilotage</button>
        </nav>
      </header>
      <main className="page-wrap">
        {view === "chat" ? <ChatSimulator /> : <Dashboard />}
      </main>
    </div>
  );
}
