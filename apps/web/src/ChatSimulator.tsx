import { useEffect, useRef, useState } from "react";
import { WS_URL, apiGet, apiPost } from "./api";

interface ChatMsg {
  role: "client" | "agent" | "system";
  texte: string;
  trace?: any[];
  guardrail?: { ok: boolean; violations: string[] };
  escalation?: { motif: string; contexte: string };
  latency_ms?: number;
}

interface ClientRow {
  client_id: string;
  nom: string;
  telephone: string;
  ville: string;
  langue_preferee: string;
}

export default function ChatSimulator() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  const [conversationId, setConversationId] = useState<string>(() => `WEB-${Date.now()}`);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({ nom: "", telephone: "", ville: "Casablanca", langue_preferee: "fr" });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<ClientRow[]>(`/api/clients/search?q=${encodeURIComponent(query)}`).then(setClients).catch(() => {});
  }, [query]);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "agent_message") {
        setMessages((m) => [...m, {
          role: "agent", texte: data.draft, trace: data.trace, guardrail: data.guardrail,
          escalation: data.escalation, latency_ms: data.latency_ms,
        }]);
      } else if (data.type === "error") {
        setMessages((m) => [...m, { role: "system", texte: `Erreur: ${data.message}` }]);
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [conversationId]);

  function send(type: "text" | "image" | "audio", payload: { text?: string; base64?: string }) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (type === "text" && payload.text) setMessages((m) => [...m, { role: "client", texte: payload.text! }]);
    if (type === "image") setMessages((m) => [...m, { role: "client", texte: "[Photo envoyée]" }]);
    if (type === "audio") setMessages((m) => [...m, { role: "client", texte: "[Note vocale envoyée]" }]);

    wsRef.current.send(JSON.stringify({
      type,
      conversationId,
      clientId: selectedClient?.client_id,
      telephone: selectedClient?.telephone,
      ville: selectedClient?.ville,
      text: payload.text,
      base64: payload.base64,
    }));
  }

  function newConversation() {
    setConversationId(`WEB-${Date.now()}`);
    setMessages([]);
  }

  async function createClient() {
    const created = await apiPost<ClientRow>("/api/clients", newClient);
    setSelectedClient(created);
    setClients((current) => [created, ...current]);
    setShowNewClient(false);
    setNewClient({ nom: "", telephone: "", ville: "Casablanca", langue_preferee: "fr" });
    newConversation();
  }

  function onFile(kind: "image" | "audio", e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      send(kind, { base64 });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <div className="eyebrow">Espace conversation</div>
      <h1 className="page-title">Parlez à vos clients.</h1>
      <p className="page-copy" style={{ marginBottom: 24 }}>Choisissez un client, puis laissez Kenza qualifier le besoin et conclure la vente.</p>
    <div className="chat-layout">
      <div className="surface client-panel">
        <h3 className="panel-title">Carnet clients</h3>
        <label className="panel-label" htmlFor="client-search">Rechercher</label>
        <input
          id="client-search" className="search-input"
          placeholder="Rechercher nom / téléphone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary-button" style={{ marginTop: 10 }} onClick={() => setShowNewClient((value) => !value)}>
          {showNewClient ? "Fermer" : "+ Nouveau client"}
        </button>
        {showNewClient && (
          <div className="new-client-form">
            <input className="search-input" placeholder="Nom complet" value={newClient.nom} onChange={(e) => setNewClient({ ...newClient, nom: e.target.value })} />
            <input className="search-input" placeholder="Téléphone" value={newClient.telephone} onChange={(e) => setNewClient({ ...newClient, telephone: e.target.value })} />
            <input className="search-input" placeholder="Ville" value={newClient.ville} onChange={(e) => setNewClient({ ...newClient, ville: e.target.value })} />
            <select className="search-input" value={newClient.langue_preferee} onChange={(e) => setNewClient({ ...newClient, langue_preferee: e.target.value })}>
              <option value="fr">Français</option><option value="darija">Darija</option><option value="ar">Arabe</option>
            </select>
            <button className="send-button" onClick={() => void createClient()}>Créer le client</button>
          </div>
        )}
        <label className="panel-label">Clients récents</label>
        <div className="client-list">
          {clients.map((c) => (
            <button
              key={c.client_id}
              onClick={() => setSelectedClient(c)}
              className={`client-row ${selectedClient?.client_id === c.client_id ? "selected" : ""}`}
            >
              <div className="client-name">{c.nom}</div>
              <div className="client-meta">{c.telephone} · {c.ville} · {c.langue_preferee}</div>
            </button>
          ))}
        </div>
        {selectedClient && (
          <div className="selected-client">
            Client sélectionné : <b>{selectedClient.nom}</b>
          </div>
        )}
      </div>

      <div className="surface chat-panel">
        <div className="chat-header">
          <div><div className="eyebrow">Fil en direct</div><h2 className="chat-title">{selectedClient?.nom ?? "Nouveau client"}</h2></div>
          <span className={`connection ${connected ? "online" : ""}`}>{connected ? "● En ligne" : "○ Hors ligne"}</span>
        </div>
        <div className="messages">
          {messages.length === 0 && <div className="empty-state">Le fil est prêt. Envoyez un premier message.</div>}
          {messages.map((m, i) => (
            <div key={i} className={`message-line ${m.role}`}>
              <div>
              <div className={`bubble ${m.role === "system" ? "system" : ""}`}>
                {m.texte}
              </div>
              {m.role === "agent" && (
                <div className="text-xs text-slate-400 mt-1">
                  {m.latency_ms != null && <span>{m.latency_ms}ms · </span>}
                  {m.guardrail && <span className={m.guardrail.ok ? "text-green-600" : "text-red-600"}>guardrail: {m.guardrail.ok ? "PASS" : "FAIL"} · </span>}
                  {m.escalation && <span className="text-orange-600">escaladé: {m.escalation.motif}</span>}
                  {m.trace && (
                    <details className="inline">
                      <summary style={{ cursor: "pointer" }}>trace ({m.trace.length})</summary>
                      <pre className="surface" style={{ textAlign: "left", padding: 10, marginTop: 5, overflowX: "auto" }}>{JSON.stringify(m.trace, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
              </div>
            </div>
          ))}
        </div>
        <div className="composer">
          <input
            className="message-input"
            placeholder="Écrire un message (fr / ar / darija)..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                send("text", { text: input });
                setInput("");
              }
            }}
          />
          <input ref={fileInputRef} type="file" accept="image/*" className="file-input" id="img-input" onChange={(e) => onFile("image", e)} />
          <label htmlFor="img-input" className="media-button" title="Envoyer une photo"><span aria-hidden="true">◫</span><span>Photo</span></label>
          <input type="file" accept="audio/*" className="file-input" id="audio-input" onChange={(e) => onFile("audio", e)} />
          <label htmlFor="audio-input" className="media-button" title="Envoyer une note vocale"><span aria-hidden="true">◉</span><span>Audio</span></label>
          <button
            className="send-button"
            onClick={() => { if (input.trim()) { send("text", { text: input }); setInput(""); } }}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}
