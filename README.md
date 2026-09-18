# Kenza — Agent commercial autonome (#NumeosHack26, Sujet 02)

> **État du dépôt : Phase 3 (Socle) terminée et validée.**
> Les phases suivantes (tools, graphe LangGraph, guardrails, darija, worker,
> dashboard, tests) seront ajoutées incrémentalement — voir la méthode
> d'exécution du prompt maître.

## Ce qui fonctionne à ce stade

- `docker compose up` démarre 5 services : `web`, `api`, `postgres`, `redis`, `worker`.
- Au démarrage, l'API applique automatiquement la migration SQL puis exécute
  le seeder — **aucune étape manuelle**.
- Le seeder est **idempotent** (`ON CONFLICT DO NOTHING`, rejouable sans
  doublon) et **fail-fast** : si les volumes ne correspondent pas exactement
  à `80 produits / 120 clients / 320 commandes / 449 lignes / 12 villes /
  12 promotions`, le process quitte en erreur plutôt que de démarrer avec une
  base incomplète.
- `GET /api/health` vérifie la connectivité PostgreSQL.
- L'app web affiche un statut de santé minimal (le simulateur de chat et le
  dashboard arrivent en Phase 10).

Validé dans le bac à sable de développement (PostgreSQL 16 + Redis 7 locaux,
Docker non disponible dans cet environnement) :
- comptages exacts 80/120/320/449/12/12 ;
- ré-exécution du seeder sans doublon (idempotence) ;
- faits métier vérifiés en base : REF-0019/REF-0020 (Caftan beige S/M) à
  stock 0, REF-0021 (Caftan beige L) en promotion et en stock (piège
  promotion ≠ disponibilité), 15 références à stock 0 au total, grille de
  livraison à 12 villes conforme à `data/livraison.csv`, `created_by='humain'`
  pour les 320 commandes historiques ;
- compilation TypeScript stricte sans erreur.

## Lancement

```bash
cp .env.example .env
# renseigner LLM_BASE_URL / LLM_API_KEY / LLM_MODEL fournis par Numeos
docker compose up
```

- Web : http://localhost:5173
- API : http://localhost:3001/api/health

## Lancement sans Docker (dev local)

```bash
npm install
# démarrer PostgreSQL 16 et Redis 7 localement, puis :
export DATABASE_URL=postgresql://user:pass@localhost:5432/kenza
npm run seed        # migrate + seed, idempotent
npm run dev:api
npm run dev:web
```

## Architecture (résumé — détails complets en fin de projet)

```
kenza/
├── docker-compose.yml   # 5 services, healthchecks, depends_on conditionnel
├── data/                # CSV/JSONL/MD fournis, jamais modifiés
├── apps/
│   ├── web/              # React 18 + Vite + TS + Tailwind
│   └── api/               # Fastify — bootstrap DB, health, (WS + graphe en Phase 5)
│       └── src/worker.ts  # process worker BullMQ (placeholder, Phase 8)
├── packages/
│   ├── agent/            # StateGraph LangGraph — Phase 5
│   └── db/                # schéma Drizzle, migration SQL, seeder idempotent
└── scripts/seed.ts        # wrapper CLI migrate+seed
```

## Prochaines phases

4. Les 10 tools (search_catalog, check_stock, get_price, get_shipping_cost,
   apply_discount, update_cart, create_order, suggest_alternatives,
   get_client_history, escalate), testés sans LLM.
5. StateGraph LangGraph + checkpointer PostgreSQL + état Redis.
6. Guardrails (zéro hallucination, plancher de remise, anti-réassort).
7. Darija / arabe / français, normalisation arabizi, few-shots masqués.
8. Worker BullMQ (relances, A/B testing, DEMO_DELAY_MINUTES).
9. Multimodal (STT, vision).
10. Dashboard commerçant complet.
11. `scripts/replay-conversations.ts`.
12. Finition (README complet EX-01→EX-08, script de démo).
