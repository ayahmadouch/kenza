FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY data ./data

ENV DATA_DIR=/app/data

EXPOSE 4000

# Le seeder est idempotent et FAIL FAST si les volumes sont incorrects :
# aucune migration manuelle n'est nécessaire après le démarrage.
CMD sh -c "npm run seed && npm run start:api"
