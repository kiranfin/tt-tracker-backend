# syntax=docker/dockerfile:1

# Node 22.13+ is required: node:sqlite (src/store/db.ts) is unflagged from there on.
ARG NODE_VERSION=22-alpine

# ---- Build: compile TypeScript to dist/ ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime: production dependencies + compiled output only ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Relative store/log paths (data/*.json, data/store.db, logs/requests.jsonl) resolve against /app.
# Both folders are mounted as volumes in docker-compose.yml.
RUN mkdir -p data logs && chown -R node:node data logs
USER node

# Inside the container the server must listen on all interfaces; the port is only published
# on 127.0.0.1 of the host (see docker-compose.yml), so it stays behind the reverse proxy.
ENV HOST=0.0.0.0 \
    PORT=4001
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly (not via npm) so SIGTERM from `docker stop` reaches the server
# and the cache is flushed to disk before exit.
CMD ["node", "dist/server.js"]
