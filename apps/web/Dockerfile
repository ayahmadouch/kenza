FROM node:20-slim AS base
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/

RUN npm install --workspace=apps/web --include-workspace-root

COPY apps/web apps/web

WORKDIR /repo/apps/web

EXPOSE 5173

# Vite dev server : suffisant pour la démo du hackathon (pas de build de prod
# requis par le cahier des charges). Le proxy /api et /ws pointe vers le
# service "api" du docker-compose.
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
