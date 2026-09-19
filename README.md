# Kenza — agent commercial autonome (#NumeosHack26, Sujet 02)

> ⚠️ **État réel de ce livrable, à lire avant tout.** Ce dépôt a été généré dans un
> environnement sans accès réseau ni Docker : je n'ai **pas pu exécuter**
> `npm install`, `docker compose up`, ni lancer les tests. Le code est complet et
> cohérent avec le cahier des charges, mais **non vérifié**. Attendez-vous à devoir
> corriger des erreurs de compilation/typage (notamment sur les signatures exactes de
> `@langchain/langgraph` et `@langchain/langgraph-checkpoint-postgres`, dont les API
> évoluent) à la première exécution. Section [Limites connues](#limites-connues) en bas.

## 1. Problème

Un commerçant marocain reçoit 150 à 300 messages par jour sur WhatsApp/chat. Il répond
quand il peut, et ne relance jamais les paniers abandonnés faute de temps.

## 2. Solution

Kenza est un agent commercial autonome : il qualifie le besoin, cherche dans le vrai
catalogue, vérifie le vrai stock, calcule la vraie livraison, gère le panier, crée
réellement la commande en base, relance les paniers abandonnés via une file de tâches,
et transfère à un humain avec le contexte complet dès qu'il sort de son domaine.

## 3. Architecture

```
React (simulateur chat + dashboard)
        │ WebSocket / REST
Fastify API ── LangGraph (StateGraph) ──► Tools (10, déterministes) ──► PostgreSQL
        │                                                                  ▲
        └── Redis (état court) ── BullMQ (relances) ── Worker Node ───────┘
```

### LLM vs Agent vs Orchestrateur vs Tool

- **LLM** : moteur de langage (endpoint Numeos, compatible OpenAI — `LLM_BASE_URL` /
  `LLM_API_KEY` / `LLM_MODEL`, aucun code spécifique à un fournisseur).
- **Agent** : LLM + prompt + état (`KenzaState`) + tools + capacité d'action.
- **Orchestrateur** : `packages/agent/graph.ts`, un `StateGraph` LangGraph.js explicite.
- **Tool** : fonction déterministe dans `packages/agent/tools/*.ts` qui lit/écrit
  PostgreSQL. Le LLM n'accède **jamais** directement à la base.

### Graphe LangGraph

```
START → intent
intent ─┬─(intention hors domaine/réclamation, ou confiance très basse traitée en aval)→ escalation
        ├─(besoin catalogue/stock/livraison/panier/commande)→ catalogue → conversation
        └─(clarification simple)→ conversation
conversation → guardrail
guardrail ─┬─ valid   → END
           ├─ retry   → conversation (1 seul essai supplémentaire)
           └─ escalate→ escalation
escalation → END
```

Nœuds : `intent_node`, `catalogue_node` (boucle de tool-calling réelle), `conversation_node`
(rédaction à partir des `facts` uniquement), `guardrail_node`, `escalation_node`.
Le nœud `multimodal_node` s'exécute en amont du graphe (audio/image → texte) car il
transforme l'entrée brute avant construction de l'état. Le nœud `relance` n'est **pas**
dans la boucle synchrone : il vit dans `packages/worker` (BullMQ), conformément à
l'interdiction du `setTimeout()` côté API.

### Zéro hallucination métier

Chaque tool retourne des `facts` typés avec leur source (`db:products.prix_mad`, etc.).
`guardrail_node` (`packages/agent/guardrails/guardrail.ts`) extrait tous les nombres du
brouillon final et vérifie qu'ils sont justifiables par un fact, le panier ou la
livraison calculée — sinon la réponse est rejetée (1 retry max, puis escalade). La
remise est plafonnée **en code** (`apply_discount`, plancher 10%), jamais seulement
dans le prompt.

### Mémoire

- **Courte** (Redis, `packages/agent/memory.ts`) : état conversationnel volatile.
- **Longue** (checkpointer PostgreSQL de LangGraph, `PostgresSaver`) : le `thread_id`
  est basé sur `client_id` (ou `telephone` à défaut), donc un client qui revient après
  un `docker compose restart` retrouve son fil de conversation.

### Guardrails, escalade

Voir `packages/agent/guardrails/guardrail.ts` et `packages/agent/nodes/escalation_node.ts`.
L'escalade écrit en base (`escalations`), passe `conversations.needs_human = true`
(l'agent doit alors ignorer cette conversation) et transmet motif + contexte complet
(derniers messages, panier, client) : le client ne se répète pas.

### Relances (BullMQ)

`packages/worker/src/scanner.ts` scanne les conversations à panier non vide, inactives
depuis plus de `DEMO_DELAY_MINUTES` (ou 24h par défaut), sans relance déjà planifiée.
Une relance est plannifiée une seule fois par panier, avec variante A/B alternée, et
reportée si elle tombe hors horaires boutique (10h-20h, lundi-samedi).
`packages/worker/src/index.ts` consomme la file et envoie le message (inséré comme
message `agent` en base), visible dans le chat, le dashboard et la table `relances`.

## 4. Base de données

Schéma : `packages/db/schema.sql`. Seeder : `packages/db/seeder/seed.ts` — idempotent
(`ON CONFLICT DO NOTHING` sur les tables à clé naturelle), lit `data/*.csv` sans jamais
les modifier, et **échoue au démarrage (FAIL FAST)** si les volumes ne correspondent
pas à `80/120/320/449/12/12`.

## 5. Installation

```bash
cp .env.example .env
# Renseigner LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (endpoint Numeos fourni)
docker compose up --build
```

- API : http://localhost:4000 (santé : `/health`)
- Web : http://localhost:5173
- Le seeder tourne automatiquement au démarrage du service `api` (voir
  `apps/api/Dockerfile`), aucune migration manuelle requise.

### Variables d'environnement (`.env.example`)

`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `DATABASE_URL`, `REDIS_URL`,
`DEMO_DELAY_MINUTES` (réduit le seuil panier abandonné de 24h à 1 min pour la démo),
`SHOP_OPEN_HOUR` / `SHOP_CLOSE_HOUR`, `DISCOUNT_MAX_PCT`.

## 6. Tests

```bash
npm run test:tools    # tools sans LLM (stock, remise, livraison, commande transactionnelle...)
npm run test:replay   # rejoue les 40 conversations, assertions programmatiques
```

`scripts/replay-conversations.ts` ne demande **jamais** au LLM si une réponse est
"correcte" : il vérifie mécaniquement langue==langue client, absence de nombre hors
facts, absence de promesse de réassort, alternative proposée en cas de rupture,
escalade sur ville inconnue / réclamation / remise hors plancher, mise à jour du
panier sur changement de taille, et un seuil de précision d'intention ≥ 85%.

## 7. EX-01 → EX-08

| # | Exigence | Où le vérifier |
|---|---|---|
| EX-01 | Conversation complète jusqu'à la commande | Simulateur de chat, onglet Commandes du dashboard |
| EX-02 | Tools réels, jamais de catalogue dans le prompt | `packages/agent/tools/`, trace visible dans le chat |
| EX-03 | Commande créée en base, `created_by='agent'` | `packages/agent/tools/order.ts`, onglet Commandes |
| EX-04 | Mémoire par client, survit à un restart | Checkpointer PostgreSQL (`graph.ts`), thread_id = client_id |
| EX-05 | Relance déclenchée par l'agent | `packages/worker/`, onglet Relances, `DEMO_DELAY_MINUTES=1` |
| EX-06 | Escalade avec contexte complet | `escalation_node.ts`, onglet Escalades |
| EX-07 | Dashboard (conversations, conversion, commandes, escalades) | `apps/web/src/Dashboard.tsx` |
| EX-08 | Français / arabe / darija | `packages/agent/prompts/{fr,ar,darija}` |

## 8. Scénario de démo (2 minutes)

1. Message darija mal orthographié ("chhal taman dyal ...") → recherche produit.
2. Stock + prix réels affichés, avec trace des tool calls dans le chat.
3. Ville de livraison → frais/délai réels calculés.
4. Confirmation → commande créée, visible immédiatement dans le dashboard.
5. Nouveau message "finalement en L" → panier mis à jour, total recalculé.
6. Demande d'un produit en rupture (ex. `REF-0019`) → alternative réelle proposée,
   aucun réassort promis.
7. Demande de 30% de remise → refus + escalade visible dans le dashboard.
8. Laisser un panier non finalisé, attendre `DEMO_DELAY_MINUTES` → relance visible
   dans le chat et la table `relances`.

## 9. Limites connues

- **Non exécuté** : voir avertissement en haut de ce fichier. Les points les plus
  susceptibles de nécessiter un ajustement : les imports/API exacts de
  `@langchain/langgraph` (`Annotation`, `StateGraph`) et de
  `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver.setup()`), qui changent
  entre versions ; le format exact des tool_calls retournés par le modèle Numeos ;
  la gestion des types audio/image dans `@langchain/openai`.
- Le frontend (chat + dashboard) est fonctionnel mais volontairement sobre (pas de
  design abouti).
- WhatsApp Cloud API n'est pas branché (hors périmètre assumé, cf. cahier des charges).
- Les tests unitaires et `replay-conversations.ts` sont écrits mais jamais exécutés :
  il faut s'attendre à devoir corriger des assertions après un premier run réel.

## 10. Bonus non couverts

Notes vocales et reconnaissance d'image sont câblées (`multimodal_node.ts`) avec
dégradation propre si le service échoue, mais n'ont pas pu être testées faute
d'accès réseau. A/B testing des relances est implémenté (alternance A/B + colonne
`resultat` pour mesurer la conversion).
