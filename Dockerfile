# ============================================================
# Omnivex Academy — production image for a small VPS
# Tuned for 1 vCPU / 1 GB RAM (with 2 GB swap): multi-stage,
# memory-bounded build, fixed runtime heap.
#
#   Stage 1 deps    — npm ci + build toolchain
#   Stage 2 build   — typecheck + vite build (dist/)
#   Stage 3 runtime — slim node, serves API + dist/ on :3000
# ============================================================

# ---- Stage 1: dependencies -------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- Stage 2: build --------------------------------------------
FROM deps AS build
COPY . .
# Bounded heap so the build survives a 1 GB box (plus 2 GB swap).
RUN NODE_OPTIONS=--max-old-space-size=608 npm run build

# ---- Stage 3: runtime ------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src/server ./src/server
COPY tsconfig.json ./

# Data directory for SQLite + uploads (mounted as a named volume).
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]
USER node
EXPOSE 3000

ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Fixed, modest heap: the app stays inside its container budget on a shared box.
CMD ["node", "--max-old-space-size=384", "--import", "tsx", "src/server/index.ts"]