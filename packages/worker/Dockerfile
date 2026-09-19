FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY packages ./packages
COPY data ./data

ENV DATA_DIR=/app/data

CMD ["npm", "run", "start:worker"]
