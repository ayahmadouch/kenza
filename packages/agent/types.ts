import type { BaseMessage } from "@langchain/core/messages";

export type Langue = "fr" | "ar" | "darija";

export type Intention =
  | "prix_et_disponibilite"
  | "rupture_de_stock"
  | "darija_prix"
  | "conseil_taille"
  | "negociation"
  | "question_arabe"
  | "client_qui_revient"
  | "changement_avis"
  | "note_vocale"
  | "photo_produit"
  | "suivi_commande"
  | "retour_produit"
  | "hors_domaine"
  | "livraison_arabe"
  | "rupture_arabe"
  | "reclamation_arabe"
  | "panier_abandonne"
  | "inconnu";

export interface Fact {
  type: "price" | "stock" | "shipping" | "promotion" | "discount" | "order_total" | "availability" | "payment_method";
  value: unknown;
  source: string; // ex: "db:products.prix_mad"
  ref?: string;
}

export interface CartItem {
  ref: string;
  modele: string;
  taille: string;
  qte: number;
  prix_unitaire: number;
}

export interface KenzaState {
  conversationId: string;
  clientId?: string;
  telephone?: string;

  langue: Langue;

  messages: BaseMessage[];

  intention?: Intention;
  intentConfidence?: number;

  facts: Fact[];

  cart: CartItem[];

  ville?: string;

  shipping?: {
    frais: number;
    delai_h: number;
    cod: boolean;
    retrait: boolean;
  };

  remise?: {
    demandee_pct: number;
    accordee_pct: number;
  };

  draft?: string;

  guardrail?: {
    ok: boolean;
    violations: string[];
    retries: number;
  };

  escalation?: {
    motif: string;
    contexte: string;
  };

  orderId?: string;

  needsHuman: boolean;

  trace: TraceEvent[];
}

export interface TraceEvent {
  node: string;
  ts: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  decision?: string;
  latency_ms?: number;
}

export const ALLOWED_CITIES = [
  "Casablanca", "Rabat", "Fès", "Marrakech", "Tanger", "Agadir",
  "Meknès", "Oujda", "Kénitra", "Tétouan", "Salé", "Mohammedia",
];
