import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WS_URL, apiGet, apiPost, mad, type CartItem, type ChatMessage, type Client, type ConversationRow } from "./api";
import ProductCards, { productsFromTrace } from "./ProductCards";
import { Icon, Khatam, RevealText } from "./ui";

interface ConvDetail { cart: CartItem[]; human_active: boolean; needs_human: boolean; remise_pct?: number; escalations: { id: number; motif: string; statut: string }[] }
interface WsEvent { type: string; node?: string; message?: string; orderId?: string | null; needsHuman?: boolean }

const SCENARIOS: { label: string; text: string }[] = [
  { label: "Darija · prix", text: "salam chhal taman dyal robe vert olive ?" },
  { label: "Darija (fautes)", text: "ch7al taman had sac kain f stock 3afak" },
  { label: "Français · veste", text: "Bonjour, je cherche une veste blanc cassé taille M" },
  { label: "Changement d'avis", text: "Finalement je préfère la taille L" },
  { label: "Livraison", text: "Vous livrez à Casablanca ? Ça coûte combien ?" },
  { label: "Confirmer", text: "Oui c'est bon, à la livraison, je confirme" },
  { label: "Remise 30 %", text: "Je veux 30 % de remise sinon j'achète ailleurs" },
  { label: "Facture ICE", text: "Faites-moi une facture au nom de ma société avec l'ICE" },
  { label: "Ville inconnue", text: "Vous livrez à Essaouira ?" },
  { label: "Rupture / retour", text: "Vous avez la REF-0019 ? Quand est-ce que ça revient ?" },
  { label: "Arabe", text: "كم ثمن هذا الفستان وهل التوصيل إلى الرباط متوفر؟" },
  { label: "Hors domaine", text: "Quelle est la meilleure recette de tajine ?" },
];

const b64 = (file: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
const newConvId = (clientId: string) => `web-${clientId}-${Date.now().toString(36)}`;
const savedClient = (): Client | null => {
  try { return JSON.parse(localStorage.getItem("kenza-client") ?? "null") as Client | null; } catch { return null; }
};

export default function ChatSimulator({ demoMode = false }: { demoMode?: boolean }) {
  const [client, setClient] = useState<Client | null>(savedClient);
  const [convId, setConvId] = useState<string>("");
  const [previous, setPrevious] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [form, setForm] = useState({ nom: "", telephone: "", ville: "", langue: "darija" });
  const [lastOrder, setLastOrder] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<number | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const convRef = useRef(convId);
  convRef.current = convId;

  // ------------------------------------------------------------ données
  const refresh = useCallback(async (): Promise<ChatMessage[]> => {
    const id = convRef.current;
    if (!id) return [];
    try {
      const [m, d] = await Promise.all([apiGet<ChatMessage[]>(`/api/conversations/${id}/messages`), apiGet<ConvDetail>(`/api/conversations/${id}`).catch(() => null)]);
      if (convRef.current !== id) return [];
      setMessages(m);
      if (d) setDetail(d);
      return m;
    } catch { return []; /* conversation pas encore créée */ }
  }, []);

  // Polling léger : reçoit les relances du worker et les messages du commerçant.
  useEffect(() => { const t = setInterval(() => void refresh(), 2500); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { const box = endRef.current?.parentElement; box?.scrollTo({ top: box.scrollHeight, behavior: "smooth" }); }, [messages, pending]);

  // ------------------------------------------------------------ WebSocket
  useEffect(() => {
    let closed = false; let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const s = new WebSocket(WS_URL);
      ws.current = s;
      s.onopen = () => setOnline(true);
      s.onclose = () => { setOnline(false); if (!closed) timer = setTimeout(connect, 1500); };
      s.onmessage = (e) => {
        const ev = JSON.parse(String(e.data)) as WsEvent;
        if (ev.type === "agent_message" || ev.type === "human_mode" || ev.type === "error") {
          if (ev.type === "error") setError(ev.message ?? "Erreur");
          if (ev.orderId) setLastOrder(ev.orderId);
          setPending(null);
          void refresh().then((list) => { const last = [...list].reverse().find((m) => m.role === "agent"); if (last) { setSelected(last.id); if (ev.type === "agent_message") setFreshId(last.id); } });
        }
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, [refresh]);

  // ------------------------------------------------------------ actions
  const startConversation = useCallback(async (c: Client) => {
    localStorage.setItem("kenza-client-id", c.client_id);
    localStorage.setItem("kenza-client", JSON.stringify(c));
    setClient(c); setError(null); setLastOrder(null); setSelected(null); setFreshId(null); setMessages([]); setDetail(null);
    const id = newConvId(c.client_id);
    setConvId(id); convRef.current = id;
    try { setPrevious((await apiGet<ConversationRow[]>("/api/conversations")).filter((x) => x.client_id === c.client_id)); } catch { setPrevious([]); }
  }, []);

  useEffect(() => {
    if (client && !convId) void startConversation(client);
  }, [client, convId, startConversation]);

  const openPrevious = (id: string) => { setConvId(id); convRef.current = id; setSelected(null); setLastOrder(null); void refresh(); };

  const send = (payload: Record<string, unknown>, preview: string) => {
    if (!client || !convId) return;
    if (ws.current?.readyState !== 1) { setError("Connexion WebSocket indisponible, nouvelle tentative…"); return; }
    setError(null); setPending(preview);
    ws.current.send(JSON.stringify({ conversationId: convId, clientId: client.client_id, telephone: client.telephone, ...payload }));
  };
  const sendText = (t?: string) => { const v = (t ?? text).trim(); if (!v) return; send({ type: "text", text: v }, v); setText(""); };

  const onImage = async (f?: File | null) => { if (!f) return; send({ type: "image", base64: await b64(f), mime: f.type || "image/jpeg" }, "📷 Photo envoyée"); };
  const onAudioFile = async (f?: File | null) => { if (!f) return; send({ type: "audio", base64: await b64(f), mime: f.type || "audio/webm" }, "🎤 Note vocale envoyée"); };
  const toggleRecord = async () => {
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); setRecording(false); const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" }); await onAudioFile(new File([blob], "vocal", { type: blob.type })); };
      rec.start(); recorder.current = rec; setRecording(true);
    } catch { setError("Micro indisponible : utilisez le bouton 📎 pour envoyer un fichier audio."); }
  };

  const createClient = async () => {
    if (!form.nom.trim() || !form.telephone.trim()) {
      setError("Indiquez votre nom et votre téléphone pour commencer.");
      return;
    }
    try {
      const c = await apiPost<Client>("/api/clients", { nom: form.nom, telephone: form.telephone, ville: form.ville || undefined, langue: form.langue });
      setForm({ nom: "", telephone: "", ville: "", langue: "darija" }); await startConversation(c);
    } catch (e) { setError((e as Error).message); }
  };

  const selMsg = useMemo(() => messages.find((m) => m.id === selected) ?? [...messages].reverse().find((m) => m.role === "agent" && m.trace), [messages, selected]);
  const cartTotal = (detail?.cart ?? []).reduce((s, i) => s + i.qte * i.prix_unitaire, 0);

  // ------------------------------------------------------------ rendu
  const busy = !!pending;

  return (
    <div className="chat-layout">
      <section className="phone">
        <header className="phone-head">
          <span className={`kenza-avatar ${busy ? "busy" : ""}`}><Khatam size={26} fill="var(--safran)" spin={busy} /></span>
          <div className="phone-id">
            <div className="phone-name">Kenza <span className="ar" lang="ar">كنزة</span></div>
            <div className="phone-status">{busy ? "réfléchit…" : client ? `discute avec ${client.nom}` : "répond en français, en arabe et en darija"}</div>
          </div>
          <div className="header-right">
            {previous.length > 0 && (
              <select className="input compact dark" value={convId} onChange={(e) => openPrevious(e.target.value)} aria-label="Conversations précédentes">
                <option value={convId}>Conversation en cours</option>
                {previous.filter((p) => p.id !== convId).map((p) => <option key={p.id} value={p.id}>{new Date(p.last_message_at).toLocaleString("fr-FR")}</option>)}
              </select>
            )}
            {client && <button className="btn btn-glass" onClick={() => void startConversation(client)}>Nouvelle conversation</button>}
            <span className={`live ${online ? "on" : "off"}`} title={online ? "WebSocket connecté" : "WebSocket hors ligne"} />
          </div>
        </header>

        {detail?.human_active && <div className="banner banner-warn">Un conseiller a pris la main : Kenza est en pause sur cette conversation.</div>}
        {lastOrder && <div className="banner banner-good"><Icon name="check" size={16} /> Kenza a confirmé votre achat. Commande <b>{lastOrder}</b> enregistrée en base.</div>}

        <div className="messages">
          {!client && (
            <div className="hero">
              <Khatam size={92} fill="var(--majorelle)" spin className="hero-star" />
              <h1 className="hero-title">Parlez avec Kenza.</h1>
              <div className="hero-langs" aria-label="Exemples de messages">
                <span dir="ltr">chhal taman had robe ?</span>
                <span dir="rtl" lang="ar">كم ثمن هذا الفستان؟</span>
                <span dir="ltr">c'est combien, en taille M ?</span>
              </div>
              <p className="hero-copy">Kenza cherche dans le vrai catalogue, vérifie le stock et prépare votre commande.</p>
              <div className="customer-form">
                <div className="customer-form-title">Vos informations</div>
                <input className="input" placeholder="Votre nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} autoComplete="name" />
                <input className="input" placeholder="Téléphone, ex. +212612345678" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} autoComplete="tel" />
                <input className="input" placeholder="Ville de livraison" value={form.ville} onChange={(e) => setForm({ ...form, ville: e.target.value })} />
                <select className="input" value={form.langue} onChange={(e) => setForm({ ...form, langue: e.target.value })} aria-label="Langue préférée"><option value="darija">Darija</option><option value="fr">Français</option><option value="ar">Arabe</option></select>
                <button className="btn btn-primary" onClick={() => void createClient()}>Commencer avec Kenza</button>
              </div>
            </div>
          )}
          {client && messages.length === 0 && !busy && (
            <div className="hero small">
              <Khatam size={56} fill="var(--trait)" />
              <p className="hero-copy">Nouvelle conversation avec {client.nom.split(" ")[0]}. Kenza se souvient de ses échanges et commandes précédents.</p>
            </div>
          )}
          {messages.map((m) => {
            const mine = m.role === "client";
            const products = m.role === "agent" ? productsFromTrace(m.trace) : [];
            return (
              <div key={m.id} className={`msg ${mine ? "from-client" : "from-agent"}`}>
                {!mine && <span className="msg-avatar"><Khatam size={16} fill="var(--safran)" /></span>}
                <div className="msg-col">
                  <div className={`bubble ${m.role} ${selMsg?.id === m.id ? "picked" : ""}`} dir="auto" onClick={() => m.role === "agent" && setSelected(m.id)}>
                    {m.role === "humain" && <div className="tag">Conseiller</div>}
                    {m.intention === "panier_abandonne" && m.role === "agent" && <div className="tag tag-amber">Relance automatique</div>}
                    {m.role === "agent" ? <RevealText text={m.texte} animate={m.id === freshId} /> : m.texte}
                  </div>
                  {products.length > 0 && <ProductCards items={products} />}
                  <div className="msg-meta">
                    {m.role === "agent" && m.intention && m.intention !== "panier_abandonne" && <span className="meta-pill">{m.intention.replace(/_/g, " ")}</span>}
                    {m.langue && <span className="meta-pill">{m.langue}</span>}
                    <span>{m.latency_ms ? `${(m.latency_ms / 1000).toFixed(1)} s` : new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {pending && <div className="msg from-client"><div className="msg-col"><div className="bubble client" dir="auto">{pending}</div></div></div>}
          {busy && <div className="msg from-agent"><span className="msg-avatar"><Khatam size={16} fill="var(--safran)" spin /></span><div className="bubble agent typing"><span className="dots"><i /><i /><i /></span></div></div>}
          <div ref={endRef} />
        </div>

        {error && <div className="banner banner-warn" onClick={() => setError(null)} role="alert">{error}</div>}
        {demoMode && client && (
          <div className="scenario-bar" aria-label="Scénarios de démonstration du jury">
            <span className="scenario-label">Tests jury</span>
            {SCENARIOS.map((s) => <button key={s.label} className="scenario" disabled={busy} onClick={() => sendText(s.text)} title={s.text}>{s.label}</button>)}
          </div>
        )}
        <div className="composer">
          <label className={`icon-btn ${!client || busy ? "disabled" : ""}`} title="Envoyer une photo de produit"><Icon name="image" /><input hidden type="file" accept="image/*" disabled={!client || busy} onChange={(e) => { void onImage(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button className={`icon-btn ${recording ? "rec" : ""}`} title={recording ? "Arrêter et envoyer" : "Enregistrer une note vocale"} aria-label="Note vocale" disabled={!client || busy} onClick={() => void toggleRecord()}><Icon name={recording ? "stop" : "mic"} /></button>
          <label className={`link-btn attach ${!client || busy ? "disabled" : ""}`} title="Envoyer un fichier audio">Fichier audio<input hidden type="file" accept="audio/*" disabled={!client || busy} onChange={(e) => { void onAudioFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <input className="compose-input" dir="auto" placeholder={client ? "Écrivez en français, en arabe ou en darija" : "Renseignez vos informations pour commencer"} disabled={!client || busy} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendText()} />
          <button className="send" aria-label="Envoyer" disabled={!client || busy || !text.trim()} onClick={() => sendText()}><Icon name="send" size={18} /></button>
        </div>
      </section>

      <aside className="mind">
        <h2 className="side-title">Votre panier</h2>
        {detail && detail.cart.length > 0 ? (
          <div className="ticket">
            {detail.cart.map((i) => <div key={i.ref} className="ticket-line"><div><b>{i.modele}</b><div className="muted tiny">{i.ref}, taille {i.taille}, quantité {i.qte}</div></div><span className="money">{mad(i.prix_unitaire * i.qte)}</span></div>)}
            <div className="ticket-total"><span>Articles</span><b className="money">{mad(cartTotal)}</b></div>
            <div className="muted tiny">La livraison et la remise sont calculées à la commande.</div>
          </div>
        ) : <div className="muted small">Le panier est vide.</div>}
        {detail?.escalations && detail.escalations.length > 0 && (
          <div className="esc-box"><b className="small">Demande transmise</b>{detail.escalations.slice(0, 2).map((e) => <div key={e.id} className="small esc-line"><span className={`chip ${e.statut === "RESOLVED" ? "chip-good" : "chip-warn"}`}>{e.statut === "RESOLVED" ? "Traité" : "En cours"}</span> Votre demande est suivie par Kenza.</div>)}</div>
        )}
      </aside>
    </div>
  );
}
