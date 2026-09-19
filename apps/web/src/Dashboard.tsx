import { useMemo, useState, type ReactNode } from "react";
import { apiPost, dt, day, mad, pct, type CartItem, type ChatMessage, type ConversationRow, type Kpis } from "./api";
import { usePolling } from "./usePolling";
import TraceView from "./TraceView";
import { Counter, Khatam, Ring } from "./ui";
import { useEffect } from "react";
import { apiGet, type TraceEvent, type GuardrailVerdict } from "./api";

export type Page = "overview" | "conversations" | "catalogue" | "stock" | "orders" | "relances" | "escalations" | "activity";

function Head({ title, copy, right }: { title: string; copy: string; right?: ReactNode }) {
  return <div className="dashboard-head"><div><h1 className="page-title">{title}</h1><p className="page-copy">{copy}</p></div>{right}</div>;
}
const Loading = ({ error }: { error: string | null }) => <div className="empty-state">{error ? `Erreur : ${error}` : "Chargement…"}</div>;
const Chip = ({ kind, children }: { kind?: "good" | "warn" | "info"; children: ReactNode }) => <span className={`chip ${kind ? `chip-${kind}` : ""}`}>{children}</span>;

function Table({ head, rows, empty = "Aucune donnée." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <div className="empty-state">{empty}</div>;
  return <div className="table-wrap"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
}

// ----------------------------------------------------------------------- Vue d'ensemble
interface TraceLite { id: number; client_nom: string | null; langue: string | null; intention: string | null; guardrail: { ok: boolean } | null; trace: { tool?: string; node: string }[]; created_at: string }
const LANG_NAME: Record<string, string> = { fr: "français", ar: "arabe", darija: "darija" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function Bar({ label, value, max, tone = "blue" }: { label: string; value: number; max: number; tone?: "blue" | "jade" | "safran" | "corail" }) {
  return <div className="bar-row"><span className="bar-label">{label}</span><span className="bar-track"><span className={`bar-fill tone-${tone}`} style={{ width: `${max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0}%` }} /></span><b className="bar-val">{value}</b></div>;
}

function Overview() {
  const { data: k, error } = usePolling<Kpis>("/api/kpis", 3000);
  const { data: feed } = usePolling<TraceLite[]>("/api/traces?limit=6", 3000);
  if (!k) return <Loading error={error} />;
  const converties = Math.round(k.taux_conversion * k.conversations_total);
  const escaladees = Math.round(k.taux_escalade * k.conversations_total);
  return (
    <>
      <section className="banner-hero">
        <div className="banner-hero-text">
          <p className="hero-kicker">Aujourd'hui dans la boutique</p>
          <h1 className="hero-sentence">
            Kenza a conclu <span className="num"><Counter value={k.ventes_agent} /></span> {k.ventes_agent > 1 ? "ventes" : "vente"} pour <span className="num"><Counter value={k.ca_agent_mad} /> MAD</span> et a relancé <span className="num"><Counter value={k.relances_envoyees} /></span> {k.relances_envoyees > 1 ? "paniers" : "panier"}.
          </h1>
          <p className="hero-sub">{plural(k.escalades_ouvertes, "conversation attend", "conversations attendent")} votre réponse.</p>
        </div>
        <div className="rings">
          <Ring value={k.taux_conversion} label="Conversations qui finissent en commande" />
          <Ring value={1 - k.taux_escalade} label="Conversations réglées sans vous" />
        </div>
        <Khatam size={260} fill="rgba(255,255,255,.06)" className="hero-deco" />
      </section>

      <dl className="figures">
        {([
          ["Chiffre d'affaires", `${k.chiffre_affaires_mad.toLocaleString("fr-FR")} MAD`, `${k.commandes_total} commandes`],
          ["Panier moyen", `${k.panier_moyen_mad.toLocaleString("fr-FR")} MAD`, "toutes commandes"],
          ["Conversations actives", String(k.conversations_actives), `sur ${k.conversations_total}`],
          ["Paniers en cours", String(k.paniers_en_cours), "à relancer si silence"],
          ["Paniers récupérés", `${(k.taux_recuperation_panier * 100).toFixed(0)} %`, `${k.relances_converties} sur ${k.relances_envoyees} relances`],
        ] as const).map(([label, value, sub]) => <div key={label} className="figure"><dt>{label}</dt><dd>{value}</dd><span>{sub}</span></div>)}
      </dl>

      <div className="overview-grid">
        <section className="panel">
          <h2 className="panel-h">Parcours des conversations</h2>
          <Bar label="Conversations" value={k.conversations_total} max={k.conversations_total} />
          <Bar label="Commande créée" value={converties} max={k.conversations_total} tone="jade" />
          <Bar label="Transmises à vous" value={escaladees} max={k.conversations_total} tone="corail" />
          <Bar label="Panier en attente" value={k.paniers_en_cours} max={k.conversations_total} tone="safran" />
          <h2 className="panel-h spaced">Test A/B des relances</h2>
          {k.ab.length === 0 ? <p className="muted small">Aucune relance envoyée. Laissez un panier 1 minute dans le simulateur pour lancer le premier test.</p> : k.ab.map((r) => (
            <div key={r.variante} className="ab">
              <div className="ab-head"><b>Variante {r.variante}</b><span className="muted small">{plural(r.envoyees, "envoi")}</span></div>
              <Bar label="Réponses" value={r.reponses} max={Math.max(1, r.envoyees)} tone="blue" />
              <Bar label="Commandes" value={r.converties} max={Math.max(1, r.envoyees)} tone="jade" />
            </div>
          ))}
          <p className="muted tiny">A : rappel direct. B : ton chaleureux avec une question ouverte.</p>
        </section>

        <section className="panel">
          <h2 className="panel-h">Ce que Kenza vient de faire</h2>
          {!feed || feed.length === 0 ? <p className="muted small">Rien pour l'instant. Ouvrez le simulateur et envoyez un message.</p> : (
            <ol className="feed">
              {feed.map((t) => (
                <li key={t.id}>
                  <Khatam size={18} fill={t.guardrail?.ok === false ? "var(--corail)" : "var(--jade)"} />
                  <div><b>{t.client_nom ?? "Client"}</b> a écrit en {LANG_NAME[t.langue ?? "fr"] ?? t.langue}<div className="muted small">{(t.intention ?? "intention inconnue").replace(/_/g, " ")}, {plural(t.trace.filter((e) => e.tool).length, "outil")}, {t.guardrail?.ok === false ? "réponse bloquée" : "chiffres vérifiés"}, {dt(t.created_at)}</div></div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------- Conversations
function Conversations() {
  const { data, error } = usePolling<ConversationRow[]>("/api/conversations", 3000);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <Head title="Conversations" copy="Clients, langues, intentions détectées et paniers." />
      <div className="surface data-surface">
        <Table head={["Client", "Téléphone", "Langue", "Intention", "Statut", "Panier", "Dernier message", "Activité", ""]}
          rows={data.map((c) => [
            <b>{c.client_nom ?? "Anonyme"}</b>, c.telephone ?? "—", <Chip>{c.langue}</Chip>, c.intention ?? "—",
            <Chip kind={c.human_active ? "warn" : c.needs_human ? "warn" : c.statut === "converted" ? "good" : undefined}>{c.human_active ? "humain" : c.statut}</Chip>,
            (c.cart as CartItem[]).length ? mad((c.cart as CartItem[]).reduce((s, i) => s + i.qte * i.prix_unitaire, 0)) : "—",
            <span className="ellipsis">{c.dernier_message ?? "—"}</span>, dt(c.last_message_at),
            <button className="table-action" onClick={() => setOpen(c.id)}>Ouvrir</button>,
          ])} empty="Aucune conversation : lancez-en une depuis le simulateur." />
      </div>
      {open && <ConversationDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ConversationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: msgs } = usePolling<ChatMessage[]>(`/api/conversations/${id}/messages`, 2500);
  const { data: conv, reload } = usePolling<{ cart: CartItem[]; human_active: boolean; client_nom: string | null; telephone: string | null }>(`/api/conversations/${id}`, 3000);
  const [reply, setReply] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const trace = msgs?.find((m) => m.id === picked) ?? [...(msgs ?? [])].reverse().find((m) => m.role === "agent" && m.trace);
  const act = async (path: string, body?: unknown) => { await apiPost(`/api/conversations/${id}/${path}`, body); await reload(); };
  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="drawer surface" onClick={(e) => e.stopPropagation()}>
        <div className="row-between"><div><h3 className="panel-title">{conv?.client_nom ?? "Conversation"}</h3><div className="muted small">{conv?.telephone} · {id}</div></div><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
        <div className="actions">
          {conv?.human_active ? <button className="btn btn-primary" onClick={() => void act("release")}>Rendre à Kenza</button> : <button className="btn btn-primary" onClick={() => void act("take-over")}>Reprendre la main</button>}
        </div>
        <div className="drawer-grid">
          <div className="drawer-msgs">
            {(msgs ?? []).map((m) => <div key={m.id} className={`message-line ${m.role === "client" ? "client" : "agent"}`}><div className={`bubble ${m.role}`} onClick={() => m.role === "agent" && setPicked(m.id)}>{m.role === "humain" && <div className="tag">Conseiller</div>}{m.texte}<div className="message-meta">{m.intention ?? m.role} · {dt(m.created_at)}</div></div></div>)}
          </div>
          <div className="drawer-trace"><div className="panel-label">Trace du message sélectionné</div><TraceView trace={trace?.trace as TraceEvent[] | undefined} guardrail={trace?.guardrail as GuardrailVerdict | undefined} latency={trace?.latency_ms} /></div>
        </div>
        {conv?.human_active && (
          <div className="composer"><input className="input grow" dir="auto" placeholder="Répondre en tant que commerçant…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) { void act("human-message", { texte: reply }); setReply(""); } }} /><button className="btn btn-accent" onClick={() => { if (reply.trim()) { void act("human-message", { texte: reply }); setReply(""); } }}>Envoyer</button></div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- Catalogue
interface Product { ref: string; modele: string; famille: string; couleur: string; taille: string; prix_mad: number; prix_promo_mad: number | null; promo_fin: string | null; stock: number; disponible: boolean; matiere: string }
function Catalogue() {
  const { data, error } = usePolling<Product[]>("/api/catalogue", 15000);
  const [q, setQ] = useState("");
  const rows = useMemo(() => (data ?? []).filter((p) => `${p.ref} ${p.modele} ${p.famille} ${p.couleur}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <Head title="Catalogue" copy={`${data.length} références — la promotion n'implique pas la disponibilité.`} right={<input className="input search" placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />} />
      <div className="surface data-surface"><Table head={["Réf.", "Modèle", "Famille", "Couleur", "Taille", "Prix", "Promotion", "Stock", "Disponibilité"]}
        rows={rows.map((p) => [<code>{p.ref}</code>, p.modele, p.famille, p.couleur, p.taille, mad(p.prix_mad),
          p.prix_promo_mad !== null ? <Chip kind="info">{mad(p.prix_promo_mad)} · jusqu'au {day(p.promo_fin)}</Chip> : "—", p.stock, <Chip kind={p.disponible ? "good" : "warn"}>{p.disponible ? "Disponible" : "Rupture"}</Chip>])} /></div>
    </>
  );
}

// ----------------------------------------------------------------------- Stock
interface StockRow { ref: string; modele: string; famille: string; couleur: string; taille: string; stock: number; statut: "rupture" | "faible" | "en_stock" }
interface Facets { familles: string[]; couleurs: string[]; tailles: string[] }
function Stock() {
  const [f, setF] = useState({ statut: "", famille: "", couleur: "", taille: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error } = usePolling<StockRow[]>(`/api/stock?${qs}`, 5000);
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => { void apiGet<Facets>("/api/stock/facets").then(setFacets).catch(() => undefined); }, []);
  const sel = (key: keyof typeof f, label: string, opts: string[]) => <select className="input compact" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}><option value="">{label}</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>;
  return (
    <>
      <Head title="Stock" copy="Quantités réelles ; se met à jour après chaque commande de l'agent."
        right={<div className="filters"><select className="input compact" value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value })}><option value="">Tous statuts</option><option value="en_stock">En stock</option><option value="rupture">Rupture</option></select>{sel("famille", "Famille", facets?.familles ?? [])}{sel("couleur", "Couleur", facets?.couleurs ?? [])}{sel("taille", "Taille", facets?.tailles ?? [])}</div>} />
      {!data ? <Loading error={error} /> : <div className="surface data-surface"><Table head={["Réf.", "Produit", "Variante", "Quantité", "Statut"]}
        rows={data.map((s) => [<code>{s.ref}</code>, s.modele, `${s.couleur} · ${s.taille}`, <b>{s.stock}</b>, <Chip kind={s.statut === "rupture" ? "warn" : s.statut === "faible" ? "info" : "good"}>{s.statut === "rupture" ? "Rupture" : s.statut === "faible" ? "Stock faible" : "En stock"}</Chip>])} /></div>}
    </>
  );
}

// ----------------------------------------------------------------------- Commandes
interface Order { commande_id: string; date: string; statut: string; total_articles_mad: number; frais_livraison_mad: number; total_mad: number; ville_livraison: string; paiement: string; created_by: string; client_nom: string | null; items: { ref: string; modele: string; taille: string; quantite: number; prix_unitaire_mad: number }[] }
function Orders() {
  const { data, error } = usePolling<Order[]>("/api/commandes", 3000);
  const [only, setOnly] = useState(false);
  if (!data) return <Loading error={error} />;
  const rows = data.filter((o) => !only || o.created_by === "agent");
  return (
    <>
      <Head title="Commandes" copy="Historique + commandes créées par Kenza (created_by = agent)." right={<label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Kenza uniquement</label>} />
      <div className="surface data-surface"><Table head={["Commande", "Client", "Produits", "Livraison", "Total", "Statut", "Date", "Créée par"]}
        rows={rows.map((o) => [<code>{o.commande_id}</code>, o.client_nom ?? "—",
          <span className="ellipsis">{o.items.map((i) => `${i.quantite}× ${i.modele} (${i.taille}) ${mad(i.prix_unitaire_mad)}`).join(" ; ")}</span>,
          `${mad(o.frais_livraison_mad)} · ${o.ville_livraison}`, <b>{mad(o.total_mad)}</b>, <Chip>{o.statut}</Chip>, day(o.date), <Chip kind={o.created_by === "agent" ? "good" : undefined}>{o.created_by}</Chip>])} /></div>
    </>
  );
}

// ----------------------------------------------------------------------- Relances
interface Relance { id: number; conversation_id: string; variante: string; planifiee_a: string; envoyee_a: string | null; resultat: string; texte: string | null; client_nom: string | null; cart: CartItem[]; last_message_at: string }
function Relances() {
  const { data, error } = usePolling<Relance[]>("/api/relances", 3000);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <Head title="Relances" copy="Paniers abandonnés relancés par le worker BullMQ — une seule relance par panier." />
      <div className="surface data-surface"><Table head={["Client", "Panier", "Dernière activité", "Variante", "Planifiée", "Envoyée", "Résultat", "Message"]}
        rows={data.map((r) => [<b>{r.client_nom ?? r.conversation_id}</b>, r.cart?.length ? mad(r.cart.reduce((s, i) => s + i.qte * i.prix_unitaire, 0)) : "—", dt(r.last_message_at), <Chip kind="info">{r.variante}</Chip>, dt(r.planifiee_a), dt(r.envoyee_a),
          <Chip kind={r.resultat === "converted" ? "good" : r.resultat === "pending" ? "warn" : undefined}>{r.resultat}</Chip>, <span className="ellipsis">{r.texte ?? "—"}</span>])}
        empty="Aucune relance. Laissez un panier inactif (DEMO_DELAY_MINUTES=1) : le worker la planifiera." /></div>
    </>
  );
}

// ----------------------------------------------------------------------- Escalades
interface Escalation { id: number; conversation_id: string; motif: string; contexte_resume: string | null; statut: string; created_at: string; client_nom: string | null; telephone: string | null; human_active: boolean }
function Escalations() {
  const { data, error, reload } = usePolling<Escalation[]>("/api/escalations", 3000);
  const [openId, setOpenId] = useState<number | null>(null);
  if (!data) return <Loading error={error} />;
  const act = async (e: Escalation, path: "take-over" | "release") => { await apiPost(`/api/conversations/${e.conversation_id}/${path}`); await reload(); };
  return (
    <>
      <Head title="Escalades" copy="Cas transmis au commerçant avec le contexte complet de la conversation." />
      <div className="surface data-surface"><Table head={["Client", "Motif", "Statut", "Date", "Contexte", "Action"]}
        rows={data.map((e) => [<><b>{e.client_nom ?? "Anonyme"}</b><div className="muted tiny">{e.telephone}</div></>, <span className="wrap">{e.motif}</span>,
          <Chip kind={e.statut === "RESOLVED" ? "good" : "warn"}>{e.statut}</Chip>, dt(e.created_at),
          <button className="link-btn" onClick={() => setOpenId(openId === e.id ? null : e.id)}>{openId === e.id ? "Masquer" : "Voir"}</button>,
          e.statut === "RESOLVED" ? "—" : e.human_active ? <button className="table-action" onClick={() => void act(e, "release")}>Rendre à Kenza</button> : <button className="table-action" onClick={() => void act(e, "take-over")}>Reprendre la main</button>])}
        empty="Aucune escalade." /></div>
      {openId && <div className="surface pad-lg ctx"><h3 className="panel-title">Contexte transmis</h3><pre>{data.find((e) => e.id === openId)?.contexte_resume}</pre></div>}
    </>
  );
}

// ----------------------------------------------------------------------- Activité
interface TraceRow { id: number; conversation_id: string; client_nom: string | null; intention: string | null; langue: string | null; latency_ms: number | null; guardrail: GuardrailVerdict | null; trace: TraceEvent[]; texte: string; created_at: string }
function Activity() {
  const { data, error } = usePolling<TraceRow[]>("/api/traces?limit=20", 3000);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <Head title="Activité de l'agent" copy="Exécution structurée de chaque réponse : nœuds, outils, garde-fou, latence." />
      <div className="activity">{data.map((t) => (
        <div key={t.id} className="surface pad-lg">
          <div className="row-between"><div><b>{t.client_nom ?? t.conversation_id}</b> <Chip>{t.langue}</Chip> <Chip kind="info">{t.intention ?? "—"}</Chip></div><span className="muted small">{dt(t.created_at)}</span></div>
          <div className="reply">« {t.texte} »</div>
          <TraceView trace={t.trace} guardrail={t.guardrail} latency={t.latency_ms} />
        </div>))}
        {data.length === 0 && <div className="empty-state">Aucune exécution pour l'instant.</div>}
      </div>
    </>
  );
}

export default function Dashboard({ page }: { page: Page }) {
  switch (page) {
    case "overview": return <Overview />;
    case "conversations": return <Conversations />;
    case "catalogue": return <Catalogue />;
    case "stock": return <Stock />;
    case "orders": return <Orders />;
    case "relances": return <Relances />;
    case "escalations": return <Escalations />;
    case "activity": return <Activity />;
  }
}
