import { useState } from "react";
import ChatSimulator from "./ChatSimulator";
import Dashboard from "./Dashboard";

export default function App() {
  const [view, setView] = useState<"chat" | "dashboard">("chat");

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="font-semibold text-lg">Kenza <span className="text-slate-400 font-normal text-sm">— agent commercial</span></div>
        <nav className="flex gap-2">
          <button onClick={() => setView("chat")} className={`px-3 py-1 rounded text-sm ${view === "chat" ? "bg-blue-600" : "bg-slate-700"}`}>Simulateur de chat</button>
          <button onClick={() => setView("dashboard")} className={`px-3 py-1 rounded text-sm ${view === "dashboard" ? "bg-blue-600" : "bg-slate-700"}`}>Dashboard commerçant</button>
        </nav>
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        {view === "chat" ? <ChatSimulator /> : <Dashboard />}
      </main>
    </div>
  );
}
