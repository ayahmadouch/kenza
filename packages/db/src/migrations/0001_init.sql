-- Migration initiale Kenza. Idempotente : rejouable sans erreur au redémarrage
-- (docker compose restart) grâce à IF NOT EXISTS partout. Aucune étape manuelle
-- n'est nécessaire après `docker compose up` : cette migration est appliquée
-- automatiquement par apps/api/src/bootstrap au démarrage.

CREATE TABLE IF NOT EXISTS products (
  ref                     TEXT PRIMARY KEY,
  modele                  TEXT NOT NULL,
  famille                 TEXT NOT NULL,
  genre                   TEXT NOT NULL,
  couleur                 TEXT NOT NULL,
  taille                  TEXT NOT NULL,
  matiere                 TEXT NOT NULL,
  saison                  TEXT NOT NULL,
  prix_mad                INTEGER NOT NULL,
  stock                   INTEGER NOT NULL,
  delai_reassort_jours    INTEGER,
  code_barre              TEXT NOT NULL,
  poids_g                 INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS products_famille_couleur_taille_idx
  ON products (famille, couleur, taille);
CREATE INDEX IF NOT EXISTS products_stock_idx ON products (stock);

CREATE TABLE IF NOT EXISTS clients (
  client_id           TEXT PRIMARY KEY,
  nom                 TEXT NOT NULL,
  telephone           TEXT NOT NULL UNIQUE,
  ville               TEXT NOT NULL,
  langue_preferee     TEXT NOT NULL,
  premier_achat       DATE,
  nb_commandes        INTEGER NOT NULL DEFAULT 0,
  segment             TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  commande_id           TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES clients(client_id),
  date                  DATE NOT NULL,
  canal                 TEXT NOT NULL,
  statut                TEXT NOT NULL,
  total_articles_mad    INTEGER NOT NULL,
  frais_livraison_mad   INTEGER NOT NULL,
  total_mad             INTEGER NOT NULL,
  ville_livraison       TEXT NOT NULL,
  paiement              TEXT NOT NULL,
  created_by            TEXT NOT NULL DEFAULT 'humain'
);

CREATE TABLE IF NOT EXISTS order_items (
  id                    SERIAL PRIMARY KEY,
  commande_id           TEXT NOT NULL REFERENCES orders(commande_id),
  ref                   TEXT NOT NULL REFERENCES products(ref),
  modele                TEXT NOT NULL,
  taille                TEXT NOT NULL,
  quantite              INTEGER NOT NULL,
  prix_unitaire_mad     INTEGER NOT NULL,
  -- Rang d'occurrence parmi les lignes strictement identiques d'une même
  -- commande (0, 1, 2...). Certaines commandes du CSV source contiennent
  -- deux lignes intégralement identiques (même ref/taille/quantité/prix) :
  -- ce sont deux lignes d'achat distinctes et légitimes, pas un doublon
  -- d'import. Ce rang sert uniquement de clé technique pour un seed
  -- idempotent ; il n'a aucun sens métier.
  seed_occurrence       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS order_items_commande_id_idx ON order_items (commande_id);

CREATE UNIQUE INDEX IF NOT EXISTS order_items_natural_key_idx
  ON order_items (commande_id, ref, taille, quantite, prix_unitaire_mad, seed_occurrence);

CREATE TABLE IF NOT EXISTS shipping_rates (
  ville                       TEXT PRIMARY KEY,
  frais_mad                   INTEGER NOT NULL,
  delai_heures                INTEGER NOT NULL,
  paiement_a_la_livraison     BOOLEAN NOT NULL,
  retrait_boutique            BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id                  SERIAL PRIMARY KEY,
  ref                 TEXT NOT NULL REFERENCES products(ref),
  prix_normal_mad     INTEGER NOT NULL,
  prix_promo_mad      INTEGER NOT NULL,
  debut               DATE NOT NULL,
  fin                 DATE NOT NULL,
  condition           TEXT
);

-- Idem : clé naturelle synthétique pour un seed idempotent des promotions.
CREATE UNIQUE INDEX IF NOT EXISTS promotions_natural_key_idx
  ON promotions (ref, debut, fin);

CREATE TABLE IF NOT EXISTS conversations (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT,
  telephone           TEXT,
  canal               TEXT NOT NULL DEFAULT 'web',
  langue              TEXT,
  statut              TEXT NOT NULL DEFAULT 'en_cours',
  last_message_at     TIMESTAMPTZ,
  cart                JSONB NOT NULL DEFAULT '[]',
  needs_human         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id                  SERIAL PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id),
  role                TEXT NOT NULL,
  texte               TEXT NOT NULL,
  intention           TEXT,
  langue              TEXT,
  tool_calls          JSONB,
  guardrail           JSONB,
  latency_ms          INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx
  ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS escalations (
  id                  SERIAL PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id),
  motif               TEXT NOT NULL,
  contexte_resume     TEXT NOT NULL,
  payload             JSONB,
  statut              TEXT NOT NULL DEFAULT 'NEEDS_HUMAN_REVIEW',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS relances (
  id                  SERIAL PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id),
  variante            TEXT NOT NULL,
  planifiee_a         TIMESTAMPTZ NOT NULL,
  envoyee_a           TIMESTAMPTZ,
  resultat            TEXT
);

-- Table de contrôle interne du seeder (vérification des volumes attendus).
CREATE TABLE IF NOT EXISTS _seed_status (
  id            SERIAL PRIMARY KEY,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  counts        JSONB NOT NULL,
  ok            BOOLEAN NOT NULL
);

-- Les tables de checkpoints LangGraph (checkpoints, checkpoint_writes, ...)
-- sont créées par PostgresSaver.setup() côté apps/api au démarrage (Phase 5),
-- volontairement absentes ici pour ne pas dupliquer leur schéma interne.
