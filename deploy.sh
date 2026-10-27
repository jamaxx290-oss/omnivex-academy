#!/usr/bin/env bash
# =============================================================
# Omnivex Academy — one-command container deploy for a small VPS
# Tuned for: 1 vCPU / 1 GB RAM / 2 GB swap / ~35 GB SSD.
# The app runs in Docker so it stays isolated from the other
# apps on the server.
#
#   git pull            (you do this yourself)
#   ./deploy.sh         (this script does the rest)
#
# Helpers:
#   ./deploy.sh logs      tail the app logs
#   ./deploy.sh restart   restart the container
#   ./deploy.sh stop      stop the container
#   ./deploy.sh status    show container status + health
#   ./deploy.sh backup    copy the database + uploads aside
# =============================================================
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;35m%s\033[0m\n' "$*"; }

# ---- 0. Preflight ----------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Docker is not installed. Install it first:"
  echo "  curl -fsSL https://get.docker.com | sh"
  exit 1
fi
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  say "Docker Compose is not available. Install the docker-compose-plugin."
  exit 1
fi

SWAP_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
if [ "${SWAP_KB:-0}" -lt 1572864 ]; then
  say "WARNING: less than 1.5 GB swap detected — the 1 GB build may thrash."
  echo "Create a 2 GB swap file with:"
  echo "  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
fi

# ---- 1. Environment secrets ------------------------------------
if [ ! -f .env ]; then
  if [ -f env.template ]; then
    cp env.template .env
    chmod 600 .env
    say ".env created from env.template."
    echo "Fill in ADMIN_PASSWORD and APP_URL, then run this script again."
    exit 1
  fi
  say "No .env and no env.template — cannot configure the app."
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  say "WARNING: ADMIN_PASSWORD is empty in .env — the first admin sign-in needs it."
fi

# ---- 2. Persistent data folder ---------------------------------
mkdir -p data
if [ "$(id -u)" = "0" ]; then chown -R 1000:1000 data || true; fi

# ---- 3. Build + start the container ---------------------------
say "Building the image (bounded memory)…"
"${COMPOSE[@]}" build --build-arg NODE_OPTIONS=--max-old-space-size=512

say "Starting the container…"
"${COMPOSE[@]}" up -d

# ---- 4. Health check -------------------------------------------
say "Waiting for the app to become healthy…"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    say "✔ Omnivex Academy is up on port ${PORT:-3000}"
    "${COMPOSE[@]}" ps
    exit 0
  fi
  sleep 3
done

say "The app did not answer /api/health in time. Logs:"
"${COMPOSE[@]}" logs --tail=120
exit 1