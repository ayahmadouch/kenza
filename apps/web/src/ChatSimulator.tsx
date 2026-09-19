import { useEffect, useRef, useState } from "react";
import { WS_URL, apiGet } from "./api";

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
    <div className="grid grid-cols-3 gap-4 h-[75vh]">
      <div className="col-span-1 bg-white rounded-lg shadow p-4 overflow-y-auto">
        <h3 className="font-semibold mb-2">Client</h3>
        <input
          className="w-full border rounded px-2 py-1 mb-2 text-sm"
          placeholder="Rechercher nom / téléphone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="w-full mb-2 bg-slate-800 text-white rounded px-2 py-1 text-sm" onClick={newConversation}>
          + Nouvelle conversation
        </button>
        <div className="space-y-1">
          {clients.map((c) => (
            <button
              key={c.client_id}
              onClick={() => setSelectedClient(c)}
              className={`w-full text-left text-sm px-2 py-1 rounded ${selectedClient?.client_id === c.client_id ? "bg-blue-100" : "hover:bg-slate-50"}`}
            >
              <div className="font-medium">{c.nom}</div>
              <div className="text-xs text-slate-500">{c.telephone} · {c.ville} · {c.langue_preferee}</div>
            </button>
          ))}
        </div>
        {selectedClient && (
          <div className="mt-3 text-xs text-slate-500">
            Client sélectionné: <b>{selectedClient.nom}</b>
          </div>
        )}
      </div>

      <div className="col-span-2 bg-white rounded-lg shadow flex flex-col">
        <div className="border-b px-4 py-2 text-sm text-slate-500 flex justify-between">
          <span>Conversation {conversationId}</span>
          <span className={connected ? "text-green-600" : "text-red-500"}>{connected ? "● connecté" : "○ déconnecté"}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "client" ? "text-right" : "text-left"}>
              <div className={`inline-block px-3 py-2 rounded-lg max-w-[80%] text-sm ${
                m.role === "client" ? "bg-blue-600 text-white" : m.role === "system" ? "bg-red-100 text-red-700" : "bg-slate-100"
              }`}>
                {m.texte}
              </div>
              {m.role === "agent" && (
                <div className="text-xs text-slate-400 mt-1">
                  {m.latency_ms != null && <span>{m.latency_ms}ms · </span>}
                  {m.guardrail && <span className={m.guardrail.ok ? "text-green-600" : "text-red-600"}>guardrail: {m.guardrail.ok ? "PASS" : "FAIL"} · </span>}
                  {m.escalation && <span className="text-orange-600">escaladé: {m.escalation.motif}</span>}
                  {m.trace && (
                    <details className="inline">
                      <summary className="cursor-pointer">trace ({m.trace.length})</summary>
                      <pre className="text-left bg-slate-50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(m.trace, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="border-t p-3 flex gap-2 items-center">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
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
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" id="img-input" onChange={(e) => onFile("image", e)} />
          <label htmlFor="img-input" className="cursor-pointer text-sm bg-slate-100 px-2 py-2 rounded" title="Envoyer une photo">📷</label>
          <input type="file" accept="audio/*" className="hidden" id="audio-input" onChange={(e) => onFile("audio", e)} />
          <label htmlFor="audio-input" className="cursor-pointer text-sm bg-slate-100 px-2 py-2 rounded" title="Envoyer une note vocale">🎤</label>
          <button
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm"
            onClick={() => { if (input.trim()) { send("text", { text: input }); setInput(""); } }}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
