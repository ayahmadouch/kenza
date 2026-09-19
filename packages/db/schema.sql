-- Kenza — schéma PostgreSQL
-- Source de vérité métier + checkpoints LangGraph (créés séparément par PostgresSaver.setup())

CREATE TABLE IF NOT EXISTS products (
  ref TEXT PRIMARY KEY,
  modele TEXT NOT NULL,
  famille TEXT NOT NULL,
  genre TEXT,
  couleur TEXT,
  taille TEXT,
  matiere TEXT,
  saison TEXT,
  prix_mad INT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  delai_reassort_jours INT NULL,
  code_barre TEXT,
  poids_g INT
);
CREATE INDEX IF NOT EXISTS idx_products_famille_couleur_taille ON products(famille, couleur, taille);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  telephone TEXT UNIQUE,
  ville TEXT,
  langue_preferee TEXT,
  premier_achat DATE,
  nb_commandes INT DEFAULT 0,
  segment TEXT
);

-- Séquence dédiée aux commandes créées par l'agent, pour ne jamais entrer
-- en collision avec les 320 commandes historiques CMD-00001..CMD-00320.
CREATE SEQUENCE IF NOT EXISTS agent_order_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  commande_id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(client_id),
  date DATE,
  canal TEXT,
  statut TEXT,
  total_articles_mad INT,
  frais_livraison_mad INT,
  total_mad INT,
  ville_livraison TEXT,
  paiement TEXT,
  created_by TEXT NOT NULL DEFAULT 'humain' CHECK (created_by IN ('agent', 'humain'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  commande_id TEXT REFERENCES orders(commande_id),
  ref TEXT REFERENCES products(ref),
  modele TEXT,
  taille TEXT,
  quantite INT,
  prix_unitaire_mad INT
);
CREATE INDEX IF NOT EXISTS idx_order_items_commande ON order_items(commande_id);

CREATE TABLE IF NOT EXISTS shipping_rates (
  ville TEXT PRIMARY KEY,
  frais_mad INT NOT NULL,
  delai_heures INT NOT NULL,
  paiement_a_la_livraison BOOLEAN NOT NULL DEFAULT false,
  retrait_boutique BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  ref TEXT REFERENCES products(ref),
  prix_normal_mad INT,
  prix_promo_mad INT,
  debut DATE,
  fin DATE,
  condition TEXT
);
CREATE INDEX IF NOT EXISTS idx_promotions_ref ON promotions(ref);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(client_id),
  telephone TEXT,
  canal TEXT DEFAULT 'web',
  langue TEXT DEFAULT 'fr',
  statut TEXT DEFAULT 'active', -- active | needs_human | closed
  needs_human BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  cart JSONB DEFAULT '[]'::jsonb,
  ville TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  role TEXT NOT NULL, -- client | agent | system
  texte TEXT,
  intention TEXT,
  langue TEXT,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  guardrail JSONB,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS escalations (
  id SERIAL PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  motif TEXT NOT NULL,
  contexte_resume TEXT,
  payload JSONB,
  statut TEXT NOT NULL DEFAULT 'NEEDS_HUMAN_REVIEW',
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS relances (
  id SERIAL PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  variante TEXT NOT NULL, -- A | B
  planifiee_a TIMESTAMPTZ,
  envoyee_a TIMESTAMPTZ,
  resultat TEXT -- pending | sent | converted | ignored | skipped_out_of_hours
);
