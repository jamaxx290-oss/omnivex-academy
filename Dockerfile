# ============================================================
# Omnivex Academy — production image for a small VPS
# Tuned for 1 vCPU / 1 GB RAM (with 2 GB swap): multi-stage,
# memory-bounded build, fixed runtime heap.
#
#   Stage 1 deps    — npm ci + toolchain for better-sqlite3
#   Stage 2 build   — typecheck + vite build (PWA)
#   Stage 3 runtime — slim node, serves API + dist/ on :3000
# ============================================================

# ---- Stage 1: dependencies -----------------------------------
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- Stage 2: frontend build (bounded heap for 1 GB boxes) ---
FROM deps AS build
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=600
RUN npm run build

# ---- Stage 3: runtime ----------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    NODE_OPTIONS=--max-old-space-size=384

# tsx runs the server (npm start) and vite/tsc are kept so `npm run build`
# could run in-container if ever needed; the compiled sqlite binding from
# stage 1 is reused so better-sqlite3 is never recompiled here.
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src

# Persistent home for SQLite + uploads (mounted as a volume by compose)
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
