export const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:4000";
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws/chat";

async function handle<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try { detail = ((await res.json()) as { error?: string }).error ?? ""; } catch { /* corps non JSON */ }
    throw new Error(`${label} → ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export const apiGet = async <T,>(path: string): Promise<T> => handle<T>(await fetch(`${API_URL}${path}`), `GET ${path}`);
export const apiPost = async <T,>(path: string, body?: unknown): Promise<T> =>
  handle<T>(await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), `POST ${path}`);

// ---------------------------------------------------------------- Types partagés
export interface TraceEvent { node: string; ts: string; tool?: string; args?: unknown; result?: unknown; decision?: string; latency_ms?: number }
export interface GuardrailVerdict { ok: boolean; violations: string[]; retries: number }
export interface CartItem { ref: string; modele: string; taille: string; qte: number; prix_unitaire: number }
export interface ChatMessage {
  id: number; role: "client" | "agent" | "humain" | "system"; texte: string; intention?: string | null; langue?: string | null;
  latency_ms?: number | null; guardrail?: GuardrailVerdict | null; trace?: TraceEvent[] | null; created_at: string;
}
export interface Client { client_id: string; nom: string; telephone: string; ville: string | null; langue_preferee: string | null; nb_commandes: number; segment: string | null }
export interface ConversationRow {
  id: string; telephone: string | null; langue: string; statut: string; needs_human: boolean; human_active: boolean; cart: CartItem[]; ville: string | null;
  last_message_at: string; client_nom: string | null; client_id: string | null; dernier_message: string | null; intention: string | null; escalades_ouvertes: number;
}
export interface Kpis {
  conversations_total: number; conversations_actives: number; commandes_total: number; chiffre_affaires_mad: number; panier_moyen_mad: number;
  ventes_agent: number; ca_agent_mad: number; taux_conversion: number; taux_escalade: number; escalades_total: number; escalades_ouvertes: number;
  paniers_en_cours: number; relances_envoyees: number; relances_converties: number; taux_recuperation_panier: number;
  ab: { variante: string; envoyees: number; reponses: number; converties: number; taux_reponse: number; taux_conversion: number }[];
}

// ---------------------------------------------------------------- Formats
export const mad = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Number(n).toLocaleString("fr-FR")} MAD`);
export const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)} %`;
export const dt = (v?: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
