FROM node:20-slim AS base
WORKDIR /repo

# On copie tout le monorepo : nécessaire pour resoudre les workspaces
# npm (@kenza/db, @kenza/agent) sans registre privé.
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/agent/package.json packages/agent/

RUN npm install --workspaces --include-workspace-root

COPY packages/db packages/db
COPY packages/agent packages/agent
COPY apps/api apps/api
COPY data data

WORKDIR /repo/apps/api

EXPOSE 3001

# Le serveur applique lui-même les migrations + le seeder au démarrage
# (bootstrapDatabase) : aucune étape manuelle après `docker compose up`.
CMD ["npx", "tsx", "src/server.ts"]
