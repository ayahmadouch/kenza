FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY apps/web ./apps/web

EXPOSE 5173
CMD ["npm", "run", "dev:web"]
