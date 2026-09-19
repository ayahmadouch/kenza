# STATUS

Vérifié par exécution (sandbox sans Docker/PG/Redis/LLM) : `tsc --noEmit` API+agent+worker+web OK ; tests unitaires règles 54/54, guardrail+routage 51/51, horaires/A-B 9/9.
Vérifié précédemment sur PostgreSQL 16 : seeder + `npm run test:tools` 37/37.

NON exécuté : `docker compose up`, graphe avec le vrai LLM, worker sur Redis, `npm run test:replay`, `vite build` (binaire rollup natif absent de ce sandbox).
Premier réflexe au démarrage : `docker compose up --build`, puis `docker compose exec api npm run test:replay` et corriger les prompts selon `replay-report.json`.

Sécurité : le .env d'origine contenait une clé LLM réelle ; il est exclu de cette archive. Régénérez cette clé.
